import { test, expect, Page } from '@playwright/test'
import { reset, open, elRect, grafanaRequests, API, PT } from './helpers'

test.beforeEach(async ({ page, request }) => { await reset(request); await open(page) })

const near = (a: number, b: number, tol = 1) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThanOrEqual(tol)

async function insertDashboardBlock(page: Page, host: string, saveToLibrary = false) {
  await page.getByTestId('dashboard-item').first().locator('.title').click()
  await page.getByTestId('dash-as-block').click()
  await expect(page.getByTestId('insert-block-dialog')).toBeVisible()
  await page.getByTestId('bv-host').fill(host)
  if (saveToLibrary) await page.getByTestId('bv-save').check()
  await page.getByTestId('bv-insert').click()
  await expect(page.getByTestId('insert-block-dialog')).toBeHidden()
}
const hostsRequested = async (request: any) => {
  const reqs = await grafanaRequests(request)
  const by: Record<string, Set<string>> = {}
  for (const q of reqs) (by[q.panelId] ??= new Set()).add(q['var-host'])
  return by
}

test('whole dashboard becomes a block: all panels, dashboard layout, variables with defaults', async ({ page, request }) => {
  await page.getByTestId('dashboard-item').first().locator('.title').click()
  await page.getByTestId('dash-as-block').click()
  const dlg = page.getByTestId('insert-block-dialog')
  await expect(dlg).toContainText('3 граф.')
  await expect(page.getByTestId('bv-host')).toHaveValue('srv-default')      // default taken from the dashboard
  await expect(page.getByTestId('bv-job')).toHaveValue('All')
  await expect(dlg.locator('label', { hasText: 'Host' })).toBeVisible()      // dashboard label is used
  await expect(page.getByTestId('bv-ds')).toHaveCount(0)                     // datasource variable is not offered
  await page.getByTestId('bv-host').fill('web-01')
  await page.getByTestId('bv-insert').click()

  const charts = page.getByTestId('el-chart')
  await expect(charts).toHaveCount(3)
  const r = await Promise.all([0, 1, 2].map(i => elRect(charts.nth(i))))
  // layout mirrors the dashboard grid: panel 2 is half a page-width to the right, panel 3 is one grid block (8 rows) lower
  near(r[1].x - r[0].x, 12 / 24 * 523, 0.5); near(r[1].y, r[0].y, 0.1); near(r[2].y - r[0].y, 8 * (523 / 24) * 0.76, 0.5)
  near(r[0].w, 261.5, 0.5)
  const groups = await charts.evaluateAll(n => n.map(e => e.getAttribute('data-group')))
  expect(new Set(groups).size).toBe(1); expect(groups[0]).toBeTruthy()

  // every chart preview asked Grafana with var-host=web-01 (and the other block variables)
  await expect.poll(async () => Object.keys(await hostsRequested(request)).length).toBe(3)
  const reqs = await grafanaRequests(request)
  for (const q of reqs) { expect(q['var-host']).toBe('web-01'); expect(q['var-job']).toBe('All'); expect(q['var-ds']).toBeUndefined() }
})

test('clicking one chart selects the whole block; Ctrl+click picks a single chart; drag moves the block', async ({ page }) => {
  await insertDashboardBlock(page, 'web-01')
  const charts = page.getByTestId('el-chart')
  await expect(page.getByTestId('chart-img')).toHaveCount(3)
  await charts.nth(1).click()
  await expect(page.getByTestId('selection-box')).toBeVisible()
  await expect(page.getByTestId('inspector')).toContainText('Блок «CPU Overview»')
  await expect(page.getByTestId('gv-host')).toHaveValue('web-01')

  const before = await Promise.all([0, 1, 2].map(i => elRect(charts.nth(i))))
  const b = (await charts.nth(1).boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + 30 * PT, b.y + b.height / 2 + 90 * PT, { steps: 10 }); await page.mouse.up()
  const after = await Promise.all([0, 1, 2].map(i => elRect(charts.nth(i))))
  const d = after.map((a, i) => [a.x - before[i].x, a.y - before[i].y])
  d.forEach(([dx, dy]) => { near(dx, d[0][0], 0.01); near(dy, d[0][1], 0.01) })    // the whole block moved by the same offset
  expect(d[0][1]).toBeGreaterThan(50)

  await charts.nth(0).click({ modifiers: ['Control'] })                           // single member
  await expect(page.getByTestId('selection-box')).toHaveCount(0)
  await expect(page.getByTestId('inspector')).toContainText('График')
})

