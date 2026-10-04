import fs from 'node:fs'
import path from 'node:path'
import type { VideoItem } from '../shared/types'

export function localVideoPath(video: VideoItem): string | undefined {
  const file = video.source === 'online' ? video.downloadedPath : video.path
  try { if (file && fs.statSync(file).isFile()) return path.resolve(file) } catch {}
}

export function requireLocalVideo(video: VideoItem): string {
  const file = localVideoPath(video)
  if (!file) throw new Error(video.source === 'online'
    ? '请先将视频下载到保存文件夹。文件已移动时请重新定位，工具不会自动重新下载。'
    : '视频文件不存在，请重新定位。')
  return file
}
