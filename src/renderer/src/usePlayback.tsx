import {useCallback,useEffect,useRef,useState} from 'react'
import {Button,Progress,Spin} from 'antd'
import type {VideoItem} from '../../shared/types'
export default function usePlayback(video:VideoItem){
  const ref=useRef<HTMLVideoElement>(null),desired=useRef(0),alive=useRef(true),generation=useRef(0)
  const [url,setUrl]=useState(video.mediaUrl||''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[time,setTime]=useState(0),[playing,setPlaying]=useState(false)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  const prepare=useCallback(async()=>{const token=++generation.current;setLoading(true);setError('');try{const result=await window.framepick.preparePreview(video.id,true);if(alive.current&&token===generation.current)setUrl(result.mediaUrl)}catch(e){if(alive.current&&token===generation.current)setError((e as Error).message)}finally{if(alive.current&&token===generation.current)setLoading(false)}},[video.id])
  useEffect(()=>{desired.current=0;setTime(0);setPlaying(false);setLoading(false);setUrl(video.mediaUrl||'');setError('');return()=>{generation.current++}},[video.id,video.status])
  useEffect(()=>{setUrl(video.mediaUrl||'');setError('')},[video.mediaUrl])
  useEffect(()=>{const hidden=()=>{if(document.hidden)ref.current?.pause()};document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden)},[])
  function seek(n:number){const next=Math.max(0,Math.min(video.info?.duration||0,n));desired.current=next;setTime(next);if(ref.current?.readyState)ref.current.currentTime=Math.min(next,ref.current.duration||next)}
  const failure='播放器暂时无法播放此文件。可以重试原视频，或手动生成兼容预览；抽帧仍使用已保存的视频。'
  function toggle(){const p=ref.current;if(!p)return;if(p.paused)void p.play().catch(()=>setError(failure));else p.pause()}
  function retry(){setError('');ref.current?.load()}
  async function download(){try{await window.framepick.downloadVideo(video.id)}catch(e){setError((e as Error).message)}}
  return {ref,url,loading,error,time,playing,seek,toggle,retry,prepare,download,cancel:()=>void window.framepick.cancelPreview(video.id),events:{onLoadedMetadata:()=>{if(ref.current)ref.current.currentTime=Math.min(desired.current,ref.current.duration||0)},onTimeUpdate:()=>{const next=ref.current?.currentTime||0;desired.current=next;setTime(next)},onPlay:()=>setPlaying(true),onPause:()=>setPlaying(false),onError:()=>setError(failure)}}
}
export function PlaybackSurface({video,player,controls=false}:{video:VideoItem;player:ReturnType<typeof usePlayback>;controls?:boolean}){
  const available=video.localReady!==false&&!!(video.downloadedPath||video.path)
  const downloading=!available&&['waiting','running'].includes(video.downloadStatus||'')
  const preparing=player.loading||video.previewStatus==='preparing'
  return <>{player.url&&<video ref={player.ref} src={player.url} poster={video.thumbnailUrl} controls={controls} preload="metadata" {...player.events}/>}{(!player.url||preparing||player.error)&&<div className="playback-status">{video.thumbnailUrl&&<img className="poster" src={video.thumbnailUrl} alt="视频封面"/>}<div>{downloading?<><Spin/><p>{video.downloadStatus==='waiting'?'等待队列下载':'正在下载到保存文件夹'} · {Math.round(video.downloadProgress||0)}%</p><Progress percent={Math.round(video.downloadProgress||0)} size="small" showInfo={false}/><p>保存完成后直接播放这份本地视频。</p><Button size="small" onClick={()=>void window.framepick.cancelJob(video.downloadJobId!)}>取消下载</Button></>:preparing?<><Spin/><p>正在生成兼容预览 · {video.previewProgress||0}%</p><Progress percent={video.previewProgress||0} size="small" showInfo={false}/><Button size="small" onClick={player.cancel}>取消兼容预览</Button></>:!available?<><p>{video.downloadError||player.error||'请先下载视频，或重新定位已保存的文件。'}</p>{video.source==='online'&&<Button onClick={()=>void player.download()}>选择文件夹并下载</Button>}<Button onClick={()=>void window.framepick.relocateVideo(video.id)}>重新定位视频</Button></>:<><p>{player.error||'正在载入本地视频'}</p><Button onClick={player.retry}>重试原视频</Button>{player.error&&<><Button onClick={()=>void player.prepare()}>生成兼容预览（可选）</Button><p>只转换本地文件，长视频可能耗时；不影响抽帧。</p><Button size="small" onClick={()=>void window.framepick.openPath((video.downloadedPath||video.path)!)}>在系统中打开</Button></>}</>}</div></div>}</>
}