test('editing a block variable re-queries Grafana for every chart of that block only', async ({ page, request }) => {
  await insertDashboardBlock(page, 'web-01')
  await expect(page.getByTestId('chart-img')).toHaveCount(3)
  await page.getByTestId('el-chart').first().click()
  await request.get('http://127.0.0.1:3100/__reset')
  await page.getByTestId('gv-host').fill('db-02')
  await expect.poll(async () => { const h = await hostsRequested(request); return ['1', '2', '3'].every(p => h[p]?.has('db-02')) }).toBe(true)
  const reqs = await grafanaRequests(request)
  expect(reqs.every(q => q['var-host'] !== 'web-01' || q.panelId === undefined)).toBe(true)

  // a new variable can be added to the block and goes to Grafana as var-NAME
  await request.get('http://127.0.0.1:3100/__reset')
  await page.getByTestId('gv-new-name').fill('region'); await page.getByTestId('gv-add').click()
  await page.getByTestId('gv-region').fill('eu')
  await expect.poll(async () => (await grafanaRequests(request)).some(q => q['var-region'] === 'eu')).toBe(true)
})

test('block is saved to the library, can be dragged onto the page again with other values', async ({ page, request }) => {
  await insertDashboardBlock(page, 'web-01', true)
  const item = page.getByTestId('block-item')
  await expect(item).toHaveCount(1)
  await expect(item).toContainText('CPU Overview'); await expect(item).toContainText('3 граф.'); await expect(item).toContainText('host, job')
  const stored = await (await request.get(`${API}/api/blocks`)).json()
  expect(stored[0].charts).toHaveLength(3); expect(stored[0].variables.map((v: any) => v.name)).toEqual(['host', 'job'])

  await item.dragTo(page.getByTestId('page-0'), { targetPosition: { x: 40, y: 500 * PT } })
  await expect(page.getByTestId('insert-block-dialog')).toBeVisible()
  await expect(page.getByTestId('bv-host')).toHaveValue('srv-default')               // library defaults
  await page.getByTestId('bv-host').fill('db-02'); await page.getByTestId('bv-insert').click()
  await expect(page.getByTestId('el-chart')).toHaveCount(6)
  const groups = await page.getByTestId('el-chart').evaluateAll(n => n.map(e => e.getAttribute('data-group')))
  expect(new Set(groups).size).toBe(2)
  const second = page.getByTestId('el-chart').nth(3); expect((await elRect(second)).y).toBeGreaterThan(400)

  await expect.poll(async () => { const h = await hostsRequested(request); return h['1']?.has('web-01') && h['1']?.has('db-02') }).toBe(true)
  // cancelling does nothing
  await item.click(); await page.getByTestId('insert-block-dialog').getByText('Отмена').click()
  await expect(page.getByTestId('el-chart')).toHaveCount(6)
})

test('selected charts can be saved as a block; mixed or empty selections are rejected', async ({ page, request }) => {
  await insertDashboardBlock(page, 'web-01')
  await expect(page.getByTestId('chart-img')).toHaveCount(3)
  // ungroup, then pick two charts, save as a new block
  await page.getByTestId('el-chart').first().click()
  await page.getByTestId('ungroup').click()
  await expect(page.getByTestId('el-chart').first()).not.toHaveAttribute('data-group', /.+/)
  await page.getByTestId('el-chart').nth(0).click(); await page.getByTestId('el-chart').nth(1).click({ modifiers: ['Shift'] })
  await page.getByTestId('save-block').click()
  await page.getByTestId('block-name').fill('CPU + Memory')
  await page.getByTestId('block-save').click()
  await expect(page.getByTestId('block-item')).toContainText('CPU + Memory')
  const blocks = await (await request.get(`${API}/api/blocks`)).json()
  const b = blocks.find((x: any) => x.name === 'CPU + Memory')
  expect(b.charts).toHaveLength(2); expect(b.dashboardUid).toBe('abc')
  near(b.charts[1].x, 261.5, 0.6); expect(b.charts[0].x).toBe(0); expect(b.charts[0].y).toBe(0)
  expect(b.variables.map((v: any) => [v.name, v.defaultValue])).toEqual([['host', 'web-01'], ['job', 'All']])   // current values become defaults

  // a single ungrouped chart exposes per-chart variables
  await page.getByTestId('el-chart').nth(2).click()
  await page.getByTestId('cv-new').fill('instance'); await page.getByTestId('cv-add').click()
  await page.getByTestId('cv-instance').fill('10.0.0.5:9100')
  await expect.poll(async () => (await grafanaRequests(request)).some(q => q['var-instance'] === '10.0.0.5:9100' && q.panelId === '3')).toBe(true)
})

