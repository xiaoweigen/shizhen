import {Spin,Collapse,Button} from 'antd'
import type {ExtractSettings,VideoItem,TimeRange} from '../../shared/types'
import usePlayback,{PlaybackSurface} from './usePlayback'
import VideoTimeline from './VideoTimeline'
export default function VideoPreview({video,settings,onRange}:{video:VideoItem;settings:ExtractSettings;onRange(r:TimeRange):void}){
  const player=usePlayback(video),duration=video.info?.duration||0
  return <><div className="preview-stage">{video.status==='reading'?<Spin description="读取视频信息"/>:video.status==='error'?<div className="preview-placeholder"><p>{video.error}</p><Button onClick={()=>void window.framepick.relocateVideo(video.id)}>重新定位视频</Button></div>:<PlaybackSurface video={video} player={player} controls/>}</div>{duration>0&&video.status==='ready'&&video.localReady!==false&&<div className="workspace-timeline"><Collapse ghost defaultActiveKey={['range']} items={[{key:'range',label:'截取范围 · 可视化时间轴',children:<VideoTimeline duration={duration} time={player.time} range={{start:Math.min(settings.start,duration-.001),end:Math.min(settings.end??duration,duration)}} onRange={onRange} seek={player.seek} playing={player.playing} toggle={player.toggle} reset={()=>onRange({start:0,end:duration})}/>} ]}/></div>}</>
}
