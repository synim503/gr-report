import { test, expect, Page } from '@playwright/test'
import { reset, open, addText, dropPanel, openDashboard, elRect, grafanaRequests, download, API, GRAFANA } from './helpers'

test.beforeEach(async ({ page, request }) => { await reset(request); await open(page) })

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const attr = (xml: string, tag: string, name: string) => [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*?${name}="([^"]*)"`, 'g'))].map(m => m[1])
async function typeInto(page: Page, el: any, text: string) {
  await el.dblclick(); await expect(el.locator('.ProseMirror')).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type(text)
}
const leave = (page: Page) => page.locator('[data-testid="page-0"]').click({ position: { x: 4, y: 4 } })

test('save, reload, reopen from the list; dirty indicator; delete', async ({ page }) => {
  const t = await addText(page, 100, 120); await typeInto(page, t, 'Persisted text'); await leave(page)
  await page.getByTestId('rv-new').fill('server'); await page.getByTestId('rv-add').click(); await page.getByTestId('rv-server').fill('db-1')
  await page.getByTestId('report-name').fill('Недельный отчёт')
  await expect(page.getByTestId('dirty')).toContainText('не сохранено')
  await page.getByTestId('save').click()
  await expect(page.getByTestId('dirty')).toContainText('сохранено')
  await expect(page.getByTestId('dirty')).not.toContainText('не сохранено')

  await page.reload()
  await expect(page.getByTestId('el-text')).toHaveCount(0)
  await page.getByTestId('open').click()
  await expect(page.getByTestId('template-item')).toHaveCount(1)
  await expect(page.getByTestId('template-item')).toContainText('Недельный отчёт')
  await page.getByTestId('template-open').click()
  await expect(page.getByTestId('report-name')).toHaveValue('Недельный отчёт')
  await expect(page.getByTestId('text-static')).toContainText('Persisted text')
  const r = await elRect(page.getByTestId('el-text')); expect(Math.round(r.x)).toBeGreaterThan(95); expect(Math.round(r.y)).toBeGreaterThan(115)
  await expect(page.getByTestId('rv-server')).toHaveValue('db-1')

  // saving again updates, not duplicates
  await page.getByTestId('report-name').fill('Renamed'); await page.getByTestId('save').click()
  await expect(page.getByTestId('dirty')).not.toContainText('не сохранено')
  await page.getByTestId('open').click(); await expect(page.getByTestId('template-item')).toHaveCount(1)
  await expect(page.getByTestId('template-item')).toContainText('Renamed')
  await page.getByTestId('template-delete').click()
  await expect(page.getByTestId('template-item')).toHaveCount(0)
})

test('Ctrl+S saves', async ({ page, request }) => {
  await page.getByTestId('report-name').fill('Hotkey')
  await page.locator('body').press('Control+s')
  await expect.poll(async () => (await (await request.get(`${API}/api/templates`)).json()).length).toBe(1)
})

