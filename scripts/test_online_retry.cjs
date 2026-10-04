const {_electron:electron,expect}=require('@playwright/test')
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'..'),data=process.env.FRAMEPICK_RESUME_TEST_DATA
if(!data||!fs.existsSync(path.join(data,'workspace.json')))throw new Error('Set FRAMEPICK_RESUME_TEST_DATA to an isolated test workspace with a failed download.')
let app,page;const cases=[]
const snap=()=>page.evaluate(()=>window.framepick.snapshot())
async function terminal(id){await expect.poll(async()=>['done','error','cancelled'].includes((await snap()).jobs.find(j=>j.id===id)?.status),{timeout:300000}).toBe(true);const j=(await snap()).jobs.find(j=>j.id===id);assert.equal(j.status,'done',j.error);return j}
;(async()=>{try{
  app=await electron.launch({executablePath:process.env.FRAMEPICK_PACKAGED_EXE||require('electron'),args:process.env.FRAMEPICK_PACKAGED_EXE?['--hidden']:[root,'--hidden'],env:{...process.env,FRAMEPICK_TEST_DATA:data,ELECTRON_RENDERER_URL:''},timeout:60000})
  page=await app.firstWindow();await expect.poll(async()=>(await snap()).health.ready).toBe(true)
  const failed=(await snap()).jobs.find(j=>j.kind==='download'&&j.status==='error');assert(failed)
  await page.evaluate(id=>window.framepick.retryJob(id),failed.id);await terminal(failed.id)
  const video=(await snap()).videos.find(v=>v.id===failed.videoId);assert(fs.existsSync(video.downloadedPath)&&video.info.audioCodec!=='下载后核验')
  cases.push({name:'网络失败后重试独立下载及核验元信息',status:'passed'});console.log('PASS retry download and metadata')
  await page.evaluate(async id=>{const s=await window.framepick.snapshot();await window.framepick.saveSettings({...s.settings,start:0,end:8,interval:2});await window.framepick.enqueue([id])},video.id)
  const extraction=(await snap()).jobs.at(-1);await terminal(extraction.id);const results=await page.evaluate(id=>window.framepick.results(id,0),extraction.id)
  assert.equal(results.total,3);assert(results.frames.every(f=>fs.existsSync(f.path)))
  cases.push({name:'独立下载后复用保存视频抽帧',status:'passed'});console.log('PASS downloaded video extraction')
}finally{
  fs.writeFileSync(path.join(path.dirname(data),'retry-report.json'),JSON.stringify({packaged:!!process.env.FRAMEPICK_PACKAGED_EXE,cases},null,2));if(app)await app.close()
}})().catch(e=>{console.error(e);process.exitCode=1})
