import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Snapshot, VideoItem } from '../../shared/types'

export const UNCLASSIFIED = '__unclassified__'

export default function useVideoDrag(state: Snapshot, moved: (id: string, target: string | null) => Promise<void>) {
  const list = useRef<HTMLDivElement>(null)
  const latest = useRef({ state, moved })
  latest.current = { state, moved }
  const ignoreClick = useRef(false)
  const gesture = useRef<{ id: string; pointer: number; startX: number; startY: number; x: number; y: number; active: boolean; timer: ReturnType<typeof setTimeout> } | null>(null)
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; target: string | null } | null>(null)
  const hovered = useRef<string | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function targetAt(x: number, y: number) {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-project]')
    return element && list.current?.contains(element) ? element.dataset.dropProject || null : null
  }
  function updateTarget() {
    const g = gesture.current
    if (!g?.active) return
    const target = targetAt(g.x, g.y)
    setDrag({ id: g.id, x: g.x, y: g.y, target })
    if (target === hovered.current) return
    hovered.current = target
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    const project = latest.current.state.projects.find(item => item.id === target)
    if (project?.collapsed) hoverTimer.current = setTimeout(() => {
      if (gesture.current?.active && hovered.current === project.id) void window.framepick.updateProject(project.id, { collapsed: false }).catch(() => {})
    }, 600)
  }
  function end() {
    const g = gesture.current
    if (clickTimer.current) clearTimeout(clickTimer.current)
    if (g?.active) clickTimer.current = setTimeout(() => { ignoreClick.current = false }, 80)
    else ignoreClick.current = false
    if (g) {
      clearTimeout(g.timer)
      if (list.current?.hasPointerCapture(g.pointer)) list.current.releasePointerCapture(g.pointer)
    }
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (scrollTimer.current) clearInterval(scrollTimer.current)
    hoverTimer.current = null; scrollTimer.current = null; hovered.current = null
    gesture.current = null; setDrag(null)
  }
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = gesture.current
      if (!g || g.pointer !== e.pointerId) return
      g.x = e.clientX; g.y = e.clientY
      if (!g.active) { if (Math.hypot(g.x - g.startX, g.y - g.startY) > 8) end(); return }
      e.preventDefault(); updateTarget()
    }
    const up = (e: PointerEvent) => {
      const g = gesture.current
      if (!g || g.pointer !== e.pointerId) return
      const target = g.active ? targetAt(e.clientX, e.clientY) : null
      const id = g.id
      end()
      const video = latest.current.state.videos.find(item => item.id === id)
      if (target && video && (video.projectId || UNCLASSIFIED) !== target) void latest.current.moved(id, target === UNCLASSIFIED ? null : target)
    }
    const cancel = () => end()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && gesture.current) { e.preventDefault(); end() } }
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key)
      end()
    }
  }, [])
  function down(e: ReactPointerEvent, video: VideoItem) {
    if (e.button !== 0 || !state.projects.length || (e.target as HTMLElement).closest('button,input,.ant-checkbox-wrapper')) return
    end()
    const pointer = e.pointerId
    gesture.current = { id: video.id, pointer, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, active: false, timer: setTimeout(() => {
      const g = gesture.current
      if (!g || g.pointer !== pointer) return
      g.active = true; ignoreClick.current = true
      list.current?.setPointerCapture(pointer)
      updateTarget()
      scrollTimer.current = setInterval(() => {
        const current = gesture.current, element = list.current
        if (!current?.active || !element) return
        const bounds = element.getBoundingClientRect()
        if (current.y < bounds.top + 36) element.scrollTop -= 12
        else if (current.y > bounds.bottom - 36) element.scrollTop += 12
        updateTarget()
      }, 40)
    }, 350) }
  }
  return { list, drag, down, ignoreClick }
}
