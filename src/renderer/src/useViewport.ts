import { createContext, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { DEFAULT_VIEWPORT, type ViewportPrefs } from '../../shared/types'
export const ViewportContext = createContext<ViewportPrefs>(DEFAULT_VIEWPORT)
export function keyChord(event: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) {
  return [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', event.code].filter(Boolean).join('+')
}
const editing = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable=true]')
export function topDialog(element: HTMLElement | null) {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('.ant-modal')).filter(node=>node.getClientRects().length && getComputedStyle(node).visibility!=='hidden')
  const top = dialogs.at(-1)
  return !top || !!element && top.contains(element)
}
export default function useViewport(width: number, height: number, options: { active?: boolean; fitHeight?: boolean; close?(): void; panStart?(): void } = {}) {
  const prefs = useContext(ViewportContext), container = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'fit' | 'actual' | 'custom'>('fit'), [custom, setCustom] = useState(1), [bounds, setBounds] = useState({ width: 700, height: 400 }), [panning, setPanning] = useState(false)
  const fitScale = Math.max(.01, Math.min(1, Math.max(1, bounds.width - 18) / Math.max(1, width), options.fitHeight ? Math.max(1, bounds.height - 18) / Math.max(1, height) : 1))
  const scale = mode === 'fit' ? fitScale : mode === 'actual' ? 1 : custom
  const latest = useRef({ prefs, options, scale }); latest.current = { prefs, options, scale }
  const space = useRef(false), suppressClick = useRef(false)
  const gesture = useRef<{ pointer: number; startX: number; startY: number; x: number; y: number; left: number; top: number; active: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null)
  function stop() { const g = gesture.current; if (g?.timer) clearTimeout(g.timer); if (g?.active) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false }, 80) }; if (g && container.current?.hasPointerCapture(g.pointer)) container.current.releasePointerCapture(g.pointer); gesture.current = null; setPanning(false) }
  function zoomTo(next: number, point?: { x: number; y: number }) {
    const root = container.current, old = latest.current.scale, value = Math.max(.02, Math.min(8, next))
    const x = point?.x ?? (root?.clientWidth || 0)/2, y = point?.y ?? (root?.clientHeight || 0)/2
    const left = root?.scrollLeft || 0, top = root?.scrollTop || 0
    setCustom(value); setMode('custom')
    latest.current.scale=value
    requestAnimationFrame(() => { if (root) { root.scrollLeft = (left+x)*value/old-x; root.scrollTop = (top+y)*value/old-y } })
  }
  useEffect(() => {
    const root = container.current; if (!root) return
    const observer = new ResizeObserver(() => {if(root.clientWidth>0&&root.clientHeight>0)setBounds({ width: root.clientWidth, height: root.clientHeight })}); observer.observe(root)
    const wheel = (event: WheelEvent) => {
      const { prefs, options, scale } = latest.current
      if (options.active === false || !topDialog(root) || editing(event.target) || prefs.wheel === 'disabled') return
      const enabled = prefs.wheel === 'none' || (prefs.wheel === 'control' && event.ctrlKey) || (prefs.wheel === 'alt' && event.altKey) || (prefs.wheel === 'shift' && event.shiftKey)
      if (!enabled) return
      event.preventDefault(); const box = root.getBoundingClientRect(); zoomTo(scale * (event.deltaY < 0 ? prefs.zoomStep : 1/prefs.zoomStep), { x: event.clientX-box.left, y: event.clientY-box.top })
    }
    root.addEventListener('wheel', wheel, { passive: false })
    return () => { observer.disconnect(); root.removeEventListener('wheel', wheel); stop() }
  }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const { prefs, options, scale } = latest.current
      if (options.active === false || !topDialog(container.current) || !container.current?.getClientRects().length) return
      const chord = keyChord(event)
      if (chord === prefs.close) { event.preventDefault(); event.stopImmediatePropagation(); stop(); options.close?.(); return }
      if (editing(event.target)) return
      if (event.code === 'Space') { space.current = true; if (prefs.pan==='space') event.preventDefault() }
      const plusAlias=prefs.zoomIn==='Control+Equal'&&chord==='Control+Shift+Equal'
      if (chord === prefs.zoomIn || chord === prefs.zoomOut || plusAlias) { event.preventDefault(); event.stopPropagation(); zoomTo(scale * (chord === prefs.zoomIn || plusAlias ? prefs.zoomStep : 1/prefs.zoomStep)) }
      else if (chord === prefs.fit || chord === prefs.actual) { event.preventDefault(); event.stopPropagation(); setMode(chord === prefs.fit ? 'fit' : 'actual') }
    }
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') space.current = false }
    const blur = () => { space.current = false; stop() }
    window.addEventListener('keydown', key); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop) }
  }, [])
  function begin() { const g = gesture.current, root = container.current; if (!g || !root) return; g.active = true; options.panStart?.(); setPanning(true); root.setPointerCapture(g.pointer) }
  function down(event: ReactPointerEvent) {
    if (options.active === false || editing(event.target) || (event.target as HTMLElement).closest('button,a,.crop-handle')) return
    stop(); const root = container.current!
    const immediate = event.button === 1 || (event.button === 0 && (prefs.pan === 'left' || prefs.pan === 'space' && space.current))
    if (event.button !== 0 && !immediate) return
    gesture.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, left: root.scrollLeft, top: root.scrollTop, active: false }
    if (immediate) { event.preventDefault(); event.stopPropagation(); begin() }
    else if (prefs.longPressPan && !(event.target as HTMLElement).closest('[draggable=true]')) gesture.current.timer = setTimeout(begin, prefs.longPressMs)
  }
  function move(event: ReactPointerEvent) {
    const g = gesture.current; if (!g || g.pointer !== event.pointerId) return
    g.x = event.clientX; g.y = event.clientY
    if (!g.active) { if (Math.hypot(g.x-g.startX,g.y-g.startY)>8 && g.timer) { clearTimeout(g.timer); g.timer = undefined }; return }
    event.preventDefault(); event.stopPropagation(); const root = container.current!; root.scrollLeft = g.left-(g.x-g.startX); root.scrollTop = g.top-(g.y-g.startY)
  }
  return { container, scale, mode, panning, zoomIn: () => zoomTo(scale*prefs.zoomStep), zoomOut: () => zoomTo(scale/prefs.zoomStep), fit: () => setMode('fit'), actual: () => setMode('actual'), handlers: { onPointerDownCapture: down, onPointerMoveCapture: move, onClickCapture: (event: React.MouseEvent) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation() } } } }
}
