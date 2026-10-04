import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DEFAULT_VIEWPORT, expectedCount, migrateSettings, videoSettings, type ExtractSettings, type Job, type Snapshot, type SpaceEstimate, type ViewportPrefs } from '../shared/types'
import type { ProcessingWorker } from './worker'

export function viewport(value: Partial<ViewportPrefs>): ViewportPrefs {
  const result = { ...DEFAULT_VIEWPORT, ...value }
  const keys = [result.zoomIn, result.zoomOut, result.fit, result.actual, result.close]
  if (keys.some(key => typeof key !== 'string' || key.length > 150 || !/^(?:(?:Control|Alt|Shift|Meta)\+)*(?:[A-Za-z][A-Za-z0-9]*)(?:\+[A-Za-z][A-Za-z0-9]*)*$/.test(key) || key==='F2' || !key.split('+').some(part=>!['Control','Alt','Shift','Meta'].includes(part))) || new Set(keys).size !== keys.length) throw new Error('快捷键无效、重复或使用了菜单专用 F2，请重新设置。')
  if (!['control','alt','shift','none','disabled'].includes(result.wheel) || !['space','middle','left'].includes(result.pan)) throw new Error('画面操作设置无效。')
  if (!Number.isFinite(result.longPressMs) || result.longPressMs < 150 || result.longPressMs > 1000 || !Number.isFinite(result.zoomStep) || result.zoomStep < 1.05 || result.zoomStep > 2) throw new Error('长按时间或缩放步长超出范围。')
  result.longPressPan = result.longPressPan === true
  return result
}

export function spaceEstimate(state: Snapshot, ids: string[]): SpaceEstimate {
  let frames = 0, minBytes = 0, maxBytes = 0
  for (const video of state.videos.filter(v => ids.includes(v.id))) {
    const s = videoSettings(video, state.settings), info = video.info
    if (!info) continue
    const count = expectedCount(info.duration, s)
    const sarWidth = info.width * (info.sar || 1), rotated = Math.abs(info.rotation || 0) % 180 === 90
    const sourceW = rotated ? info.height : sarWidth, sourceH = rotated ? sarWidth : info.height
    const regions = [s.crop, ...(s.cropSegments || []).map(item => item.rect)]
    const pixels = Math.max(...regions.map(rect => {
      const w = sourceW * (rect?.width || 1), h = sourceH * (rect?.height || 1), ratio = Math.min(1, (s.maxWidth || w)/w)
      return w*h*ratio*ratio
    }))
    frames += count
    minBytes += count * (pixels * (s.format === 'png' ? .5 : .08) + 1024)
    maxBytes += count * (pixels * (s.format === 'png' ? 3.1 : .8) + 4096)
    if (s.autoStitch) maxBytes += count * s.thumbWidth * Math.ceil(s.thumbWidth * sourceH/sourceW + (s.notesEnabled ? s.noteHeight : 0) + 30)*.8
    if (video.source === 'online' && !video.downloadedPath) maxBytes += Math.max(info.size || 0, info.duration*1_000_000)
  }
  let freeBytes: number | null = null, folder = path.resolve(state.outputRoot)
  try { let existing = folder; while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing); const stat = fs.statfsSync(existing); freeBytes = stat.bavail*stat.bsize } catch {}
  return { frames, minBytes: Math.ceil(minBytes), maxBytes: Math.ceil(maxBytes), freeBytes, sufficient: freeBytes === null || freeBytes > maxBytes + 16*1024*1024, folder }
}

