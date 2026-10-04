import {useContext,useEffect,useState} from 'react'
import {Input,Tooltip} from 'antd'
import {formatTime,parseTime,parseMilliseconds} from '../../shared/time'
import {TimeInputContext} from './TimeInputMode'
export default function TimeInput({value,onChange,label,min=0,max=Infinity,nullable=false,placeholder='00:00.000'}:{value:number|null;onChange(value:number|null):void;label:string;min?:number;max?:number;nullable?:boolean;placeholder?:string}) {
  const {mode}=useContext(TimeInputContext)
  const format=(n:number)=>mode==='milliseconds'?String(Math.round(n*1000)):formatTime(n)
  const parse=mode==='milliseconds'?parseMilliseconds:parseTime
  const [text,setText]=useState(value===null?'':format(value)),[editing,setEditing]=useState(false),[error,setError]=useState('')
  useEffect(()=>{setText(value===null?'':format(value));setEditing(false);setError('')},[mode])
  useEffect(()=>{if(!editing){setText(value===null?'':format(value));setError('')}},[value,editing])
  function commit(){
    if(!text.trim()&&nullable){setError('');onChange(null);setEditing(false);return}
    const parsed=parse(text)
    // Display has millisecond precision; rounded video ends may be half a millisecond above the source duration.
    const n=parsed!==null&&Number.isFinite(max)&&parsed>max&&parsed-max<=.000501?max:parsed
    if(n===null||n<min||n>max){setError(`请输入${mode==='milliseconds'?'整数毫秒':'有效时间（分:秒或时:分:秒）'}，范围 ${formatTime(min)}～${Number.isFinite(max)?formatTime(max):'视频结尾'}`);return false}
    setError('');onChange(n);setText(format(n));setEditing(false);return true
  }
  const converted=mode==='milliseconds'?parseMilliseconds(text):null
  return <div className="time-input"><Tooltip title={error||(mode==='milliseconds'?'输入整数毫秒；1000 = 1 秒':'分:秒.毫秒；超过一小时可输入时:分:秒')}><Input aria-label={label} aria-invalid={!!error} status={error?'error':undefined} value={text} placeholder={mode==='milliseconds'&&!nullable?'0 ms':placeholder} suffix={mode==='milliseconds'?'ms':undefined} onFocus={()=>setEditing(true)} onChange={e=>{setText(e.target.value);setError('')}} onBlur={commit} onPressEnter={e=>{if(commit())e.currentTarget.blur()}}/></Tooltip>{converted!==null&&<small className="time-converted">= {formatTime(converted)}</small>}{error&&<small role="alert">{error}</small>}</div>
}
