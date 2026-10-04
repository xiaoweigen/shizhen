import {useMemo,useState} from 'react'
import {Alert,App as AntApp,Button,Modal,Radio} from 'antd'
import type {TimeRange,VideoItem} from '../../shared/types'
import {formatTime} from '../../shared/time'
import usePlayback,{PlaybackSurface} from './usePlayback'
import VideoTimeline from './VideoTimeline'
type Range=TimeRange&{id:string}
type EditState={ranges:Range[];mode:'keep'|'remove';active:number}
export default function TrimEditor({video,close}:{video:VideoItem;close():void}){
  const {message}=AntApp.useApp(),player=usePlayback(video),duration=video.info!.duration
  const [mode,setMode]=useState<'keep'|'remove'>('keep'),[ranges,setRanges]=useState<Range[]>([{id:crypto.randomUUID(),start:0,end:duration}]),[active,setActive]=useState(0),[busy,setBusy]=useState(false),[joinOpen,setJoinOpen]=useState(false),[history,setHistory]=useState<EditState[]>([])
  const current=ranges[active]||{id:'draft',start:0,end:duration}
  const calculated=useMemo(()=>{
    const sorted=[...ranges].sort((a,b)=>a.start-b.start)
    if(!sorted.length||sorted.some((r,i)=>r.end<=r.start||r.start<0||r.end>duration||(i>0&&r.start<sorted[i-1].end)))return {kept:[] as TimeRange[],error:'时段不能为空、重叠或超出视频时长。'}
    if(mode==='keep')return {kept:sorted.map(({start,end})=>({start,end})),error:''}
    const kept:TimeRange[]=[];let end=0
    for(const r of sorted){if(r.start>end)kept.push({start:end,end:r.start});end=r.end}
    if(end<duration)kept.push({start:end,end:duration})
    return {kept,error:kept.length?'':'不能删除整段视频，请至少留下一部分。'}
  },[ranges,mode,duration])
  const remember=()=>setHistory(h=>[...h.slice(-19),{ranges:ranges.map(r=>({...r})),mode,active}])
  function update(range:TimeRange){setRanges(prev=>prev.map((r,i)=>i===active?{...r,...range}:r))}
  async function save(join:boolean){setBusy(true);try{if(await window.framepick.trimVideo(video.id,calculated.kept,join)){message.success('剪切已加入处理队列，完成后新视频自动加入列表');close()}setJoinOpen(false)}catch(e){message.error((e as Error).message)}finally{setBusy(false)}}
  return <Modal open title={`剪切视频长度 · ${video.name}`} className="trim-modal" width={1040} style={{top:24}} maskClosable={false} onCancel={()=>!busy&&close()} footer={<><Button onClick={close} disabled={busy}>取消</Button><Button type="primary" loading={busy} disabled={!!calculated.error} onClick={()=>calculated.kept.length>1?setJoinOpen(true):void save(true)}>选择位置并保存</Button></>}>
    <p className="crop-help">只处理另存副本，原视频的位置和内容保持不变。剪切按画面重新编码为兼容 MP4，保留声音。</p>
    <div className="trim-preview"><PlaybackSurface video={video} player={player} controls/></div>
    <Radio.Group aria-label="剪切方式" value={mode} onChange={e=>{remember();setMode(e.target.value)}} options={[{value:'keep',label:'保留选定时段'},{value:'remove',label:'删除选定时段'}]}/>
    <VideoTimeline label="剪切" duration={duration} time={player.time} range={current} onRange={update} beforeChange={remember} seek={player.seek} playing={player.playing} toggle={player.toggle} segments={ranges} activeId={current.id} onSelect={id=>{const i=ranges.findIndex(r=>r.id===id);setActive(i);player.seek(ranges[i].start)}} reset={()=>{remember();setRanges([{id:crypto.randomUUID(),start:0,end:duration}]);setActive(0)}}/>
    <div className="trim-range-list">{ranges.map((r,i)=><div key={r.id} className={i===active?'active':''}><button onClick={()=>{setActive(i);player.seek(r.start)}}>{mode==='keep'?'保留':'删除'} {i+1} · {formatTime(r.start)}～{formatTime(r.end)}</button><Button size="small" disabled={ranges.length===1} onClick={()=>{remember();setRanges(prev=>prev.filter((_,j)=>j!==i));setActive(0)}}>移除时段</Button></div>)}</div>
    <div className="trim-tools"><Button disabled={ranges.length>=100} onClick={()=>{remember();setRanges([...ranges,{id:crypto.randomUUID(),start:Math.min(player.time,duration-.001),end:Math.min(duration,player.time+5)}]);setActive(ranges.length)}}>添加时段</Button><Button disabled={!history.length} onClick={()=>{const previous=history.at(-1)!;setRanges(previous.ranges);setMode(previous.mode);setActive(previous.active);setHistory(h=>h.slice(0,-1))}}>撤销时段操作</Button></div>
    {calculated.error?<Alert type="warning" title={calculated.error}/>:<p className="trim-summary">将保留 {calculated.kept.length} 段，共 {formatTime(calculated.kept.reduce((sum,r)=>sum+r.end-r.start,0))}：{calculated.kept.map(r=>`${formatTime(r.start)}～${formatTime(r.end)}`).join('、')}</p>}
    <Modal open={joinOpen} title="是否拼接留下的视频片段？" onCancel={()=>!busy&&setJoinOpen(false)} footer={<><Button disabled={busy} onClick={()=>setJoinOpen(false)}>返回编辑</Button><Button loading={busy} onClick={()=>void save(false)}>否 · 分别保存并加入列表</Button><Button type="primary" loading={busy} onClick={()=>void save(true)}>是 · 拼接为一个视频</Button></>}><p>当前保留 {calculated.kept.length} 段。拼接会按原时间顺序连成一个视频；分别保存会输出多个独立视频。</p></Modal>
  </Modal>
}