test('block variable may reference a report variable; changing it updates the charts', async ({ page, request }) => {
  await page.locator('[data-testid="page-0"]').click({ position: { x: 4, y: 4 } })
  await page.getByTestId('rv-new').fill('server'); await page.getByTestId('rv-add').click()
  await page.getByTestId('rv-server').fill('app-9')
  await insertDashboardBlock(page, '{{server}}')
  await expect.poll(async () => (await hostsRequested(request))['1']?.has('app-9')).toBe(true)
  await page.locator('[data-testid="page-0"]').click({ position: { x: 4, y: 4 } })
  await request.get('http://127.0.0.1:3100/__reset')
  await page.getByTestId('rv-server').fill('app-10')
  await expect.poll(async () => (await hostsRequested(request))['1']?.has('app-10')).toBe(true)
  // removing the report variable
  await page.getByTestId('rv-del-server').click()
  await expect(page.getByTestId('rv-server')).toHaveCount(0)
})

test('library blocks can be deleted', async ({ page, request }) => {
  await insertDashboardBlock(page, 'x', true)
  await expect(page.getByTestId('block-item')).toHaveCount(1)
  await page.getByTestId('block-delete').click()
  await expect(page.getByTestId('block-item')).toHaveCount(0)
  expect((await (await request.get(`${API}/api/blocks`)).json())).toHaveLength(0)
})

test('undo removes an inserted block in one step', async ({ page }) => {
  await insertDashboardBlock(page, 'web-01')
  await expect(page.getByTestId('el-chart')).toHaveCount(3)
  await page.getByTestId('undo').click()
  await expect(page.getByTestId('el-chart')).toHaveCount(0)
})

test('aligning / positioning a block treats it as one unit and keeps its internal layout', async ({ page }) => {
  await insertDashboardBlock(page, 'web-01')
  const charts = page.getByTestId('el-chart')
  await expect(page.getByTestId('chart-img')).toHaveCount(3)
  await charts.first().click()
  const rel = async () => { const r = await Promise.all([0, 1, 2].map(i => elRect(charts.nth(i)))); return r.map(x => [x.x - r[0].x, x.y - r[0].y]) }
  const layout0 = await rel()

  await page.getByTestId('align-hcenter').click()
  const r = await Promise.all([0, 1, 2].map(i => elRect(charts.nth(i))))
  const left = Math.min(...r.map(x => x.x)), right = Math.max(...r.map(x => x.x + x.w))
  near(left + (right - left) / 2, 595.28 / 2, 0.2)                    // centred on the page as a whole
  expect(await rel()).toEqual(layout0)                                // …and the layout inside the block is untouched

  await page.getByTestId('align-bottom').click()
  const r2 = await Promise.all([0, 1, 2].map(i => elRect(charts.nth(i))))
  near(Math.max(...r2.map(x => x.y + x.h)), 841.89, 0.2)
  expect(await rel()).toEqual(layout0)

  await page.getByTestId('ins-x').fill('50'); await page.getByTestId('ins-y').fill('60')
  const r3 = await Promise.all([0, 1, 2].map(i => elRect(charts.nth(i))))
  near(Math.min(...r3.map(x => x.x)), 50, 0.01); near(Math.min(...r3.map(x => x.y)), 60, 0.01)
  expect(await rel()).toEqual(layout0)
})
