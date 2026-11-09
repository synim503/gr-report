import { test, expect, Page, Locator } from '@playwright/test'
import { reset, open, openDashboard, dropOnPage, dropPanel, addText, elRect, grafanaRequests, PT, pageBox } from './helpers'

test.beforeEach(async ({ page, request }) => { await reset(request); await open(page) })

async function dragBy(page: Page, el: Locator, dxPt: number, dyPt: number, during?: () => Promise<void>) {
  const b = (await el.boundingBox())!
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + dxPt * PT, cy + dyPt * PT, { steps: 10 })
  if (during) await during()
  await page.mouse.up()
}
const topLeft = (el: Locator) => el.click({ position: { x: 10, y: 8 } })
const bottomRight = async (el: Locator) => { const bb = (await el.boundingBox())!; await el.click({ position: { x: bb.width - 8, y: bb.height - 6 } }) }
const near = (a: number, b: number, tol = 1.5) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThanOrEqual(tol)

test('drag a Grafana panel onto the page: positioned at the drop point, preview rendered with the token', async ({ page, request }) => {
  await openDashboard(page)
  await dropPanel(page, 0, 100, 200)
  const chart = page.getByTestId('el-chart')
  await expect(chart).toHaveCount(1)
  const r = await elRect(chart)
  near(r.x, 100); near(r.y, 200); expect(r.w).toBeGreaterThan(100)
  await expect(chart.getByTestId('chart-img')).toBeVisible()
  const nat = await chart.getByTestId('chart-img').evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight])
  expect(nat[0]).toBeGreaterThan(300)
  const reqs = await grafanaRequests(request)
  expect(reqs.some(q => q.panelId === '1' && q.theme === 'light' && q.from === 'now-6h')).toBe(true)
})

test('click on a panel adds it too; a broken dashboard shows a readable error inside the chart', async ({ page }) => {
  await openDashboard(page)
  await page.getByTestId('panel-item').nth(1).click()
  await expect(page.getByTestId('el-chart')).toHaveCount(1)
  await expect(page.getByTestId('chart-img')).toBeVisible()
  // the renderer returns HTML for this dashboard -> error is shown instead of a broken image
  const noRender = page.getByTestId('dashboard-item').nth(1)
  await noRender.locator('.title').click()
  await page.getByTestId('panel-item').first().click()
  await expect(page.getByTestId('chart-error').first()).toBeVisible()
})

test('move by dragging; snaps to page edge with a visible guide; Alt and the toggle disable snapping', async ({ page }) => {
  const t = await addText(page, 100, 300)
  const r0 = await elRect(t)
  await dragBy(page, t, 40, 30)
  let r = await elRect(t)
  near(r.x, r0.x + 40, 2); near(r.y, r0.y + 30, 2)

  // move so the left edge ends 4pt from the page edge -> snaps to 0 and shows the guide while dragging
  await dragBy(page, t, -(r.x - 2), 0, async () => { await expect(page.getByTestId('guide-v').first()).toBeVisible() })
  r = await elRect(t); expect(r.x).toBe(0)
  await expect(page.getByTestId('guide-v')).toHaveCount(0)    // guides disappear after drop

  // with Alt pressed nothing snaps
  await page.keyboard.down('Alt')
  await dragBy(page, t, 4, 0)
  await page.keyboard.up('Alt')
  r = await elRect(t); near(r.x, 4, 1)

  // toggle off in page settings
  await page.getByTestId('page-2') .count()
  await page.locator('[data-testid="page-0"]').click({ position: { x: 5, y: 5 } })   // deselect
  await page.getByTestId('snap-toggle').uncheck()
  await dragBy(page, t, -2, 0)
  r = await elRect(t); near(r.x, 2, 1)
})

test('snaps to centre of the page and to a neighbour\'s edges', async ({ page }) => {
  const a = await addText(page, 100, 100)
  const pw = 595.28
  const ra = await elRect(a)
  // centre the first block horizontally by dragging it near the centre
  await dragBy(page, a, (pw - ra.w) / 2 - ra.x + 3, 0, async () => { await expect(page.getByTestId('guide-v').first()).toBeVisible() })
  near((await elRect(a)).x, (pw - ra.w) / 2, 0.2)

  const b = await addText(page, 100, 400)
  const rb = await elRect(b)
  // aim b's top 3pt below a's top -> snaps to a's top edge (horizontal guide)
  const ra2 = await elRect(a)
  await dragBy(page, b, 0, ra2.y + 3 - rb.y, async () => { await expect(page.getByTestId('guide-h').first()).toBeVisible() })
  near((await elRect(b)).y, ra2.y, 0.2)
})

