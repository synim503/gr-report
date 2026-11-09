import { test, expect, Page } from '@playwright/test'
import { reset, open, dropPanel, elRect, download, grafanaRequests, openDashboard, API, PT } from './helpers'

test.beforeEach(async ({ page, request }) => { await reset(request); await open(page) })

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const near = (a: number, b: number, tol = 0.6) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThanOrEqual(tol)
const leave = (page: Page) => page.locator('[data-testid="page-0"]').click({ position: { x: 4, y: 4 } })
async function chartAt(page: Page, panelIdx: number, x: number, y: number) {
  const before = await page.getByTestId('el-chart').count()
  await dropPanel(page, panelIdx, x, y)
  await expect(page.getByTestId('el-chart')).toHaveCount(before + 1)
  const id = await page.getByTestId('el-chart').last().getAttribute('data-el-id')
  return page.locator(`[data-el-id="${id}"]`)
}
const select = (el: any) => el.click({ position: { x: 12, y: 30 } })

test('a caption with custom text and automatic number appears under the chart, the picture shrinks by the caption line', async ({ page }) => {
  await openDashboard(page)
  const c = await chartAt(page, 0, 60, 80)
  await expect(c.getByTestId('figure-caption')).toHaveCount(0)
  const full = await elRect(c)
  await select(c)
  await page.getByTestId('cap-enable').check()
  await expect(c.getByTestId('figure-caption')).toHaveText('Рисунок 1 — CPU usage')           // defaults to the panel title
  await expect(page.getByTestId('cap-preview')).toHaveText('Рисунок 1 — CPU usage')
  await page.getByTestId('cap-text').fill('Загрузка процессора за 6 часов')
  await expect(c.getByTestId('figure-caption')).toHaveText('Рисунок 1 — Загрузка процессора за 6 часов')
  // the picture is 22 pt shorter, the element box is unchanged
  const pic = await c.locator('.pic').evaluate(n => parseFloat((n as HTMLElement).style.height))
  near(pic, full.h - 22); near((await elRect(c)).h, full.h, 0.01)
  // empty text -> only the number
  await page.getByTestId('cap-text').fill('')
  await expect(c.getByTestId('figure-caption')).toHaveText('Рисунок 1')
  // above: caption on top, picture below it
  await page.getByTestId('cap-text').fill('Над'); await page.getByTestId('cap-pos').selectOption('above')
  expect(await c.getByTestId('figure-caption').evaluate(n => (n as HTMLElement).style.top)).toBe('0px')
  expect(await c.locator('.pic').evaluate(n => parseFloat((n as HTMLElement).style.top))).toBe(22)
  // off again
  await page.getByTestId('cap-enable').uncheck()
  await expect(c.getByTestId('figure-caption')).toHaveCount(0)
  near(await c.locator('.pic').evaluate(n => parseFloat((n as HTMLElement).style.height)), full.h, 0.01)
})

test('numbers are assigned automatically in reading order and follow the layout', async ({ page }) => {
  await openDashboard(page)
  const a = await chartAt(page, 0, 40, 400), b = await chartAt(page, 1, 320, 100)             // a is lower, b is higher
  for (const c of [a, b]) { await select(c); await page.getByTestId('cap-enable').check() }
  await expect(a.getByTestId('figure-caption')).toContainText('Рисунок 2')
  await expect(b.getByTestId('figure-caption')).toContainText('Рисунок 1')
  // move a above b: the numbers swap
  await select(a)
  await page.getByTestId('ins-y').fill('20')
  await expect(a.getByTestId('figure-caption')).toContainText('Рисунок 1')
  await expect(b.getByTestId('figure-caption')).toContainText('Рисунок 2')
  // same row (tops within 8pt): left first
  await page.getByTestId('ins-y').fill('100'); await page.getByTestId('ins-x').fill('40')
  await expect(a.getByTestId('figure-caption')).toContainText('Рисунок 1'); await expect(b.getByTestId('figure-caption')).toContainText('Рисунок 2')
  // an element without a caption takes no number
  const c = await chartAt(page, 2, 40, 600); await expect(c.getByTestId('figure-caption')).toHaveCount(0)
  await select(c); await page.getByTestId('cap-enable').check()
  await expect(c.getByTestId('figure-caption')).toContainText('Рисунок 3')
  await page.getByTestId('delete').click()
  await expect(a.getByTestId('figure-caption')).toContainText('Рисунок 1')
})

test('numbering continues on the next page and the prefix is configurable', async ({ page }) => {
  await openDashboard(page)
  const a = await chartAt(page, 0, 40, 100); await select(a); await page.getByTestId('cap-enable').check()
  await page.getByTestId('add-page').click()
  await page.getByTestId('panel-item').nth(1).dragTo(page.getByTestId('page-1'), { targetPosition: { x: 60 * PT, y: 60 * PT } })
  const b = page.getByTestId('page-1').getByTestId('el-chart'); await expect(b).toHaveCount(1)
  await select(b); await page.getByTestId('cap-enable').check()
  await expect(b.getByTestId('figure-caption')).toContainText('Рисунок 2')
  await leave(page)
  await page.getByTestId('cap-label').fill('Рис.')
  await expect(a.getByTestId('figure-caption')).toContainText('Рис. 1'); await expect(b.getByTestId('figure-caption')).toContainText('Рис. 2')
})

