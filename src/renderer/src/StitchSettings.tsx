import { Checkbox, InputNumber, Radio, Select, Switch } from 'antd'
import type { ExtractSettings } from '../../shared/types'

const presets = [
  { value: '3x3', label: '九宫格 · 3 行 × 3 列', rows: 3, columns: 3 },
  { value: '2x3', label: '六宫格 · 2 行 × 3 列', rows: 2, columns: 3 },
  { value: '2x2', label: '四宫格 · 2 行 × 2 列', rows: 2, columns: 2 },
  { value: '3x4', label: '十二格 · 3 行 × 4 列', rows: 3, columns: 4 },
  { value: '4x4', label: '十六格 · 4 行 × 4 列', rows: 4, columns: 4 }
]

export default function StitchSettings({ value, onChange, automatic = false }: {
  value: ExtractSettings; onChange(value: ExtractSettings): void; automatic?: boolean
}) {
  function set<K extends keyof ExtractSettings>(key: K, next: ExtractSettings[K]) {
    const updated = { ...value, [key]: next }
    if (updated.layout === 'grid') updated.perSheet = updated.rows * updated.columns
    onChange(updated)
  }
  const preset = presets.find(p => value.rows === p.rows && value.columns === p.columns)?.value || 'custom'
  return <div className="stitch-settings">
    {automatic && <div className="inline-setting stitch-toggle"><span>抽帧后自动拼接</span><Switch aria-label="自动拼接" checked={value.autoStitch} onChange={v => set('autoStitch', v)} /></div>}
    <div className="setting-block"><label>拼接布局</label><Radio.Group block optionType="button" value={value.layout} options={[{ value: 'grid', label: '网格' }, { value: 'horizontal', label: '横排' }, { value: 'vertical', label: '竖排' }]} onChange={e => set('layout', e.target.value)} /></div>
    {value.layout === 'grid' ? <>
      <div className="setting-block"><label>布局预设</label><Select aria-label="拼接预设" className="full-width" value={preset} options={[...presets, { value: 'custom', label: '自定义行列' }]} onChange={v => {
        const p = presets.find(item => item.value === v)
        if (p) onChange({ ...value, rows: p.rows, columns: p.columns, perSheet: p.rows * p.columns })
      }} /></div>
      <div className="inline-setting"><span>行数</span><InputNumber aria-label="拼接行数" min={1} max={20} precision={0} value={value.rows} onChange={v => v !== null && set('rows', v)} /></div>
      <div className="inline-setting"><span>列数</span><InputNumber aria-label="拼接列数" min={1} max={20} precision={0} value={value.columns} onChange={v => v !== null && set('columns', v)} /></div>
    </> : <div className="inline-setting"><span>每张拼接图最多</span><InputNumber aria-label="每张拼接图数量" min={1} max={100} precision={0} value={value.perSheet} onChange={v => v !== null && set('perSheet', v)} /></div>}
    <p className="subtle-note">每张最多 {value.layout === 'grid' ? value.rows * value.columns : value.perSheet} 张图片。末行缺图留空，底部空行自动去除，超出时分为下一张。</p>
    <div className="inline-setting"><span>每格画面宽度</span><InputNumber aria-label="拼接图片宽度" min={80} max={1920} precision={0} value={value.thumbWidth} onChange={v => v !== null && set('thumbWidth', v)} /></div>
    <div className="inline-setting"><span>图片间距</span><InputNumber aria-label="拼接图片间距" min={0} max={100} precision={0} value={value.padding} onChange={v => v !== null && set('padding', v)} /></div>
    <div className="inline-setting"><span>背景颜色</span><input aria-label="拼接背景颜色" type="color" value={value.background} onChange={e => set('background', e.target.value)} /></div>
    <Checkbox checked={value.labels} onChange={e => set('labels', e.target.checked)}>显示序号和时间标签</Checkbox>
    <div className="storyboard-option"><div className="inline-setting"><span>画面内图序号 · ①②③</span><Switch aria-label="画面图序号" checked={value.markersEnabled} onChange={v=>set('markersEnabled',v)}/></div>
      {value.markersEnabled && <><div className="inline-setting"><span>符号样式</span><Select aria-label="图序号样式" value={value.markerStyle} options={[{value:'circle',label:'带圈数字 · ①②③'},{value:'number',label:'数字 · 1 2 3'}]} onChange={v=>set('markerStyle',v)}/></div><div className="inline-setting"><span>默认角落</span><Select aria-label="图序号角落" value={value.markerCorner} options={[{value:'tl',label:'左上角'},{value:'tr',label:'右上角'},{value:'bl',label:'左下角'},{value:'br',label:'右下角'}]} onChange={v=>set('markerCorner',v)}/></div><div className="inline-setting"><span>符号大小</span><InputNumber aria-label="图序号大小" min={12} max={120} value={value.markerSize} onChange={v=>v!==null&&set('markerSize',v)}/></div><div className="inline-setting"><span>序号颜色</span><input aria-label="图序号颜色" type="color" value={value.markerColor} onChange={e=>set('markerColor',e.target.value)}/></div><div className="inline-setting"><span>序号底色</span><input aria-label="图序号底色" type="color" value={value.markerBackground} onChange={e=>set('markerBackground',e.target.value)}/></div><Checkbox checked={value.markerContinuous} onChange={e=>set('markerContinuous',e.target.checked)}>跨拼接图连续编号</Checkbox><p className="subtle-note">直接拖动画面上的序号可单独定位；默认每张拼接图从 1 编号。</p></>}
    </div>
    <div className="storyboard-option"><div className="inline-setting"><span>留备注区 · 故事板</span><Switch aria-label="故事板备注区" checked={value.notesEnabled} onChange={v => set('notesEnabled', v)} /></div>
      {value.notesEnabled && <><div className="inline-setting"><span>备注区最小高度</span><InputNumber aria-label="备注区高度" min={40} max={500} precision={0} value={value.noteHeight} onChange={v => v !== null && set('noteHeight', v)} /></div><div className="inline-setting"><span>备注字号</span><InputNumber aria-label="备注字号" min={8} max={36} precision={0} value={value.noteFontSize} onChange={v => v !== null && set('noteFontSize', v)} /></div><div className="inline-setting"><span>备注字体</span><Select aria-label="备注字体" value={value.noteFont} onChange={v=>set('noteFont',v)} options={[{value:'yahei',label:'微软雅黑'},{value:'arial',label:'Arial · 中文用雅黑'}]}/></div><div className="inline-setting"><span>备注对齐</span><Select aria-label="备注对齐" value={value.noteAlign} onChange={v=>set('noteAlign',v)} options={[{value:'left',label:'左对齐'},{value:'center',label:'居中'},{value:'right',label:'右对齐'}]}/></div><div className="inline-setting"><span>文字颜色</span><input aria-label="备注文字颜色" type="color" value={value.noteColor} onChange={e=>set('noteColor',e.target.value)}/></div><div className="inline-setting"><span>备注背景</span><input aria-label="备注背景颜色" type="color" value={value.noteBackground} onChange={e=>set('noteBackground',e.target.value)}/></div><Checkbox checked={value.noteFields} onChange={e=>set('noteFields',e.target.checked)}>使用镜号 / 画面 / 动作 / 对白字段</Checkbox><p className="subtle-note">文字自动换行并撑高备注区，同行一起增高，不缩小字号、不滚动。空备注保留空白，未开启时不额外留白。</p></>}
    </div>
  </div>
}