test('generate Word: layout, formatting, charts, image and 2 pages end up in the .docx', async ({ page, request }) => {
  await page.getByTestId('report-name').fill('Отчёт Q1')
  // --- text with formatting
  const title = await addText(page, 40, 30)
  await title.dblclick(); await expect(title.locator('.ProseMirror')).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('Weekly report {{date}}')
  await page.keyboard.press('ControlOrMeta+a')
  await page.getByTestId('tb-heading').selectOption('1'); await page.getByTestId('tb-center').click()
  await page.getByTestId('tb-color').fill('#ff0000')
  await leave(page)
  await title.click({ position: { x: 10, y: 8 } }); await page.getByTestId('ins-w').fill('515'); await page.getByTestId('ins-h').fill('40')

  const body = await addText(page, 40, 90)
  await body.dblclick(); await expect(body.locator('.ProseMirror')).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('Bold Italic')
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('ControlOrMeta+b'); await page.keyboard.press('ControlOrMeta+i')
  await page.keyboard.press('End'); await page.keyboard.press('Enter')
  await page.getByTestId('tb-ol').click(); await page.keyboard.type('first'); await page.keyboard.press('Enter'); await page.keyboard.type('second')
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.type('link')
  await page.keyboard.press('Shift+Home')
  page.once('dialog', d => d.accept('https://grafana.com/')); await page.getByTestId('tb-link').click()
  await leave(page)

  // --- charts: one with its own time range
  await openDashboard(page)
  await dropPanel(page, 0, 40, 300); await dropPanel(page, 1, 320, 300)
  await expect(page.getByTestId('chart-img')).toHaveCount(2)
  await page.getByTestId('el-chart').nth(1).click({ position: { x: 5, y: 5 } })
  await page.getByTestId('chart-from').fill('now-1h'); await page.getByTestId('chart-theme').selectOption('dark')
  await page.getByTestId('cv-host').fill('web-77')            // dashboard variables are listed right away
  const c0 = await elRect(page.getByTestId('el-chart').first())
  await leave(page)
  await page.getByTestId('range-from').fill('now-7d')

  // --- image
  await page.getByTestId('image-input').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByTestId('el-image')).toHaveCount(1)

  // --- second page
  await page.getByTestId('add-page').click()
  const p2 = page.getByTestId('add-text'); await p2.dragTo(page.getByTestId('page-1'), { targetPosition: { x: 100, y: 100 } })
  await expect(page.getByTestId('page-1').getByTestId('el-text')).toHaveCount(1)
  await typeInto(page, page.getByTestId('page-1').getByTestId('el-text'), 'Second page text')
  await page.locator('[data-testid="page-1"]').click({ position: { x: 4, y: 4 } })

  await request.get('http://127.0.0.1:3100/__reset')
  const { zip, xml, filename } = await download(page, () => page.getByTestId('generate').click())
  expect(filename).toBe('Отчёт Q1.docx')
  await expect(page.getByTestId('toast-info').filter({ hasText: 'Готово' })).toBeVisible()

  // text frames, absolutely positioned on the page (twips)
  const xs = attr(xml, 'w:framePr', 'w:x').map(Number), ys = attr(xml, 'w:framePr', 'w:y').map(Number)
  expect(xs.some(x => Math.abs(x - 40 * 20) <= 20)).toBe(true); expect(ys.some(y => Math.abs(y - 30 * 20) <= 20)).toBe(true)   // drop lands within a pixel of the target
  expect(attr(xml, 'w:framePr', 'w:w')).toContain(String(515 * 20)); expect(new Set(attr(xml, 'w:framePr', 'w:hAnchor'))).toEqual(new Set(['page']))
  // formatting
  const text = xml.replace(/<[^>]+>/g, '')
  expect(text).toMatch(/Weekly report \d{4}-\d\d-\d\d/)                     // {{date}} substituted
  expect(xml).toMatch(/<w:jc w:val="center"\/>/); expect(xml).toMatch(/<w:color w:val="FF0000"\/>/)
  expect(xml).toMatch(/<w:sz w:val="48"\/>/); expect(xml).toMatch(/<w:outlineLvl w:val="0"\/>/)        // heading 1 = 24pt
  expect(xml).toMatch(/<w:b( w:val="(true|1|on)")?\/>/); expect(xml).toMatch(/<w:i( w:val="(true|1|on)")?\/>/)
  expect(xml).toMatch(/<w:numPr>/); expect(xml).toMatch(/<w:hyperlink /)
  expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('https://grafana.com/')
  // charts are floating pictures at the editor position (EMU)
  expect(xml.match(/<wp:anchor /g)!.length).toBe(3)                           // 2 charts + 1 logo
  expect(attr(xml, 'wp:posOffset', '')).toBeDefined()
  expect([...xml.matchAll(/<wp:posOffset>(\d+)<\/wp:posOffset>/g)].map(m => Number(m[1]))).toContain(Math.round(c0.x * 12700))
  expect(Object.keys(zip.files).filter(f => f.startsWith('word/media/'))).toHaveLength(3)
  // page two
  expect(xml.indexOf('pageBreakBefore')).toBeGreaterThan(0)
  expect(text.indexOf('Second page text')).toBeGreaterThan(text.indexOf('second'))

  // what Grafana was asked for: default range, override on one chart, theme, variables, pixel size = pt × 96/72 × 1.5
  const reqs = await grafanaRequests(request)
  const p1 = reqs.find(q => q.panelId === '1')!, p2r = reqs.find(q => q.panelId === '2')!
  expect(p1.from).toBe('now-7d'); expect(p1.to).toBe('now'); expect(p1.theme).toBe('light'); expect(p1['var-host']).toBe('srv-default')   // dashboard defaults picked up in the sidebar
  expect(p2r.from).toBe('now-1h'); expect(p2r.theme).toBe('dark'); expect(p2r['var-host']).toBe('web-77')
  expect(Number(p1.width)).toBe(Math.round(c0.w * 96 / 72 * 1.5)); expect(Number(p1.height)).toBe(Math.round(c0.h * 96 / 72 * 1.5))
})

