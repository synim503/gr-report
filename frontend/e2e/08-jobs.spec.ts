import { test, expect } from '@playwright/test'
import { reset, open, API, GRAFANA, slowTemplate, openFirstTemplate, maxInflight, download, addText } from './helpers'

const openJobs = async (page: any) => { if (!(await page.getByTestId('jobs-panel').isVisible())) await page.getByTestId('jobs-btn').click() }   // clicking elsewhere closes it

test.beforeEach(async ({ page, request }) => { await reset(request); await open(page) })

test('settings: parallelism is validated, saved and shown again', async ({ page, request }) => {
  await page.getByTestId('open-settings').click()
  await expect(page.getByTestId('set-parallel')).toHaveValue('4')
  await page.getByTestId('set-parallel').fill('0')
  await expect(page.getByTestId('par-error')).toBeVisible(); await expect(page.getByTestId('set-save')).toBeDisabled()
  await page.getByTestId('set-parallel').fill('17'); await expect(page.getByTestId('set-save')).toBeDisabled()
  await page.getByTestId('set-parallel').fill('2.5'); await expect(page.getByTestId('set-save')).toBeDisabled()
  await page.getByTestId('set-parallel').fill('2')
  await expect(page.getByTestId('par-error')).toHaveCount(0)
  await page.getByTestId('set-save').click(); await expect(page.getByTestId('settings-dialog')).toBeHidden()
  expect((await (await request.get(`${API}/api/settings`)).json()).parallelism).toBe(2)
  await page.getByTestId('open-settings').click()
  await expect(page.getByTestId('set-parallel')).toHaveValue('2')
  // the token was not touched by saving the other fields
  expect((await (await request.get(`${API}/api/settings`)).json()).tokenSet).toBe(true)
})

test('the parallelism setting really limits concurrent chart renders', async ({ page, request }) => {
  await slowTemplate(request, 6); await openFirstTemplate(page)
  await page.getByTestId('open-settings').click(); await page.getByTestId('set-parallel').fill('2'); await page.getByTestId('set-save').click()
  await request.get(`${GRAFANA}/__reset`)
  let t0 = Date.now()
  await download(page, () => page.getByTestId('generate').click())
  const slow = Date.now() - t0
  expect(await maxInflight(request)).toBe(2)

  await page.getByTestId('open-settings').click(); await page.getByTestId('set-parallel').fill('6'); await page.getByTestId('set-save').click()
  await request.get(`${GRAFANA}/__reset`)
  t0 = Date.now()
  await download(page, () => page.getByTestId('generate').click())
  const fast = Date.now() - t0
  expect(await maxInflight(request)).toBe(6)
  expect(fast).toBeLessThan(slow - 600)                                       // 6 at once is clearly quicker than 2 at a time
})

test('active tasks: progress is shown and a running build can be cancelled', async ({ page, request }) => {
  await request.put(`${API}/api/settings`, { data: { parallelism: 1 } })
  await slowTemplate(request, 8, 'Cancel me'); await openFirstTemplate(page)
  let downloaded = false; page.on('download', () => { downloaded = true })
  await expect(page.getByTestId('jobs-count')).toHaveCount(0)
  await page.getByTestId('generate').click()
  await expect(page.getByTestId('jobs-count')).toHaveText('1')                // badge in the top bar
  await page.getByTestId('jobs-btn').click()
  const job = page.getByTestId('job-item')
  await expect(job).toHaveCount(1)
  await expect(job).toContainText('Cancel me')
  await expect(job.getByTestId('job-state')).toHaveText('Выполняется')
  await expect(job.getByTestId('job-counter')).toHaveText(/^[1-7] \/ 8 графиков/, { timeout: 6000 })   // progress advances
  await expect(job.getByTestId('job-download')).toHaveCount(0)

  await request.get(`${GRAFANA}/__reset`)
  await job.getByTestId('job-cancel').click()
  await expect(job.getByTestId('job-state')).toHaveText('Отменена')
  await expect(page.getByTestId('jobs-count')).toHaveCount(0)
  await expect(page.getByTestId('toast-info').filter({ hasText: 'Задача отменена' })).toBeVisible()
  // Grafana stops being asked for charts, and nothing is downloaded
  await page.waitForTimeout(1500)
  const sent = (await (await request.get(`${GRAFANA}/__requests`)).json()).length
  await page.waitForTimeout(1500)
  expect((await (await request.get(`${GRAFANA}/__requests`)).json()).length).toBe(sent)
  expect(downloaded).toBe(false)
  // cancelled entries can be removed
  await job.getByTestId('job-remove').click()
  await expect(page.getByTestId('job-item')).toHaveCount(0); await expect(page.getByTestId('jobs-empty')).toBeVisible()
})

