import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Checkbox, Tooltip } from 'antd'
import type { FrameResult } from '../../shared/types'

export default function FrameGrid({ frames, selected, onChange, open }: {
  frames: FrameResult[]; selected: string[]; onChange(names: string[]): void; open(path: string): void
}) {
  const root = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ pointer: number; start: number; x: number; y: number; base: string[]; add: boolean; active: boolean; timer: ReturnType<typeof setTimeout> } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [scrollTop,setScrollTop] = useState(0), [height,setHeight] = useState(440), [columns,setColumns] = useState(4), [focus,setFocus] = useState(0)
  const anchor = useRef(0), rowHeight = 198
  useEffect(()=>{
    const container=root.current;if(!container)return
    const observer=new ResizeObserver(()=>{setHeight(container.clientHeight);setColumns(window.innerWidth<=1300?3:4)});observer.observe(container)
    return()=>observer.disconnect()
  },[])
  const end = () => {
    if (gesture.current) clearTimeout(gesture.current.timer)
    gesture.current = null; setDragging(false)
  }
  useEffect(() => {
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end)
      if (gesture.current) clearTimeout(gesture.current.timer)
    }
  }, [])
  useEffect(() => { end();setScrollTop(0);setFocus(0);anchor.current=0;if(root.current)root.current.scrollTop=0 }, [frames])
  function choose(index:number,shift=false) {
    const name=frames[index].name
    onChange(shift?[...new Set([...selected,...frames.slice(Math.min(anchor.current,index),Math.max(anchor.current,index)+1).map(f=>f.name)])]:selected.includes(name)?selected.filter(n=>n!==name):[...selected,name])
    if(!shift)anchor.current=index
    setFocus(index)
  }
  function navigate(index:number) {
    const next=Math.max(0,Math.min(frames.length-1,index));setFocus(next)
    const top=Math.floor(next/columns)*rowHeight, container=root.current
    if(container){if(top<container.scrollTop)container.scrollTop=top;else if(top+rowHeight>container.scrollTop+container.clientHeight)container.scrollTop=top+rowHeight-container.clientHeight}
    requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>(`[data-frame-index="${next}"]`)?.focus())
  }
  function range(index: number) {
    const g = gesture.current
    if (!g) return
    const names = frames.slice(Math.min(index, g.start), Math.max(index, g.start) + 1).map(f => f.name)
    onChange(g.add ? [...new Set([...g.base, ...names])] : g.base.filter(name => !names.includes(name)))
  }
  function down(e: PointerEvent, index: number) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.ant-checkbox-wrapper')) return
    end()
    const pointer = e.pointerId
    gesture.current = { pointer, start: index, x: e.clientX, y: e.clientY, base: [...selected], add: !selected.includes(frames[index].name), active: false, timer: setTimeout(() => {
      const g = gesture.current
      if (!g || g.pointer !== pointer) return
      g.active = true; setDragging(true)
      root.current?.setPointerCapture(pointer)
      range(index)
    }, 350) }
  }
  function move(e: PointerEvent) {
    const g = gesture.current
    if (!g || g.pointer !== e.pointerId) return
    if (!g.active) {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 8) end()
      return
    }
    e.preventDefault()
    const element = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-frame-index]')
    if (element && root.current?.contains(element)) range(Number(element.dataset.frameIndex))
    const container = root.current
    if (container) {
      const bounds = container.getBoundingClientRect()
      if (e.clientY < bounds.top + 35) container.scrollTop -= 24
      else if (e.clientY > bounds.bottom - 35) container.scrollTop += 24
    }
  }
  const virtual=frames.length>24, firstRow=virtual?Math.max(0,Math.floor(scrollTop/rowHeight)-2):0, lastRow=virtual?Math.min(Math.ceil(frames.length/columns),Math.ceil((scrollTop+height)/rowHeight)+2):Math.ceil(frames.length/columns)
  return <div ref={root} tabIndex={0} aria-label="抽帧图片列表" className={'results-grid '+(virtual?'virtual ':'') + (dragging ? 'drag-selecting' : '')} onScroll={e=>setScrollTop(e.currentTarget.scrollTop)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onKeyDown={event=>{
    if(event.target instanceof HTMLElement && event.target.closest('input'))return
    if(event.ctrlKey && event.code==='KeyA'){event.preventDefault();onChange([...new Set([...selected,...frames.map(f=>f.name)])]);return}
    const steps:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns}
    if(event.code in steps){event.preventDefault();const next=Math.max(0,Math.min(frames.length-1,focus+steps[event.code]));if(event.shiftKey)choose(next,true);navigate(next)}
    else if(event.code==='Space'){event.preventDefault();choose(focus,event.shiftKey)}
    else if(event.code==='Enter'){event.preventDefault();if(frames[focus])open(frames[focus].path)}
    else if(event.code==='Home'||event.code==='End'){event.preventDefault();navigate(event.code==='Home'?0:frames.length-1)}
  }}>
    <div className="frame-grid-inner" style={{display:'grid',gridTemplateColumns:`repeat(${columns},minmax(0,1fr))`,gap:12,paddingTop:firstRow*rowHeight,paddingBottom:(Math.ceil(frames.length/columns)-lastRow)*rowHeight}}>
    {frames.slice(firstRow*columns,lastRow*columns).map((frame,visibleIndex) => {const index=firstRow*columns+visibleIndex;return <figure key={frame.name} tabIndex={index===focus?0:-1} data-frame-index={index} className={selected.includes(frame.name) ? 'selected' : ''} style={{height:186}} onFocus={()=>setFocus(index)} onPointerDown={e => down(e, index)} onClick={e=>{if(!dragging && !(e.target as HTMLElement).closest('.ant-checkbox-wrapper'))choose(index,e.shiftKey)}} onDoubleClick={() => { if (!gesture.current?.active) open(frame.path) }}>
      <img src={frame.thumbnailUrl || frame.url} alt={frame.name} loading="lazy" draggable={false} />
      <figcaption><Checkbox checked={selected.includes(frame.name)} onChange={() => choose(index)}>{frame.name}</Checkbox><Tooltip title={`目标 ${frame.target}s，实际帧 ${frame.actual}s`}><small>实际 {frame.actual}s</small></Tooltip></figcaption>
    </figure>})}</div>
  </div>
}
