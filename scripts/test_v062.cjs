const {_electron:electron,expect}=require('@playwright/test')
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'..'),version=require('../package.json').version
const source=process.env.FRAMEPICK_TEST_VIDEO,url=process.env.FRAMEPICK_TEST_URL
if(!source||!fs.existsSync(source))throw new Error('Set FRAMEPICK_TEST_VIDEO to an existing local video.')
const artifact=path.join(root,'.test-artifacts',version,'user-fixes',String(Date.now())),output=path.join(artifact,'output')
fs.mkdirSync(output,{recursive:true});let app,page,job,online
const cases=[],errors=[],hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),originalHash=hash(source)
const snap=()=>page.evaluate(()=>window.framepick.snapshot())
const wait=predicate=>expect.poll(async()=>predicate(await snap()),{timeout:240000}).toBe(true)
const report=()=>fs.writeFileSync(path.join(artifact,'report.json'),JSON.stringify({version,packaged:!!process.env.FRAMEPICK_PACKAGED_EXE,cases,errors,originalUnchanged:hash(source)===originalHash},null,2))
async function test(name,fn){try{const evidence=await fn();cases.push({name,status:'passed',evidence});console.log('PASS '+name)}catch(error){cases.push({name,status:'failed',error:error.message});await page.screenshot({path:path.join(artifact,'failed.png')}).catch(()=>{});throw error}finally{report()}}
const scale=selector=>page.locator(selector).evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a)
async function chord(){await page.keyboard.down('q');await page.keyboard.down('w');await page.keyboard.up('w');await page.keyboard.up('q')}
async function pan(selector,hold='Space'){const stage=page.locator(selector),box=await stage.boundingBox();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.65);if(hold&&hold!=='middle')await page.keyboard.down(hold);await page.mouse.down({button:hold==='middle'?'middle':'left'});if(!hold)await page.waitForTimeout(450);await page.mouse.move(box.x+box.width*.6-70,box.y+box.height*.65-90,{steps:12});await page.mouse.up({button:hold==='middle'?'middle':'left'});if(hold&&hold!=='middle')await page.keyboard.up(hold)}
async function operation(name){await page.getByRole('button',{name:'视频操作 ▾',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click()}
async function choose(label,text){await page.getByLabel(label,{exact:true}).click();await page.getByText(text,{exact:true}).last().click()}
;(async()=>{try{
 app=await electron.launch({executablePath:process.env.FRAMEPICK_PACKAGED_EXE||require('electron'),args:process.env.FRAMEPICK_PACKAGED_EXE?['--hidden']:[root,'--hidden'],env:{...process.env,FRAMEPICK_TEST_DATA:path.join(artifact,'user-data'),ELECTRON_RENDERER_URL:''},timeout:60000})
 page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await wait(s=>s.health.ready);await page.emulateMedia({reducedMotion:'reduce'});await app.evaluate(({BrowserWindow})=>{const main=BrowserWindow.getAllWindows()[0];main.show();main.focus()})
 await test('Alt 不显示原生菜单，F2 打开应用菜单',async()=>{
   assert.equal(await app.evaluate(({Menu})=>Menu.getApplicationMenu()),null)
   await page.keyboard.press('Alt');assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMenuBarVisible()),false)
   await app.evaluate(({Menu})=>{global.menuShows=0;global.oldMenuEmit=Menu.prototype.emit;Menu.prototype.emit=function(name,...args){if(name==='menu-will-show'){global.menuShows++;global.testPopupMenu=this}return global.oldMenuEmit.call(this,name,...args)}})
   await app.evaluate(({BrowserWindow})=>{const wc=BrowserWindow.getAllWindows()[0].webContents;wc.sendInputEvent({type:'keyDown',keyCode:'F2'});wc.sendInputEvent({type:'keyUp',keyCode:'F2'})});await expect.poll(()=>app.evaluate(()=>global.menuShows)).toBe(1)
   await app.evaluate(({Menu})=>{global.testPopupMenu.closePopup();Menu.prototype.emit=global.oldMenuEmit})
   return {altMenu:false,f2OpenedAndClosed:true}
 })
 await test('已有真实本地视频导入和元信息',async()=>{
   await page.evaluate(file=>window.framepick.addFiles([file]),source);await wait(s=>s.videos[0]?.status==='ready')
   const info=(await snap()).videos[0].info;assert(info.width>0&&info.height>0&&info.codec);return {width:info.width,height:info.height,codec:info.codec}
 })
 await test('裁剪窗口首次打开即可快捷键缩放和滚轮缩放',async()=>{
   await operation('裁剪画面');const before=await scale('.crop-stage')
   await page.keyboard.press('Control+Equal');await expect.poll(()=>scale('.crop-stage')).toBeGreaterThan(before)
   const box=await page.locator('.crop-preview-wrap').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);const second=await scale('.crop-stage')
   await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.keyboard.up('Control');await expect.poll(()=>scale('.crop-stage')).toBeGreaterThan(second)
   assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()),1);return {canvasOnly:true}
 })
 await test('裁剪空格拖动、中键拖动不会改变裁剪区域',async()=>{
   await page.getByRole('button',{name:'100%',exact:true}).click();const original=await page.getByRole('spinbutton',{name:'裁剪宽度',exact:true}).inputValue()
   await pan('.crop-preview-wrap');assert((await page.locator('.crop-preview-wrap').evaluate(e=>e.scrollTop))>40)
   await pan('.crop-preview-wrap','middle');assert.equal(await page.getByRole('spinbutton',{name:'裁剪宽度',exact:true}).inputValue(),original)
   await page.keyboard.press('Control+Digit0');await pan('.crop-preview-wrap',null)
   assert.notEqual(await page.locator('.crop-scaled-canvas').evaluate(e=>getComputedStyle(e).translate),'0px')
   await page.keyboard.press('Escape');await expect(page.locator('.crop-modal')).not.toBeVisible();return {space:true,middle:true,longPress:true,rectUnchanged:true}
 })
 await test('组合键录制支持两个普通按键和多个修饰键',async()=>{
   await page.getByRole('button',{name:'画面操作快捷键',exact:true}).click()
   const zoom=page.getByRole('textbox',{name:'放大快捷键',exact:true});await zoom.click();await page.keyboard.down('q');await page.keyboard.down('w');await page.keyboard.up('w');await page.keyboard.up('q');await expect(zoom).toHaveValue('Q + W')
   const out=page.getByRole('textbox',{name:'缩小快捷键',exact:true});await out.click();await page.keyboard.down('Control');await page.keyboard.down('Shift');await page.keyboard.down('x');await page.keyboard.up('x');await page.keyboard.up('Shift');await page.keyboard.up('Control');await expect(out).toHaveValue('Ctrl + Shift + X')
   await page.getByRole('button',{name:/^保\s*存$/}).click();await wait(s=>s.viewport.zoomIn==='KeyQ+KeyW');return {zoomIn:'KeyQ+KeyW',zoomOut:'Control+Shift+KeyX'}
 })
 await test('抽帧、命名、处理队列结果显示',async()=>{
   await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]})},output)
   await page.evaluate(async()=>{await window.framepick.chooseOutput();const s=await window.framepick.snapshot();await window.framepick.saveSettings({...s.settings,interval:.5,end:8,format:'png',maxWidth:720,rows:3,columns:3,thumbWidth:240,labels:false,background:'#eeeeee'});await window.framepick.setExtractRanges([s.videos[0].id],{start:0,end:8});await window.framepick.enqueue([s.videos[0].id])})
   await wait(s=>s.jobs[0]?.status==='done');job=(await snap()).jobs[0];const result=await page.evaluate(id=>window.framepick.results(id,0),job.id);assert.equal(result.frames[0].name,'0.5s.png');assert.equal(result.frames.length,15)
   await page.getByRole('button',{name:'查看处理队列',exact:true}).click();await page.getByRole('button',{name:'查看图片',exact:true}).click();return {frames:job.count,naming:'0.5s.png',progress:100}
 })
 await test('结果弹窗双击原图后组合键、滚轮、拖动、Esc 正常',async()=>{
   await page.locator('.frame-grid-inner figure img').first().dblclick();await expect(page.locator('.image-viewer-modal')).toBeVisible()
   const before=await page.locator('.image-viewer-canvas img').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a);await chord();await expect.poll(()=>scale('.image-viewer-canvas img')).toBeGreaterThan(before)
   await page.getByRole('button',{name:'100%',exact:true}).click();await pan('.image-viewer-stage');assert((await page.locator('.image-viewer-stage').evaluate(e=>e.scrollTop))>30)
   await page.keyboard.press('Control+Shift+KeyX');const after=await scale('.image-viewer-canvas img');assert(after<1)
   await page.keyboard.press('Escape');await expect(page.locator('.image-viewer-modal')).not.toBeVisible();await expect(page.locator('.results-modal')).toBeVisible();return {nestedModal:true,customCombination:true,spacePan:true,escapeClosesOnlyViewer:true}
 })
 await test('拼接编辑缩放、空格拖动和焦点边线',async()=>{
   await page.getByRole('tab',{name:'拼接编辑',exact:true}).click();await expect(page.locator('.story-cell img').first()).toBeVisible();await expect(page.getByRole('button',{name:'生成当前拼接图',exact:true})).toBeEnabled()
   const before=await scale('.storyboard-grid');await chord();await expect.poll(()=>scale('.storyboard-grid')).toBeGreaterThan(before)
   await pan('.board-scroll');const styles=await page.locator('.board-scroll').evaluate(e=>({outline:getComputedStyle(e).outlineStyle,shadow:getComputedStyle(e).boxShadow}));assert.equal(styles.outline,'none');assert.equal(styles.shadow,'none');return styles
 })
 await test('画面序号启用、四角定位、拖动保存',async()=>{
   await page.getByRole('switch',{name:'画面图序号',exact:true}).click();await expect(page.locator('.frame-marker')).toHaveCount(9)
   await choose('图序号角落','右下角');await expect.poll(()=>page.locator('.frame-marker').first().evaluate(e=>parseFloat(e.style.top))).toBeGreaterThan(200)
   await page.getByRole('button',{name:'适合宽度',exact:true}).click();const marker=page.locator('.frame-marker').first();await marker.scrollIntoViewIfNeeded();const box=await marker.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x-80,box.y-80,{steps:12});await page.mouse.up()
   await expect.poll(async()=>{const r=await page.evaluate(id=>window.framepick.results(id,0),job.id);return Object.keys(r.stitchDraft?.markerPositions||{}).length}).toBe(1)
   return {draggable:true,saved:true,fourCorners:true}
 })
 await test('生成当前拼图并验证宫格显示与每行数量',async()=>{
   await page.getByRole('button',{name:'生成当前拼接图',exact:true}).click();await expect(page.getByRole('tab',{name:'拼接图 (1)',exact:true})).toBeVisible()
   await expect(page.locator('.sheets-grid figure')).toHaveCount(1)
   await choose('拼接图每行数量','4 张');assert.equal(await page.locator('.sheets-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),4)
   await page.locator('.sheets-grid').getByRole('button',{name:'编辑这张',exact:true}).click();await expect(page.getByText('正在编辑已有拼接图 · 重新生成会另存一张',{exact:true})).toBeVisible()
   await expect(page.locator('.frame-marker')).toHaveCount(9);return {columns:4,recipeRestored:true}
 })
 await test('备注高度、字号和未填满最后一页的底部高度',async()=>{
   await page.getByRole('switch',{name:'故事板备注区',exact:true}).click();await page.getByRole('spinbutton',{name:'备注区高度',exact:true}).fill('160');await page.getByRole('spinbutton',{name:'备注区高度',exact:true}).press('Tab')
   const note=page.locator('.story-cell textarea').first();await expect.poll(()=>note.evaluate(e=>parseFloat(e.style.height))).toBeGreaterThanOrEqual(160)
   await page.getByRole('spinbutton',{name:'备注字号',exact:true}).fill('28');await page.getByRole('spinbutton',{name:'备注字号',exact:true}).press('Tab');await expect.poll(()=>note.evaluate(e=>getComputedStyle(e).fontSize)).toBe('28px')
   await note.fill('故事板备注。'.repeat(90));await expect.poll(()=>note.evaluate(e=>e.clientHeight)).toBeGreaterThan(160)
   assert.equal(await note.evaluate(e=>getComputedStyle(e).overflowY),'hidden');return {minHeight:160,fontSize:28,autoGrow:true}
 })
 await test('已有拼接图查看器不会操作背后的编辑器',async()=>{
   await page.getByRole('tab',{name:'拼接图 (1)',exact:true}).click();await page.getByRole('button',{name:'查看原图',exact:true}).click();const parent=await scale('.storyboard-grid'),before=await scale('.image-viewer-canvas img')
   await chord();await expect.poll(()=>scale('.image-viewer-canvas img')).toBeGreaterThan(before);assert.equal(await scale('.storyboard-grid'),parent)
   await page.keyboard.press('Escape');await expect(page.locator('.results-modal')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.results-modal')).not.toBeVisible();return {scopeIsolated:true}
 })
 if(url){
   await test('在线链接完整提示、匿名解析与自动选中预览',async()=>{
     await page.getByRole('button',{name:'抽帧工作台',exact:true}).click();await page.evaluate(async()=>{const id=await window.framepick.createProject('在线项目');await window.framepick.setActiveProject(id);await window.framepick.updateProject(id,{collapsed:true})});await page.getByRole('textbox',{name:'搜索视频',exact:true}).fill('不会匹配新视频');await page.getByRole('button',{name:'粘贴视频链接',exact:true}).click()
     await expect(page.locator('.link-complete-warning')).toHaveText('复制解析视频链接时需要网站加载完成补全链接，不然链接缺失复制过来也无法解析')
     await page.getByRole('textbox',{name:'在线视频链接',exact:true}).fill(url);await page.locator('.ant-modal:visible .ant-modal-footer .ant-btn-primary').click()
     await expect(page.getByRole('textbox',{name:'在线视频链接',exact:true})).not.toBeVisible({timeout:240000});online=(await snap()).videos.find(v=>v.source==='online');assert(online)
     await expect(page.locator(`[data-video-id="${online.id}"]`)).toHaveClass(/focused/);assert(online.thumbnailUrl);assert.equal((await snap()).projects.find(p=>p.id===online.projectId).collapsed,false);await expect(page.getByRole('textbox',{name:'搜索视频',exact:true})).toHaveValue('');await wait(s=>s.videos.find(v=>v.id===online.id)?.localReady);await expect.poll(()=>page.locator('.preview-stage video').evaluate(v=>{v.muted=true;return v.readyState})).toBeGreaterThanOrEqual(2)
     return {anonymous:true,autoFocused:true,decodedPreview:true}
   })
   await test('匿名在线视频下载、元信息核验与抽帧',async()=>{
     await wait(s=>s.jobs.at(-1)?.kind==='download'&&s.jobs.at(-1)?.status==='done')
     const downloaded=(await snap()).videos.find(v=>v.id===online.id);assert(fs.existsSync(downloaded.downloadedPath))
     await page.evaluate(async id=>{const s=await window.framepick.snapshot();await window.framepick.saveSettings({...s.settings,interval:2});await window.framepick.setExtractRanges([id],{start:0,end:8});await window.framepick.enqueue([id])},online.id);await wait(s=>s.jobs.at(-1)?.kind!=='download'&&s.jobs.at(-1)?.status==='done')
     return {downloaded:true,frames:(await snap()).jobs.at(-1).count,cookieConfigured:false}
   })
 }
 await test('偏好与原始视频保存完整',async()=>{assert.equal(hash(source),originalHash);await page.reload();await wait(s=>s.health.ready&&s.viewport.zoomIn==='KeyQ+KeyW');assert.equal(await page.evaluate(()=>localStorage.getItem('sheetColumns')),'4');assert.equal(errors.length,0);return {sourceUnchanged:true,settingsPersisted:true,rendererErrors:errors.length}})
 console.log(JSON.stringify({result:'passed',cases:cases.length,artifact}))
 }finally{report();if(app)await app.close()}})().catch(e=>{console.error(e);process.exitCode=1})
