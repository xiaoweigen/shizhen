import {createContext,useContext} from 'react'
import {Select} from 'antd'
import type {TimeInputMode} from '../../shared/types'

export const TimeInputContext=createContext<{mode:TimeInputMode;change(mode:TimeInputMode):void}>({mode:'clock',change:()=>{}})
export default function TimeInputModeSelector({label='时间输入方式'}:{label?:string}){
  const {mode,change}=useContext(TimeInputContext)
  return <Select aria-label={label} className="time-mode-select" value={mode} onChange={change} options={[{value:'clock',label:'时分秒 · 01:05.000'},{value:'milliseconds',label:'毫秒 · 65000 ms'}]}/>
}
