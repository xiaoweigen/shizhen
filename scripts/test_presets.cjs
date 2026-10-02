const { _electron: electron, expect } = require('@playwright/test')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..'), version = require('../package.json').version, artifact = path.join(root, '.test-artifacts', version, 'presets', String(Date.now()))
fs.mkdirSync(artifact, { recursive: true })
const {spawnSync}=require('node:child_process'); const sample=path.join(artifact,'generated-portrait.mp4'); const generated=spawnSync(path.join(root,'.tools/ffmpeg.exe'),['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=duration=1:size=720x1280:rate=30','-c:v','libx264','-threads','2','-pix_fmt','yuv420p',sample],{windowsHide:true,encoding:'utf8'}); assert.equal(generated.status,0,generated.stderr)

let app
;(async () => {
  try {
    app = await electron.launch({ executablePath: process.env.FRAMEPICK_PACKAGED_EXE || require('electron'), args: process.env.FRAMEPICK_PACKAGED_EXE ? ['--hidden'] : [root, '--hidden'], env: { ...process.env, FRAMEPICK_TEST_DATA: path.join(artifact, 'user-data'), ELECTRON_RENDERER_URL: '', PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` }, timeout: 60000 })
    const page = await app.firstWindow(); page.setDefaultTimeout(20000)
    const wait = predicate => expect.poll(async () => predicate(await page.evaluate(() => window.framepick.snapshot())), { timeout: 60000 }).toBe(true)
    await wait(s => s.health.ready); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.reload(); await wait(s => s.health.ready)
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, path.join(artifact, 'output'))
    await page.evaluate(async sample => { await window.framepick.addFiles([sample]); await window.framepick.chooseOutput(); const s = await window.framepick.snapshot(); await window.framepick.saveSettings({ ...s.settings, interval: .02, end: .2, format: 'png', maxWidth: 160, thumbWidth: 80, labels: false }); await window.framepick.enqueue([s.videos[0].id]) }, sample)
    await wait(s => s.jobs[0].status === 'done'); const job = (await page.evaluate(() => window.framepick.snapshot())).jobs[0]; assert.equal(job.count, 9)
    await page.getByRole('button', { name: '查看导出图片', exact: true }).click(); await page.getByRole('tab', { name: '拼接编辑', exact: true }).click()
    const board = page.locator('.board-settings'), checks = []
    const options = [['四宫格 · 2 行 × 2 列', 2, 2], ['六宫格 · 2 行 × 3 列', 2, 3], ['九宫格 · 3 行 × 3 列', 3, 3], ['十二格 · 3 行 × 4 列', 3, 4], ['十六格 · 4 行 × 4 列', 4, 4]]
    for (const [name, rows, columns] of options) {
      await board.getByLabel('拼接预设', { exact: true }).click(); await page.locator('.ant-select-dropdown:visible').getByText(name, { exact: true }).click()
      await expect(board.getByLabel('拼接行数', { exact: true })).toHaveValue(String(rows)); await expect(board.getByLabel('拼接列数', { exact: true })).toHaveValue(String(columns))
      const count = Math.min(9, rows * columns), occupiedRows = Math.ceil(count / columns)
      await expect(page.locator('.story-cell')).toHaveCount(occupiedRows * columns)
      await page.getByRole('button', { name: '生成当前拼接图', exact: true }).click(); await expect(page.getByRole('tab', { name: `拼接图 (${checks.length + 1})`, exact: true })).toBeVisible()
      const saved = JSON.parse(fs.readFileSync(job.manifest, 'utf8')), file = saved.sheets.at(-1)
      const size = await app.evaluate(({ nativeImage }, file) => nativeImage.createFromPath(file).getSize(), file)
      assert.equal(size.width, columns * 88 + 8); assert.equal(size.height, occupiedRows * 150 + 8)
      assert.equal(saved.sheetRecipes[file].names.length, count)
      checks.push({ name, rows, columns, images: count, actualRows: occupiedRows, blanks: occupiedRows * columns - count, size, status: 'passed' }); console.log('PASS ' + name)
      await page.getByRole('tab', { name: '拼接编辑', exact: true }).click()
    }
    const interactions = []
    for (const [name, width, height] of [['横排', 1416, 158], ['竖排', 96, 1358]]) {
      await board.getByText(name, { exact: true }).click(); await expect(page.locator('.story-cell img')).toHaveCount(9)
      const old = JSON.parse(fs.readFileSync(job.manifest, 'utf8')).sheets.length
      await page.getByRole('button', { name: '生成当前拼接图', exact: true }).click(); await expect(page.getByRole('tab', { name: `拼接图 (${old + 1})`, exact: true })).toBeVisible()
      const saved = JSON.parse(fs.readFileSync(job.manifest, 'utf8')), file = saved.sheets.at(-1)
      const size = await app.evaluate(({ nativeImage }, file) => nativeImage.createFromPath(file).getSize(), file)
      assert.deepEqual(size, { width, height }); interactions.push({ name: name + '界面与导出', size, status: 'passed' })
      await page.getByRole('tab', { name: '拼接编辑', exact: true }).click()
    }
    await board.getByText('横排', { exact: true }).click(); await board.getByLabel('拼接图片宽度', { exact: true }).fill('200'); await board.getByLabel('拼接图片宽度', { exact: true }).blur()
    await expect.poll(() => page.locator('.storyboard-grid').evaluate(element => Number(element.style.width.replace('px', '')))).toBeGreaterThan(1800)
    await page.getByRole('button', { name: '100%', exact: true }).click(); await expect(page.locator('.storyboard-grid')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
    await page.getByRole('button', { name: '适合宽度', exact: true }).click(); await expect.poll(() => page.locator('.storyboard-grid').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).a)).toBeLessThan(1)
    interactions.push({ name: '100%与适合宽度切换', status: 'passed' })
    await page.locator('.results-modal .ant-modal-close').click(); await expect(page.locator('.results-modal')).not.toBeVisible()
    await page.getByRole('button', { name: '裁剪画面', exact: true }).click()
    await expect.poll(() => page.locator('.crop-stage video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(1)
    const slider = page.locator('.crop-timeline [role="slider"]'); await slider.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight')
    await expect(page.locator('.crop-timeline')).toContainText('预览位置 0.3s'); await expect.poll(() => page.locator('.crop-stage video').evaluate(video => video.currentTime)).toBeCloseTo(.3, 3)
    await page.locator('.crop-modal .ant-modal-close').click(); interactions.push({ name: '裁剪时间预览实际跳转0.3秒', status: 'passed' })
    const report = { result: 'passed', version, packaged: Boolean(process.env.FRAMEPICK_PACKAGED_EXE), executable: process.env.FRAMEPICK_PACKAGED_EXE, artifact, checks, interactions }
    fs.writeFileSync(path.join(artifact, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report))
  } finally { if (app) await app.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
