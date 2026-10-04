import { useEffect, useState } from 'react'
import { Button, Modal } from 'antd'
import type { FrameResult } from '../../shared/types'
import useViewport from './useViewport'
export type ViewImage = { url: string; path: string; name: string; width?: number; height?: number }
export default function ImageViewer({ images, index, close }: { images: ViewImage[]; index: number; close(): void }) {
  const [current, setCurrent] = useState(index), [size, setSize] = useState({ width: images[index]?.width || 1000, height: images[index]?.height || 600 })
  const image = images[current], view = useViewport(size.width, size.height, { fitHeight: true, close })
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.target as HTMLElement)?.closest('input,textarea')) return; if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') { event.preventDefault(); setCurrent(previous => Math.max(0, Math.min(images.length-1, previous+(event.code === 'ArrowRight' ? 1 : -1)))) } }
    window.addEventListener('keydown',key); return () => window.removeEventListener('keydown',key)
  }, [images.length])
  return <Modal open title={`查看图片 · ${image?.name || ''}`} className="image-viewer-modal" width={1180} style={{ top:24 }} footer={null} onCancel={close} maskClosable={false} keyboard={false}>
    <div className="image-viewer-tools"><Button onClick={view.zoomOut} aria-label="缩小图片">−</Button><span>{Math.round(view.scale*100)}%</span><Button onClick={view.zoomIn} aria-label="放大图片">＋</Button><Button onClick={view.fit}>适合画面</Button><Button onClick={view.actual}>100%</Button><span>{size.width} × {size.height} px · {current+1} / {images.length}</span><Button onClick={() => void window.framepick.openPath(image.path)}>在系统中打开</Button><Button onClick={()=>void window.framepick.revealPath(image.path)}>所在文件夹</Button></div>
    <div ref={view.attach} className={'image-viewer-stage ' + (view.panning ? 'panning' : '')} {...view.handlers}>
      <div className="image-viewer-canvas" style={{ ...view.panStyle, width: size.width*view.scale, height: size.height*view.scale }}><img src={image?.url} alt={image?.name} draggable={false} style={{ width:size.width, height:size.height, transform:`scale(${view.scale})` }} onLoad={event => { setSize({ width:event.currentTarget.naturalWidth, height:event.currentTarget.naturalHeight }) }} /></div>
    </div>
    <div className="image-viewer-tools"><Button disabled={!current} onClick={() => setCurrent(current-1)}>上一张</Button><Button disabled={current>=images.length-1} onClick={() => setCurrent(current+1)}>下一张</Button><small>使用你配置的快捷键或滚轮缩放，空格/中键/长按拖动；默认 Esc 退出。左右方向键切换本页图片。</small></div>
  </Modal>
}