test('generate Word with a block: variables and report variables reach Grafana', async ({ page, request }) => {
  await page.getByTestId('rv-new').fill('server'); await page.getByTestId('rv-add').click(); await page.getByTestId('rv-server').fill('app-1')
  await page.getByTestId('dashboard-item').first().locator('.title').click()
  await page.getByTestId('dash-as-block').click()
  await page.getByTestId('bv-host').fill('{{server}}'); await page.getByTestId('bv-insert').click()
  await expect(page.getByTestId('chart-img')).toHaveCount(3)
  await request.get('http://127.0.0.1:3100/__reset')
  const { zip, xml } = await download(page, () => page.getByTestId('generate').click())
  expect(xml.match(/<wp:anchor /g)).toHaveLength(3)
  expect(Object.keys(zip.files).filter(f => f.startsWith('word/media/'))).toHaveLength(3)
  const reqs = await grafanaRequests(request)
  expect(reqs).toHaveLength(3)
  for (const q of reqs) { expect(q['var-host']).toBe('app-1'); expect(q['var-job']).toBe('All') }
})

test('chart that cannot be rendered: document is still produced, with a placeholder and a warning', async ({ page, request }) => {
  const tpl = { name: 'broken', pageWidth: 595.28, pageHeight: 841.89, timeRange: { from: 'now-6h', to: 'now' }, variables: {},
    pages: [{ elements: [
      { id: 'a', type: 'chart', x: 20, y: 20, w: 300, h: 150, z: 0, chart: { dashboardUid: 'boom', panelId: 1, title: 'Broken', vars: {} } },
      { id: 'b', type: 'chart', x: 20, y: 200, w: 300, h: 150, z: 1, chart: { dashboardUid: 'abc', panelId: 1, title: 'Fine', vars: {} } }] }] }
  await request.post(`${API}/api/templates`, { data: tpl })
  await page.getByTestId('open').click(); await page.getByTestId('template-open').click()
  await expect(page.getByTestId('chart-error')).toBeVisible()                  // the canvas shows the problem too
  const { zip } = await download(page, () => page.getByTestId('generate').click())
  expect(Object.keys(zip.files).filter(f => f.startsWith('word/media/'))).toHaveLength(2)
  await expect(page.getByTestId('toast-warn')).toContainText('Broken')
})

test('revoked token: generation reports it clearly instead of failing silently', async ({ page, request }) => {
  await page.getByTestId('dashboard-item').first().locator('.title').click()
  await page.getByTestId('panel-item').first().click()
  await expect(page.getByTestId('chart-img')).toBeVisible()
  await request.put(`${API}/api/settings`, { data: { token: 'revoked' } })
  await page.getByTestId('generate').click()
  await expect(page.getByTestId('toast-warn')).toContainText(/token|unauthorized/i)
})

test('generation of an empty report works and a failed request shows an error toast', async ({ page }) => {
  const { xml } = await download(page, () => page.getByTestId('generate').click())
  expect(xml).toContain('<w:body>')
  await page.route('**/api/reports/jobs*', r => r.request().method() === 'POST' ? r.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"pages: must not be empty"}' }) : r.continue())
  await page.getByTestId('generate').click()
  await expect(page.getByTestId('toast-err')).toContainText('pages: must not be empty')
  await expect(page.getByTestId('generate')).toBeEnabled()
})

test('image elements: upload, resize, appear in the document; non-image is refused', async ({ page }) => {
  await page.getByTestId('image-input').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: PNG })
  const img = page.getByTestId('el-image'); await expect(img).toHaveCount(1)
  await expect(img.locator('img')).toHaveAttribute('src', /^data:image\/png/)
  await img.click(); await page.getByTestId('ins-w').fill('120'); await page.getByTestId('ins-h').fill('60')
  const { xml, zip } = await download(page, () => page.getByTestId('generate').click())
  expect(xml).toContain(`cx="${120 * 12700}"`); expect(xml).toContain(`cy="${60 * 12700}"`)
  expect(Object.keys(zip.files).some(f => f.startsWith('word/media/'))).toBe(true)
  await page.getByTestId('image-input').setInputFiles({ name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') })
  await expect(page.getByTestId('toast-err')).toContainText('PNG')
  await expect(page.getByTestId('el-image')).toHaveCount(1)
})

test('landscape A3 page size is written to the document', async ({ page }) => {
  await page.getByTestId('page-size').selectOption('A3'); await page.getByTestId('page-orient').selectOption('l')
  await page.getByTestId('add-text').click()
  await expect(page.getByTestId('el-text')).toHaveCount(1)
  const { xml } = await download(page, () => page.getByTestId('generate').click())
  expect(attr(xml, 'w:pgSz', 'w:w')[0]).toBe('23811'); expect(attr(xml, 'w:pgSz', 'w:h')[0]).toBe('16838')
  expect(attr(xml, 'w:pgSz', 'w:orient')[0]).toBe('landscape')
})
