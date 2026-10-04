import { Button, Checkbox, Collapse, InputNumber, Radio, Select, Tooltip } from 'antd'
import type { ExtractSettings, ExtractRange } from '../../shared/types'
import TimeInputModeSelector from './TimeInputMode'
import Icon from './Icon'
import StitchSettings from './StitchSettings'
import TimeInput from './TimeInput'

export default function SettingsPanel({ value, onChange, outputRoot, chooseOutput, chooseCookie, compact = false, range, onRange, applyRange, rangeCount=0, rangeDuration=Infinity }: {
  value: ExtractSettings; onChange(value: ExtractSettings): void; outputRoot?: string;
  chooseOutput?: () => void; chooseCookie?: () => void; compact?: boolean
  range?:ExtractRange;onRange?(range:ExtractRange):void;applyRange?():void;rangeCount?:number;rangeDuration?:number
}) {
  const set = <K extends keyof ExtractSettings>(key: K, next: ExtractSettings[K]) => {if(onRange&&range&&(key==='start'||key==='end'))onRange({...range,[key]:next});else onChange({ ...value, [key]: next })}
  const selectedRange=range||value
  const base = <>
    <div className="setting-block"><label>抽帧方式</label><Select aria-label="抽帧方式" className="full-width" value={value.sampling} options={[{value:'interval',label:'固定时间间隔'},{value:'scene',label:'画面变化 · 按场景抽帧'}]} onChange={v=>set('sampling',v)}/>{value.sampling==='scene'&&<><div className="inline-setting"><span>场景变化阈值</span><InputNumber aria-label="场景变化阈值" min={1} max={100} value={value.sceneThreshold} onChange={v=>v!==null&&set('sceneThreshold',v)}/></div><p className="subtle-note">保留范围内首帧和达到阈值的新场景；下方间隔作为两个场景的最短间隔。阈值越小越敏感，渐变镜头可能不触发。</p></>}</div>
    <div className="setting-block"><label>抽帧间隔</label><div className="interval-input"><InputNumber aria-label="抽帧间隔" value={value.interval} min={.001} max={86400} step={.5} precision={3} controls={false} onChange={v => v !== null && set('interval', v)} /><span>秒 / 张</span></div>
      <div className="presets">{[.5, 1, 2, 5].map(n => <button key={n} className={value.interval === n ? 'active' : ''} onClick={() => set('interval', n)}>{n} 秒</button>)}</div>
    </div>
    <div className="setting-block"><label>截取范围{range?' · 当前视频':''} <small>留空结束时间代表视频结尾</small></label><TimeInputModeSelector/><div className="range-inputs">
      <label>从<TimeInput label="开始时间" value={selectedRange.start} max={Math.min(rangeDuration-.001,selectedRange.end===null?Infinity:selectedRange.end-.001)} onChange={v=>v!==null&&set('start',v)}/></label>
      <label>到<TimeInput label="结束时间" value={selectedRange.end} min={selectedRange.start+.001} max={rangeDuration} nullable placeholder="视频结尾" onChange={v=>set('end',v)}/></label>
    </div>{applyRange&&<Button size="small" block disabled={!rangeCount} onClick={applyRange}>应用到已选视频（{rangeCount}）</Button>}<Checkbox checked={value.includeStart} onChange={e => set('includeStart', e.target.checked)}>包含起点画面</Checkbox></div>
    <div className="setting-block"><label>图片格式</label><Radio.Group block optionType="button" buttonStyle="solid" value={value.format} options={[{ value: 'jpg', label: 'JPG · 更小' }, { value: 'png', label: 'PNG · 无损' }]} onChange={e => set('format', e.target.value)} />
      {value.format === 'jpg' && <div className="inline-setting"><span>图片质量</span><InputNumber aria-label="图片质量" value={value.quality} min={1} max={100} addonAfter="%" controls={false} onChange={v => v !== null && set('quality', v)} /></div>}
      <div className="inline-setting"><span>图片宽度</span><Select aria-label="图片宽度" value={value.maxWidth || 0} onChange={v => set('maxWidth', v || null)} options={[{ value: 0, label: '原始尺寸' }, { value: 1920, label: '不超过 1920 px' }, { value: 1280, label: '不超过 1280 px' }, { value: 640, label: '不超过 640 px' }]} /></div>
    </div>
    {!!chooseOutput && <div className="setting-block output-setting"><label>保存位置</label><Tooltip title={outputRoot}><button className="folder-picker" onClick={chooseOutput}><Icon name="folder" /><span>{outputRoot || '选择保存文件夹'}</span><Icon name="arrow" size={14} /></button></Tooltip><small>每个视频建立独立子文件夹，图片按时间命名。</small></div>}
    <div className="setting-block"><label>已有同名截图</label><Select aria-label="重复导出策略" className="full-width" value={value.conflict} onChange={v => set('conflict', v)} options={[{ value: 'skip', label: '核验后跳过 · 保留已有图片' }, { value: 'batch', label: '另存一批 · 建立批次子目录' }, { value: 'overwrite', label: '覆盖已有 · 替换同名图片' }]} /></div>
  </>
  const stitching = <StitchSettings value={value} onChange={onChange} automatic />
  const advanced = <>
    <Checkbox checked={value.deduplicate} onChange={e=>set('deduplicate',e.target.checked)}>去除相似的连续截图</Checkbox>
    {value.deduplicate&&<div className="inline-setting"><span>相似度差异阈值</span><InputNumber aria-label="去重差异阈值" min={0} max={100} value={value.similarity} onChange={v=>v!==null&&set('similarity',v)}/></div>}
    <p className="subtle-note">将裁剪后的画面缩为 32 × 18 比较颜色差异。差异低于阈值的图片省略，时间与顺序仍保留；阈值越大，省略越多。</p>
    <div className="inline-setting"><span>HDR 转普通图片</span><Select aria-label="HDR映射方式" value={value.hdrMode} options={[{value:'auto',label:'自动 · HDR 用 Hable'},{value:'hable',label:'Hable · 保留高光层次'},{value:'reinhard',label:'Reinhard · 柔和映射'},{value:'off',label:'关闭映射'}]} onChange={v=>set('hdrMode',v)}/></div><p className="subtle-note">仅 HDR 视频使用映射。导出为 SDR 图片；混合不同 HDR 素材时建议先导出几张确认。</p>
  </>
  const online = <>
    <div className="inline-setting"><span>下载清晰度上限</span><Select aria-label="在线清晰度" value={value.onlineQuality} onChange={v => set('onlineQuality', v)} options={[360, 480, 720, 1080, 2160].map(n => ({ value: n, label: `${n}p` }))} /></div>
    <p className="subtle-note">实际清晰度取决于平台提供的格式与访问状态。</p>
    {!!chooseCookie && <><Button block onClick={chooseCookie} icon={<Icon name="shield" size={16} />}>选择 Cookie 文件</Button><div className="cookie-status">{value.cookiePath ? value.cookiePath.split(/[\\/]/).pop() : '尚未配置 · 有需要时再选择'}</div>{value.cookiePath && <Button size="small" type="text" onClick={() => set('cookiePath', '')}>移除配置</Button>}</>}
    <p className="subtle-note">解析后下载到所选文件夹，后续复用本地视频。已有视频的清晰度不会因修改上限而改变；需要时可再次下载。</p>
  </>
  return <div className={'settings-content ' + (compact ? 'compact' : '')}>
    {base}<Collapse ghost defaultActiveKey={compact ? ['stitch'] : []} items={[{ key:'advanced',label:'画面筛选与颜色',children:advanced },{ key: 'stitch', label: <span className="collapse-label"><Icon name="grid" size={16} />图片拼接{value.autoStitch && <span className="small-pill">已开启</span>}</span>, children: stitching }, ...(!compact ? [{ key: 'online', label: <span className="collapse-label"><Icon name="link" size={16} />在线来源设置</span>, children: online }] : [])]} />
  </div>
}
