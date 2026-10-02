import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Pagination, Radio, Select, Spin } from 'antd'
import type { ExtractSettings, Job, SheetRecipe, StitchPreview, StoryTemplate } from '../../shared/types'
import { migrateSettings, STITCH_KEYS } from '../../shared/types'
import StitchSettings from './StitchSettings'
import useViewport from './useViewport'

export type StitchEditorHandle = { save(): Promise<void>; openSelection(): void; openSheet(recipe: SheetRecipe): Promise<void>; generateAll(): Promise<void>; isBusy(): boolean }

const StitchEditor = forwardRef<StitchEditorHandle, {
  job: Job; initial: ExtractSettings; initialNotes: Record<string, string>; selected: string[];
  templates?: StoryTemplate[];
  back(): void; exported(): Promise<void>
}>(function StitchEditor({ job, initial, initialNotes, selected, templates=[], back, exported }, ref) {
  const [value, setValue] = useState(initial)
  const [notes, setNotes] = useState(initialNotes)
  const [scope, setScope] = useState(selected.length ? 'selected' : 'all')
  const [recipe, setRecipe] = useState<SheetRecipe | null>(null)
  const [page, setPage] = useState(0)
  const [preview, setPreview] = useState<StitchPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportingRef = useRef(false)
  const openingRef = useRef(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [templateName,setTemplateName]=useState(''), [templateOpen,setTemplateOpen]=useState(false), [replaceOpen,setReplaceOpen]=useState(false), [replaceFrames,setReplaceFrames]=useState<{name:string;thumbnailUrl?:string;url:string}[]>([]), [replacePage,setReplacePage]=useState(0), [replaceTotal,setReplaceTotal]=useState(0)
  const dragged = useRef('')
  const view = useViewport(preview?.width || 1, preview?.height || 1, { close: ()=>{if(!exportingRef.current&&!openingRef.current)back()} })
  const [focusedFrame, setFocusedFrame] = useState('')
  const [availableWidth, setAvailableWidth] = useState(700)
  const scroll = view.container
  const request = useRef(0)
  const selectedKey = JSON.stringify(selected)
  const sourceNames = scope === 'sheet' ? recipe?.names || [] : scope === 'selected' ? selected : []
  const names = value.preserveOrder && sourceNames.length ? [...sourceNames].sort((a,b)=>{const order=value.frameOrder||[];const ia=order.indexOf(a),ib=order.indexOf(b);return (ia<0?order.length:ia)-(ib<0?order.length:ib)}) : sourceNames
  const offset = scope === 'sheet' ? recipe?.offset || 0 : 0
  const save = () => window.framepick.saveStitchDraft(job.id, notes, value)
  function reorder(from:string,to:string){if(from===to||!preview)return;const order=[...(preview.order||preview.frames.map(f=>f.name))];const start=order.indexOf(from),end=order.indexOf(to);if(start<0||end<0)return;order.splice(start,1);order.splice(end,0,from);setValue({...value,preserveOrder:true,frameOrder:order});if(scope==='sheet'&&recipe)setRecipe({...recipe,names:order});dragged.current=''}
  function shift(direction:number){if(!preview||!focusedFrame)return;const order=preview.order||preview.frames.map(f=>f.name),index=order.indexOf(focusedFrame),target=order[index+direction];if(target)reorder(focusedFrame,target)}
  async function loadReplacements(next=0){const result=await window.framepick.results(job.id,next);setReplaceFrames(result.frames);setReplaceTotal(result.total);setReplacePage(next);setReplaceOpen(true)}
  function replace(name:string){if(!preview||!focusedFrame)return;const order=[...(preview.order||preview.frames.map(f=>f.name))],index=order.indexOf(focusedFrame);if(index<0)return;if(order.includes(name)){const other=order.indexOf(name);order[other]=focusedFrame;order[index]=name;setValue({...value,preserveOrder:true,frameOrder:order});if(scope==='sheet'&&recipe)setRecipe({...recipe,names:order})}else{order[index]=name;setScope('sheet');setRecipe({names:order,settings:value,notes,offset});setValue({...value,preserveOrder:true,frameOrder:order})}setFocusedFrame(name);setReplaceOpen(false)}
  const fields=['镜号','画面','动作','对白']
  const fieldValues=Object.fromEntries(fields.map(label=>[label,(notes[focusedFrame]||'').split('\n').filter(line=>line.startsWith(label+'：')).map(line=>line.slice(label.length+1)).join(' ')]))
  function updateField(label:string,text:string){const next={...fieldValues,[label]:text.replace(/\n/g,' ')};const plain=(notes[focusedFrame]||'').split('\n').filter(line=>!fields.some(key=>line.startsWith(key+'：'))).filter(Boolean).join('\n');const content=[...fields.filter(key=>next[key]).map(key=>`${key}：${next[key]}`),plain].filter(Boolean).join('\n');if(content.length>1000){setError('每张图片的备注最多 1000 字，请缩短文字。');return}setNotes({...notes,[focusedFrame]:content})}
  useImperativeHandle(ref, () => ({
    save, isBusy: () => exportingRef.current || openingRef.current,
    openSelection: () => { setRecipe(null); setScope(selected.length ? 'selected' : 'all'); setPage(0) },
    openSheet: async next => {
      openingRef.current=true
      try{await save()
        setRecipe(next); setScope('sheet'); setPage(0); setError(''); setPreview(null)
        setValue(migrateSettings(next.settings))
        setNotes(previous => ({ ...previous, ...next.notes }))
      } finally {openingRef.current=false}
    },
    generateAll: () => generate(true)
  }), [job.id, notes, value, selectedKey, scope, recipe, page, exporting])
  useEffect(() => {
    const element = scroll.current
    if (!element) return
    const observer = new ResizeObserver(() => setAvailableWidth(Math.max(100, element.clientWidth - 18)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { setPage(0) }, [scope, selectedKey, value.rows, value.columns, value.layout, value.perSheet])
  useEffect(() => {
    const token = ++request.current
    setLoading(true); setError('')
    if (scope === 'selected' && !selected.length) { setPreview(null); setLoading(false); return }
    const timer = setTimeout(() => {
      window.framepick.stitchPreview(job.id, names, value, page, notes, offset).then(result => {
        if (request.current === token) { setPreview(result); if (result.page !== page) setPage(result.page) }
      }).catch(e => { if (request.current === token) { setPreview(null); setError(e.message) } }).finally(() => { if (request.current === token) setLoading(false) })
    }, 150)
    return () => { clearTimeout(timer); request.current++ }
  }, [job.id, selectedKey, scope, recipe, value, page, notes])
  useEffect(() => {
    if (exporting) return
    setSaved('正在保存…')
    let alive = true
    const timer = setTimeout(() => save().then(() => { if (alive) setSaved('备注与设置已保存') }).catch(e => { if (alive) setSaved(e.message) }), 500)
    return () => { alive = false; clearTimeout(timer) }
  }, [job.id, notes, value, exporting])
  async function generate(all = false) {
    if (exportingRef.current) return
    exportingRef.current = true
    setExporting(true); setError('')
    try {
      await save()
      await window.framepick.stitch(job.id, all ? [] : names, value, all ? undefined : { page, offset })
      await exported()
    } catch (e) { setError(e instanceof Error ? e.message : '拼接失败。') }
    finally { exportingRef.current = false; setExporting(false) }
  }
  const cells = preview ? Array.from({ length: preview.rows * preview.columns }, (_, index) => preview.frames[index] || null) : []
  const scale = view.scale
  const inset = preview ? Math.max(6, Math.min(14, Math.floor(preview.imageWidth * .025))) : 6
  return <div className="stitch-editor">
    <section className="board-main"><div className="board-toolbar"><Radio.Group aria-label="拼接图片范围" value={scope} onChange={e => { setRecipe(null); setScope(e.target.value) }} disabled={exporting} options={[{ value: 'selected', label: `仅已选 ${selected.length} 张`, disabled: !selected.length }, { value: 'all', label: '全部截图' }, ...(scope === 'sheet' ? [{ value: 'sheet', label: '当前已选拼接图' }] : [])]} /><Button size="small" disabled={exporting} onClick={back}>返回选图</Button></div>
      <div className="board-zoom"><span>{scope === 'sheet' ? '正在编辑已有拼接图 · 重新生成会另存一张' : `当前拼接图 ${(preview?.page || 0) + 1} / ${preview?.pages || 1}`}</span><div><Button size="small" type={view.mode === 'fit' ? 'primary' : 'default'} onClick={view.fit}>适合宽度</Button><Button size="small" type={view.mode === 'actual' ? 'primary' : 'default'} onClick={view.actual}>100%</Button><Button size="small" aria-label="缩小拼接画面" onClick={view.zoomOut}>−</Button><Button size="small" aria-label="放大拼接画面" onClick={view.zoomIn}>＋</Button><small>{Math.round(scale * 100)}%{loading && ' · 更新预览…'}</small></div></div>
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} />}
      {preview?.tooLarge && <Alert type="warning" showIcon title="图片超过 2400 万像素，请减少行列、画面宽度或备注区高度。" style={{ marginBottom: 12 }} />}
      <div className={'board-scroll ' + (view.panning ? 'panning' : '')} ref={scroll} {...view.handlers} onDragOver={event=>{if(!dragged.current)return;event.preventDefault();const root=scroll.current!;const box=root.getBoundingClientRect();if(event.clientY<box.top+35)root.scrollTop-=24;else if(event.clientY>box.bottom-35)root.scrollTop+=24}}><Spin spinning={loading && !preview}><div className="board-canvas-shell" style={{ width: preview ? preview.width * scale : undefined, height: preview ? preview.height * scale : undefined }}>
        <div className="storyboard-grid" style={{ width: preview?.width, height: preview?.height, transform: `scale(${scale})`, gridTemplateColumns: `repeat(${preview?.columns || 1}, ${preview?.imageWidth || 1}px)`, gap: preview?.padding, background: value.background, padding: preview?.padding }}>
          {cells.map((frame, index) => {
            const row = Math.floor(index / (preview?.columns || 1)), noteHeight = preview?.rowNoteHeights[row] || 0
            return <div key={frame?.name || `empty-${index}`} className={'story-cell ' + (frame ? focusedFrame === frame.name ? 'focused' : '' : 'empty')} data-frame={frame?.name} onClick={() => frame && setFocusedFrame(frame.name)} onDragOver={event=>{if(frame){event.preventDefault();event.dataTransfer.dropEffect='move'}}} onDrop={event=>{event.preventDefault();if(frame&&dragged.current)reorder(dragged.current,frame.name)}} style={{ height: (preview?.imageHeight || 0) + (preview?.labelHeight || 0) + noteHeight }}>
              {frame && <><img src={frame.thumbnailUrl&&(preview?.tooLarge||((preview?.imageWidth||0)*scale<=480))?frame.thumbnailUrl:frame.url} alt={frame.name} draggable onDragStart={event=>{dragged.current=frame.name;event.dataTransfer.setData('text/plain',frame.name);event.dataTransfer.effectAllowed='move'}} style={{ height: preview?.imageHeight }} />{value.labels && <div className="story-time" style={{ height: preview?.labelHeight, fontSize: Math.max(12, Math.floor(value.thumbWidth * .04)), padding: '0 6px' }}>#{(preview?.offset || 0) + index + 1} · {frame.name}</div>}{value.notesEnabled && <Input.TextArea aria-label={`${frame.name} 备注`} placeholder="镜头说明、动作、对白…" maxLength={1000} value={notes[frame.name] || ''} disabled={exporting} style={{ height: noteHeight, minHeight: 0, overflow: 'hidden', fontFamily: value.noteFont==='arial'&&!/[\u3400-\u9fff]/.test(notes[frame.name]||'')?'Arial, sans-serif':'Microsoft YaHei, sans-serif', color:value.noteColor,background:value.noteBackground,textAlign:value.noteAlign, fontSize: value.noteFontSize, lineHeight: `${Math.ceil(value.noteFontSize * 1.45)}px`, padding: inset }} onChange={e => { setError(''); setNotes(previous => ({ ...previous, [frame.name]: e.target.value })) }} />}</>}
            </div>
          })}
        </div>
      </div>{!preview && !loading && <p className="board-empty">先选择图片，或切换为全部截图。</p>}</Spin></div>
      <div className="board-page-info"><span>{preview ? `${preview.rows} 行 × ${preview.columns} 列 · ${preview.width} × ${preview.height} px · 共 ${preview.pages} 张拼接图` : ''}</span>{preview && <Pagination aria-label="选择拼接图" current={page + 1} pageSize={preview.capacity} total={preview.total} showSizeChanger={false} size="small" onChange={next => setPage(next - 1)} />}</div>
      <p className="board-footnote">末行缺图留空，底部空行自动去除。备注按所选字号自动撑高，同一行保持等高；100% 可查看实际字号。</p>
    </section>
    <aside className="board-settings settings-content"><fieldset disabled={exporting}><div className="board-template"><Select aria-label="选择故事板模板" placeholder="应用已保存模板" value={null} options={templates.filter(t=>!t.name.startsWith("裁剪 · ")).map(t=>({value:t.id,label:t.name}))} onChange={id=>{const t=templates.find(t=>t.id===id);if(t){setValue({...value,...Object.fromEntries(STITCH_KEYS.map(key=>[key,t.settings[key]]))})}}}/><Button size="small" onClick={()=>{setTemplateName('');setTemplateOpen(true)}}>保存模板</Button></div>{focusedFrame&&<div className="focused-image-tools"><strong>{focusedFrame}</strong><div><Button size="small" onClick={()=>shift(-1)}>前移</Button><Button size="small" onClick={()=>shift(1)}>后移</Button><Button size="small" onClick={()=>void loadReplacements().catch(e=>setError(e.message))}>替换图片</Button></div>{value.noteFields&&value.notesEnabled&&fields.map(label=><label key={label}>{label}<Input.TextArea aria-label={`${focusedFrame} ${label}`} value={fieldValues[label]} maxLength={220} autoSize={{minRows:1}} onChange={e=>updateField(label,e.target.value)}/></label>)}</div>}<Button type="text" size="small" disabled={!value.preserveOrder} onClick={()=>setValue({...value,preserveOrder:false,frameOrder:[]})}>恢复按时间排序</Button><StitchSettings value={value} onChange={setValue} /></fieldset><div className="board-save-status">{saved}</div><Button type="primary" block loading={exporting} disabled={!preview?.total || loading || preview.tooLarge} onClick={() => void generate()}>生成当前拼接图</Button></aside>
    <Modal open={templateOpen} title="保存故事板模板" okText="保存模板" cancelText="取消" onCancel={()=>setTemplateOpen(false)} onOk={()=>void window.framepick.saveTemplate(templateName,value).then(()=>{setTemplateOpen(false);setSaved('模板已保存')}).catch(e=>setError(e.message))}><Input aria-label="故事板模板名称" value={templateName} maxLength={60} onChange={e=>setTemplateName(e.target.value)}/></Modal>
    <Modal open={replaceOpen} title={`替换 ${focusedFrame}`} footer={null} width={720} onCancel={()=>setReplaceOpen(false)}><p className="subtle-note">选择替换图片；若图片已在当前拼图中，则互换位置。</p><div className="replacement-grid">{replaceFrames.map(frame=><button key={frame.name} onClick={()=>replace(frame.name)}><img src={frame.thumbnailUrl||frame.url} alt={frame.name}/><span>{frame.name}</span></button>)}</div><Pagination current={replacePage+1} pageSize={60} total={replaceTotal} showSizeChanger={false} onChange={next=>void loadReplacements(next-1)}/></Modal>
  </div>
})
export default StitchEditor