test('resize with handles: inspector reflects size, min size is enforced, edge snaps to page', async ({ page }) => {
  const t = await addText(page, 100, 100)
  await t.click()
  const r0 = await elRect(t)
  const se = page.getByTestId('handle-se')
  const hb = (await se.boundingBox())!
  const hx = hb.x + hb.width / 2, hy = hb.y + hb.height / 2
  await page.mouse.move(hx, hy); await page.mouse.down()
  await page.mouse.move(hx + 50 * PT, hy + 40 * PT, { steps: 8 }); await page.mouse.up()
  const r1 = await elRect(t)
  near(r1.w, r0.w + 50, 2); near(r1.h, r0.h + 40, 2); near(r1.x, r0.x, 0.1)
  await expect(page.getByTestId('ins-w')).toHaveValue(String(Math.round(r1.w * 10) / 10))

  // west handle drag far to the right -> min size 20, right edge stays
  const right = r1.x + r1.w
  const wh = (await page.getByTestId('handle-w').boundingBox())!
  const wx = wh.x + wh.width / 2, wy = wh.y + wh.height / 2
  await page.mouse.move(wx, wy); await page.mouse.down()
  await page.mouse.move(wx + 600 * PT, wy, { steps: 8 }); await page.mouse.up()
  const r2 = await elRect(t); near(r2.w, 20, 0.1); near(r2.x + r2.w, right, 0.5)

  // east handle toward the page edge snaps exactly to it
  const eh = (await page.getByTestId('handle-e').boundingBox())!
  const ex = eh.x + eh.width / 2, ey = eh.y + eh.height / 2
  await page.mouse.move(ex, ey); await page.mouse.down()
  await page.mouse.move(ex + (595.28 - (r2.x + r2.w) - 2) * PT, ey, { steps: 8 }); await page.mouse.up()
  const r3 = await elRect(t); near(r3.x + r3.w, 595.28, 0.05)
})

test('inspector numeric fields move/resize precisely', async ({ page }) => {
  const t = await addText(page, 100, 100)
  await t.click()
  await page.getByTestId('ins-x').fill('50'); await page.getByTestId('ins-y').fill('70')
  await page.getByTestId('ins-w').fill('300'); await page.getByTestId('ins-h').fill('90')
  expect(await elRect(t)).toEqual({ x: 50, y: 70, w: 300, h: 90 })
  await page.getByTestId('ins-x').fill('9999')        // clamped to the page
  const r = await elRect(t); near(r.x + r.w, 595.28, 0.1)
})

test('align a single element to the page (all six modes)', async ({ page }) => {
  const t = await addText(page, 100, 100); await t.click()
  const W = 595.28, H = 841.89
  const { w, h } = await elRect(t)
  for (const [mode, check] of [
    ['left', (r: any) => near(r.x, 0, 0.1)], ['hcenter', (r: any) => near(r.x, (W - w) / 2, 0.1)], ['right', (r: any) => near(r.x + r.w, W, 0.1)],
    ['top', (r: any) => near(r.y, 0, 0.1)], ['vmiddle', (r: any) => near(r.y, (H - h) / 2, 0.1)], ['bottom', (r: any) => near(r.y + r.h, H, 0.1)],
  ] as const) {
    await page.getByTestId(`align-${mode}`).click()
    check(await elRect(t))
  }
})

test('shift-click multi-select: align to selection bounds, distribute, group drag', async ({ page }) => {
  const a = await addText(page, 50, 100), b = await addText(page, 250, 180), c = await addText(page, 480, 140)
  // make sizes small so three fit in a row
  for (const el of [a, b, c]) { await el.click(); await page.getByTestId('ins-w').fill('60') }
  await a.click(); await b.click({ modifiers: ['Shift'] }); await c.click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('selection-box')).toBeVisible()
  await expect(page.getByTestId('dist-h')).toBeEnabled()

  await page.getByTestId('align-top').click()
  const top = Math.min(...(await Promise.all([a, b, c].map(async e => (await elRect(e)).y))))
  const ys = await Promise.all([a, b, c].map(async e => (await elRect(e)).y)); ys.forEach(y => near(y, top, 0.01))

  const before = await Promise.all([a, b, c].map(async e => (await elRect(e)).x))
  await page.getByTestId('dist-h').click()
  const xs = await Promise.all([a, b, c].map(async e => (await elRect(e)).x))
  near(xs[0], before[0], 0.01); near(xs[2], before[2], 0.01)                          // outer elements stay
  near(xs[1], (xs[0] + xs[2]) / 2, 0.01)                                               // same widths -> middle is centred

  // dragging moves the whole selection
  await dragBy(page, b, 0, 60)
  const ys2 = await Promise.all([a, b, c].map(async e => (await elRect(e)).y))
  ys2.forEach(y => near(y, top + 60, 2))
})

