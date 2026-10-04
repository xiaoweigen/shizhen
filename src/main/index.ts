import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell, Tray } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { DEFAULT_VIEWPORT, ExtractSettings, Job, Snapshot, VideoItem, CropRect, CropSegment, expectedCount, migrateSettings, videoSettings } from '../shared/types'
import { ProcessingWorker, WorkerFailure } from './worker'
import { registerServices, spaceEstimate, viewport } from './services'
import {anonymousCookies} from './anonymous'
import {registerEditing} from './editing'
import {localVideoPath, requireLocalVideo} from './media'

const hidden = process.argv.includes('--hidden')
if (hidden) { app.disableHardwareAcceleration(); app.setPath('userData', path.resolve(process.env.FRAMEPICK_TEST_DATA || '.test-artifacts/user-data')) }
const ownsWorkspace=app.requestSingleInstanceLock()
if(!ownsWorkspace)app.quit()
protocol.registerSchemesAsPrivileged([{ scheme: 'framepick-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }])

let window: BrowserWindow | undefined
let worker: ProcessingWorker
let state: Snapshot
let busy = false
let quitting = false
let tray:Tray|undefined
let closePrompt=false
app.on('second-instance',()=>{window?.show();if(window?.isMinimized())window.restore();window?.focus()})
let persistTimer: NodeJS.Timeout | undefined
const assets = new Map<string, string>()
const assetIds = new Map<string, string>()
const allowedPaths = new Set<string>()
const draftWrites = new Map<string, Promise<unknown>>()

function asset(file: string): string {
  const absolute = path.resolve(file)
  allowedPaths.add(absolute)
  let id = assetIds.get(absolute)
  if (!id) { id = randomUUID(); assetIds.set(absolute, id); assets.set(id, absolute) }
  let version = 0
  try { version = fs.statSync(absolute).mtimeMs } catch {}
  return `framepick-media://asset/${id}?v=${version}`
}
function publicInfo(video: VideoItem) {
  const source = localVideoPath(video)
  video.localReady = !!source
  // Old online preview downloads are never used as the processing source.
  if (!source || (video.previewSource && path.resolve(video.previewSource).toLowerCase() !== source.toLowerCase())) {
    video.previewPath = undefined; video.previewSource = undefined; video.previewStatus = undefined
  }
  const playable = source && video.previewSource && video.previewPath && fs.existsSync(video.previewPath) ? video.previewPath : source
  if (playable && fs.existsSync(playable)) { allowedPaths.add(path.resolve(playable)); video.mediaUrl = asset(playable); if (video.source === 'online') allowedPaths.add(path.dirname(path.resolve(playable))) }
  else video.mediaUrl = undefined
  if (video.info?.thumbnail) video.thumbnailUrl = asset(video.info.thumbnail)
  return video
}
function saveState() {
  if(!state)return
  const file = path.join(app.getPath('userData'), 'workspace.json')
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file + '.tmp', JSON.stringify({ ...state, health: undefined, paused: true }))
    fs.renameSync(file + '.tmp', file)
  } catch { /* Do not interrupt processing when preference storage is unavailable. */ }
}
function changed() {
  for (const video of state.videos) {
    publicInfo(video)
    const download = [...state.jobs].reverse().find(job => job.videoId === video.id && job.kind === 'download')
    video.downloadStatus = download?.status; video.downloadProgress = download?.progress
    video.downloadError = download?.error; video.downloadJobId = download?.id
  }
  const processing=state.jobs.find(job=>job.status==='running')
  if(window&&!window.isDestroyed())window.setProgressBar(processing?Math.max(.01,Math.min(1,processing.progress/100)):-1)
  tray?.setToolTip(processing?`拾帧 · ${processing.stage} · ${Math.round(processing.progress)}%`.slice(0,120):'拾帧 · 视频抽帧与拼接')
  if (window && !window.isDestroyed()) window.webContents.send('state', state)
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(saveState, 300)
}
function settings(value: ExtractSettings): ExtractSettings {
  const result = migrateSettings(value)
  for (const key of ['interval', 'start', 'quality', 'rows', 'columns', 'perSheet', 'thumbWidth', 'padding', 'onlineQuality', 'noteHeight', 'noteFontSize'] as const) {
    if (!Number.isFinite(result[key])) throw new Error('设置中存在无效数字。')
  }
  if (result.interval < .001 || result.start < 0 || (result.end !== null && (!Number.isFinite(result.end) || result.end <= result.start))) throw new Error('请检查时间间隔和起止范围。')
  if (!['jpg', 'png'].includes(result.format) || !['skip', 'overwrite', 'batch'].includes(result.conflict)) throw new Error('导出设置无效。')
  result.quality = Math.max(1, Math.min(100, result.quality))
  if (!['grid', 'horizontal', 'vertical'].includes(result.layout)) throw new Error('拼接布局无效。')
  result.columns = Math.max(1, Math.min(20, Math.round(result.columns)))
  result.rows = Math.max(1, Math.min(20, Math.round(result.rows)))
  result.perSheet = result.layout === 'grid' ? result.rows * result.columns : Math.max(1, Math.min(100, Math.round(result.perSheet)))
  result.thumbWidth = Math.max(80, Math.min(1920, Math.round(result.thumbWidth)))
  result.padding = Math.max(0, Math.min(100, Math.round(result.padding)))
  result.noteHeight = Math.max(40, Math.min(500, Math.round(result.noteHeight)))
  result.noteFontSize = Math.max(8, Math.min(36, Math.round(result.noteFontSize)))
  result.notesEnabled = result.notesEnabled === true
  if(!Number.isFinite(result.markerSize) || result.markerSize<12 || result.markerSize>120 || !['circle','number'].includes(result.markerStyle) || !['tl','tr','bl','br'].includes(result.markerCorner) || !/^#[0-9a-f]{6}$/i.test(result.markerColor) || !/^#[0-9a-f]{6}$/i.test(result.markerBackground)) throw new Error('图序号设置无效。')
  result.markersEnabled=result.markersEnabled===true;result.markerContinuous=result.markerContinuous===true;result.markerSize=Math.round(result.markerSize)
  if(!result.markerPositions || typeof result.markerPositions!=='object' || Array.isArray(result.markerPositions) || Object.keys(result.markerPositions).length>100000) throw new Error('图序号位置无效。')
  for(const [name,point] of Object.entries(result.markerPositions)) if(path.basename(name)!==name || !point || ![point.x,point.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1)) throw new Error('图序号位置超出画面。')
  if (result.crop) {
    const { x, y, width, height } = result.crop
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001) throw new Error('裁剪区域超出画面。')
    result.crop = { x, y, width, height }
  }
  if (!Array.isArray(result.cropSegments) || result.cropSegments.length > 200) throw new Error('裁剪时段最多 200 个。')
  if (result.cropSegments.some(segment=>!segment || typeof segment!=='object' || !Number.isFinite(segment.start))) throw new Error('裁剪时段格式无效。')
  result.cropSegments = [...result.cropSegments].sort((a,b) => a.start-b.start)
  if (!Array.isArray(result.frameOrder) || result.frameOrder.length>100000 || result.frameOrder.some(name=>typeof name!=='string'||path.basename(name)!==name||name.length>200)) throw new Error('图片顺序信息无效。')
  result.frameOrder=[...new Set(result.frameOrder)]
  let previousEnd = -1
  for (const segment of result.cropSegments) {
    if (!segment || typeof segment.id !== 'string' || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start) throw new Error('请检查裁剪时段的起止时间。')
    if (segment.start < previousEnd - 1e-9) throw new Error('裁剪时段不能重叠；相接的边界使用后一段。')
    previousEnd = segment.end
    if (segment.rect) {
      const {x,y,width,height} = segment.rect
      if (![x,y,width,height].every(Number.isFinite) || x<0 || y<0 || width<=0 || height<=0 || x+width>1.000001 || y+height>1.000001) throw new Error('裁剪时段的区域超出画面。')
    }
  }
  if (!['interval','scene'].includes(result.sampling) || !['auto','off','hable','reinhard'].includes(result.hdrMode)) throw new Error('抽帧方式或 HDR 设置无效。')
  if (!Number.isFinite(result.similarity) || result.similarity<0 || result.similarity>100 || !Number.isFinite(result.sceneThreshold) || result.sceneThreshold<1 || result.sceneThreshold>100) throw new Error('画面变化阈值应在有效范围内。')
  for (const color of [result.noteColor,result.noteBackground]) if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('文字颜色无效。')
  if (!['left','center','right'].includes(result.noteAlign) || !['yahei','arial'].includes(result.noteFont)) throw new Error('文字样式无效。')
  if (!/^#[0-9a-f]{6}$/i.test(result.background)) throw new Error('背景颜色无效。')
  if (result.maxWidth !== null && (!Number.isFinite(result.maxWidth) || result.maxWidth < 16 || result.maxWidth > 16384)) throw new Error('图片宽度应在 16～16384 像素之间。')
  return result
}
async function addFiles(paths: string[], projectId = state.activeProjectId || undefined, derivedFrom?:string) {
  if (!Array.isArray(paths)) throw new Error('请选择视频文件。')
  const promises: Promise<void>[] = []
  for (const raw of paths.slice(0, 500)) {
    if (typeof raw !== 'string') continue
    const file = path.resolve(raw)
    if (state.videos.some(v => v.path?.toLowerCase() === file.toLowerCase())) continue
    const video: VideoItem = { id: randomUUID(), name: path.basename(file, path.extname(file)), source: 'local', path: file, status: 'reading', projectId,derivedFrom,extractRange:{start:0,end:null} }
    state.videos.push(video)
    changed()
    promises.push(worker.request('probe', { path: file }).then(info => {
      video.info = info; video.status = 'ready'; publicInfo(video); changed()
    }).catch((error: Error) => { video.status = 'error'; video.error = error.message; changed() }))
  }
  await Promise.all(promises)
}
async function pump() {
  if (busy || state.paused || quitting) return
  const job = state.jobs.find(item => item.status === 'waiting')
  if (!job) return
  const video = state.videos.find(item => item.id === job.videoId)
  if (!video) { job.status = 'error'; job.error = '原视频已从列表移除。'; changed(); return pump() }
  busy = true
  job.status = 'running'; job.stage = job.kind === 'download' ? '准备下载' : '准备处理'; job.error = undefined; changed()
  try {
    const download = job.kind === 'download'
    const trim=job.kind==='trim'
    if (!download) requireLocalVideo(video)
    const result = await worker.request(trim?'trim-video':download ? 'download-video' : 'process', { video, settings: job.settings, outputRoot: job.outputRoot, jobId: job.id, resumeFolder: job.folder,ranges:job.trimRanges,join:job.trimJoin }, job.id)
    if (download) {
      video.downloadedPath = result.downloadPath; video.previewPath=undefined;video.previewSource=undefined;video.previewStatus=undefined;video.info = result.info; publicInfo(video)
      allowedPaths.add(path.resolve(result.downloadPath))
      delete result.info
    }
    if(trim)await addFiles(result.outputFiles,video.projectId,video.id)
    Object.assign(job, result, { status: 'done', stage: trim?'剪切完成':download ? '下载完成' : result.stage || '处理完成', progress: 100 })
    allowedPaths.add(path.resolve(result.folder))
  } catch (error) {
    job.status = error instanceof WorkerFailure && error.cancelled ? 'cancelled' : 'error'
    job.stage = job.status === 'cancelled' ? '已取消' : job.kind === 'download' ? '下载失败' : '处理失败'
    job.error = error instanceof Error ? error.message : '处理失败。'
  } finally { busy = false; changed(); void pump() }
}
function queueDownload(video: VideoItem, root: string): boolean {
  if (state.jobs.some(job => job.videoId === video.id && ['waiting', 'running'].includes(job.status))) return false
  allowedPaths.add(root)
  state.jobs.push({ id: randomUUID(), kind: 'download', videoId: video.id, name: video.name, status: 'waiting', stage: '等待下载', progress: 0, completed: 0, total: 0, createdAt: new Date().toISOString(), settings: { ...(video.override || state.settings) }, outputRoot: root })
  state.paused = false
  return true
}
function registerIPC() {
  const handle = (name: string, fn: (...args: any[]) => unknown) => ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效访问。')
    return fn(...args)
  })
  handle('snapshot', () => state)
  const validProject = (id: string | null) => {
    if (id !== null && !state.projects.some(project => project.id === id)) throw new Error('项目不存在，请重新选择。')
  }
  const projectName = (name: string, except?: string) => {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) throw new Error('项目名称应为 1～60 个字符。')
    const clean = name.trim()
    if (state.projects.some(project => project.id !== except && project.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new Error('已有同名项目，请换一个名称。')
    return clean
  }
  handle('create-project', (name: string) => {
    const project = { id: randomUUID(), name: projectName(name), collapsed: false }
    state.projects.push(project); state.activeProjectId = project.id; changed(); return project.id
  })
  handle('update-project', (id: string, value: { name?: string; collapsed?: boolean; pinned?: boolean }) => {
    validProject(id)
    const project = state.projects.find(item => item.id === id)!
    if (value.name !== undefined) project.name = projectName(value.name, id)
    if (value.collapsed !== undefined) project.collapsed = Boolean(value.collapsed)
    if (value.pinned !== undefined) project.pinnedAt = value.pinned ? Date.now() : undefined
    changed()
  })
  handle('set-active-project', (id: string | null) => {
    validProject(id); state.activeProjectId = id
    const project = state.projects.find(item => item.id === id)
    if (project) project.collapsed = false
    changed()
  })
  handle('move-videos', (ids: string[], projectId: string | null) => {
    validProject(projectId)
    if (!Array.isArray(ids)) throw new Error('请先选择视频。')
    for (const video of state.videos) if (ids.includes(video.id)) video.projectId = projectId || undefined
    const project = state.projects.find(item => item.id === projectId)
    if (project) project.collapsed = false
    changed()
  })
  handle('remove-project', (id: string) => {
    validProject(id)
    state.projects = state.projects.filter(item => item.id !== id)
    for (const video of state.videos) if (video.projectId === id) video.projectId = undefined
    if (state.activeProjectId === id) state.activeProjectId = null
    changed()
  })
  handle('pick-videos', async (batch: boolean) => {
    const result = await dialog.showOpenDialog(window!, { title: batch ? '批量添加视频' : '添加一个视频', properties: batch ? ['openFile', 'multiSelections'] : ['openFile'], filters: [{ name: '视频', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'ts', 'm2ts', 'flv', 'wmv'] }, { name: '所有文件', extensions: ['*'] }] })
    if (!result.canceled) await addFiles(result.filePaths)
  })
  handle('add-files', addFiles)
  const removeVideos = (ids: string[]) => {
    if (!Array.isArray(ids) || !ids.length) throw new Error('请先选择视频。')
    if (state.jobs.some(j => ids.includes(j.videoId) && ['waiting', 'running'].includes(j.status))) throw new Error('所选视频仍有待处理任务，请先取消或等待完成。')
    state.videos = state.videos.filter(v => !ids.includes(v.id)); changed()
  }
  handle('remove-video', (id: string) => removeVideos([id]))
  handle('remove-videos', removeVideos)
  handle('pin-video', (id: string, pinned: boolean) => {
    const video = state.videos.find(item => item.id === id)
    if (!video) throw new Error('视频已不在列表中。')
    video.pinnedAt = pinned ? Date.now() : undefined; changed()
  })
  handle('set-crop', (id: string, crop: CropRect | null, segments?: CropSegment[]) => {
    const video = state.videos.find(item => item.id === id)
    if (!video) throw new Error('视频已不在列表中。')
    const value = settings({ ...videoSettings(video, state.settings), crop, cropSegments: segments || video.cropSegments || [] })
    if (value.cropSegments.some(segment=>segment.end>(video.info?.duration || Infinity)+.001)) throw new Error('裁剪时段不能超过视频时长。')
    video.crop = value.crop; video.cropSegments = value.cropSegments; changed()
  })
  handle('resolve-links', async (text: string) => {
    if (!state.health.ready) throw new Error(state.health.message)
    const projectId = state.activeProjectId || undefined
    if (typeof text !== 'string' || text.length > 30000) throw new Error('链接内容过长。')
    const links = [...new Set(text.match(/https?:\/\/[^\s<>"\u3000]+/g) || [])].slice(0, 50)
    if (!links.length) throw new Error('没有找到视频链接。')
    const selected = await dialog.showOpenDialog(window!, { title: '选择视频下载保存位置', defaultPath: state.downloadRoot, properties: ['openDirectory', 'createDirectory'] })
    if (selected.canceled || !selected.filePaths[0]) return { added: 0, ids: [], errors: [], queued: 0, reused: 0, cancelled: true }
    const root = path.resolve(selected.filePaths[0])
    state.downloadRoot = root
    let added = 0
    let queued = 0, reused = 0
    const ids: string[] = []
    const errors: string[] = []
    for (const link of links) {
      try {
        const anonymousSettings={...state.settings,cookiePath:''}
        let data
        try { data=await worker.request('resolve',{text:link,settings:anonymousSettings}) }
        catch(firstError) {
          const detail=firstError instanceof Error?firstError.message:''
          if(detail.includes('【链接类型】')||detail.includes('【视频不可用】')||detail.includes('没有找到视频链接')||detail.includes('当前支持'))throw firstError
          const guestCookies=await anonymousCookies(link).catch(()=>[])
          try {data=await worker.request('resolve',{text:link,settings:anonymousSettings,guestCookies})}
          catch(anonymousError) {
            if(!state.settings.cookiePath)throw anonymousError
            data=await worker.request('resolve',{text:link,settings:state.settings})
          }
        }
        const existing = state.videos.find(v => v.source === 'online' && v.remoteId === data.remoteId && v.platform === data.platform)
        if (existing) {
          if (ids.includes(existing.id)) continue
          if (localVideoPath(existing)) reused++
          else { existing.info=data.info; existing.publicShare=data.publicShare; if(queueDownload(existing,root))queued++ }
          publicInfo(existing); ids.push(existing.id); continue
        }
        const id = randomUUID()
        const video = publicInfo({ ...data, id, source: 'online', status: 'ready', extractRange:{start:0,end:null}, projectId: state.projects.some(project => project.id === projectId) ? projectId : undefined })
        state.videos.push(video); queueDownload(video, root); queued++; ids.push(id); added++; changed()
      } catch (error) { errors.push(error instanceof Error ? error.message : '解析失败。') }
    }
    for (const video of state.videos.filter(v => ids.includes(v.id))) {
      const project = state.projects.find(p => p.id === video.projectId)
      if (project) project.collapsed = false
    }
    changed()
    void pump()
    return { added, ids, errors, queued, reused }
  })
  handle('download-video', async (id: string) => {
    if (!state.health.ready) throw new Error(state.health.message)
    const video = state.videos.find(item => item.id === id)
    if (!video || video.source !== 'online' || video.status !== 'ready') throw new Error('请先解析在线视频，再选择下载。')
    if (state.jobs.some(job => job.videoId === id && ['waiting', 'running'].includes(job.status))) throw new Error('这个视频已有待处理任务，请等待完成或先取消。')
    const result = await dialog.showOpenDialog(window!, { title: '选择视频下载保存位置', defaultPath: state.downloadRoot, properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return false
    if (!state.videos.includes(video)) throw new Error('视频已从列表移除。')
    if (state.jobs.some(job => job.videoId === id && ['waiting', 'running'].includes(job.status))) throw new Error('这个视频已有待处理任务。')
    state.downloadRoot = path.resolve(result.filePaths[0])
    queueDownload(video, state.downloadRoot)
    changed(); void pump(); return true
  })
  handle('choose-output', async () => {
    const result = await dialog.showOpenDialog(window!, { title: '选择截图保存的根目录', defaultPath: state.outputRoot, properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled) return null
    state.outputRoot = result.filePaths[0]; allowedPaths.add(path.resolve(state.outputRoot)); changed(); return state.outputRoot
  })
  handle('choose-cookie', async () => {
    const result = await dialog.showOpenDialog(window!, { title: '选择 Netscape 格式的 Cookie 文件', properties: ['openFile'], filters: [{ name: 'Cookie 文件', extensions: ['txt'] }] })
    return result.canceled ? null : result.filePaths[0]
  })
  handle('save-settings', (value: ExtractSettings) => { state.settings = settings(value); changed() })
  handle('save-time-input-mode', (mode: string) => {
    if (!['clock','milliseconds'].includes(mode)) throw new Error('时间输入方式无效。')
    state.timeInputMode = mode as Snapshot['timeInputMode']; changed()
  })
  handle('set-extract-ranges', (ids:string[], range:{start:number;end:number|null}) => {
    if (!Array.isArray(ids) || !ids.length || ids.length>500 || !range || !Number.isFinite(range.start) || range.start<0 || (range.end!==null&&(!Number.isFinite(range.end)||range.end<=range.start))) throw new Error('截取范围无效。')
    const changes = [...new Set(ids)].map(id=>{
      const video=state.videos.find(v=>v.id===id), duration=video?.info?.duration || 0
      if(!video||range.start>=duration)throw new Error(`${video?.name || '视频'} 的起点超出时长，请调整后再应用。`)
      return {video,range:{start:range.start,end:range.end===null?null:Math.min(range.end,duration)}}
    })
    for(const change of changes)change.video.extractRange=change.range
    changed()
  })
  handle('set-override', (id: string, value: ExtractSettings | null) => {
    const video = state.videos.find(v => v.id === id)
    if (video) { video.override = value ? settings(value) : undefined; if(video.override)video.extractRange={start:video.override.start,end:video.override.end}; changed() }
  })
  handle('enqueue', (ids: string[]) => {
    if (!state.health.ready) throw new Error(state.health.message)
    if (!Array.isArray(ids) || !ids.length) throw new Error('请先选择视频。')
    for (const id of new Set(ids)) { const video=state.videos.find(v=>v.id===id); if(video)requireLocalVideo(video) }
    const estimate = spaceEstimate(state,ids)
    if (!estimate.sufficient) throw new Error('保存位置的可用空间不足，请减少图片数量、降低尺寸或更换保存位置。')
    for (const id of new Set(ids)) {
      const video = state.videos.find(v => v.id === id)
      if (!video || video.status !== 'ready') continue
      if (state.jobs.some(j => j.videoId === id && ['waiting', 'running'].includes(j.status))) continue
      const parameters = settings(videoSettings(video, state.settings))
      if (parameters.cropSegments.some(segment=>segment.end>(video.info?.duration || Infinity)+.001)) throw new Error(`${video.name} 的裁剪时段超过视频时长，请调整。`)
      const count = expectedCount(video.info?.duration || 0, parameters)
      if (video.info?.duration && (!count || count > 100000)) throw new Error(`${video.name} 的时间范围或预计图片数量不合适，请调整参数。`)
    }
    for (const id of new Set(ids)) {
      const video = state.videos.find(v => v.id === id)
      if (!video || video.status !== 'ready' || state.jobs.some(j => j.videoId === id && ['waiting', 'running'].includes(j.status))) continue
      const parameters = settings(videoSettings(video, state.settings))
      state.jobs.push({ id: randomUUID(), videoId: id, name: video.name, status: 'waiting', stage: '等待处理', progress: 0, completed: 0, total: expectedCount(video.info?.duration || 0, parameters), createdAt: new Date().toISOString(), settings: parameters, outputRoot: state.outputRoot })
    }
    state.paused = false; changed(); void pump()
  })
  handle('cancel-job', (id: string) => {
    const job = state.jobs.find(j => j.id === id)
    if (!job) return
    if (job.status === 'waiting') { job.status = 'cancelled'; job.stage = '已取消' }
    else if (job.status === 'running') { job.stage = '正在取消'; worker.cancel(id) }
    changed()
  })
  handle('retry-job', (id: string) => {
    const job = state.jobs.find(j => j.id === id)
    if (!job || !['error', 'cancelled'].includes(job.status)) return
    if (state.jobs.some(other => other.id !== id && other.videoId === job.videoId && ['waiting', 'running'].includes(other.status))) throw new Error('这个视频已有待处理任务，请等待完成或先取消。')
    job.status = 'waiting'; job.error = undefined; job.stage = '等待重试'
    state.paused = false; changed(); void pump()
  })
  handle('pause-queue', (paused: boolean) => { state.paused = Boolean(paused); changed(); void pump() })
  handle('cancel-jobs',(ids:string[])=>{
    if(!Array.isArray(ids)||!ids.length)throw new Error('请先选择任务。')
    for(const job of state.jobs.filter(job=>ids.includes(job.id))){if(job.status==='waiting'){job.status='cancelled';job.stage='已取消'}else if(job.status==='running'){job.stage='正在取消';worker.cancel(job.id)}}
    changed()
  })
  handle('retry-jobs',(ids:string[])=>{
    if(!Array.isArray(ids)||!ids.length)throw new Error('请先选择任务。')
    const selected=state.jobs.filter(job=>ids.includes(job.id)&&['error','cancelled'].includes(job.status)),seen=new Set(state.jobs.filter(job=>['waiting','running'].includes(job.status)).map(job=>job.videoId)),eligible:Job[]=[]
    for(const job of selected){if(seen.has(job.videoId)||!state.videos.some(video=>video.id===job.videoId))continue;seen.add(job.videoId);eligible.push(job)}
    if(!eligible.length)throw new Error('没有可重试任务，或所选视频已有待处理任务；源视频缺失时请先重新导入或定位。')
    for(const job of eligible){job.status='waiting';job.stage='等待重试';job.error=undefined}
    state.paused=false;changed();void pump();return{queued:eligible.length,skipped:selected.length-eligible.length}
  })
  handle('results', async (id: string, page: number, sheetPage=0) => {
    const job = state.jobs.find(j => j.id === id)
    if (!job?.manifest || !fs.existsSync(job.manifest)) return { frames: [], total: 0, sheets: [] }
    const data = JSON.parse(fs.readFileSync(job.manifest, 'utf-8'))
    const validFrame = (frame: any) => {
      if (typeof frame.path !== 'string') return false
      const relative = path.relative(path.resolve(job.folder!), path.resolve(frame.path))
      return !relative.startsWith('..') && !path.isAbsolute(relative) && /\.(jpg|png)$/i.test(frame.path)
    }
    const existingFrames=(data.frames || []).filter(validFrame).filter((frame:any)=>fs.existsSync(frame.path))
    const currentPage=Math.max(0,Math.min(Math.floor(page||0),Math.ceil(existingFrames.length/60)-1))
    const start=currentPage*60
    const frames = existingFrames.slice(start,start+60)
    const sheetFiles = (data.sheets || []).filter((file:string) => typeof file==='string' && !path.relative(path.resolve(job.folder!),path.resolve(file)).startsWith('..') && fs.existsSync(file))
    const currentSheetPage=Math.max(0,Math.min(Math.floor(sheetPage||0),Math.ceil(sheetFiles.length/20)-1))
    const thumbnails = await worker.request('thumbnails',{files:[...frames.map((f:any)=>f.path),...sheetFiles.slice(currentSheetPage*20,currentSheetPage*20+20)]})
    const small = new Map<string,any>(thumbnails.map((entry:any)=>[entry.path,entry]))
    job.missing = (data.frames || []).filter((frame:any)=>!validFrame(frame)||!fs.existsSync(frame.path)).length
    return {
      frames: frames.map((frame:any)=>({ ...frame, url:asset(frame.path), thumbnailUrl:small.get(frame.path)?.thumbnail?asset(small.get(frame.path).thumbnail):undefined,width:small.get(frame.path)?.width,height:small.get(frame.path)?.height })),
      total: existingFrames.length,
      page:currentPage,
      sheetPage:currentSheetPage,
      missing: job.missing,
      notes: data.notes || {}, stitchDraft: migrateSettings(data.stitchDraft || job.settings),
      sheets: sheetFiles.map((file: string) => {
        let recipe = data.sheetRecipes?.[file]
        if (!recipe) {
          // Reconstruct editable pages from older manifests and automatic exports.
          const history = (data.stitchHistory || []).find((entry: any) => entry.sheets.includes(file))
          const value = migrateSettings(history?.settings || data.settings || job.settings)
          const all = [...(data.frames || [])].sort((a: any, b: any) => a.target - b.target).filter((f: any) => !history || history.names.includes(f.name))
          const list = history?.sheets || (data.sheets || []).filter((s: string) => !(data.stitchHistory || []).some((h: any) => h.sheets.includes(s)))
          const offset = Math.max(0, list.indexOf(file)) * value.perSheet
          const names = all.slice(offset, offset + value.perSheet).map((f: any) => f.name)
          recipe = { names, settings: value, notes: Object.fromEntries(names.map((name: string) => [name, history ? data.notes?.[name] || '' : ''])), offset }
        }
        return { path: file, url: asset(file), thumbnailUrl:small.get(file)?.thumbnail?asset(small.get(file).thumbnail):undefined, recipe: { ...recipe, settings: migrateSettings(recipe.settings) } }
      })
    }
  })
  handle('stitch-preview', async (id: string, names: string[], value: ExtractSettings, page: number, notes?: Record<string, string>, offset = 0) => {
    const job = state.jobs.find(j => j.id === id)
    if (!job?.manifest) throw new Error('未找到截图记录。')
    const result = await worker.request('stitch-preview', { manifest: job.manifest, names: Array.isArray(names) ? names : [], settings: settings(value), page: Math.max(0, Math.floor(page || 0)), notes, offset: Math.max(0, Math.floor(offset || 0)) })
    const thumbnails: any[]=[]
    for(let start=0;start<result.frames.length;start+=200) thumbnails.push(...await worker.request('thumbnails',{files:result.frames.slice(start,start+200).map((frame:any)=>frame.path)}))
    const small=new Map<string,any>(thumbnails.map(entry=>[entry.path,entry]))
    result.frames = result.frames.map((frame: any) => ({ ...frame, url: asset(frame.path),thumbnailUrl:small.get(frame.path)?.thumbnail?asset(small.get(frame.path).thumbnail):undefined }))
    return result
  })
  handle('save-stitch-draft', async (id: string, notes: Record<string, string>, value: ExtractSettings) => {
    const job = state.jobs.find(j => j.id === id)
    if (!job?.manifest) throw new Error('未找到截图记录。')
    if (job.status === 'running') throw new Error('请等待当前任务完成后再保存备注。')
    const normalized = settings(value)
    const write = (draftWrites.get(id) || Promise.resolve()).catch(() => {}).then(() => worker.request('save-stitch-draft', { manifest: job.manifest, notes, settings: normalized }))
    draftWrites.set(id, write)
    try { await write } finally { if (draftWrites.get(id) === write) draftWrites.delete(id) }
  })
  handle('stitch', async (id: string, names: string[], value: ExtractSettings, options?: { page?: number; offset?: number }) => {
    const job = state.jobs.find(j => j.id === id)
    if (!job?.manifest) throw new Error('未找到可拼接的截图。')
    await draftWrites.get(id)
    if (busy) throw new Error('请等待当前任务完成后再手动拼接。')
    const original = { status: job.status, stage: job.stage, completed: job.completed, total: job.total, progress: job.progress, error: job.error }
    busy = true; job.status = 'running'; job.stage = '生成拼接图'; changed()
    try {
      const result = await worker.request('stitch', { manifest: job.manifest, names: Array.isArray(names) ? names : [], settings: settings(value), page: options?.page, offset: Math.max(0, Math.floor(options?.offset || 0)) }, job.id)
      job.sheets = result.sheets; Object.assign(job, original)
    } catch (error) {
      Object.assign(job, original)
      throw error
    } finally { busy = false; changed(); void pump() }
  })
  handle('open-path', async (file: string) => {
    if (typeof file !== 'string' || !allowedPaths.has(path.resolve(file))) throw new Error('该路径尚未授权。')
    const error = await shell.openPath(path.resolve(file))
    if (error) throw new Error('无法打开文件或目录：' + error)
  })
  handle('clear-finished', () => { state.jobs = state.jobs.filter(j => ['running', 'waiting'].includes(j.status)); changed() })
  registerServices({handle,getState:()=>state,changed,getWindow:()=>window!,worker,settings,asset,allowed:allowedPaths,busy:()=>busy})
  registerEditing({handle,state:()=>state,changed,window:()=>window!,worker,publicInfo,allowed:allowedPaths,pump:()=>void pump(),flushDrafts:async(ids)=>{await Promise.all(ids.map(id=>draftWrites.get(id)))}})
}

app.whenReady().then(async () => {
  if(!ownsWorkspace)return
  const root = path.resolve(__dirname, '../..')
  const savedPath = path.join(app.getPath('userData'), 'workspace.json')
  let saved: Partial<Snapshot> = {}
  try { saved = JSON.parse(fs.readFileSync(savedPath, 'utf-8')) } catch {}
  state = {
    closeAction:['ask','tray','quit'].includes(saved.closeAction||'')?saved.closeAction!:'ask',
    timeInputMode:saved.timeInputMode==='milliseconds'?'milliseconds':'clock',
    viewport: (()=>{try{return viewport(saved.viewport || DEFAULT_VIEWPORT)}catch{return DEFAULT_VIEWPORT}})(), templates: saved.templates || [],
    projects: saved.projects || [], activeProjectId: saved.activeProjectId || null,
    downloadRoot: saved.downloadRoot || app.getPath('videos'),
    videos: saved.videos || [], jobs: saved.jobs || [], settings: migrateSettings(saved.settings),
    outputRoot: saved.outputRoot || path.join(app.getPath('pictures'), '拾帧截图'), paused: false,
    health: { ready: false, message: '正在启动处理引擎…' }
  }
  for (const video of state.videos) {
    if(video.previewStatus==='preparing')video.previewStatus=undefined
    if (!state.projects.some(project => project.id === video.projectId)) video.projectId = undefined
    if (video.override) video.override = migrateSettings(video.override)
    const oldRange = video.extractRange || video.override || state.settings
    const duration = video.info?.duration || Infinity
    const end = oldRange.end===null?null:Math.min(oldRange.end,duration)
    video.extractRange = Number.isFinite(oldRange.start)&&oldRange.start>=0&&oldRange.start<duration&&(end===null||Number.isFinite(end)&&end>oldRange.start) ? {start:oldRange.start,end} : {start:0,end:null}
    if (video.status === 'reading') { video.status = 'error'; video.error = '上次读取已中断，请移除后重新添加。' }
    publicInfo(video)
  }
  if (!state.projects.some(project => project.id === state.activeProjectId)) state.activeProjectId = null
  for (const job of state.jobs) {
    job.settings = migrateSettings(job.settings)
    if (['running', 'waiting'].includes(job.status)) { job.status = 'cancelled'; job.stage = '上次处理已中断'; job.error = '可点击重试继续核验并处理。' }
    if (job.folder) allowedPaths.add(path.resolve(job.folder))
    if (job.downloadPath) allowedPaths.add(path.resolve(job.downloadPath))
  }
  allowedPaths.add(path.resolve(state.outputRoot))
  const tools = app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(root, '.tools')
  const executable = app.isPackaged ? path.join(process.resourcesPath, 'worker/framepick-worker.exe') : path.join(root, '.venv/Scripts/python.exe')
  const args = [...(app.isPackaged ? [] : [path.join(root, 'backend/worker.py')]), '--tools', tools, '--cache', path.join(app.getPath('userData'), 'cache')]
  worker = new ProcessingWorker(executable, args, (message) => { if (!quitting) { state.health = { ready: false, message }; changed() } })
  worker.onProgress = (id, data) => {
    const job = state.jobs.find(j => j.id === id)
    if (!job) return
    if (data.info) {
      const video = state.videos.find(v => v.id === job.videoId)
      if (video) { video.info = data.info; publicInfo(video) }
      delete data.info
    }
    Object.assign(job, data)
    if (job.folder) allowedPaths.add(path.resolve(job.folder))
    changed()
  }
  protocol.handle('framepick-media', async (request) => {
    const file = assets.get(new URL(request.url).pathname.slice(1))
    if (!file) return new Response('Not found', { status: 404 })
    try {
      const size = fs.statSync(file).size
      const extension = path.extname(file).toLowerCase()
      const mime = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webm': 'video/webm', '.mov': 'video/quicktime' } as Record<string, string>)[extension] || 'video/mp4'
      const headers: Record<string, string> = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }
      let start = 0, end = size - 1, status = 200
      const range = request.headers.get('range')
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (!match) return new Response(null, { status: 416 })
        if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1 }
        else start = Math.max(0, size - Number(match[2]))
        if (start >= size || end < start) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`; status = 206
      }
      headers['Content-Length'] = String(Math.max(0, end - start + 1))
      return new Response(request.method === 'HEAD' || size === 0 ? null : Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, { status, headers })
    } catch { return new Response('Not found', { status: 404 }) }
  })
  registerIPC()
  window = new BrowserWindow({ width: 1480, height: 960, minWidth: 1120, minHeight: 720, show: false, autoHideMenuBar: true,
    title: '拾帧 · 视频抽帧与拼接', backgroundColor: '#f5f6f2', icon: path.join(root, 'assets/icon.png'),
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: !hidden }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  Menu.setApplicationMenu(null)
  tray=new Tray(path.join(root,'assets/icon.png'))
  tray.setToolTip('拾帧 · 视频抽帧与拼接')
  const restore=()=>{window?.show();if(window?.isMinimized())window.restore();window?.focus()}
  tray.on('double-click',restore);tray.on('click',restore)
  tray.setContextMenu(Menu.buildFromTemplate([{label:'打开拾帧',click:restore},{label:'暂停 / 继续队列',click:()=>{state.paused=!state.paused;changed();if(!state.paused)void pump()}},{type:'separator'},{label:'退出拾帧',click:()=>app.quit()}]))
  window.on('close',event=>{
    if(quitting)return
    if(state.closeAction==='quit'){event.preventDefault();app.quit();return}
    event.preventDefault()
    if(state.closeAction==='tray'){window?.hide();return}
    if(closePrompt)return
    closePrompt=true
    void dialog.showMessageBox(window!,{type:'question',title:'关闭拾帧',message:'关闭窗口后如何处理？',detail:'隐藏到托盘后，下载、抽帧和剪切继续运行。退出会停止当前处理任务。',buttons:['隐藏到托盘','直接退出','取消'],defaultId:0,cancelId:2,checkboxLabel:'记住选择，可在设置中更改',checkboxChecked:true}).then(answer=>{
      if(answer.response===2)return
      if(answer.checkboxChecked){state.closeAction=answer.response===0?'tray':'quit';saveState();changed()}
      if(answer.response===0)window?.hide();else app.quit()
    }).finally(()=>{closePrompt=false})
  })
  const appMenu = Menu.buildFromTemplate([
    {label:'编辑',submenu:[{role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},
    {role:'togglefullscreen',label:'全屏'}, {role:'quit',label:'退出拾帧'}
  ])
  window.webContents.on('before-input-event', (event,input) => {
    if(input.type==='keyDown' && input.key==='F2' && !input.control && !input.alt && !input.shift && !input.meta) {event.preventDefault();appMenu.popup({window})}
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  if (!hidden) window.once('ready-to-show', () => window?.show())
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(path.join(__dirname, '../renderer/index.html'))
  try { state.health = await worker.request('health') } catch { state.health = { ready: false, message: '处理引擎未能启动，请检查安装文件。' } }
  const decoder = path.join(app.getPath('userData'),'decoder/yt-dlp.exe')
  if (fs.existsSync(decoder)) try { await worker.request('use-decoder',{path:decoder}) } catch { /* Retain bundled parser when an override is damaged. */ }
  changed()
})
app.on('window-all-closed', () => app.quit())
app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  if (busy) {
    event.preventDefault()
    for (const job of state.jobs) if (job.status === 'running') worker.cancel(job.id)
    setTimeout(() => { saveState(); worker?.close(); app.exit(0) }, 1500)
  } else { saveState(); worker?.close() }
})
