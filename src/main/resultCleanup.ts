import fs from 'node:fs'
import path from 'node:path'
import {shell} from 'electron'
import type {Job} from '../shared/types'

const key=(file:string)=>path.resolve(file).toLowerCase()
const write=(file:string,data:unknown)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(data));fs.renameSync(file+'.tmp',file)}
const owned=(file:string,folder:string)=>{const relative=path.relative(fs.realpathSync(folder),fs.realpathSync(file));return !relative.startsWith('..')&&!path.isAbsolute(relative)&&!fs.lstatSync(file).isSymbolicLink()}

// Update every live or archived result referencing a successfully deleted file.
export async function cleanupResults(jobs:Job[],removed:Set<string>,errors:string[]):Promise<string[]>{
  const retired:string[]=[],folders=new Map<string,Set<string>>()
  for(const job of jobs){
    if(!job.manifest||!job.folder||!fs.existsSync(job.manifest))continue
    try{
      if(!owned(job.manifest,job.folder)||fs.statSync(job.manifest).size>64*1024*1024)throw new Error('结果记录位置无效或过大')
      const data=JSON.parse(fs.readFileSync(job.manifest,'utf8'))
      const deleted=(data.frames||[]).filter((f:any)=>typeof f.path==='string'&&removed.has(key(f.path)))
      const deletedSheets=(data.sheets||[]).filter((f:string)=>removed.has(key(f)))
      if(!deleted.length&&!deletedSheets.length)continue
      const names=new Set<string>(deleted.map((f:any)=>f.name))
      const folderKey=key(job.folder),collected=folders.get(folderKey)||new Set<string>();for(const name of names)collected.add(name);folders.set(folderKey,collected)
      const cleanSettings=(settings:any)=>{if(!settings)return;settings.frameOrder=(settings.frameOrder||[]).filter((n:string)=>!names.has(n));for(const n of names)if(settings.markerPositions)delete settings.markerPositions[n]}
      data.frames=(data.frames||[]).filter((f:any)=>!removed.has(key(f.path)))
      data.sheets=(data.sheets||[]).filter((f:string)=>!removed.has(key(f)))
      for(const n of names)if(data.notes)delete data.notes[n]
      cleanSettings(data.stitchDraft);cleanSettings(data.settings);cleanSettings(job.settings)
      for(const [file,recipe] of Object.entries(data.sheetRecipes||{}) as [string,any][]){
        if(removed.has(key(file))){delete data.sheetRecipes[file];continue}
        recipe.names=(recipe.names||[]).filter((n:string)=>!names.has(n));for(const n of names)if(recipe.notes)delete recipe.notes[n];cleanSettings(recipe.settings)
      }
      data.stitchHistory=(data.stitchHistory||[]).map((h:any)=>({...h,names:(h.names||[]).filter((n:string)=>!names.has(n)),sheets:(h.sheets||[]).filter((f:string)=>!removed.has(key(f)))})).filter((h:any)=>h.sheets.length)
      // A deletion failure remains referenced because it is absent from removed.
      write(job.manifest,data)
      job.count=data.frames.length;job.completed=data.frames.length;job.total=data.frames.length;job.sheets=data.sheets;job.missing=0
      if(!data.frames.length&&!data.sheets.length){await shell.trashItem(job.manifest);retired.push(job.id)}
    }catch{errors.push(`${job.name}：文件删除已完成，但对应结果记录未能完全清理，请重试或移除记录。`)}
  }
  for(const [folder,names] of folders){
    const registry=path.join(folder,'.framepick-frames.json')
    try{if(!fs.existsSync(registry)||!owned(registry,folder))continue;const data=JSON.parse(fs.readFileSync(registry,'utf8'));for(const name of names)if(data.frames)delete data.frames[name];if(Object.keys(data.frames||{}).length)write(registry,data);else await shell.trashItem(registry)}
    catch{errors.push('部分截图索引未能清理；其余文件和记录已经处理。')}
  }
  return retired
}