test('finished builds stay in the list: download again, remove, clear', async ({ page }) => {
  await addText(page, 60, 60)
  const first = await download(page, () => page.getByTestId('generate').click())
  expect(first.xml).toContain('<w:body>')
  await page.getByTestId('jobs-btn').click()
  const job = page.getByTestId('job-item').first()
  await expect(job.getByTestId('job-state')).toHaveText('Готово')
  await expect(job.getByTestId('job-counter')).toHaveText('без графиков')
  await expect(job.getByTestId('job-progress').locator('i')).toHaveCSS('width', /^[1-9]/)
  const again = await download(page, () => job.getByTestId('job-download').click())
  expect(again.xml).toContain('<w:body>')

  await page.getByTestId('generate').click()                                   // a second one (this click closes the panel)
  await openJobs(page)
  await expect(page.getByTestId('job-item')).toHaveCount(2)
  await expect(page.getByTestId('job-state')).toHaveText(['Готово', 'Готово'])   // "clear" only removes finished builds
  await page.getByTestId('jobs-clear').click()
  await expect(page.getByTestId('job-item')).toHaveCount(0)
})

test('two builds run side by side; cancelling one does not affect the other', async ({ page, request }) => {
  await request.put(`${API}/api/settings`, { data: { parallelism: 2 } })
  await slowTemplate(request, 4, 'Parallel jobs'); await openFirstTemplate(page)
  await page.getByTestId('generate').click(); await page.getByTestId('generate').click()
  await expect(page.getByTestId('jobs-count')).toHaveText('2')
  await openJobs(page)
  await expect(page.getByTestId('job-item')).toHaveCount(2)
  const dl = page.waitForEvent('download')
  await page.getByTestId('job-item').nth(0).getByTestId('job-cancel').click()    // newest first = the second job
  await expect(page.getByTestId('jobs-count')).toHaveText('1')
  await dl                                                                       // the remaining build still completes and downloads
  await expect(page.getByTestId('jobs-count')).toHaveCount(0)
  const states = await page.getByTestId('job-state').allTextContents()
  expect(states.sort()).toEqual(['Готово', 'Отменена'])
})

test('a failed build shows the reason in the list and as a toast', async ({ page }) => {
  const job = { id: 'x1', name: 'Broken', state: 'FAILED', done: 1, total: 3, startedAt: Date.now() - 5000, finishedAt: Date.now(), error: 'Grafana: unauthorized (check the token)', warnings: [] }
  await page.route('**/api/reports/jobs*', r => r.request().method() === 'POST'
    ? r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ...job, state: 'RUNNING', finishedAt: undefined, error: undefined }) })
    : r.fulfill({ contentType: 'application/json', body: JSON.stringify([job]) }))
  await page.getByTestId('generate').click()
  await expect(page.getByTestId('toast-err')).toContainText('Grafana: unauthorized')
  await page.getByTestId('jobs-btn').click()
  await expect(page.getByTestId('job-state')).toHaveText('Ошибка')
  await expect(page.getByTestId('job-error')).toContainText('unauthorized')
  await expect(page.getByTestId('job-counter')).toHaveText('1 / 3 графиков')
})

test('panel closes on outside click; jobs started elsewhere are listed but not auto-downloaded', async ({ page, request }) => {
  await request.post(`${API}/api/reports/jobs`, { data: { name: 'From another tab', pageWidth: 595.28, pageHeight: 841.89, timeRange: { from: 'now-6h', to: 'now' }, variables: {}, pages: [{ elements: [] }] } })
  await page.reload()
  let downloaded = false; page.on('download', () => { downloaded = true })
  await page.getByTestId('jobs-btn').click()
  await expect(page.getByTestId('job-item')).toContainText('From another tab')
  await page.waitForTimeout(800); expect(downloaded).toBe(false)
  await page.locator('.canvas').click({ position: { x: 5, y: 5 } })
  await expect(page.getByTestId('jobs-panel')).toBeHidden()
})
