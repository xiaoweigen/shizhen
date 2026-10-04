import {BrowserWindow,session} from 'electron'
import {randomUUID} from 'node:crypto'

const allowed=(url:string)=>{try{const host=new URL(url).hostname;return ['bilibili.com','b23.tv','douyin.com','iesdouyin.com'].some(domain=>host===domain||host.endsWith('.'+domain))}catch{return false}}
/** A new in-memory visitor session, never the user's browser or account session. */
export async function anonymousCookies(url:string) {
  if(!allowed(url))return []
  const visitor=session.fromPartition('anonymous-'+randomUUID(),{cache:false})
  const browser=new BrowserWindow({show:false,webPreferences:{session:visitor,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
  browser.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  browser.webContents.on('will-navigate',(event,next)=>{if(!allowed(next))event.preventDefault()})
  browser.webContents.on('will-redirect',(event,next)=>{if(!allowed(next))event.preventDefault()})
  visitor.on('will-download',event=>event.preventDefault())
  let timer:ReturnType<typeof setTimeout>|undefined
  try {
    await Promise.race([browser.loadURL(url).catch(()=>{}),new Promise<void>(resolve=>{timer=setTimeout(resolve,18000)})])
    if(timer)clearTimeout(timer)
    await new Promise(resolve=>setTimeout(resolve,1200))
    return (await visitor.cookies.get({})).filter(cookie=>allowed('https://'+(cookie.domain||'').replace(/^\./,''))).map(cookie=>({domain:cookie.domain,path:cookie.path,name:cookie.name,value:cookie.value,secure:cookie.secure,expirationDate:cookie.expirationDate || 0}))
  } finally {
    if(timer)clearTimeout(timer)
    if(!browser.isDestroyed())browser.destroy()
    await visitor.clearStorageData();await visitor.clearCache()
  }
}
