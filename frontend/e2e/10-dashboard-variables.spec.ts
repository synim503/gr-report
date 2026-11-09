import { test, expect, Page } from '@playwright/test'
import { reset, open, elRect } from './helpers'

test.beforeEach(async ({ page, request }) => { await reset(request); await open(page) })

async function openNodeExporter(page: Page) {
  await page.getByTestId('dash-search').fill('node')
  await expect(page.getByTestId('dashboard-item')).toHaveCount(1)
  await page.getByTestId('dashboard-item').first().locator('.title').click()
  await expect(page.getByTestId('dash-vars')).toBeVisible()
}
async function opts(page: Page, id: string) {
  await page.getByTestId(`${id}-menu`).click()
  await expect(page.getByTestId(`${id}-options`)).toBeVisible()
  await expect(page.getByTestId(`${id}-options`).getByText('Загрузка из Grafana')).toHaveCount(0)
  const list = await page.getByTestId(`${id}-opt`).allTextContents()
  return list
}

test('query variables get a dropdown with values loaded from Grafana; chained variables follow their parent', async ({ page }) => {
  await openNodeExporter(page)
  // datasource variable is hidden, the others are listed; JSON of the dashboard has NO options for job / nodename
  await expect(page.getByTestId('sv-ds')).toHaveCount(0)
  for (const v of ['job', 'nodename', 'logs', 'env']) await expect(page.getByTestId(`sv-${v}`)).toBeVisible()
  await expect(page.getByTestId('sv-job')).toHaveValue('node')
  expect(await opts(page, 'sv-job')).toEqual(['app', 'node'])
  await page.getByTestId('sv-job-opt').first().click()                       // job = app
  await expect(page.getByTestId('sv-job')).toHaveValue('app')
  expect(await opts(page, 'sv-nodename')).toEqual(['All', 'app1'])            // depends on $job
  await page.getByTestId('sv-nodename-opt').nth(1).click()
  await expect(page.getByTestId('sv-nodename')).toHaveValue('app1')
  await page.getByTestId('sv-job').fill('node')
  expect(await opts(page, 'sv-nodename')).toEqual(['All', 'srv1', 'srv2'])   // sorted, with "All"
  await page.getByTestId('sv-nodename-opt').first().click(); await expect(page.getByTestId('sv-nodename')).toHaveValue('All')
  // custom variable: values from the dashboard JSON
  expect(await opts(page, 'sv-env')).toEqual(['prod', 'stage'])
  await page.getByTestId('sv-env-opt').nth(1).click(); await expect(page.getByTestId('sv-env')).toHaveValue('stage')
})

test('unsupported datasource: the dropdown explains it, manual entry still works', async ({ page }) => {
  await openNodeExporter(page)
  await page.getByTestId('sv-logs-menu').click()
  await expect(page.getByTestId('sv-logs-error')).toContainText('loki')
  await expect(page.getByTestId('sv-logs-error')).toContainText('manually')
  await page.getByTestId('sv-logs').fill('my-app')
  await expect(page.getByTestId('sv-logs')).toHaveValue('my-app')
})

test('a dashboard with collapsed rows becomes a clean layout: no overlaps, rows expanded in order', async ({ page }) => {
  await openNodeExporter(page)
  await page.getByTestId('dash-as-block').click()
  await expect(page.getByTestId('insert-block-dialog')).toBeVisible()
  // the insert dialog offers the Grafana values for query variables too
  await page.getByTestId('bv-nodename-menu').click()
  await expect(page.getByTestId('bv-nodename-opt')).toHaveText(['All', 'srv1', 'srv2'])
  await page.getByTestId('bv-nodename-opt').nth(1).click()
  await expect(page.getByTestId('bv-nodename')).toHaveValue('srv1')
  await page.getByTestId('bv-insert').click()
  const charts = page.getByTestId('el-chart'); await expect(charts).toHaveCount(6)
  const r = await Promise.all([0, 1, 2, 3, 4, 5].map(i => elRect(charts.nth(i))))   // A B | C D | E | F (collapsed row children C, D are expanded)
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
    const a = r[i], b = r[j]
    const overlap = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5
    expect(overlap, `chart ${i} overlaps chart ${j}`).toBe(false)
  }
  const [A, B, C, D, E, F] = r
  expect(Math.abs(A.y - B.y)).toBeLessThan(0.2)                              // stat panels share the top row
  expect(C.y).toBeGreaterThanOrEqual(A.y + A.h - 0.5); expect(Math.abs(C.y - D.y)).toBeLessThan(0.2)
  expect(E.y).toBeGreaterThanOrEqual(C.y + C.h - 0.5)                        // E was beside the collapsed row; now below its children
  expect(F.y).toBeGreaterThanOrEqual(E.y + E.h - 0.5)
  // small stat panels show a compact variable counter instead of a wall of chips
  await expect(charts.nth(0).getByTestId('var-badge')).toHaveClass(/mini/)
  await expect(charts.nth(4).getByTestId('var-badge')).not.toHaveClass(/mini/)
  expect(await charts.nth(4).getByTestId('var-badge').evaluate(n => n.getBoundingClientRect().height)).toBeLessThan(25)   // one compact line
})
