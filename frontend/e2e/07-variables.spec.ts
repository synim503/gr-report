import { test, expect, Page } from '@playwright/test'
import { reset, open, dropPanel, grafanaRequests, elRect } from './helpers'

test.beforeEach(async ({ page, request }) => { await reset(request); await open(page) })

const hosts = async (request: any, panel: string) => new Set((await grafanaRequests(request)).filter(q => q.panelId === panel).map(q => q['var-host']))
async function pick(page: Page, testid: string, value: string) {
  await page.getByTestId(`${testid}-menu`).click()
  await page.getByTestId(`${testid}-options`).getByTestId(`${testid}-opt`).filter({ hasText: new RegExp(`^${value}$`) }).click()
}

test('expanding a dashboard shows its variables right away, with the values known to Grafana', async ({ page }) => {
  await page.getByTestId('dashboard-item').first().locator('.title').click()
  const card = page.getByTestId('dash-vars')
  await expect(card).toBeVisible()
  await expect(page.getByTestId('sv-host')).toHaveValue('srv-default')
  await expect(page.getByTestId('sv-job')).toHaveValue('All')
  await expect(page.getByTestId('sv-ds')).toHaveCount(0)                               // datasource variables are not offered
  await page.getByTestId('sv-host-menu').click()
  await expect(page.getByTestId('sv-host-opt')).toHaveText(['srv-default', 'web-01', 'db-02'])
  await page.getByTestId('sv-host-opt').nth(1).click()
  await expect(page.getByTestId('sv-host')).toHaveValue('web-01')
  await expect(page.getByTestId('sv-host-options')).toHaveCount(0)                      // menu closes after picking
  await page.getByTestId('sv-host').fill('{{server}}')                                  // free text / report variables still work
  await expect(page.getByTestId('sv-host')).toHaveValue('{{server}}')
})

test('a panel dropped from the sidebar carries the chosen values; they show on the chart and can be changed', async ({ page, request }) => {
  await page.getByTestId('dashboard-item').first().locator('.title').click()
  await expect(page.getByTestId('dash-vars')).toBeVisible()
  await pick(page, 'sv-host', 'web-01')
  await expect(page.getByTestId('panel-item')).toHaveCount(3)
  await dropPanel(page, 0, 60, 80)
  const chart = page.getByTestId('el-chart')
  await expect(chart.getByTestId('var-badge')).toContainText('host web-01')
  await expect(chart.getByTestId('var-badge')).toContainText('job All')
  await expect.poll(async () => [...await hosts(request, '1')]).toContain('web-01')

  // the chart inspector lists the dashboard variables immediately; picking another value re-renders the chart
  await chart.click({ position: { x: 10, y: 20 } })
  await expect(page.getByTestId('cv-host')).toHaveValue('web-01')
  await expect(page.getByTestId('cv-job')).toHaveValue('All')
  await pick(page, 'cv-host', 'db-02')
  await expect(chart.getByTestId('var-badge')).toContainText('host db-02')
  await expect.poll(async () => [...await hosts(request, '1')]).toContain('db-02')
  // picking is one undo step
  await page.getByTestId('undo').click()
  await expect(chart.getByTestId('var-badge')).toContainText('host web-01')
})

test('whole dashboard as block is pre-filled with the sidebar values and offers the options in the dialog', async ({ page, request }) => {
  await page.getByTestId('dashboard-item').first().locator('.title').click()
  await pick(page, 'sv-host', 'db-02')
  await page.getByTestId('dash-as-block').click()
  await expect(page.getByTestId('bv-host')).toHaveValue('db-02')
  await pick(page, 'bv-host', 'web-01')
  await expect(page.getByTestId('bv-host')).toHaveValue('web-01')
  await page.getByTestId('bv-insert').click()
  await expect(page.getByTestId('el-chart')).toHaveCount(3)
  await expect(page.getByTestId('var-badge').first()).toContainText('host web-01')

  // block inspector: dashboard variables with options, changes apply to every chart of the block
  await page.getByTestId('el-chart').first().click()
  await expect(page.getByTestId('gv-host')).toHaveValue('web-01')
  await request.get('http://127.0.0.1:3100/__reset')
  await pick(page, 'gv-host', 'db-02')
  await expect(page.getByTestId('var-badge').nth(2)).toContainText('host db-02')
  for (const p of ['1', '2', '3']) await expect.poll(async () => (await hosts(request, p)).has('db-02')).toBe(true)
})

test('variable badges are editor-only and do not leak into the document', async ({ page }) => {
  await page.getByTestId('dashboard-item').first().locator('.title').click()
  await page.getByTestId('dash-as-block').click(); await page.getByTestId('bv-host').fill('SECRET-HOST'); await page.getByTestId('bv-insert').click()
  await expect(page.getByTestId('var-badge').first()).toContainText('SECRET-HOST')
  const { download } = await import('./helpers')
  const { xml } = await download(page, () => page.getByTestId('generate').click())
  expect(xml).not.toContain('SECRET-HOST')
})

test('a whole tall dashboard is laid out over several pages, not squeezed into one (regression)', async ({ page }) => {
  await page.getByTestId('dash-search').fill('tall')
  await expect(page.getByTestId('dashboard-item')).toHaveCount(1)
  await page.getByTestId('dashboard-item').first().locator('.title').click()
  await page.getByTestId('dash-as-block').click()
  await page.getByTestId('bv-insert').click()
  await expect(page.getByTestId('page-3')).toBeVisible()                               // 40 panels → 4 pages
  await expect(page.getByTestId('el-chart')).toHaveCount(40)
  const size = await page.getByTestId('el-chart').evaluateAll(n => n.map(e => [parseFloat((e as HTMLElement).style.width), parseFloat((e as HTMLElement).style.height)]))
  for (const [w, h] of size) { expect(w).toBeGreaterThan(250); expect(h).toBeGreaterThan(100) }   // full-size charts, no shrinking
  for (let i = 0; i < 4; i++) {
    const els = page.getByTestId(`page-${i}`).getByTestId('el-chart')
    expect(await els.count()).toBeGreaterThan(5)
    const r = await Promise.all((await els.all()).map(elRect))
    expect(Math.min(...r.map(x => x.y))).toBeGreaterThanOrEqual(35.9)
    expect(Math.max(...r.map(x => x.y + x.h))).toBeLessThanOrEqual(841.89 - 35.9)
    expect(Math.max(...r.map(x => x.x + x.w))).toBeLessThanOrEqual(595.28)
    expect(Math.min(...r.map(x => x.x))).toBeGreaterThanOrEqual(0)
  }
})
