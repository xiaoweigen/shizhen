// Capture real usage from an isolated test workspace; no media is created here.
const {_electron:electron,expect}=require('@playwright/test')
const fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'..'),data=process.env.FRAMEPICK_SCREENSHOT_DATA
if(!data||!fs.existsSync(path.join(data,'workspace.json')))throw new Error('Set FRAMEPICK_SCREENSHOT_DATA to an isolated test workspace.')
const output=path.resolve(process.env.FRAMEPICK_SCREENSHOT_OUTPUT||path.join(root,'.test-artifacts','screenshots'))
fs.mkdirSync(output,{recursive:true})
let app,page
const snap=()=>page.evaluate(()=>window.framepick.snapshot())
async function operation(name){await page.getByRole('button',{name:'视频操作 ▾',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click()}
async function shot(name){
  await page.evaluate(names=>{
    const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);window.redacted=[]
    while(walk.nextNode()){const node=walk.currentNode;let next=node.textContent;for(const [i,value] of names.entries())if(value)next=next.split(value).join('示例视频 '+(i+1));if(next!==node.textContent){window.redacted.push([node,node.textContent]);node.textContent=next}}
  },(await snap()).videos.map(video=>video.name))
  await page.mouse.move(3,3);await page.waitForTimeout(600)
  try{
    await app.evaluate(async({BrowserWindow})=>{const wc=BrowserWindow.getAllWindows()[0].webContents;await wc.capturePage(undefined,{stayAwake:true});await new Promise(r=>setTimeout(r,200));await wc.capturePage(undefined,{stayAwake:true})})
    await page.screenshot({path:path.join(output,name+'.png')})
  }finally{await page.evaluate(()=>{for(const [node,text] of window.redacted)node.textContent=text;delete window.redacted})}
}
;(async()=>{try{
  app=await electron.launch({executablePath:process.env.FRAMEPICK_PACKAGED_EXE||require('electron'),args:process.env.FRAMEPICK_PACKAGED_EXE?['--hidden']:[root,'--hidden'],env:{...process.env,FRAMEPICK_TEST_DATA:data,ELECTRON_RENDERER_URL:''},timeout:60000})
  page=await app.firstWindow();await expect.poll(async()=>(await snap()).health.ready).toBe(true)
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.show();w.focus()})
  await page.addStyleTag({content:'.video-title-bar p,.folder-picker span,.download-summary span,.delete-file-list small,.ant-tooltip{visibility:hidden!important}*{transition:none!important;animation-duration:0.001s!important;animation-delay:0s!important}'})
  const original=(await snap()).videos.find(v=>v.source==='local'&&!v.derivedFrom&&v.status==='ready')
  if(!original)throw new Error('The test workspace needs an existing original video.')
  await page.locator(`[data-video-id="${original.id}"]`).click()
  await page.evaluate(async id=>{await window.framepick.setTrimEnabled(id,false);const s=await window.framepick.snapshot();await window.framepick.saveSettings({...s.settings,start:0,end:null,interval:.5})},original.id)
  await page.locator('.preview-panel').evaluate(e=>e.scrollTop=0)
  await page.getByRole('button',{name:'视频操作 ▾',exact:true}).click();await shot('video-menu-0.7.0');await page.keyboard.press('Escape')
  await operation('裁剪画面');await expect.poll(()=>page.locator('.crop-stage video').evaluate(v=>{v.muted=true;return v.readyState})).toBeGreaterThanOrEqual(2)
  const seek=page.getByRole('textbox',{name:'裁剪播放位置',exact:true});await seek.fill('00:18.000');await seek.press('Tab')
  await page.locator('.crop-modal .ant-modal-body').evaluate(e=>e.scrollTop=0);await shot('playable-crop-0.7.0');await page.locator('.crop-modal .ant-modal-close').click()
  await operation('启用视频剪切');await operation('剪切长度');await page.getByLabel('删除选定时段',{exact:true}).check()
  for(const [name,value] of [['剪切终点','00:04.000'],['剪切起点','00:02.000']]){const input=page.getByRole('textbox',{name,exact:true});await input.fill(value);await input.press('Tab')}
  await shot('trim-video-0.7.0');await page.locator('.trim-modal .ant-modal-close').click()
  await page.evaluate(()=>window.framepick.setCloseAction('tray'));await page.getByRole('button',{name:'设置与维护',exact:true}).click();await expect(page.getByLabel('关闭窗口方式',{exact:true})).toBeVisible();await shot('tray-settings-0.7.0')
  console.log('Captured four deidentified usage screenshots.')
}finally{if(app)await app.close()}})().catch(e=>{console.error(e);process.exitCode=1})
