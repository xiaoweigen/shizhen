import { useRef, useState, type PointerEvent } from 'react'
import { Alert, App as AntApp, Button, Collapse, Input, InputNumber, Modal, Select } from 'antd'
import type { CropRect, CropSegment, VideoItem, StoryTemplate } from '../../shared/types'
import useViewport from './useViewport'
import usePlayback,{PlaybackSurface} from './usePlayback'
import VideoTimeline from './VideoTimeline'
import TimeInput from './TimeInput'
import {formatTime} from '../../shared/time'
const full: CropRect = { x:0,y:0,width:1,height:1 }
const clamp = (v:number,min:number,max:number) => Math.max(min,Math.min(max,v))
const normalized = (rect:CropRect) => rect.x === 0 && rect.y === 0 && rect.width === 1 && rect.height === 1 ? null : rect
export default function CropEditor({ video, initial, presets=[],savePreset,batch,close, apply }: { video:VideoItem; initial:CropRect|null; presets?:StoryTemplate[];savePreset?(name:string,crop:CropRect|null,segments:CropSegment[]):Promise<void>;batch?(crop:CropRect|null,segments:CropSegment[]):Promise<void>;close():void; apply(crop:CropRect|null,segments:CropSegment[]):Promise<void> }) {
  const { modal } = AntApp.useApp(), info = video.info!
  const rotated = Math.abs(info.rotation||0)%180===90, rawWidth = Math.round(info.width*(info.sar||1)), width = rotated?info.height:rawWidth, height = rotated?rawWidth:info.height
  const stageWidth = width, stageHeight = height
  const [presetOpen,setPresetOpen]=useState(false), [presetName,setPresetName]=useState('')
  const [base,setBase] = useState(initial||full), [segments,setSegments] = useState<CropSegment[]>(video.cropSegments||[]), [active,setActive] = useState('base'), [saving,setSaving] = useState(false), [error,setError] = useState(''), [draftRange,setDraftRange]=useState({start:0,end:info.duration})
  const playback=usePlayback(video),time=playback.time
  const stage = useRef<HTMLDivElement>(null), gesture = useRef<{pointer:number;x:number;y:number;rect:CropRect;mode:string}|null>(null)
  const view = useViewport(stageWidth,stageHeight,{fitHeight:true,close:()=>{ if(!saving) close() },panStart:()=>{gesture.current=null}})
  const current = segments.find(item=>item.id===active), rect = current?.rect|| (current?full:base)
  const pixels = {x:Math.round(rect.x*width),y:Math.round(rect.y*height),width:Math.max(1,Math.round((rect.x+rect.width)*width)-Math.round(rect.x*width)),height:Math.max(1,Math.round((rect.y+rect.height)*height)-Math.round(rect.y*height))}
  function setRect(next:CropRect) { if(current) setSegments(previous=>previous.map(item=>item.id===active?{...item,rect:normalized(next)}:item)); else setBase(next) }
  function seek(next:number,choose=true) { playback.seek(next); if(choose) { const match=[...segments].sort((a,b)=>b.start-a.start).find(item=>item.start<=next&&next<=item.end); setActive(match?.id||'base') } }
  function select(id:string) { setActive(id); const item=segments.find(item=>item.id===id); if(item) seek(item.start,false) }
  function point(event:PointerEvent) { const box=stage.current!.getBoundingClientRect();return {x:clamp((event.clientX-box.left)/box.width,0,1),y:clamp((event.clientY-box.top)/box.height,0,1)} }
  function down(event:PointerEvent) { if(event.button!==0)return;event.preventDefault();const p=point(event),mode=(event.target as HTMLElement).dataset.handle||((event.target as HTMLElement).closest('.crop-rect')?'move':'draw');gesture.current={pointer:event.pointerId,...p,rect,mode};stage.current?.setPointerCapture(event.pointerId) }
  function move(event:PointerEvent) {
    const g=gesture.current;if(!g||g.pointer!==event.pointerId)return
    const p=point(event),dx=p.x-g.x,dy=p.y-g.y,r=g.rect
    if(g.mode==='move'){setRect({...r,x:clamp(r.x+dx,0,1-r.width),y:clamp(r.y+dy,0,1-r.height)});return}
    let left=r.x,top=r.y,right=r.x+r.width,bottom=r.y+r.height
    if(g.mode==='draw'){left=Math.min(g.x,p.x);top=Math.min(g.y,p.y);right=Math.max(g.x,p.x);bottom=Math.max(g.y,p.y)}else{if(g.mode.includes('w'))left=clamp(r.x+dx,0,right-1/width);if(g.mode.includes('e'))right=clamp(r.x+r.width+dx,left+1/width,1);if(g.mode.includes('n'))top=clamp(r.y+dy,0,bottom-1/height);if(g.mode.includes('s'))bottom=clamp(r.y+r.height+dy,top+1/height,1)}
    left=Math.min(left,1-1/width);top=Math.min(top,1-1/height);setRect({x:left,y:top,width:Math.max(1/width,right-left),height:Math.max(1/height,bottom-top)})
  }
  function number(key:keyof CropRect,value:number){const p={...pixels,[key]:Math.round(value)};p.x=clamp(p.x,0,width-1);p.y=clamp(p.y,0,height-1);p.width=clamp(p.width,1,width-p.x);p.height=clamp(p.height,1,height-p.y);setRect({x:p.x/width,y:p.y/height,width:p.width/width,height:p.height/height})}
  function add(){const start=active==='base'?draftRange.start:Math.max(...segments.map(item=>item.end))+.001,end=active==='base'?draftRange.end:Math.min(info.duration,start+5);if(start>=info.duration||end<=start||segments.some(s=>start<s.end&&end>s.start)){setError('选区与已有时段重叠或没有剩余时间，请先调整选区。');return}setError('');const id=crypto.randomUUID();setSegments(previous=>[...previous,{id,start,end,rect:normalized(rect)}]);setActive(id);seek(start,false)}
  const sorted=[...segments].sort((a,b)=>a.start-b.start),invalid=sorted.some((s,i)=>s.end<=s.start||s.end>info.duration||(i>0&&s.start<sorted[i-1].end))
  async function save(){setSaving(true);setError('');try{await apply(normalized(base),segments.map(item=>({...item,rect:item.rect?normalized(item.rect):null})));close()}catch(e){setError((e as Error).message)}finally{setSaving(false)}}
  return <Modal open title={`裁剪画面 · ${video.name}`} className="crop-modal" width={1120} style={{top:24}} styles={{body:{maxHeight:'calc(100vh - 190px)',overflowY:'auto',paddingRight:4}}} keyboard={false} onCancel={()=>{if(!saving)close()}} maskClosable={false} footer={<><Button disabled={saving} onClick={()=>setRect(full)}>恢复完整画面</Button><Button disabled={saving} onClick={close}>取消</Button><Button type="primary" disabled={invalid} loading={saving} onClick={()=>void save()}>应用裁剪区域</Button></>}>
    <p className="crop-help">默认区域用于未设置的时段；分段按目标截图时间切换，时段起点和终点均包含，相接边界用后一段。缩放只改变查看大小，不改变裁剪像素。</p>
    {error&&<Alert type="error" title={error} showIcon/>}{invalid&&<Alert type="warning" title="裁剪时段存在重叠或超出时长，请调整时间轴。"/>}
    <div className="crop-workspace"><div className="crop-main">
      <div className="image-viewer-tools"><Button aria-label="缩小裁剪画面" onClick={view.zoomOut}>−</Button><span>{Math.round(view.scale*100)}%</span><Button aria-label="放大裁剪画面" onClick={view.zoomIn}>＋</Button><Button onClick={view.fit}>适合画面</Button><Button onClick={view.actual}>100%</Button><span>{current?`${formatTime(current.start)}～${formatTime(current.end)}`:'默认区域'}</span></div>
      <div ref={view.attach} className={'crop-preview-wrap '+(view.panning?'panning':'')} {...view.handlers}><div className="crop-scaled-canvas" style={{...view.panStyle,width:stageWidth*view.scale,height:stageHeight*view.scale,flexShrink:0}}><div ref={stage} className="crop-stage" style={{width:stageWidth,height:stageHeight,transform:`scale(${view.scale})`,transformOrigin:'top left'}} onPointerDown={down} onPointerMove={move} onPointerUp={()=>{gesture.current=null}} onPointerCancel={()=>{gesture.current=null}} onLostPointerCapture={()=>{gesture.current=null}}>
        <PlaybackSurface video={video} player={playback}/>
        <div className="crop-rect" style={{left:`${rect.x*100}%`,top:`${rect.y*100}%`,width:`${rect.width*100}%`,height:`${rect.height*100}%`}}><span className="crop-size" style={{fontSize:12/view.scale,padding:`${3/view.scale}px ${6/view.scale}px`}}>{pixels.width} × {pixels.height} px</span>{['nw','n','ne','e','se','s','sw','w'].map(handle=><i key={handle} data-handle={handle} className={`crop-handle ${handle}`} style={{width:10/view.scale,height:10/view.scale}}/>)}</div>
      </div></div></div>
      <Collapse ghost defaultActiveKey={['timeline']} items={[{key:'timeline',label:'裁剪范围 · 可视化时间轴',children:<VideoTimeline label="裁剪" duration={info.duration} time={time} range={current||draftRange} onRange={next=>{if(current)setSegments(prev=>prev.map(s=>s.id===active?{...s,...next}:s));else setDraftRange(next)}} seek={next=>seek(next,false)} playing={playback.playing} toggle={playback.toggle} segments={segments} activeId={active} onSelect={select}/>} ]}/>

      <div className="crop-fields">{(['x','y','width','height'] as const).map((key,index)=><label key={key}>{['左边距','上边距','裁剪宽度','裁剪高度'][index]}<InputNumber aria-label={['裁剪左边距','裁剪上边距','裁剪宽度','裁剪高度'][index]} value={pixels[key]} min={key==='x'||key==='y'?0:1} max={key==='x'||key==='width'?width:height} precision={0} suffix="px" onChange={v=>v!==null&&number(key,v)}/></label>)}</div>
      <div className="crop-preset-tools"><Select<string> aria-label="裁剪比例预设" placeholder="比例预设" style={{width:140}} value={null} options={['16:9','9:16','1:1','4:3','3:4'].map(v=>({value:v,label:v}))} onChange={v=>{if(!v)return;const[a,b]=v.split(':').map(Number),w=Math.min(width,height*a/b),h=w*b/a;setRect({x:(width-w)/2/width,y:(height-h)/2/height,width:w/width,height:h/height})}}/><Button onClick={()=>setRect({...rect,x:(1-rect.width)/2,y:(1-rect.height)/2})}>居中</Button>{savePreset&&<Button onClick={()=>{setPresetName('');setPresetOpen(true)}}>保存裁剪预设</Button>}{batch&&<Button disabled={saving} onClick={()=>void batch(normalized(base),segments).catch(e=>setError(e.message))}>应用到已选视频</Button>}<Select<string> aria-label="已保存裁剪预设" placeholder="已保存区域" style={{width:180}} value={null} options={presets.map(t=>({value:t.id,label:t.name.replace(/^裁剪 · /,'')}))} onChange={id=>{const t=presets.find(item=>item.id===id);if(t){setBase(t.settings.crop||full);setSegments((t.settings.cropSegments||[]).map(segment=>({...segment,id:crypto.randomUUID()})));setActive('base')}}}/></div>
    </div><aside className="crop-segments"><h3>裁剪时段</h3><button data-crop-segment="base" className={active==='base'?'active':''} onClick={()=>select('base')}>默认区域 · 其他所有时间</button>{segments.map(item=><div key={item.id} className="crop-segment-row"><button data-crop-segment={item.id} className={active===item.id?'active':''} onClick={()=>select(item.id)}>{formatTime(item.start)}～{formatTime(item.end)}</button><Button size="small" aria-label={`移除裁剪时段 ${item.start}～${item.end}`} onClick={()=>modal.confirm({title:'移除这个裁剪时段？',content:'这段时间将使用默认区域。',okText:'确认移除',cancelText:'取消',onOk:()=>{setSegments(previous=>previous.filter(v=>v.id!==item.id));if(active===item.id)setActive('base')}})}>×</Button></div>)}<Button onClick={add} disabled={saving||segments.length>=200}>添加裁剪时段</Button>
      {current&&<div className="crop-range-fields"><label>开始时间<TimeInput label="裁剪时段开始" max={current.end-.001} value={current.start} onChange={v=>{if(v!==null){setSegments(prev=>prev.map(s=>s.id===active?{...s,start:v}:s));seek(v,false)}}}/></label><label>结束时间（含）<TimeInput label="裁剪时段结束" min={current.start+.001} max={info.duration} value={current.end} onChange={v=>{if(v!==null){setSegments(prev=>prev.map(s=>s.id===active?{...s,end:v}:s));seek(v,false)}}}/></label></div>}
      <p className="crop-help">选择时段后调整左侧区域；可播放预览，拖动时间轴跳到指定时间。不同段可以有不同尺寸，不会改动默认区域。</p>
    </aside></div><p className="crop-help">完整画面 {width} × {height} px · 原视频保持不变，已有图片需重新抽帧。</p>
    <Modal open={presetOpen} title="保存裁剪预设" okText="保存预设" cancelText="取消" onCancel={()=>setPresetOpen(false)} onOk={()=>void savePreset?.(presetName,normalized(base),segments).then(()=>setPresetOpen(false)).catch(e=>setError(e.message))}><Input aria-label="裁剪预设名称" value={presetName} maxLength={50} onChange={e=>setPresetName(e.target.value)}/><p className="subtle-note">保存默认区域和所有时段，区域按画面比例换算；应用时请检查视频时长。</p></Modal>
  </Modal>
}
