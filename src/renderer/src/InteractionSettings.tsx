import { useState } from 'react'
import { Alert, Button, Input, InputNumber, Modal, Select, Switch } from 'antd'
import { DEFAULT_VIEWPORT, type ViewportPrefs } from '../../shared/types'
import { keyChord } from './useViewport'
export default function InteractionSettings({ value, close }: { value: ViewportPrefs; close(): void }) {
  const [draft, setDraft] = useState(value), [error, setError] = useState(''), [saving, setSaving] = useState(false)
  const shortcuts = [['zoomIn', '放大'], ['zoomOut', '缩小'], ['fit', '适合画面'], ['actual', '实际大小'], ['close', '退出查看/编辑']] as const
  return <Modal open title="画面操作与快捷键" width={560} keyboard={false} onCancel={close} okText="保存" cancelText="取消" confirmLoading={saving} onOk={async () => { const keys = shortcuts.map(([key]) => draft[key]); if (new Set(keys).size !== keys.length) { setError('快捷键重复，请为每个操作设置不同组合。'); return }; setSaving(true); try { await window.framepick.saveViewport(draft); close() } catch (e) { setError((e as Error).message) } finally { setSaving(false) } }}>
    <p className="modal-intro">图片查看、拼接编辑和视频裁剪共用这些操作。点击快捷键输入框，再按你想使用的组合；输入备注时不触发画面快捷键。</p>
    {error && <Alert type="error" title={error} />}
    {shortcuts.map(([key,label]) => <div className="inline-setting" key={key}><span>{label}</span><Input aria-label={`${label}快捷键`} readOnly value={draft[key]} style={{ width: 240 }} onKeyDown={event => { event.preventDefault(); event.stopPropagation(); if (!['ControlLeft','ControlRight','AltLeft','AltRight','ShiftLeft','ShiftRight','MetaLeft','MetaRight'].includes(event.code)) { setDraft({ ...draft, [key]: keyChord(event) }); setError('') } }} /></div>)}
    <div className="inline-setting"><span>滚轮缩放</span><Select aria-label="滚轮缩放方式" style={{ width: 240 }} value={draft.wheel} options={[{ value:'control',label:'Ctrl + 滚轮' },{ value:'alt',label:'Alt + 滚轮' },{ value:'shift',label:'Shift + 滚轮' },{ value:'none',label:'直接滚轮' },{ value:'disabled',label:'关闭滚轮缩放' }]} onChange={wheel => setDraft({ ...draft, wheel })} /></div>
    <div className="inline-setting"><span>拖动画面</span><Select aria-label="画面拖动方式" style={{ width: 240 }} value={draft.pan} options={[{value:'space',label:'空格 + 左键（中键也可）'},{value:'middle',label:'鼠标中键'},{value:'left',label:'直接左键'}]} onChange={pan => setDraft({ ...draft, pan })} /></div>
    <div className="inline-setting"><span>长按左键后拖动画面</span><Switch aria-label="长按拖动画面" checked={draft.longPressPan} onChange={longPressPan => setDraft({ ...draft, longPressPan })} /></div>
    <div className="inline-setting"><span>长按时间（毫秒）</span><InputNumber aria-label="画面长按时间" min={150} max={1000} value={draft.longPressMs} onChange={v => v !== null && setDraft({ ...draft, longPressMs:v })} /></div>
    <div className="inline-setting"><span>每次缩放倍数</span><InputNumber aria-label="缩放步长" min={1.05} max={2} step={.05} value={draft.zoomStep} onChange={v => v !== null && setDraft({ ...draft, zoomStep:v })} /></div>
    <Button style={{ marginTop:16 }} onClick={() => setDraft(DEFAULT_VIEWPORT)}>恢复默认操作</Button>
  </Modal>
}
