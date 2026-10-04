import {useRef,useState} from 'react'
import {Button} from 'antd'
import type {ExtractSettings} from '../../shared/types'

export function markerGeometry(value:ExtractSettings,width:number,height:number) {
  const size=Math.max(4,Math.min(value.markerSize,width-8,height-8)), inset=Math.max(0,Math.min(8,(Math.min(width,height)-size)/2))
  return {size,inset,travelX:Math.max(0,width-size-2*inset),travelY:Math.max(0,height-size-2*inset)}
}
export default function FrameMarker({value,name,number,width,height,change}:{value:ExtractSettings;name:string;number:number;width:number;height:number;change(point:{x:number;y:number}):void}) {
  const fallback={x:value.markerCorner.endsWith('r')?1:0,y:value.markerCorner.startsWith('b')?1:0}
  const [moving,setMoving]=useState<{x:number;y:number}|null>(null), point=moving||value.markerPositions[name]||fallback
  const gesture=useRef<{id:number;x:number;y:number;point:{x:number;y:number};scale:number}|null>(null)
  const g=markerGeometry(value,width,height),fontSize=Math.max(4,g.size*(value.markerStyle==='circle'?.63:.7)/Math.max(1,String(number).length*.55))
  return <span role="button" tabIndex={0} aria-label={`${name} 图序号 ${number}`} className={`frame-marker ${value.markerStyle}`} style={{left:g.inset+g.travelX*point.x,top:g.inset+g.travelY*point.y,width:g.size,height:g.size,fontSize,color:value.markerColor,background:value.markerBackground}}
    onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();const box=event.currentTarget.parentElement!.getBoundingClientRect();gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,point,scale:box.width/width};event.currentTarget.setPointerCapture(event.pointerId)}}
    onPointerMove={event=>{const start=gesture.current;if(!start||start.id!==event.pointerId)return;event.preventDefault();event.stopPropagation();setMoving({x:Math.max(0,Math.min(1,start.point.x+(event.clientX-start.x)/start.scale/Math.max(1,g.travelX))),y:Math.max(0,Math.min(1,start.point.y+(event.clientY-start.y)/start.scale/Math.max(1,g.travelY)))})}}
    onPointerUp={event=>{if(!gesture.current)return;event.stopPropagation();if(moving)change(moving);gesture.current=null;setMoving(null)}}
    onPointerCancel={()=>{gesture.current=null;setMoving(null)}} onClick={event=>event.stopPropagation()}
    onKeyDown={event=>{if(!event.code.startsWith('Arrow'))return;event.preventDefault();event.stopPropagation();change({x:Math.max(0,Math.min(1,point.x+(event.code==='ArrowRight'?.02:event.code==='ArrowLeft'?-.02:0))),y:Math.max(0,Math.min(1,point.y+(event.code==='ArrowDown'?.02:event.code==='ArrowUp'?-.02:0)))})}}>{number}</span>
}
