import {App as AntApp,Button,Checkbox,Dropdown} from 'antd'
import type {VideoItem} from '../../shared/types'
export default function VideoActions({video,disabled,crop,trim,override,remove}:{video:VideoItem;disabled:boolean;crop():void;trim():void;override():void;remove():void}){
  const {message}=AntApp.useApp()
  async function action(fn:()=>Promise<unknown>){try{await fn()}catch(e){message.error((e as Error).message)}}
  const file=video.downloadedPath||video.path||video.previewSource||video.previewPath
  return <Dropdown trigger={['click']} menu={{items:[
    {key:'crop',label:'裁剪画面',disabled:!video.info||video.localReady===false},
    {key:'trim-enable',label:<Checkbox checked={!!video.trimEnabled}>启用视频剪切</Checkbox>},
    ...(video.trimEnabled?[{key:'trim',label:'剪切长度',disabled:!video.info||video.localReady===false||disabled}]:[]),
    ...(video.source==='online'?[{key:'download',label:video.downloadedPath?'再次下载':'下载视频',disabled}]:[]),
    {key:'folder',label:video.downloadedPath||video.path?'所在文件夹':'预览缓存位置',disabled:!file},
    {key:'override',label:'单独设置'},
    {type:'divider'},
    {key:'delete',label:'删除视频文件',danger:true,disabled:!file||disabled}
  ],onClick:({key})=>{if(key==='crop')crop();if(key==='trim')trim();if(key==='override')override();if(key==='delete')remove();if(key==='trim-enable')void action(()=>window.framepick.setTrimEnabled(video.id,!video.trimEnabled));if(key==='folder'&&file)void action(()=>window.framepick.revealPath(file));if(key==='download')void action(async()=>{if(await window.framepick.downloadVideo(video.id))message.success('下载任务已加入队列')})}}}><Button>视频操作 ▾</Button></Dropdown>
}
