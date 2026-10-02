import { useState } from 'react'
import { App as AntApp, Button, Checkbox, Dropdown, Input, Modal, Select, Spin, Tooltip } from 'antd'
import type { Snapshot, VideoItem } from '../../shared/types'
import Icon from './Icon'
import useVideoDrag, { UNCLASSIFIED } from './useVideoDrag'

const bridge = window.framepick
const duration = (seconds: number) => { const s = Math.floor(seconds || 0); return (s >= 3600 ? `${Math.floor(s / 3600)}:` : '') + `${Math.floor(s / 60) % 60}`.padStart(2, '0') + ':' + `${s % 60}`.padStart(2, '0') }
const size = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`
const pinnedFirst = <T extends { pinnedAt?: number }>(items: T[]) => [...items].sort((a, b) => (b.pinnedAt || 0) - (a.pinnedAt || 0))

export default function VideoLibrary({ state, selected, focused, setSelected, setFocused }: {
  state: Snapshot; selected: string[]; focused: string;
  setSelected: React.Dispatch<React.SetStateAction<string[]>>; setFocused(id: string): void
}) {
  const { message, modal } = AntApp.useApp()
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [unclassifiedClosed, setUnclassifiedClosed] = useState(false)
  const projects = pinnedFirst(state.projects)
  const projectOptions = [{ value: '', label: '未分类' }, ...projects.map(project => ({ value: project.id, label: project.name }))]
  const matches = (video: VideoItem) => `${video.name} ${video.path || ''} ${video.platform || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const visible = state.videos.filter(matches)
  async function perform(fn: () => Promise<unknown>) {
    try { await fn(); return true } catch (error) { message.error(error instanceof Error ? error.message : '操作失败。'); return false }
  }
  const dragging = useVideoDrag(state, async (id, target) => {
    if (await perform(() => bridge.moveVideos([id], target))) message.success(`已移动到${projects.find(project => project.id === target)?.name || '未分类'}`)
  })
  async function saveName() {
    if (saving || editing === null) return
    setSaving(true)
    const ok = await perform(() => editing ? bridge.updateProject(editing, { name }) : bridge.createProject(name))
    setSaving(false)
    if (ok) setEditing(null)
  }
  function chooseGroup(videos: VideoItem[], checked: boolean) {
    setSelected(previous => checked ? [...new Set([...previous, ...videos.map(video => video.id)])] : previous.filter(id => !videos.some(video => video.id === id)))
  }
  function removeVideos(videos: VideoItem[]) {
    modal.confirm({ title: videos.length === 1 ? '移除这个视频？' : `移除已选的 ${videos.length} 个视频？`, content: <><p>{videos.slice(0, 3).map(video => video.name).join('、')}{videos.length > 3 && '…'}</p><p className="confirm-detail">只移除列表项，原视频、已下载的视频和导出图片都会保留。正在处理或等待处理的视频需先取消任务。</p></>, okText: '确认移除', cancelText: '取消', autoFocusButton: 'cancel', onOk: () => bridge.removeVideos(videos.map(video => video.id)).catch(error => { message.error(error.message); throw error }) })
  }
  const moveMenu = (video: VideoItem) => ({
    items: projectOptions.map(option => ({ key: option.value || UNCLASSIFIED, label: option.label, disabled: (video.projectId || '') === option.value })),
    onClick: ({ key }: { key: string }) => void perform(() => bridge.moveVideos([video.id], key === UNCLASSIFIED ? null : key))
  })
  function renderVideo(video: VideoItem) {
    return <div key={video.id} data-video-id={video.id} className={'video-row ' + (focused === video.id ? 'focused ' : '') + (dragging.drag?.id === video.id ? 'moving' : '')} onPointerDown={event => dragging.down(event, video)} onClick={() => { if (!dragging.ignoreClick.current) setFocused(video.id) }}>
      <div className="video-row-top"><Checkbox aria-label={`选择 ${video.name}`} checked={selected.includes(video.id)} onClick={e => e.stopPropagation()} onChange={e => setSelected(previous => e.target.checked ? [...new Set([...previous, video.id])] : previous.filter(id => id !== video.id))} /><span className="video-source">{video.source === 'online' ? video.platform : '本地视频'}</span><div className="video-row-controls" onClick={e => e.stopPropagation()}><Tooltip title={video.pinnedAt ? '取消置顶' : '置顶此视频'}><button aria-label={`${video.pinnedAt ? '取消置顶' : '置顶'} ${video.name}`} className={'pin-video ' + (video.pinnedAt ? 'pinned' : '')} onClick={() => void perform(() => bridge.pinVideo(video.id, !video.pinnedAt))}><Icon name="pin" size={13} /></button></Tooltip><Dropdown menu={moveMenu(video)} trigger={['click']}><button aria-label={`移动 ${video.name} 到项目`} className="move-video"><Icon name="folder" size={13} /></button></Dropdown><button aria-label={`移除 ${video.name}`} className="remove-video" onClick={() => removeVideos([video])}><Icon name="close" size={14} /></button></div></div>
      <div className="video-row-content"><div className="video-thumb">{video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" draggable={false} /> : <Icon name="film" size={23} />}{video.status === 'reading' && <Spin size="small" />}</div><div className="video-description"><Tooltip title={video.path || video.url}><strong>{video.name}</strong></Tooltip><span>{video.info ? `${duration(video.info.duration)} · ${video.info.width || '—'} × ${video.info.height || '—'}` : video.status === 'reading' ? '正在读取视频信息…' : '无法读取视频'}</span></div></div>
      <div className="video-row-bottom">{video.status === 'error' ? <Tooltip title={video.error}><span className="error-text">{video.error}</span></Tooltip> : <><span>{video.info?.codec?.toUpperCase() || '读取中'}</span>{video.downloadedPath ? <span className="override-badge">已下载</span> : video.override ? <span className="override-badge">单独设置</span> : <span>{video.info?.size ? size(video.info.size) : '—'}</span>}{video.crop && <span className="override-badge">已裁剪</span>}</>}</div>
    </div>
  }
  const unclassified = pinnedFirst(visible.filter(video => !video.projectId))
  const dragVideo = state.videos.find(video => video.id === dragging.drag?.id)
  return <section className="video-panel panel">
    <div className="panel-heading"><h2>视频列表 <span>{state.videos.length}</span></h2>{state.videos.length > 0 && <Checkbox aria-label="选择全部视频" checked={visible.length > 0 && visible.every(video => selected.includes(video.id))} indeterminate={visible.some(video => selected.includes(video.id)) && !visible.every(video => selected.includes(video.id))} disabled={!visible.length} onChange={event => chooseGroup(visible, event.target.checked)} />}</div>
    <div className="project-tools"><Button size="small" icon={<Icon name="plus" size={14} />} onClick={() => { setName(''); setEditing('') }}>新建项目</Button><Tooltip title="新导入或解析的视频会加入这里"><Select aria-label="新视频加入项目" size="small" value={state.activeProjectId || ''} options={projectOptions} onChange={id => void perform(() => bridge.setActiveProject(id || null))} /></Tooltip></div>
    <div className="video-search"><Input aria-label="搜索视频" size="small" allowClear prefix={<Icon name="search" size={13} />} placeholder="搜索名称、路径或平台" value={query} onChange={event => setQuery(event.target.value)} /></div>
    {!!selected.length && <div className="project-move">{!!projects.length && <Select aria-label="移动已选视频到项目" size="small" value={null} placeholder={`移动已选 ${selected.length} 个视频…`} options={projectOptions} onChange={id => void perform(() => bridge.moveVideos(selected, id || null))} />}<Button size="small" onClick={() => removeVideos(state.videos.filter(video => selected.includes(video.id)))}>移除已选 ({selected.length})</Button></div>}
    <div className={'video-list ' + (dragging.drag ? 'dragging-video' : '')} ref={dragging.list}>
      {projects.map(project => {
        const all = state.videos.filter(video => video.projectId === project.id)
        const videos = pinnedFirst(all.filter(matches))
        return <div className={'video-project ' + (state.activeProjectId === project.id ? 'current ' : '') + (dragging.drag?.target === project.id ? 'drop-target' : '')} key={project.id} data-project={project.id} data-drop-project={project.id}>
          <div className="project-heading"><Checkbox aria-label={`选择项目 ${project.name} 的视频`} checked={videos.length > 0 && videos.every(video => selected.includes(video.id))} indeterminate={videos.some(video => selected.includes(video.id)) && !videos.every(video => selected.includes(video.id))} disabled={!videos.length} onChange={e => chooseGroup(videos, e.target.checked)} /><button className="project-fold" aria-label={`${project.collapsed ? '展开' : '收起'}项目 ${project.name}`} aria-expanded={!project.collapsed} onClick={() => void perform(() => bridge.updateProject(project.id, { collapsed: !project.collapsed }))}><Icon name={project.collapsed ? 'chevronRight' : 'chevronDown'} size={12} />{project.pinnedAt && <Icon name="pin" size={11} />}<Tooltip title={project.name}><strong>{project.name}</strong></Tooltip><span>{query ? `${videos.length}/${all.length}` : all.length}</span></button><Dropdown trigger={['click']} menu={{ items: [{ key: 'pin', label: project.pinnedAt ? '取消置顶' : '置顶项目' }, { key: 'target', label: '新视频加入此项目' }, { key: 'rename', label: '重命名' }, { key: 'remove', label: '移除项目' }], onClick: ({ key }) => {
            if (key === 'rename') { setName(project.name); setEditing(project.id) }
            else if (key === 'remove') modal.confirm({ title: '移除项目？', content: `“${project.name}”中的 ${all.length} 个视频会回到未分类，视频与导出文件保留。`, okText: '确认移除', cancelText: '取消', autoFocusButton: 'cancel', onOk: () => bridge.removeProject(project.id) })
            else void perform(() => key === 'pin' ? bridge.updateProject(project.id, { pinned: !project.pinnedAt }) : bridge.setActiveProject(project.id))
          } }}><button className="project-menu" aria-label={`项目菜单 ${project.name}`}><Icon name="more" size={15} /></button></Dropdown></div>
          {(!project.collapsed || !!query) && (videos.length ? videos.map(renderVideo) : <p className="project-empty">{query && all.length ? '没有匹配的视频。' : '长按视频，拖到这里。'}</p>)}
        </div>
      })}
      {projects.length > 0 ? <div className={'video-project ' + (dragging.drag?.target === UNCLASSIFIED ? 'drop-target' : '')} data-drop-project={UNCLASSIFIED}><div className="project-heading"><Checkbox aria-label="选择未分类视频" checked={unclassified.length > 0 && unclassified.every(video => selected.includes(video.id))} disabled={!unclassified.length} indeterminate={unclassified.some(video => selected.includes(video.id)) && !unclassified.every(video => selected.includes(video.id))} onChange={e => chooseGroup(unclassified, e.target.checked)} /><button className="project-fold" aria-label={unclassifiedClosed ? '展开未分类' : '收起未分类'} aria-expanded={!unclassifiedClosed} onClick={() => setUnclassifiedClosed(!unclassifiedClosed)}><Icon name={unclassifiedClosed ? 'chevronRight' : 'chevronDown'} size={12} /><strong>未分类</strong><span>{unclassified.length}</span></button></div>{(!unclassifiedClosed || !!query) && (unclassified.length ? unclassified.map(renderVideo) : <p className="project-empty">可把项目里的视频拖回这里。</p>)}</div> : visible.length ? pinnedFirst(visible).map(renderVideo) : null}
      {!!query && !visible.length && <p className="project-empty">没有匹配的视频，清空搜索后查看全部。</p>}
      {!state.videos.length && !projects.length && <div className="list-empty"><Icon name="layers" size={30} /><strong>还没有视频</strong><span>添加单个文件，或一次导入多个视频。</span></div>}
    </div>
    {dragVideo && dragging.drag && <div className="video-drag-ghost" style={{ left: dragging.drag.x + 14, top: dragging.drag.y + 12 }}><Icon name="film" size={16} /><strong>{dragVideo.name}</strong><span>{dragging.drag.target ? `松开移入 ${projects.find(project => project.id === dragging.drag?.target)?.name || '未分类'}` : '拖到项目或未分类 · Esc 取消'}</span></div>}
    <div className="list-footer">已选 {state.videos.filter(video => video.status === 'ready' && selected.includes(video.id)).length} 个可处理视频{query && ` · 找到 ${visible.length} 个`}{!!projects.length && <small>长按视频拖动分类 · 悬停可展开项目</small>}</div>
    <Modal title={editing ? '重命名项目' : '新建项目'} open={editing !== null} onCancel={() => !saving && setEditing(null)} onOk={() => void saveName()} confirmLoading={saving} okButtonProps={{ disabled: !name.trim() }} okText="保存" cancelText="取消" width={420} destroyOnHidden><p className="modal-intro">项目用来分类视频列表，展开或收起都不会影响已有任务。</p><Input autoFocus aria-label="项目名称" maxLength={60} value={name} onChange={e => setName(e.target.value)} onPressEnter={() => void saveName()} placeholder="例如：旅行素材、短片参考" /></Modal>
  </section>
}
