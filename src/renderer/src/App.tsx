import { useEffect, useRef, useState } from 'react'
import { Alert, App as AntApp, Button, Checkbox, Empty, Input, Modal, Pagination, Progress, Radio, Select, Spin, Tabs, Tag, Tooltip } from 'antd'
import type { Job, ResultPage, Snapshot, VideoItem, ExtractSettings, SpaceEstimate } from '../../shared/types'
import { DEFAULT_SETTINGS, DEFAULT_VIEWPORT, expectedCount, migrateSettings, videoSettings } from '../../shared/types'
import SettingsPanel from './SettingsPanel'
import VideoLibrary from './VideoLibrary'
import StitchEditor, { type StitchEditorHandle } from './StitchEditor'
import Icon from './Icon'
import FrameGrid from './FrameGrid'
import CropEditor from './CropEditor'
import { ViewportContext, keyChord, topDialog } from './useViewport'
import InteractionSettings from './InteractionSettings'
import ImageViewer, { type ViewImage } from './ImageViewer'
import MaintenancePanel from './MaintenancePanel'

const bridge = window.framepick
const initial: Snapshot = { viewport: DEFAULT_VIEWPORT, templates: [], projects: [], activeProjectId: null, downloadRoot: '', videos: [], jobs: [], settings: DEFAULT_SETTINGS, outputRoot: '', paused: false, health: { ready: false, message: '正在连接处理引擎…' } }
const duration = (seconds: number) => { const s = Math.floor(seconds || 0); return (s >= 3600 ? `${Math.floor(s / 3600)}:` : '') + `${Math.floor(s / 60) % 60}`.padStart(2, '0') + ':' + `${s % 60}`.padStart(2, '0') }
const size = (bytes: number) => bytes ? bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB` : '未知'

export default function App() {
  const { message, modal } = AntApp.useApp()
  const [state, setState] = useState<Snapshot>(initial)
  const [view, setView] = useState('workspace')
  const [interactionOpen, setInteractionOpen] = useState(false)
  const [maintenanceOpen,setMaintenanceOpen]=useState(false), [space,setSpace]=useState<SpaceEstimate|null>(null)
  const [queueSearch,setQueueSearch]=useState(''), [queueStatus,setQueueStatus]=useState('all'), [queueSelected,setQueueSelected]=useState<string[]>([])
  const [viewer, setViewer] = useState<{ images: ViewImage[]; index: number } | null>(null)
  const [queueFocus, setQueueFocus] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [focused, setFocused] = useState('')
  const [dragging, setDragging] = useState(false)
  const [linksOpen, setLinksOpen] = useState(false)
  const [links, setLinks] = useState('')
  const [resolving, setResolving] = useState(false)
  const [linkErrors, setLinkErrors] = useState<string[]>([])
  const [cropVideo, setCropVideo] = useState<VideoItem | null>(null)
  const [chosenSheet, setChosenSheet] = useState('')
  const [sheetPage,setSheetPage]=useState(0)
  const [batchStitching, setBatchStitching] = useState(false)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [override, setOverride] = useState(DEFAULT_SETTINGS)
  const [resultJob, setResultJob] = useState<Job | null>(null)
  const [resultPage, setResultPage] = useState<ResultPage>({ frames: [], total: 0, sheets: [] })
  const [page, setPage] = useState(0)
  const [selectedFrames, setSelectedFrames] = useState<string[]>([])
  const [resultsTab, setResultsTab] = useState('frames')
  const editor = useRef<StitchEditorHandle>(null)
  const [resultLoading, setResultLoading] = useState(false)
  const [failedPreview, setFailedPreview] = useState('')
  const known = useRef(new Set<string>())
  const resultRequest = useRef(0)
  useEffect(() => {
    if (!bridge) { message.error('请通过桌面应用启动拾帧。'); return }
    let mounted = true
    const update = (next: Snapshot) => { if (mounted) setState(next) }
    const unsubscribe = bridge.subscribe(update)
    bridge.snapshot().then(update).catch(error => message.error(error.message))
    return () => { mounted = false; unsubscribe() }
  }, [])
  useEffect(() => {
    const added = state.videos.filter(v => !known.current.has(v.id)).map(v => v.id)
    state.videos.forEach(v => known.current.add(v.id))
    setSelected(prev => [...new Set([...prev.filter(id => state.videos.some(v => v.id === id)), ...added])])
    if (!state.videos.some(v => v.id === focused)) setFocused(state.videos[0]?.id || '')
  }, [state.videos])
  const active = state.videos.find(v => v.id === focused)
  const ready = state.videos.filter(v => v.status === 'ready')
  const chosen = ready.filter(v => selected.includes(v.id))
  const running = state.jobs.find(j => j.status === 'running')
  const waiting = state.jobs.filter(j => j.status === 'waiting')
  const estimated = chosen.reduce((count, video) => count + expectedCount(video.info?.duration || 0, videoSettings(video, state.settings)), 0)
  const finished = state.jobs.filter(j => j.status === 'done').length
  const progressJob = running || waiting[0] || state.jobs.at(-1)
  const progress = progressJob?.status === 'done' ? 100 : Math.round(progressJob?.progress || 0)
  function jumpToQueue() { setQueueSearch('');setQueueStatus('all');setQueueFocus(progressJob?.id || ''); setView('queue') }
  useEffect(()=>{let alive=true;const timer=setTimeout(()=>bridge.estimate(chosen.map(v=>v.id)).then(value=>{if(alive)setSpace(value)}).catch(()=>{if(alive)setSpace(null)}),200);return()=>{alive=false;clearTimeout(timer)}},[selected,state.settings,state.outputRoot,state.videos])
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{const root=document.querySelector<HTMLElement>('.results-modal');if(event.defaultPrevented||!resultJob||viewer||!root?.getClientRects().length||!topDialog(root)||resultsTab==='editor'||!!root.querySelector('[role=tab][aria-selected=true][id$=tab-editor]'))return;if(keyChord(event)===state.viewport.close){event.preventDefault();void closeResults()}}
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)
  },[resultJob,viewer,resultsTab,state.viewport.close])
  useEffect(() => {
    if (view !== 'queue' || !queueFocus) return
    const timer = setTimeout(() => document.querySelector(`[data-job-id="${queueFocus}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80)
    const clear = setTimeout(() => setQueueFocus(''), 3000)
    return () => { clearTimeout(timer); clearTimeout(clear) }
  }, [view, queueFocus])
  function clearFinished() {
    modal.confirm({ title: '清除已结束记录？', content: '已完成、失败和已取消的任务记录会移除，导出图片与下载视频保留。请先保存需要的结果位置。', okText: '确认清除', cancelText: '取消', autoFocusButton: 'cancel', onOk: () => bridge.clearFinished() })
  }
  const currentResults = active && [...state.jobs].reverse().find(j => j.videoId === active.id && j.manifest && ['done', 'cancelled', 'error'].includes(j.status))

  async function action(fn: () => Promise<unknown>) { try { await fn() } catch (error) { message.error(error instanceof Error ? error.message : '操作失败。') } }
  function updateSettings(value: ExtractSettings) {
    setState(prev => ({ ...prev, settings: value }))
    void action(() => bridge.saveSettings(value))
  }
  async function loadResults(job: Job, nextPage = 0, nextSheetPage=sheetPage) {
    const token = ++resultRequest.current
    setResultLoading(true)
    try {
      const result = await bridge.results(job.id, nextPage, nextSheetPage)
      if (token === resultRequest.current){setResultPage(result);setSheetPage(result.sheetPage || 0)}
    } catch (error) { message.error(error instanceof Error ? error.message : '读取结果失败。') }
    finally { if (token === resultRequest.current) setResultLoading(false) }
  }
  function showResults(job: Job) { setResultPage({ frames: [], total: 0, sheets: [] }); setResultJob(job); setPage(0); setSelectedFrames([]); setChosenSheet('');setSheetPage(0); setResultsTab('frames'); void loadResults(job,0,0) }
  async function closeResults() {
    if (running?.id === resultJob?.id || editor.current?.isBusy()) return
    try { await editor.current?.save(); setResultJob(null); resultRequest.current++ }
    catch (error) { message.error(error instanceof Error ? error.message : '备注保存失败。') }
  }
  function start() {
    const perform = () => action(() => bridge.enqueue(chosen.map(v => v.id)))
    if (estimated > 10000) modal.confirm({ title: `本次预计生成 ${estimated.toLocaleString()} 张图片`, content: '图片会保存到每个视频的独立文件夹中。请确认保存位置有足够空间。', okText: '开始处理', cancelText: '调整参数', onOk: perform })
    else void perform()
  }
  async function resolve() {
    setResolving(true); setLinkErrors([])
    try {
      const result = await bridge.resolveLinks(links)
      setLinkErrors(result.errors)
      if (result.added) message.success(`已添加 ${result.added} 个在线视频`)
      if (!result.errors.length) { setLinksOpen(false); setLinks('') }
    } catch (error) { setLinkErrors([error instanceof Error ? error.message : '解析失败。']) }
    finally { setResolving(false) }
  }
  const pickCookie = () => action(async () => { const file = await bridge.chooseCookie(); if (file) updateSettings({ ...state.settings, cookiePath: file }) })

  const filteredJobs=state.jobs.filter(job=>(queueStatus==='all'||job.status===queueStatus)&&`${job.name} ${job.stage} ${job.error||''}`.toLowerCase().includes(queueSearch.toLowerCase()))
  const queueList = (large = false) => <div className={'queue-list ' + (large ? 'large' : '')}>
    {!filteredJobs.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={state.jobs.length?'没有符合条件的任务':'任务会在这里显示进度和结果'} /> : [...filteredJobs].reverse().map(job => <div className={'job-row ' + (queueFocus === job.id ? 'highlighted' : '')} key={job.id} data-job-id={job.id}>
      {large&&<Checkbox aria-label={`选择任务 ${job.name}`} checked={queueSelected.includes(job.id)} onChange={e=>setQueueSelected(previous=>e.target.checked?[...previous,job.id]:previous.filter(id=>id!==job.id))}/>}
      <div className={'job-icon ' + job.status}><Icon name={job.status === 'done' ? 'check' : job.status === 'error' ? 'close' : job.status === 'running' ? 'clock' : 'film'} size={18} /></div>
      <div className="job-body"><div className="job-name">{job.name}<span className={'job-state ' + job.status}>{job.stage}</span></div>
        {job.status === 'running' && <Progress percent={Math.round(job.progress)} size="small" strokeColor="#46755b" />}
        <div className="job-detail">{job.kind === 'download' ? '视频下载' : `${job.completed || job.count || 0} / ${job.total || '—'} 张`}{job.elapsed !== undefined && <span> · {job.elapsed.toFixed(1)} 秒</span>}{job.error && <Tooltip title={job.error}><span className="error-detail"> · {job.error}</span></Tooltip>}</div>
      </div>
      <div className="job-actions">
        {['waiting', 'running'].includes(job.status) && <Button size="small" onClick={() => action(() => bridge.cancelJob(job.id))}>取消</Button>}
        {['error', 'cancelled'].includes(job.status) && <Button size="small" icon={<Icon name="refresh" size={14} />} onClick={() => action(() => bridge.retryJob(job.id))}>重试</Button>}
        {job.manifest && job.status !== 'running' && <Button size="small" onClick={() => showResults(job)}>查看图片</Button>}
        {job.downloadPath && job.status === 'done' && <Button size="small" onClick={() => action(() => bridge.openPath(job.downloadPath!))}>打开视频</Button>}{job.folder && <Tooltip title="打开文件夹"><Button size="small" type="text" icon={<Icon name="folder" size={16} />} onClick={() => action(() => bridge.openPath(job.folder!))} /></Tooltip>}
      </div>
    </div>)}
  </div>

  return <ViewportContext.Provider value={state.viewport}><div className="app-shell">
    <aside className="navigation">
      <div className="brand"><div className="brand-mark"><Icon name="film" size={25} /></div><div><strong>拾帧</strong><span>FRAMEPICK</span></div></div>
      <div className="nav-section">工作空间</div>
      <button className={'nav-item ' + (view === 'workspace' ? 'active' : '')} onClick={() => setView('workspace')}><Icon name="film" />抽帧工作台</button>
      <button className={'nav-item ' + (view === 'queue' ? 'active' : '')} onClick={() => setView('queue')}><Icon name="queue" />处理队列{waiting.length + (running ? 1 : 0) > 0 && <span className="nav-count">{waiting.length + (running ? 1 : 0)}</span>}</button>
      <button className={'nav-item ' + (view === 'help' ? 'active' : '')} onClick={() => setView('help')}><Icon name="help" />使用说明</button>
      <button className="nav-item" onClick={() => setInteractionOpen(true)}><Icon name="settings" />画面操作快捷键</button>
      <button className="nav-item" onClick={()=>setMaintenanceOpen(true)}><Icon name="folder"/>设置与维护</button>
      <div className="nav-bottom"><div className="local-note"><Icon name="shield" size={18} /><div>本地处理<span>视频与截图留在你的电脑</span></div></div><div className="version">拾帧 0.6.1 <span>Windows</span></div></div>
    </aside>
    <main className="main-shell">
      <header className="page-header"><div><div className="eyebrow">VIDEO TO FRAMES</div><h1>{view === 'workspace' ? '把视频，变成每一帧灵感。' : view === 'queue' ? '处理队列' : '使用说明'}</h1><p>{view === 'workspace' ? '选择时间间隔，批量提取画面，再拼成故事板。' : view === 'queue' ? '查看处理进度、重试任务与打开导出结果。' : '从导入到导出，所有操作都在本地完成。'}</p></div><div className={'engine-status ' + (state.health.ready ? 'ready' : '')}><span />{state.health.message}</div></header>
      {view === 'workspace' ? <>
        <div className="toolbar"><div className="toolbar-buttons"><Button icon={<Icon name="plus" />} onClick={() => action(() => bridge.pickVideos(false))}>添加视频</Button><Button icon={<Icon name="layers" />} onClick={() => action(() => bridge.pickVideos(true))}>批量添加</Button><Button icon={<Icon name="link" />} onClick={() => { setLinkErrors([]); setLinksOpen(true) }}>粘贴视频链接</Button></div><span className="toolbar-hint">支持拖入视频文件</span></div>
        <div className={'workspace ' + (dragging ? 'dragging' : '')} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }} onDrop={event => { event.preventDefault(); setDragging(false); const paths = Array.from(event.dataTransfer.files).map(file => bridge.filePath(file)).filter(Boolean); if (paths.length) void action(() => bridge.addFiles(paths)) }}>
          {dragging && <div className="drop-overlay"><Icon name="upload" size={40} /><strong>松开鼠标，添加视频</strong></div>}
          <VideoLibrary state={state} selected={selected} focused={focused} setSelected={setSelected} setFocused={setFocused} />
          <section className="preview-panel panel"><div className="panel-heading"><h2>视频预览</h2>{active && <Tag bordered={false}>{active.source === 'online' ? active.platform : '本地文件'}</Tag>}</div>
            {active ? <><div className="preview-stage">{active.status === 'reading' ? <Spin description="读取视频信息" /> : active.status === 'error' ? <div className="preview-placeholder"><Icon name="film" size={42} /><strong>暂时无法读取</strong><p>{active.error}</p><Button size="small" onClick={()=>void action(()=>bridge.relocateVideo(active.id))}>重新定位视频</Button></div> : active.mediaUrl && failedPreview !== active.id ? <video key={active.id} src={active.mediaUrl} poster={active.thumbnailUrl} controls preload="metadata" onError={() => setFailedPreview(active.id)} /> : active.thumbnailUrl ? <><img className="poster" src={active.thumbnailUrl} alt={active.name} /><span className="preview-caption">截图预览 · 此格式仍可尝试抽帧</span></> : <div className="preview-placeholder"><Icon name={active.source === 'online' ? 'link' : 'image'} size={40} /><strong>{active.source === 'online' ? '已解析在线视频' : '视频预览暂不可用'}</strong><p>{active.source === 'online' ? '开始任务后下载视频，再核验信息和抽帧。' : '预览与抽帧使用独立引擎，可直接尝试处理。'}</p></div>}</div>
              <div className="video-title-bar"><div><h3>{active.name}</h3><Tooltip title={active.path || active.url}><p>{active.path || active.url}</p></Tooltip></div><div className="video-title-actions">{active.source === 'online' && <Button icon={<Icon name="download" size={16} />} disabled={!state.health.ready || state.jobs.some(job => job.videoId === active.id && ['waiting', 'running'].includes(job.status))} onClick={() => action(async () => { if (await bridge.downloadVideo(active.id)) message.success('下载任务已加入队列') })}>{active.downloadedPath ? '再次下载' : '下载视频'}</Button>}<Button disabled={!active.info || !active.thumbnailUrl} onClick={() => setCropVideo({...active,cropSegments:videoSettings(active,state.settings).cropSegments})}>裁剪画面</Button><Tooltip title="为当前视频设置独立参数"><Button icon={<Icon name="settings" size={16} />} onClick={() => { setOverride({ ...(videoSettings(active, state.settings)) }); setOverrideOpen(true) }}>单独设置</Button></Tooltip></div></div>
              {active.info && <><div className="metadata-grid">{[['时长', duration(active.info.duration)], ['分辨率', `${active.info.width || '—'} × ${active.info.height || '—'}`], ['帧率', active.info.fps ? `${active.info.fps.toFixed(2)} fps` : '未知'], ['视频编码', active.info.codec?.toUpperCase() || '未知'], ['容器格式', active.info.format || '未知'], ['文件大小', size(active.info.size)], ['音频编码', active.info.audioCodec?.toUpperCase() || '未知'], ['码率', active.info.bitrate ? `${(active.info.bitrate / 1000).toFixed(0)} kbps` : '未知']].map(([label, content]) => <div key={label}><span>{label}</span><Tooltip title={content}><strong>{content}</strong></Tooltip></div>)}</div>{active.info.warning && <div className="video-warning"><Icon name="help" size={14} />{active.info.warning}</div>}</>}
              {active.source === 'online' && active.downloadedPath && <div className="download-summary"><div><Icon name="check" size={14} /><Tooltip title={active.downloadedPath}><span>{active.downloadedPath}</span></Tooltip></div><Button size="small" onClick={() => action(() => bridge.openPath(active.downloadedPath!))}>打开视频</Button></div>}
              <div className="preview-actions"><span>{(videoSettings(active, state.settings)).crop && '已设置裁剪 · '}预计 {expectedCount(active.info?.duration || 0, videoSettings(active, state.settings)).toLocaleString()} 张截图{active.override && ' · 当前使用单独参数'}</span>{currentResults && <Button icon={<Icon name="image" size={16} />} onClick={() => showResults(currentResults)}>查看导出图片</Button>}</div>
            </> : <div className="welcome"><div className="welcome-illustration"><div className="illustration-card back" /><div className="illustration-card middle" /><div className="illustration-card front"><Icon name="film" size={56} /><div className="illustration-timeline"><i /><i /><i /><i /></div></div><span className="illustration-stamp">0.5s</span></div><h2>从一个视频开始</h2><p>拖入视频，设置间隔，<br />让每个值得保存的画面都有自己的位置。</p><Button type="primary" icon={<Icon name="plus" />} onClick={() => action(() => bridge.pickVideos(false))}>选择视频文件</Button><div className="welcome-steps"><span><i>1</i>导入视频</span><Icon name="arrow" size={14} /><span><i>2</i>设置间隔</span><Icon name="arrow" size={14} /><span><i>3</i>导出与拼接</span></div></div>}
          </section>
          <section className="settings-panel panel"><div className="panel-heading"><h2>导出设置</h2><span className="panel-description">批量共用参数</span></div><div className="settings-scroll"><SettingsPanel value={state.settings} onChange={updateSettings} outputRoot={state.outputRoot} chooseOutput={() => action(() => bridge.chooseOutput())} chooseCookie={pickCookie} /></div><div className="start-section"><div className="estimate"><span>本次预计</span><strong>{estimated.toLocaleString()} <small>张图片</small></strong></div><div className="space-estimate" aria-label="磁盘空间预估">{space ? <>预计 {size(space.minBytes)}～{size(space.maxBytes)}<br/>可用空间 {space.freeBytes===null?'暂时无法读取':size(space.freeBytes)}{!space.sufficient&&<strong> · 空间不足</strong>}</> : '正在估算空间…'}</div><Button type="primary" size="large" block disabled={!chosen.length || !state.health.ready || space?.sufficient===false} onClick={start} icon={<Icon name="play" size={17} />}>开始抽帧{chosen.length > 0 && ` · ${chosen.length} 个视频`}</Button><p>原视频保持不变 · 可随时取消</p></div></section>
        </div>
      </> : view === 'queue' ? <section className="queue-page panel"><div className="queue-filter"><Input aria-label="搜索队列" placeholder="搜索名称、状态或错误" value={queueSearch} onChange={e=>setQueueSearch(e.target.value)} allowClear/><Select aria-label="队列状态筛选" value={queueStatus} onChange={setQueueStatus} options={[{value:'all',label:'全部状态'},{value:'waiting',label:'等待'},{value:'running',label:'处理中'},{value:'done',label:'已完成'},{value:'error',label:'失败'},{value:'cancelled',label:'已取消'}]}/><Checkbox checked={filteredJobs.length>0&&filteredJobs.every(job=>queueSelected.includes(job.id))} onChange={e=>setQueueSelected(e.target.checked?filteredJobs.map(job=>job.id):[])}>选择筛选结果</Checkbox></div><div className="queue-batch"><span>已选 {queueSelected.length} 项</span><Button disabled={!queueSelected.length} onClick={()=>void action(async()=>{await bridge.cancelJobs(queueSelected);setQueueSelected([])})}>批量取消</Button><Button disabled={!queueSelected.length} onClick={()=>void action(async()=>{const result=await bridge.retryJobs(queueSelected);message.success(`已重试 ${result.queued} 项${result.skipped?`，同视频或源素材不可用的 ${result.skipped} 项已略过`:""}`);setQueueSelected([])})}>重试失败/取消任务</Button><Button disabled={!queueSelected.length} onClick={()=>void action(async()=>{await bridge.archiveJobs(queueSelected);setQueueSelected([])})}>归档所选记录</Button><Button onClick={()=>void action(async()=>{await bridge.importResults();message.success('结果已恢复')})}>重新导入结果</Button></div><div className="queue-page-toolbar"><div className="queue-stats"><span><strong>{running ? 1 : 0}</strong>正在处理</span><span><strong>{waiting.length}</strong>等待中</span><span><strong>{finished}</strong>已完成</span></div><div><Button onClick={() => action(() => bridge.pauseQueue(!state.paused))} icon={<Icon name={state.paused ? 'play' : 'pause'} />}>{state.paused ? '继续队列' : '暂停队列'}</Button><Button type="text" disabled={!state.jobs.some(job => !['waiting', 'running'].includes(job.status))} onClick={clearFinished}>清除已结束记录</Button></div></div>{state.paused && <Alert type="info" showIcon title="队列已暂停" description="当前视频继续完成；后续视频会等待你点击继续。" />}{queueList(true)}</section> : <section className="help-page panel"><h2>三个步骤，保存每一帧</h2><div className="help-cards"><div><i>01</i><h3>添加视频</h3><p>单个或批量选择本地文件，也可以粘贴 Bilibili、抖音的视频页面链接或分享文案。</p></div><div><i>02</i><h3>设置时间与位置</h3><p>每隔 0.5 秒、1 秒或任意毫秒间隔保存一张。根目录下自动建立按视频命名的子文件夹。</p></div><div><i>03</i><h3>查看图片与拼接</h3><p>完成后打开结果，选择图片生成网格、横排或竖排拼图。数量较多时自动分张。</p></div></div><div className="help-details"><h3>如何使用分段裁剪？</h3><p>先设置默认区域，再添加时段并分别调整大小。例如 1～5 秒裁一块，6～10 秒裁另一块；中间与范围外用默认区域。裁剪时段包含结束秒，相接边界用后一段。按截图目标时间切换区域，原视频不改动。可保存预设，或按画面比例批量应用到已选视频；超出其他视频时长的段会截短或省略。</p><h3>如何缩放和拖动画面？</h3><p>默认 Ctrl + 加号 / 减号缩放，Ctrl + 0 适合画面，Ctrl + 1 实际大小，Ctrl + 滚轮缩放。空格加左键、中键或长按空白处拖动；Esc 退出当前查看或裁剪，在拼接编辑中返回选图。左侧“画面操作快捷键”可修改组合、滚轮方式和长按时间，输入备注时不会触发缩放。截图列表支持 Shift 连选、Ctrl + A 选择本页、方向键和空格选择、回车查看。</p><h3>如何恢复结果和备份？</h3><p>队列可搜索、按状态筛选、批量取消和重试，也能归档已结束记录。左侧“设置与维护”可恢复归档、选择视频输出文件夹重新导入结果，以及导出或合并工作区备份。备份保存项目、素材引用、快捷键、模板和备注，视频图片需要另行复制，Cookie 路径不会写入。失效视频可在预览区重新定位；移动后的结果可选新文件夹恢复，缺图会提示。</p><h3>怎样减少重复画面？</h3><p>抽帧方式可选固定间隔或按场景变化。按场景会保留范围首帧，用间隔限制场景最短距离；变化阈值越小越敏感。画面筛选还可省略相似连续截图，文件仍按原始时间命名。预计张数与占用是上限或范围，实际依画面内容而定。</p><h3>如何裁剪画面？</h3><p>选中视频后点击「裁剪画面」，拖动边框、四角或输入像素尺寸，应用后只抽取框内区域。保存的裁剪默认对当前视频生效，也可批量应用；默认跳过模式会改为另存一批，方便保留原来的截图。</p><h3>如何编辑拼接图？</h3><p>拼接编辑可翻页选择要生成的这一张，点击「生成当前拼接图」。右上角「拼接全部图片」按当前设置批量导出全部截图。在「拼接图」中点击「编辑这张」，可恢复图片、布局和备注，再生成一份新图。拼接图片可拖动排序、前移后移或替换单张，并保存模板；镜号、画面、动作、对白可分栏编辑。长按截图拖动可连续多选；备注区按设定字号自动撑高，同一行保持等高，底部空行自动去除。</p><h3>如何整理视频项目？</h3><p>视频列表上方可新建项目，并选择新视频加入的位置。点击项目箭头展开或收起；长按视频可拖入项目或未分类，悬停可展开，Esc 取消拖动。视频可置顶，项目菜单可置顶、重命名或移除；也能搜索视频、批量移动和移除。整理状态自动保存，移除前会确认。</p><h3>如何只下载在线视频？</h3><p>解析链接后，选中视频并点击「下载视频」，自行选择保存文件夹。队列显示下载进度，可取消或重试；完成后可打开视频，也能直接使用已保存文件抽帧。这个入口只在在线视频上显示，同名文件会另存。</p><h3>图片时间如何理解？</h3><p>文件名是目标采样时间，例如 0.5s.jpg。工具选择最接近目标的实际视频帧；结果预览会显示它的真实帧时间。默认不截取起点，结束时间不包含。</p><h3>重复导出会覆盖吗？</h3><p>默认核验来源和参数后跳过已有截图。参数不同、已有文件无法核验时，会提示改用“另存一批”或“覆盖已有”。同名不同来源的视频使用不同文件夹。</p><h3>在线链接需要什么？</h3><p>链接应指向具体视频。抖音首页无法确定你正在观看哪一个视频；含视频标识的页面或分享链接更合适。需要访问状态时，可选择自行准备的 Netscape 格式 Cookie 文件。访问状态不会上传到其他服务。</p><h3>长视频怎么处理？</h3><p>一次处理一个视频，截图持续写入磁盘。暂停队列会等待当前视频完成；取消后保留已完成图片，重试时重新核验。HDR 默认用 Hable 映射为普通图片，也可选 Reinhard 或关闭；建议先导出少量核对颜色。</p></div></section>}
      <footer className="processing-footer">
        <div className="queue-summary"><div className="queue-summary-label"><Icon name="queue" /><strong>处理进度</strong><button className="progress-link" onClick={jumpToQueue} title="跳转到对应任务">{progressJob ? `${progressJob.name} · ${progressJob.status === 'waiting' && state.paused ? '队列已暂停' : progressJob.stage}` : '准备好后，点击开始抽帧'}</button></div><div className="queue-summary-actions">{(running || waiting.length > 0) && <Button size="small" onClick={() => action(() => bridge.pauseQueue(!state.paused))} icon={<Icon name={state.paused ? 'play' : 'pause'} size={14} />}>{state.paused ? '继续队列' : '暂停队列'}</Button>}<Button size="small" onClick={jumpToQueue}>查看处理队列 <Icon name="arrow" size={14} /></Button></div></div>
        <div className="processing-meter"><Progress aria-label="底部处理进度" percent={progress} status={progressJob?.status === 'error' ? 'exception' : progressJob?.status === 'done' ? 'success' : 'normal'} strokeColor="#46755b" size="small" /><span>{state.jobs.length ? `已完成 ${finished} / ${state.jobs.length} · 等待 ${waiting.length}` : '任务进度将在这里显示'}</span></div>
      </footer>
    </main>
    {interactionOpen && <InteractionSettings value={state.viewport} close={() => setInteractionOpen(false)} />}
    {maintenanceOpen&&<MaintenancePanel state={state} close={()=>setMaintenanceOpen(false)}/>}
    {viewer && <ImageViewer key={viewer.images[viewer.index]?.path} images={viewer.images} index={viewer.index} close={() => setViewer(null)} />}
    <Modal title={<span className="modal-title"><Icon name="link" />添加在线视频</span>} open={linksOpen} onCancel={() => !resolving && setLinksOpen(false)} okText={resolving ? '正在解析…' : '解析并添加'} cancelText="取消" onOk={resolve} confirmLoading={resolving} okButtonProps={{ disabled: !links.trim() }} width={620}>
      <p className="modal-intro">粘贴视频页面链接或完整分享文案。多个链接可以分行输入。</p><Input.TextArea aria-label="在线视频链接" rows={6} value={links} onChange={e => setLinks(e.target.value)} placeholder={'https://www.bilibili.com/video/BV…\nhttps://www.douyin.com/video/…\n\n也可以直接粘贴分享文案。'} /><div className="link-note"><Icon name="shield" size={15} />视频下载到本地后处理；支持范围取决于平台与访问状态。</div>{linkErrors.map((error, index) => <Alert key={index} style={{ marginTop: 12 }} type="warning" showIcon title={error} />)}<div className="online-modal-settings"><Button onClick={pickCookie} size="small">选择 Cookie 文件</Button><span>{state.settings.cookiePath ? '已配置访问状态' : '需要时再配置'}</span></div>
    </Modal>
    {cropVideo?.info && <CropEditor key={cropVideo.id} video={cropVideo} initial={(videoSettings(cropVideo, state.settings)).crop} presets={state.templates.filter(t=>t.name.startsWith('裁剪 · '))} savePreset={async(name,crop,segments)=>{if(!name.trim())throw new Error('请填写裁剪预设名称。');await bridge.saveTemplate('裁剪 · '+name.trim(),{...state.settings,crop,cropSegments:segments})}} batch={chosen.length>1?async(crop,segments)=>{
      const eligible=chosen.filter(video=>video.info),applyAll=async()=>{for(const video of eligible){const adapted=segments.filter(segment=>segment.start<video.info!.duration).map(segment=>({...segment,end:Math.min(segment.end,video.info!.duration)})).filter(segment=>segment.end>segment.start);await bridge.setCrop(video.id,crop,adapted)}message.success(`裁剪已应用到 ${eligible.length} 个视频`)}
      modal.confirm({title:'把裁剪应用到已选视频？',content:<div><p>默认区域按各视频画面比例换算；超出时长的分段截短或省略。检查换算结果后应用：</p><ul>{eligible.map(video=>{const info=video.info!,rotated=Math.abs(info.rotation||0)%180===90,w=rotated?info.height:Math.round(info.width*(info.sar||1)),h=rotated?Math.round(info.width*(info.sar||1)):info.height;return <li key={video.id}>{video.name}：{Math.round(w*(crop?.width||1))} × {Math.round(h*(crop?.height||1))} px，{info.duration.toFixed(2)} 秒</li>})}</ul></div>,okText:'应用裁剪',cancelText:'取消',onOk:applyAll})
    }:undefined} close={() => setCropVideo(null)} apply={async (crop, segments) => {
      const current = state.videos.find(video => video.id === cropVideo.id)!
      await bridge.setCrop(current.id, crop, segments)
      message.success(segments.length ? '分段裁剪已保存，未设置时段使用默认区域' : crop ? '裁剪区域已保存，之后抽帧将使用框内画面' : '已恢复完整画面')
    }} />}
    <Modal title={`单独设置 · ${active?.name || ''}`} open={overrideOpen} onCancel={() => setOverrideOpen(false)} width={480} okText="保存单独参数" cancelText="取消" onOk={() => action(async () => { if (active) await bridge.setOverride(active.id, override); setOverrideOpen(false) })}>
      <p className="modal-intro">仅对当前视频生效，保存位置仍使用全局根目录。</p><div className="override-scroll"><SettingsPanel compact value={override} onChange={setOverride} /></div>{active?.override && <Button type="text" onClick={() => action(async () => { await bridge.setOverride(active.id, null); setOverrideOpen(false) })}>恢复使用批量共用参数</Button>}
    </Modal>
    <Modal title={`导出结果 · ${resultJob?.name || ''}`} className="results-modal" style={{ top: 32 }} open={!!resultJob} onCancel={() => void closeResults()} keyboard={false} footer={null} width={1240} destroyOnHidden closable={running?.id !== resultJob?.id && !batchStitching} maskClosable={false}>
      {!!resultPage.missing&&<Alert type="warning" showIcon title={`${resultPage.missing} 张源图缺失，已保留备注与记录。`} description="把图片放回原文件夹后重新打开；缺失图片不会用于拼接。"/>}
      <div className="results-toolbar"><span>共 {resultPage.total.toLocaleString()} 张截图 · 已选择 {selectedFrames.length} 张</span><div>
        <Button icon={<Icon name="folder" size={16} />} onClick={() => resultJob?.folder && action(() => bridge.openPath(resultJob.folder!))}>打开文件夹</Button>
        {selectedFrames.length > 0 && <Button disabled={!!running || batchStitching} onClick={() => { editor.current?.openSelection(); setResultsTab('editor') }}>拼接所选图片</Button>}
        <Button type="primary" loading={batchStitching} icon={<Icon name="grid" size={16} />} disabled={!resultPage.total || !!running} onClick={() => { setResultsTab('editor'); setBatchStitching(true); void editor.current?.generateAll().finally(() => setBatchStitching(false)) }}>拼接全部图片</Button>
      </div></div>
      <Tabs activeKey={resultsTab} onChange={key => { if (running?.id !== resultJob?.id && !editor.current?.isBusy()) setResultsTab(key) }} items={[
        { key: 'frames', label: '抽帧图片', children: <><div className="result-page-choice"><div><Checkbox checked={resultPage.frames.length > 0 && resultPage.frames.every(f => selectedFrames.includes(f.name))} onChange={e => setSelectedFrames(prev => e.target.checked ? [...new Set([...prev, ...resultPage.frames.map(f => f.name)])] : prev.filter(name => !resultPage.frames.some(f => f.name === name)))}>选择本页</Checkbox>{selectedFrames.length > 0 && <Button type="text" size="small" onClick={() => setSelectedFrames([])}>清空选择</Button>}</div><span>长按图片拖动可连续多选 · 双击打开原图</span></div><Spin spinning={resultLoading}><FrameGrid frames={resultPage.frames} selected={selectedFrames} onChange={setSelectedFrames} open={file => setViewer({ images: resultPage.frames.map(frame => ({ ...frame, name:frame.name })), index: Math.max(0, resultPage.frames.findIndex(frame => frame.path === file)) })} /></Spin><Pagination current={page + 1} pageSize={60} total={resultPage.total} showSizeChanger={false} onChange={next => { setPage(next - 1); if (resultJob) void loadResults(resultJob, next - 1) }} /></> },
        { key: 'editor', label: '拼接编辑', disabled: !resultPage.total, forceRender: true, children: resultJob && resultPage.total > 0 ? <StitchEditor key={resultJob.id} ref={editor} job={resultJob} templates={state.templates} initial={migrateSettings(resultPage.stitchDraft || resultJob.settings)} initialNotes={resultPage.notes || {}} selected={selectedFrames} back={() => setResultsTab('frames')} exported={async () => { await loadResults(resultJob, page); message.success('拼接图已保存'); setResultsTab('sheets') }} /> : null },
        { key: 'sheets', label: `拼接图 (${resultPage.sheets.length})`, children: <div className="sheets-list">{resultPage.sheets.length ? resultPage.sheets.slice(sheetPage*20,sheetPage*20+20).map((sheet, visibleIndex) => {const index=sheetPage*20+visibleIndex;return <figure key={sheet.path} className={chosenSheet === sheet.path ? 'selected' : ''} onClick={() => setChosenSheet(sheet.path)}><img loading="lazy" src={sheet.thumbnailUrl || sheet.url} alt={`拼接图 ${index + 1}`} /><div className="sheet-actions"><Radio aria-label={`选择第 ${index + 1} 张拼接图`} checked={chosenSheet === sheet.path} onChange={() => setChosenSheet(sheet.path)}>第 {index + 1} 张</Radio><Button size="small" disabled={!!running || batchStitching} onClick={() => void action(async () => { await editor.current?.openSheet(sheet.recipe); setResultsTab('editor') })}>编辑这张</Button><Button size="small" onClick={() => setViewer({ images:resultPage.sheets.map((item,i) => ({ url:item.url,path:item.path,name:`拼接图 ${i+1}` })),index })}>查看原图</Button></div></figure>}) : <Empty description="在拼接编辑中选择一页，然后生成当前拼接图" />}{resultPage.sheets.length>20&&<Pagination aria-label="拼接图列表分页" current={sheetPage+1} pageSize={20} total={resultPage.sheets.length} showSizeChanger={false} onChange={next=>resultJob&&void loadResults(resultJob,page,next-1)}/>}</div> }
      ]} />
    </Modal>
  </div></ViewportContext.Provider>
}