export function registerServices(c: { handle(name: string, fn: (...args: any[]) => unknown): void; getState(): Snapshot; changed(): void; getWindow(): BrowserWindow; worker: ProcessingWorker; settings(value: ExtractSettings): ExtractSettings; asset(file: string): string; allowed: Set<string>; busy(): boolean }) {
  const { handle } = c, saved = (name: string) => path.join(app.getPath('userData'), name)
  const atomic = (file: string, value: unknown) => { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file+'.tmp', JSON.stringify(value, null, 2)); fs.renameSync(file+'.tmp',file) }
  const read = (file: string, fallback: any) => { try { return JSON.parse(fs.readFileSync(file,'utf8')) } catch { return fallback } }
  const active = () => c.busy() || c.getState().jobs.some(j => ['waiting','running'].includes(j.status))
  handle('save-viewport', (value: ViewportPrefs) => { c.getState().viewport = viewport(value); c.changed() })
  handle('estimate', (ids: string[]) => spaceEstimate(c.getState(), Array.isArray(ids) ? ids : []))
  handle('archive-jobs', (ids: string[]) => {
    const state = c.getState(), selected = state.jobs.filter(j => ids.includes(j.id))
    if (selected.some(j => ['waiting','running'].includes(j.status))) throw new Error('请先等待或取消所选任务。')
    const all = read(saved('archived-jobs.json'), []) as Job[]
    atomic(saved('archived-jobs.json'), [...all.filter(j => !ids.includes(j.id)), ...selected.map(j => ({...j,archived:true}))])
    state.jobs = state.jobs.filter(j => !ids.includes(j.id)); c.changed()
  })
  handle('restore-archives', () => {
    const state = c.getState(), all = read(saved('archived-jobs.json'), []) as Job[]
    for (const job of all) if (!state.jobs.some(j => j.id === job.id)) { state.jobs.push({...job,archived:false}); if (job.folder) c.allowed.add(path.resolve(job.folder)) }
    atomic(saved('archived-jobs.json'), []); c.changed()
    return all.length
  })
  handle('import-results', async () => {
    const pick = await dialog.showOpenDialog(c.getWindow(), {title:'选择已有截图的输出文件夹',properties:['openDirectory']})
    if (pick.canceled) return 0
    const root = path.resolve(pick.filePaths[0]), recordDir = path.join(root,'任务记录')
    if (!fs.existsSync(recordDir)) throw new Error('这个文件夹没有“任务记录”，请选择具体视频的输出文件夹。')
    const files = fs.readdirSync(recordDir).filter(name => name.endsWith('.json') && !name.startsWith('恢复-')).slice(0,1000)
    const state = c.getState(); let added = 0
    for (const name of files) {
      const file = path.join(recordDir,name)
      if (fs.statSync(file).size > 50*1024*1024) continue
      const data = read(file,null)
      if (!data || !Array.isArray(data.frames) || data.frames.length > 100000) continue
      if (state.jobs.some(job => path.resolve(job.manifest || '.') === file)) continue
      const pending=read(saved('pending-backup-drafts.json'),[]) as any[]
      const draft=pending.find(entry=>entry?.sourceKey&&entry.sourceKey===data.sourceKey&&entry.name===data.name&&Array.isArray(entry.frames)&&entry.frames.length===data.frames.length&&entry.frames.every((frame:any,index:number)=>frame.name===data.frames[index].name))
      if(draft){data.notes={...data.notes,...draft.notes};data.stitchDraft=draft.stitchDraft || data.stitchDraft;data.sheetRecipes={...data.sheetRecipes,...draft.sheetRecipes}}
      const rebase = (old: string) => {
        if (typeof old !== 'string') throw new Error('任务记录中的路径无效。')
        const parts = old.replace(/\\/g,'/').split('/'), parent = parts.lastIndexOf('拼接图')
        const result=path.resolve(root, ...(parent >= 0 ? parts.slice(parent) : [parts.at(-1)!]))
        const relative=path.relative(root,result)
        if(relative.startsWith('..')||path.isAbsolute(relative)||!/\.(png|jpg|jpeg)$/i.test(result))throw new Error('任务记录中的拼图路径超出输出文件夹。')
        return result
      }
      for (const frame of data.frames) {
        if (typeof frame.name !== 'string' || path.basename(frame.name) !== frame.name || !/\.(png|jpg)$/i.test(frame.name) || !Number.isFinite(frame.target) || !Number.isFinite(frame.actual)) throw new Error('任务记录中的图片信息无效。')
        frame.path = path.join(root,frame.name)
      }
      const oldSheets: string[] = data.sheets || []
      data.sheets = oldSheets.map(rebase)
      data.sheetRecipes = Object.fromEntries(Object.entries(data.sheetRecipes || {}).map(([key,value]) => [rebase(key),value]))
      for (const history of data.stitchHistory || []) history.sheets = (history.sheets || []).map(rebase)
      const id = randomUUID(), relocated = data.frames.some((frame: any) => !fs.existsSync(frame.path))
      const source = data.sourcePath || data.video?.path || data.video?.downloadedPath
      const job: Job = {id,videoId:data.video?.id || randomUUID(),name:data.name || path.basename(root),status:'done',stage:relocated?'部分源图缺失':'已恢复结果',progress:100,completed:data.frames.length,total:data.frames.length,count:data.frames.length,createdAt:new Date().toISOString(),settings:c.settings(data.settings || migrateSettings()),outputRoot:path.dirname(root),folder:root,sourcePath:source,manifest:path.join(recordDir,`恢复-${id}.json`),sheets:data.sheets,missing:data.frames.filter((f:any)=>!fs.existsSync(f.path)).length}
      if (!draft&&!relocated && data.frames.every((f:any) => typeof f.path === 'string')) {
        // Reuse the original record when the selected output directory has not moved.
        const original = read(file,null)
        if (original?.frames.every((f:any)=>path.dirname(path.resolve(f.path)) === root)) job.manifest = file
      }
      if (job.manifest !== file) atomic(job.manifest!,data)
      c.allowed.add(root); state.jobs.push(job); added++
    }
    if (!added) throw new Error('没有新的可恢复任务记录，或结果已在队列中。')
    c.changed(); return added
  })
  handle('save-template', (name: string, value: ExtractSettings) => {
    if (typeof name !== 'string' || !name.trim() || name.length > 60) throw new Error('模板名称应为 1～60 个字符。')
    const state = c.getState(), existing = state.templates.find(t=>t.name===name.trim())
    const template = {id:existing?.id || randomUUID(),name:name.trim(),settings:c.settings(value)}
    state.templates = [...state.templates.filter(t=>t.id!==template.id),template]; c.changed()
  })
  handle('remove-template', (id: string) => { c.getState().templates = c.getState().templates.filter(t=>t.id!==id); c.changed() })
  handle('export-workspace', async () => {
    if (active()) throw new Error('请等待或取消任务后再导出备份，确保备注与记录完整。')
    const pick = await dialog.showSaveDialog(c.getWindow(), {title:'保存工作区备份',defaultPath:`拾帧备份-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'工作区备份',extensions:['json']}]})
    if (pick.canceled || !pick.filePath) return false
    const state = c.getState(), drafts = Object.fromEntries(state.jobs.filter(j=>j.manifest&&fs.existsSync(j.manifest)).map(j=>[j.id,read(j.manifest!,null)]))
    const settings = {...state.settings,cookiePath:''}
    const videos = state.videos.map(v=>({...v,mediaUrl:undefined,thumbnailUrl:undefined,previewPath:undefined,previewSource:undefined,previewStatus:undefined,previewError:undefined,override:v.override?{...v.override,cookiePath:''}:undefined}))
    const jobs = state.jobs.map(j=>({...j,settings:{...j.settings,cookiePath:''}}))
    const backup = {version:1,application:'Framepick',savedAt:new Date().toISOString(),workspace:{...state,health:undefined,settings,videos,jobs,paused:true},drafts}
    atomic(pick.filePath,JSON.parse(JSON.stringify(backup,(key,value)=>key==='cookiePath'?'':key==='mediaUrl'||key==='thumbnailUrl'?undefined:value)))
    return true
  })
  handle('import-workspace', async () => {
    if (active()) throw new Error('请先等待或取消当前任务。')
    const pick = await dialog.showOpenDialog(c.getWindow(), {title:'导入工作区备份',properties:['openFile'],filters:[{name:'工作区备份',extensions:['json']}]})
    if (pick.canceled) return
    const file = pick.filePaths[0]
    if (fs.statSync(file).size > 100*1024*1024) throw new Error('备份超过 100 MB，请检查文件。')
    const data = read(file,null), source = data?.workspace
    if (data?.application !== 'Framepick' || data.version !== 1 || !Array.isArray(source?.videos) || !Array.isArray(source.projects) || !Array.isArray(source.jobs) || source.videos.length>10000 || source.jobs.length>10000) throw new Error('不是有效的拾帧备份。')
    const state = c.getState()
    // Validate the full backup before changing the current workspace.
    for(const project of source.projects)if(!project||typeof project.id!=='string'||typeof project.name!=='string')throw new Error('备份中的项目无效。')
    for(const video of source.videos){if(!video||typeof video.id!=='string'||typeof video.name!=='string'||!['local','online'].includes(video.source))throw new Error('备份中的素材无效。');if(video.override)c.settings(video.override)}
    for(const job of source.jobs){if(!job||typeof job.id!=='string'||typeof job.videoId!=='string'||typeof job.name!=='string')throw new Error('备份中的任务无效。');c.settings(job.settings)}
    c.settings(source.settings);viewport(source.viewport || DEFAULT_VIEWPORT)
    for(const template of source.templates || []){if(!template||typeof template.name!=='string')throw new Error('备份中的模板无效。');c.settings(template.settings)}
    atomic(saved(`导入前备份-${Date.now()}.json`),state)
    atomic(saved('pending-backup-drafts.json'),[...read(saved('pending-backup-drafts.json'),[]),...Object.values(data.drafts || {})].filter(Boolean).slice(-10000))
    const map = new Map<string,string>(), id = (old:string)=>{ if (!map.has(old)) map.set(old,randomUUID()); return map.get(old)! }
    for (const project of source.projects) state.projects.push({...project,id:id(project.id),name:`${String(project.name).slice(0,50)}（导入）`})
    for (const video of source.videos) {
      const v = {...video,id:id(video.id),projectId:video.projectId?id(video.projectId):undefined,mediaUrl:undefined,thumbnailUrl:undefined}
      if (!['local','online'].includes(v.source)) continue
      if (v.override) v.override = c.settings(v.override)
      const base=v.override||c.settings(source.settings),range=v.extractRange||{start:base.start,end:base.end},limit=Number.isFinite(v.info?.duration)?Math.max(0,v.info.duration):Infinity
      const start=Number.isFinite(range.start)?Math.max(0,Math.min(range.start,Math.max(0,limit-.001))):0,end=range.end===null?null:Number.isFinite(range.end)?Math.min(Math.max(0,range.end),limit):null
      v.extractRange=end!==null&&end<=start?{start:0,end:null}:{start,end}
      if (v.source === 'local' && (!v.path || !fs.existsSync(v.path))) { v.status='error';v.error='素材路径已失效，请点击重新定位。' }
      const media=v.source==='local'?v.path:v.downloadedPath
      if(media&&fs.existsSync(media))v.mediaUrl=c.asset(media)
      if(v.info?.thumbnail&&fs.existsSync(v.info.thumbnail))v.thumbnailUrl=c.asset(v.info.thumbnail)
      state.videos.push(v)
    }
    for (const old of source.jobs) {
      const job = {...old,id:id(old.id),videoId:id(old.videoId),settings:c.settings(old.settings),status:['done','error','cancelled'].includes(old.status)?old.status:'cancelled'} as Job
      const draft = data.drafts?.[old.id]
      if (job.folder && c.allowed.has(path.resolve(job.folder)) && fs.existsSync(job.folder) && draft) {
        const restored = path.join(job.folder,'任务记录',`恢复-${job.id}.json`)
        atomic(restored,draft);job.manifest=restored;c.allowed.add(path.resolve(job.folder))
      } else if (job.manifest && !fs.existsSync(job.manifest)) { job.error='结果位置已失效，可用“重新导入结果”恢复。' }
      state.jobs.push(job)
    }
    state.templates = [...state.templates,...(source.templates || []).map((t:any)=>({...t,id:randomUUID(),settings:c.settings(t.settings)}))]
    state.viewport = viewport(source.viewport || DEFAULT_VIEWPORT)
    state.timeInputMode=source.timeInputMode==='milliseconds'?'milliseconds':'clock'
    state.settings = c.settings({...source.settings,cookiePath:''});state.paused=true;c.changed()
  })
  handle('relocate-video', async (id: string) => {
    const video = c.getState().videos.find(v=>v.id===id)
    if (!video) throw new Error('视频已移除。')
    if (c.getState().jobs.some(j=>j.videoId===id && ['waiting','running'].includes(j.status))) throw new Error('请先等待或取消这个视频的任务。')
    const pick = await dialog.showOpenDialog(c.getWindow(), {title:'重新定位视频文件',properties:['openFile']})
    if (pick.canceled) return
    const info = await c.worker.request('probe',{path:pick.filePaths[0]})
    if (video.source==='local') video.path=pick.filePaths[0];else video.downloadedPath=pick.filePaths[0]
    video.previewPath=undefined;video.previewSource=undefined;video.previewStatus=undefined;video.localReady=true;video.info=info;video.status='ready';video.error=undefined;video.mediaUrl=c.asset(pick.filePaths[0]);if(info.thumbnail)video.thumbnailUrl=c.asset(info.thumbnail);c.changed()
  })
  let release: any = null, updating = false
  async function latest() {
    const response = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'Framepick','Accept':'application/vnd.github+json'}})
    if (!response.ok) throw new Error(`检查解析器更新失败（${response.status}），请检查网络后重试。`)
    const value:any = await response.json()
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(value.tag_name) || !Array.isArray(value.assets)) throw new Error('官方版本信息不完整。')
    release=value;return value
  }
  handle('decoder-status', async () => {
    const local = await c.worker.request('decoder-version'), value = await latest()
    return {...local,latest:value.tag_name,updateAvailable:local.version!==value.tag_name,canRollback:fs.existsSync(saved('decoder/yt-dlp.previous.exe'))}
  })
  handle('update-decoder', async () => {
    if (active() || updating) throw new Error('请等待队列结束后更新解析器。')
    updating=true
    const target=saved('decoder/yt-dlp.exe'),temp=target+'.tmp',previous=saved('decoder/yt-dlp.previous.exe')
    let installed=false
    try {
      const value=await latest(), pick=(name:string)=>value.assets.find((a:any)=>a.name===name)?.browser_download_url
      const binary=pick('yt-dlp.exe'), checksums=pick('SHA2-256SUMS')
      if (![binary,checksums].every(url=>typeof url==='string'&&url.startsWith('https://github.com/yt-dlp/yt-dlp/releases/download/'))) throw new Error('官方更新下载地址无效。')
      const download=async(url:string)=>{const r=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!r.ok)throw new Error(`下载更新失败（${r.status}）。`);return r}
      const sums=await(await download(checksums)).text(),match=sums.split('\n').map(line=>line.trim().split(/\s+/)).find(parts=>parts[1]?.replace(/^\*/,'')==='yt-dlp.exe')
      if (!match || !/^[0-9a-f]{64}$/i.test(match[0])) throw new Error('缺少官方完整性校验信息。')
      const bytes=Buffer.from(await(await download(binary)).arrayBuffer())
      if (bytes.length>100*1024*1024 || createHash('sha256').update(bytes).digest('hex')!==match[0].toLowerCase()) throw new Error('更新文件校验失败，继续使用原版本。')
      fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(temp,bytes)
      await c.worker.request('verify-decoder',{path:temp,version:value.tag_name})
      const local=await c.worker.request('decoder-version')
      fs.copyFileSync(local.path,previous);fs.renameSync(temp,target);installed=true
      await c.worker.request('use-decoder',{path:target})
      atomic(saved('decoder/version.json'),{version:value.tag_name,sha256:match[0],updatedAt:new Date().toISOString()})
    } catch(error) { if (installed&&fs.existsSync(previous)&&fs.existsSync(target)) {fs.copyFileSync(previous,target);await c.worker.request('use-decoder',{path:target}).catch(()=>{})};throw error }
    finally {fs.rmSync(temp,{force:true});updating=false}
  })
  handle('rollback-decoder', async()=>{
    if (active() || updating) throw new Error('请等待队列结束后回退解析器。')
    const previous=saved('decoder/yt-dlp.previous.exe'),target=saved('decoder/yt-dlp.exe')
    if (!fs.existsSync(previous)) throw new Error('没有可回退的解析器版本。')
    const version=await c.worker.request('verify-decoder',{path:previous})
    fs.copyFileSync(previous,target);await c.worker.request('use-decoder',{path:target})
    atomic(saved('decoder/version.json'),{version:version.version,rolledBackAt:new Date().toISOString()})
  })
}
