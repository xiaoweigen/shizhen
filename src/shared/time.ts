export function formatTime(value:number, precision=true):string {
  const ms=Math.max(0,Math.round((Number.isFinite(value)?value:0)*1000)),seconds=Math.floor(ms/1000)
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds/60)%60
  const base=(hours?`${hours.toString().padStart(2,'0')}:`:'')+`${minutes.toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`
  return base+(precision?`.${(ms%1000).toString().padStart(3,'0')}`:'')
}
export function parseTime(text:string):number|null {
  const value=text.trim()
  if(!/^\d+(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(value))return null
  const parts=value.split(':').map(Number)
  if(parts.length>1&&parts.slice(1).some(v=>v>=60))return null
  const seconds=parts.reduce((sum,v)=>sum*60+v,0)
  return Number.isFinite(seconds)&&seconds>=0?Math.round(seconds*1000)/1000:null
}
export function parseMilliseconds(text:string):number|null {
  const value=text.trim()
  if(!/^\d+$/.test(value))return null
  const ms=Number(value)
  return Number.isSafeInteger(ms)?ms/1000:null
}
