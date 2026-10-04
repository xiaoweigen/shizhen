import {app,dialog,shell,BrowserWindow} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import type {DeletePlan,DeleteRequest,Snapshot,TimeRange,VideoItem} from '../shared/types'
import {videoSettings} from '../shared/types'
import type {ProcessingWorker} from './worker'
import {requireLocalVideo} from './media'
import {cleanupResults} from './resultCleanup'

export function registerEditing(c:{handle(name:string,fn:(...args:any[])=>unknown):void;state():Snapshot;changed():void;window():BrowserWindow;worker:ProcessingWorker;publicInfo(video:VideoItem):VideoItem;allowed:Set<string>;pump():void;flushDrafts(ids:string[]):Promise<void>}) {
  const {handle}=c
  const previewRequests=new Map<string,{id:string;promise:Promise<{mediaUrl:string}>}>()
  const previewIds=new Map<string,string>()
  const plans=new Map<string,{request:DeleteRequest;at:number;files:(DeletePlan['files'][number]&{mtime:number})[]}>()
  const video=(id:string)=>{const v=c.state().videos.find(v=>v.id===id);if(!v)throw new Error('视频已不在列表中。');return v}
  const active=(ids:string[])=>{if(c.state().jobs.some(j=>ids.includes(j.videoId)&&['waiting','running'].includes(j.status)))throw new Error('请先完成或取消这个视频的处理任务。')}
  handle('set-close-action',(value:Snapshot['closeAction'])=>{if(!['ask','tray','quit'].includes(value))throw new Error('关闭窗口设置无效。');c.state().closeAction=value;c.changed()})
  handle('set-trim-enabled',(id:string,value:boolean)=>{video(id).trimEnabled=value===true;c.changed()})
  handle('prepare-preview',(id:string,force=false)=>{
    if(previewRequests.has(id))return previewRequests.get(id)!.promise
    const v=video(id)
    requireLocalVideo(v)
    if(!force){c.publicInfo(v);return {mediaUrl:v.mediaUrl!}}
    const identity=randomUUID();previewIds.set(identity,id);v.previewStatus='preparing';v.previewProgress=0;v.previewError=undefined;c.changed()
    const promise=c.worker.request('prepare-preview',{video:v,settings:videoSettings(v,c.state().settings),force:force===true},identity).then(result=>{
      if(!c.state().videos.includes(v))throw new Error('视频已从列表移除。')
      v.previewPath=result.path;v.previewSource=result.source;c.allowed.add(path.resolve(result.source));v.previewStatus='ready';v.previewProgress=100;c.publicInfo(v);c.changed();return {mediaUrl:v.mediaUrl!}
    }).catch((e:Error)=>{v.previewStatus='error';v.previewError=e.message;c.changed();throw e}).finally(()=>{previewRequests.delete(id);previewIds.delete(identity)})
    previewRequests.set(id,{id:identity,promise});return promise
  })
  handle('cancel-preview',(id:string)=>{const request=previewRequests.get(id);if(request)c.worker.cancel(request.id)})
  // Forward background preview progress without inserting an export job into the queue.
  const previous=c.worker.onProgress
  c.worker.onProgress=(id,data)=>{
    const videoId=previewIds.get(id)
    if(videoId){const v=c.state().videos.find(v=>v.id===videoId);if(v){v.previewProgress=Math.min(99,Math.round(data.progress||0));if(data.previewSource)v.previewSource=data.previewSource;c.changed()}}
    else previous(id,data)
  }
  handle('trim-video',async(id:string,ranges:TimeRange[],join:boolean)=>{
    const v=video(id);active([id]);requireLocalVideo(v);const duration=v.info?.duration||0
    if(!v.trimEnabled)throw new Error('请先在视频操作中勾选启用视频剪切。')
    if(!Array.isArray(ranges)||!ranges.length||ranges.length>100||typeof join!=='boolean')throw new Error('请至少保留一个视频时段。')
    const clean=ranges.map(r=>({start:r.start,end:r.end})).sort((a,b)=>a.start-b.start)
    if(clean.some((r,i)=>![r.start,r.end].every(Number.isFinite)||r.start<0||r.end<=r.start||r.end>duration+.001||(i>0&&r.start<clean[i-1].end)))throw new Error('剪切时段重叠或超出视频时长。')
    const chosen=await dialog.showOpenDialog(c.window(),{title:'选择剪切视频的保存文件夹',properties:['openDirectory','createDirectory'],defaultPath:c.state().downloadRoot})
    if(chosen.canceled||!chosen.filePaths[0])return false
    if(!c.state().videos.includes(v))throw new Error('视频已被移除。');active([id])
    const root=path.resolve(chosen.filePaths[0]);c.allowed.add(root)
    c.state().jobs.push({id:randomUUID(),kind:'trim',videoId:id,name:v.name,status:'waiting',stage:'等待剪切',progress:0,completed:0,total:join?1:clean.length,createdAt:new Date().toISOString(),settings:{...videoSettings(v,c.state().settings)},outputRoot:root,trimRanges:clean,trimJoin:join})
    c.state().paused=false;c.changed();c.pump();return true
  })
  handle('reveal-path',async(file:string)=>{
    if(typeof file!=='string'||!c.allowed.has(path.resolve(file)))throw new Error('该文件位置尚未授权。')
    const resolved=path.resolve(file)
    if(!fs.existsSync(resolved))throw new Error('文件已删除或移动。')
    if(fs.statSync(resolved).isDirectory()){const error=await shell.openPath(resolved);if(error)throw new Error(error)}else shell.showItemInFolder(resolved)
  })
  handle('plan-delete',async(request:DeleteRequest):Promise<DeletePlan>=>{
    if(!request||typeof request!=='object')throw new Error('请选择要删除的文件。')
    if(request.jobId)await c.flushDrafts([request.jobId])
    const files:(DeletePlan['files'][number]&{mtime:number})[]=[]
    const add=(raw:string,category:string,folder?:string)=>{
      if(typeof raw!=='string'||!fs.existsSync(raw))return
      const resolved=fs.realpathSync(raw),stat=fs.lstatSync(raw)
      if(!stat.isFile()||stat.isSymbolicLink())return
      if(folder){const rel=path.relative(fs.realpathSync(folder),resolved);if(rel.startsWith('..')||path.isAbsolute(rel))return}
      if(files.some(f=>f.path.toLowerCase()===resolved.toLowerCase()))return
      c.allowed.add(path.resolve(resolved))
      files.push({id:randomUUID(),name:path.basename(resolved),path:resolved,category,size:stat.size,mtime:stat.mtimeMs})
    }
    const affected:string[]=[]
    if(request.videoId){
      const v=video(request.videoId);affected.push(v.id)
      if(v.path)add(v.path,v.derivedFrom?'剪切视频':'本地原视频')
      if(v.downloadedPath)add(v.downloadedPath,'已下载视频')
      const cache=path.join(app.getPath('userData'),'cache','playback')
      if(fs.existsSync(cache))for(const file of [v.previewSource,v.previewPath])if(file)add(file,'视频预览缓存',cache)
    }
    if(request.jobId){
      const job=c.state().jobs.find(j=>j.id===request.jobId);if(!job)throw new Error('任务已不存在。');affected.push(job.videoId)
      if(!job.manifest)throw new Error('请选择抽帧结果；原视频不属于导出图片删除范围。')
      if(job.manifest&&job.folder&&fs.existsSync(job.manifest)){
        if(fs.statSync(job.manifest).size>64*1024*1024)throw new Error('结果记录过大。')
        const manifest=JSON.parse(fs.readFileSync(job.manifest,'utf8'))
        const names=request.names?new Set(request.names):null,sheets=request.sheets?new Set(request.sheets):null
        if(!sheets)for(const f of manifest.frames||[])if((!names||names.has(f.name))&&/\.(jpg|jpeg|png)$/i.test(f.path||''))add(f.path,'抽帧图片',job.folder)
        if(!names)for(const file of manifest.sheets||[])if((!sheets||sheets.has(file))&&/\.(jpg|jpeg|png)$/i.test(file))add(file,'拼接图片',job.folder)
      }
    }
    active(affected)
    if(affected.some(id=>previewRequests.has(id)))throw new Error('预览仍在准备，请等待完成或取消后再删除。')
    if(!files.length)throw new Error('没有可删除的已保存文件。')
    for(const [token,p] of plans)if(Date.now()-p.at>300000)plans.delete(token)
    const token=randomUUID();plans.set(token,{request,at:Date.now(),files});return {token,files:files.map(({mtime,...file})=>file)}
  })
  handle('delete-files',async(token:string,ids:string[])=>{
    const plan=plans.get(token)
    if(!plan||Date.now()-plan.at>300000||!Array.isArray(ids)||!ids.length)throw new Error('删除清单过期或没有勾选文件，请重新确认。')
    const chosen=plan.files.filter(f=>ids.includes(f.id))
    if(new Set(ids).size!==chosen.length)throw new Error('删除清单不匹配。')
    const affected=plan.request.videoId?[plan.request.videoId]:c.state().jobs.filter(j=>j.id===plan.request.jobId).map(j=>j.videoId)
    active(affected);if(affected.some(id=>previewRequests.has(id)))throw new Error('请先取消正在准备的预览。')
    await c.flushDrafts(c.state().jobs.filter(j=>affected.includes(j.videoId)).map(j=>j.id))
    // Validate the complete selection before changing any file. Never recursively delete a folder.
    for(const f of chosen){const stat=fs.lstatSync(f.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==f.size||stat.mtimeMs!==f.mtime)throw new Error('文件发生变化，请重新打开删除清单。')}
    let deleted=0;const errors:string[]=[];const removed=new Set<string>()
    for(const f of chosen){try{await shell.trashItem(f.path);removed.add(f.path.toLowerCase());deleted++}catch{errors.push(`${f.name}：无法移入回收站，文件保留，请关闭占用它的程序。`)}}
    plans.delete(token)
    const archiveFile=path.join(app.getPath('userData'),'archived-jobs.json')
    let archived:Snapshot['jobs']=[]
    try{if(fs.existsSync(archiveFile))archived=JSON.parse(fs.readFileSync(archiveFile,'utf8'))}catch{errors.push('归档记录读取失败，已保留原记录。')}
    const removedJobIds=await cleanupResults([...c.state().jobs,...archived],removed,errors)
    c.state().jobs=c.state().jobs.filter(j=>!removedJobIds.includes(j.id))
    if(archived.length)try{fs.writeFileSync(archiveFile+'.tmp',JSON.stringify(archived.filter(j=>!removedJobIds.includes(j.id))));fs.renameSync(archiveFile+'.tmp',archiveFile)}catch{errors.push('归档记录更新失败，请先保留当前工作区。')}
    for(const v of c.state().videos)if([v.path,v.downloadedPath,v.previewPath,v.previewSource].some(p=>p&&removed.has(path.resolve(p).toLowerCase()))){
      const originalDeleted=!!v.path&&removed.has(path.resolve(v.path).toLowerCase())
      if(v.downloadedPath&&removed.has(path.resolve(v.downloadedPath).toLowerCase()))v.downloadedPath=undefined
      v.previewPath=undefined;v.previewSource=undefined;v.previewStatus='error';v.previewError='保存的视频或兼容预览已删除。请重新定位或手动下载视频。';v.mediaUrl=undefined
      if(originalDeleted&&v.source==='local'){v.status='error';v.error='视频文件已删除。列表记录保留，可移除记录或重新定位。'}
      c.publicInfo(v)
    }
    c.changed();return {deleted,errors,removedJobIds}
  })
}