test('block: caption all / remove all, numbered in dashboard reading order', async ({ page }) => {
  await page.getByTestId('dashboard-item').first().locator('.title').click()
  await page.getByTestId('dash-as-block').click(); await page.getByTestId('bv-insert').click()
  await expect(page.getByTestId('el-chart')).toHaveCount(3)
  await page.getByTestId('el-chart').first().click({ position: { x: 12, y: 30 } })
  await page.getByTestId('cap-all').click()
  const caps = page.getByTestId('figure-caption')
  await expect(caps).toHaveCount(3)
  const texts = await caps.allTextContents()
  expect(texts.sort()).toEqual(['Рисунок 1 — CPU usage', 'Рисунок 2 — Memory', 'Рисунок 3 — Disk'])
  // CPU (0,0) is 1, Memory (right of it) is 2, Disk (below) is 3
  await expect(page.locator('[data-el-id]').filter({ has: page.getByText('Рисунок 3 — Disk') }).getByTestId('chart-img')).toBeVisible()
  await page.getByTestId('cap-none').click()
  await expect(caps).toHaveCount(0)
  await page.getByTestId('undo').click(); await expect(caps).toHaveCount(3)
})

test('images can be captioned too', async ({ page }) => {
  await page.getByTestId('image-input').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG })
  const img = page.getByTestId('el-image'); await expect(img).toHaveCount(1)
  await img.click(); await page.getByTestId('cap-enable').check()
  await page.getByTestId('cap-text').fill('Логотип')
  await expect(img.getByTestId('figure-caption')).toHaveText('Рисунок 1 — Логотип')
})

test('Word document: caption is a SEQ field with the right number, text, position; picture is shorter; Grafana is asked for the shorter picture', async ({ page, request }) => {
  await openDashboard(page)
  const a = await chartAt(page, 0, 40, 400), b = await chartAt(page, 1, 320, 100)
  await select(a); await page.getByTestId('cap-enable').check(); await page.getByTestId('cap-text').fill('Нижний график')
  await select(b); await page.getByTestId('cap-enable').check(); await page.getByTestId('cap-text').fill('Верхний & <главный>'); await page.getByTestId('cap-pos').selectOption('above')
  const ra = await elRect(a), rb = await elRect(b)
  await request.get('http://127.0.0.1:3100/__reset')
  const { xml } = await download(page, () => page.getByTestId('generate').click())
  const flat = xml.replace(/<w:instrText[^>]*>[^<]*<\/w:instrText>/g, '').replace(/<[^>]+>/g, '')
  expect(flat).toContain('Рисунок 1 — Верхний &amp; &lt;главный')                             // reading order: b first; & and < are escaped in the XML
  expect(flat).toContain('Рисунок 2 — Нижний график')
  expect(flat.indexOf('Рисунок 1')).toBeLessThan(flat.indexOf('Рисунок 2'))                  // SEQ order == document order
  expect(xml.match(/SEQ Рисунок \\\* ARABIC/g)).toHaveLength(2)
  expect(xml).toMatch(/w:fldCharType="begin"/); expect(xml).toMatch(/w:fldCharType="separate"/)
  // caption frames: a below (bottom 22pt of its box), b above (top 22pt)
  const fy = [...xml.matchAll(/<w:framePr[^>]*?w:h="440"[^>]*?w:y="(\d+)"/g)].map(m => Number(m[1]))
  expect(fy.some(y => Math.abs(y - (ra.y + ra.h - 22) * 20) <= 25)).toBe(true)
  expect(fy.some(y => Math.abs(y - rb.y * 20) <= 25)).toBe(true)
  // pictures are 22pt shorter
  const cy = [...xml.matchAll(/<wp:extent cx="\d+" cy="(\d+)"/g)].map(m => Number(m[1]))
  expect(cy.some(v => Math.abs(v - (ra.h - 22) * 12700) <= 12700)).toBe(true)
  const reqs = await grafanaRequests(request)
  const pa = reqs.find(q => q.panelId === '1')!
  expect(Number(pa.height)).toBe(Math.round((ra.h - 22) * 96 / 72 * 1.5))
})

test('captions survive save / reopen', async ({ page }) => {
  await openDashboard(page)
  const a = await chartAt(page, 0, 40, 100); await select(a); await page.getByTestId('cap-enable').check(); await page.getByTestId('cap-text').fill('Сохранённая')
  await leave(page); await page.getByTestId('cap-label').fill('Рис.')
  await page.getByTestId('save').click(); await expect(page.getByTestId('dirty')).not.toContainText('не сохранено')
  await page.reload()
  await page.getByTestId('open').click(); await page.getByTestId('template-open').first().click()
  await expect(page.getByTestId('figure-caption')).toHaveText('Рис. 1 — Сохранённая')
})