test('z-order, duplicate, delete, keyboard nudge, undo / redo', async ({ page }) => {
  const a = await addText(page, 50, 50), b = await addText(page, 70, 70)
  const z = async (e: Locator) => Number(await e.evaluate(n => (n as HTMLElement).style.zIndex))
  expect(await z(b)).toBeGreaterThan(await z(a))
  await topLeft(a); await page.getByTestId('z-front').click()
  expect(await z(a)).toBeGreaterThan(await z(b))
  await page.getByTestId('z-back').click()
  expect(await z(a)).toBeLessThan(await z(b))

  await page.getByTestId('duplicate').click()
  await expect(page.getByTestId('el-text')).toHaveCount(3)

  // arrows: 1pt, Shift = 10pt
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await topLeft(a)
  const r0 = await elRect(a)
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown')
  const r1 = await elRect(a); expect(r1.x).toBe(r0.x + 1); expect(r1.y).toBe(r0.y + 10)

  // undo restores, redo reapplies
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z')
  expect((await elRect(a)).x).toBe(r0.x)
  await page.keyboard.press('Control+y')
  expect((await elRect(a)).x).toBe(r0.x + 1)
  await page.getByTestId('undo').click()
  expect((await elRect(a)).x).toBe(r0.x)

  // delete via key, then undo brings it back
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('el-text')).toHaveCount(2)
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('el-text')).toHaveCount(3)
  await bottomRight(b); await page.getByTestId('delete').click()
  await expect(page.getByTestId('el-text')).toHaveCount(2)
})

test('a whole drag is one undo step', async ({ page }) => {
  const t = await addText(page, 100, 100)
  const r0 = await elRect(t)
  await dragBy(page, t, 80, 80)
  await page.getByTestId('undo').click()
  expect(await elRect(t)).toEqual(r0)
})

test('pages: add, drop onto the second page, delete; page size & orientation', async ({ page }) => {
  await page.getByTestId('add-page').click()
  await expect(page.getByTestId('page-1')).toBeVisible()
  await dropOnPage(page, page.getByTestId('add-text'), 80, 90, 1)
  await expect(page.getByTestId('page-1').getByTestId('el-text')).toHaveCount(1)
  await expect(page.getByTestId('page-0').getByTestId('el-text')).toHaveCount(0)

  await page.locator('[data-testid="page-0"]').click({ position: { x: 5, y: 5 } })
  const b0 = await pageBox(page, 0)
  expect(b0.width / b0.height).toBeCloseTo(595.28 / 841.89, 2)
  await page.getByTestId('page-size').selectOption('A3')
  const b1 = await pageBox(page, 0); expect(b1.width / b1.height).toBeCloseTo(841.89 / 1190.55, 2)
  await page.getByTestId('page-orient').selectOption('l')
  const b2 = await pageBox(page, 0); expect(b2.width).toBeGreaterThan(b2.height)

  await page.getByTestId('delete-page-1').click()
  await expect(page.getByTestId('page-1')).toHaveCount(0)
})

test('shrinking the page pulls elements back inside', async ({ page }) => {
  const t = await addText(page, 500, 700)
  await page.locator('[data-testid="page-0"]').click({ position: { x: 5, y: 5 } })
  await page.getByTestId('page-size').selectOption('A5')
  const r = await elRect(t)
  expect(r.x + r.w).toBeLessThanOrEqual(419.54); expect(r.y + r.h).toBeLessThanOrEqual(595.29)
})

test('zoom changes the canvas scale but not the geometry', async ({ page }) => {
  const t = await addText(page, 100, 100)
  const before = await pageBox(page)
  await page.getByTestId('zoom-in').click()
  const after = await pageBox(page)
  expect(after.width).toBeGreaterThan(before.width)
  const rr = await elRect(t); near(rr.x, 100); near(rr.y, 100)
  await expect(page.getByTestId('zoom')).toHaveText('135%')
})
