import {useEffect,useLayoutEffect,useRef,useState,type PointerEvent} from 'react'
import {Button} from 'antd'
import type {TimeRange} from '../../shared/types'
import {formatTime} from '../../shared/time'
import TimeInput from './TimeInput'
import TimeInputModeSelector from './TimeInputMode'
type Segment=TimeRange&{id:string;label?:string}
export default function VideoTimeline({duration,time,range,onRange,seek,playing,toggle,label='截取',segments=[],activeId,onSelect,reset,beforeChange}:{duration:number;time:number;range:TimeRange;onRange(r:TimeRange):void;seek(time:number):void;playing:boolean;toggle():void;label?:string;segments?:Segment[];activeId?:string;onSelect?(id:string):void;reset?():void;beforeChange?():void}) {
  const track=useRef<HTMLDivElement>(null),scroll=useRef<HTMLDivElement>(null),gesture=useRef<{mode:string;start:number;range:TimeRange;pointer:number}|null>(null)
  const [draft,setDraft]=useState<TimeRange|null>(null),latest=useRef<TimeRange|null>(null),pending=useRef(false),[zoom,setZoom]=useState(1),center=useRef(.5),[trackWidth,setTrackWidth]=useState(600)
  const limit=Math.max(.001,duration),clamp=(n:number)=>Math.max(0,Math.min(limit,Math.round(n*1000)/1000))
  const selected=draft||{start:clamp(range.start),end:clamp(range.end)}
  useEffect(()=>{if(!gesture.current&&(!pending.current||latest.current&&Math.abs(range.start-latest.current.start)<.001&&Math.abs(range.end-latest.current.end)<.001)){pending.current=false;setDraft(null)}},[range.start,range.end])
  useEffect(()=>{const element=track.current;if(!element)return;const observer=new ResizeObserver(()=>setTrackWidth(element.clientWidth));observer.observe(element);return()=>observer.disconnect()},[])
  useLayoutEffect(()=>{if(scroll.current)scroll.current.scrollLeft=center.current*scroll.current.scrollWidth-scroll.current.clientWidth/2},[zoom])
  function position(event:PointerEvent){const box=track.current!.getBoundingClientRect();return clamp((event.clientX-box.left)/box.width*limit)}
  function update(mode:string,next:number,initial=selected,commit=true){
    if(mode==='seek'){seek(next);return}
    let r=initial
    if(mode==='start')r={...initial,start:Math.min(next,initial.end-.001)}
    if(mode==='end')r={...initial,end:Math.max(next,initial.start+.001)}
    if(mode==='range'){const span=initial.end-initial.start,start=Math.max(0,Math.min(limit-span,next));r={start,end:start+span}}
    r={start:clamp(r.start),end:clamp(r.end)}
    latest.current=r;setDraft(r);if(commit){pending.current=true;onRange(r)}
    seek(mode==='end'?r.end:r.start)
  }
  function down(e:PointerEvent<HTMLDivElement>){if(e.button!==0)return;e.preventDefault();const mode=(e.target as HTMLElement).closest<HTMLElement>('[data-timeline-handle]')?.dataset.timelineHandle||'seek';if(mode!=='seek')beforeChange?.();if(playing)toggle();gesture.current={mode,start:position(e),range:selected,pointer:e.pointerId};latest.current=selected;e.currentTarget.setPointerCapture(e.pointerId);if(mode==='seek')seek(position(e))}
  function move(e:PointerEvent<HTMLDivElement>){const g=gesture.current;if(g&&g.pointer===e.pointerId){const delta=position(e)-g.start;update(g.mode,g.mode==='range'?g.range.start+delta:g.mode==='seek'?position(e):(g.mode==='start'?g.range.start:g.range.end)+delta,g.range,false)}}
  function finish(e:PointerEvent<HTMLDivElement>,cancel=false){const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;if(!cancel)move(e);gesture.current=null;if(cancel){pending.current=false;setDraft(null)}else if(g.mode!=='seek'&&latest.current){pending.current=true;onRange(latest.current)}if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}
  function changeZoom(next:number){if(scroll.current)center.current=(scroll.current.scrollLeft+scroll.current.clientWidth/2)/scroll.current.scrollWidth;setZoom(Math.max(1,Math.min(32,next)))}
  function handleKey(e:React.KeyboardEvent,mode:string){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();if(mode!=='seek')beforeChange?.();const old=mode==='start'?selected.start:mode==='end'?selected.end:time,step=e.shiftKey?1:.1;update(mode,e.key==='Home'?0:e.key==='End'?limit:clamp(old+(e.key==='ArrowLeft'?-step:step)))}
  function change(mode:string,next:number){beforeChange?.();update(mode,next)}
  return <section className="video-timeline" aria-label={`${label}可视化时间轴`}>
    <div className="timeline-controls"><div className="timeline-play-controls"><Button aria-label={`${label}${playing?'暂停':'播放'}`} onClick={toggle}>{playing?'暂停':'播放'}</Button><TimeInput label={`${label}播放位置`} value={time} max={duration} onChange={v=>v!==null&&seek(v)}/><span>/ {formatTime(duration)}</span></div><div className="timeline-zoom-controls"><Button size="small" aria-label={`${label}缩小时间轴`} disabled={zoom<=1} onClick={()=>changeZoom(zoom/2)}>−</Button><span>{zoom}×</span><Button size="small" aria-label={`${label}放大时间轴`} disabled={zoom>=32} onClick={()=>changeZoom(zoom*2)}>＋</Button><Button size="small" aria-label={`${label}完整时间轴`} onClick={()=>changeZoom(1)}>完整时间轴</Button></div></div>
    <div className="timeline-caption"><span>绿色：截取范围 · 黄色：播放位置</span><TimeInputModeSelector label={`${label}时间输入方式`}/></div>
    <div ref={scroll} className="timeline-scroll"><div ref={track} className={`timeline-track ${Math.abs(selected.end-selected.start)/limit*trackWidth<32?'handles-close':''}`} data-timeline={label} style={{width:`calc(${zoom*100}% - 48px)`}} onPointerDown={down} onPointerMove={move} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)} onLostPointerCapture={()=>{if(gesture.current){gesture.current=null;pending.current=false;setDraft(null)}}}>
      <div className="timeline-rail"/><div className="timeline-selection" data-timeline-handle="range" style={{left:`${selected.start/limit*100}%`,width:`${Math.max(0,selected.end-selected.start)/limit*100}%`}}/>
      {(['start','end'] as const).map(mode=><button key={mode} type="button" className={`timeline-handle ${mode}`} data-timeline-handle={mode} role="slider" aria-label={`${label}${mode==='start'?'起点':'终点'}拖动柄`} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={selected[mode]} aria-valuetext={formatTime(selected[mode])} style={{left:`${selected[mode]/limit*100}%`}} onKeyDown={e=>handleKey(e,mode)} title={formatTime(selected[mode])}/>) }
      <button type="button" className="timeline-playhead" data-timeline-handle="seek" role="slider" aria-label={`${label}播放进度`} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time} aria-valuetext={formatTime(time)} style={{left:`${clamp(time)/limit*100}%`}} onKeyDown={e=>handleKey(e,'seek')} title={formatTime(time)}/>
    </div><div className="timeline-scale" style={{width:`calc(${zoom*100}% - 48px)`}}>
    {!!segments.length&&<div className="timeline-segments">{segments.map((s,i)=><button key={s.id} data-segment={s.id} className={s.id===activeId?'active':''} style={{left:`${s.start/limit*100}%`,width:`${(s.end-s.start)/limit*100}%`}} onClick={()=>onSelect?.(s.id)} title={`${s.label||`时段 ${i+1}`} · ${formatTime(s.start)}～${formatTime(s.end)}`}>{s.label||i+1}</button>)}</div>}
    <div className="timeline-ticks"><span>00:00</span><span>{formatTime(limit/2,false)}</span><span>{formatTime(limit,false)}</span></div></div></div>
    <div className="timeline-range-inputs"><div className="timeline-range-group"><label>起点<TimeInput label={`${label}起点`} value={selected.start} max={selected.end-.001} onChange={v=>v!==null&&change('start',v)}/></label><Button size="small" onClick={()=>change('start',Math.min(time,selected.end-.001))}>当前位置为起点</Button></div><div className="timeline-range-group"><label>终点<TimeInput label={`${label}终点`} value={selected.end} min={selected.start+.001} max={duration} onChange={v=>v!==null&&change('end',v)}/></label><Button size="small" onClick={()=>change('end',Math.max(time,selected.start+.001))}>当前位置为终点</Button></div></div>
    <div className="timeline-summary"><span>选区 {formatTime(selected.start)}～{formatTime(selected.end)} · 时长 {formatTime(Math.max(0,selected.end-selected.start))}</span>{reset&&<Button size="small" onClick={reset}>重置选区</Button>}</div>
    <p className="timeline-help">拖动绿色两端调整范围，中间色块移动整段；黄色顶部拖动点只跳转播放。{Math.abs(selected.end-selected.start)/limit*trackWidth<32?'选区较短，可放大时间轴精细调整。':''}</p>
  </section>
}
