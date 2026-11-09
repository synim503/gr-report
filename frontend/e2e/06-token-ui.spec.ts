import { test, expect } from '@playwright/test'
import { reset, open, API, GRAFANA, TOKEN } from './helpers'

test.beforeEach(async ({ request }) => { await reset(request) })

async function unconfigured(request: any) { await request.put(`${API}/api/settings`, { data: { grafanaUrl: '', token: '' } }) }

test('first run: onboarding card connects Grafana with a token entered in the UI', async ({ page, request }) => {
  await unconfigured(request)
  await page.goto('/')
  const card = page.getByTestId('onboarding')
  await expect(card).toBeVisible()
  await expect(page.getByTestId('topbar-conn')).toContainText('не подключена')
  await expect(page.getByTestId('ob-connect')).toBeDisabled()               // needs url + token

  await page.getByTestId('ob-url').fill(GRAFANA)
  await page.getByTestId('ob-token').fill('wrong')
  await page.getByTestId('ob-connect').click()
  await expect(page.getByTestId('ob-result')).toContainText('Token rejected')
  await expect(card).toBeVisible()                                           // not saved on failure
  expect((await (await request.get(`${API}/api/settings`)).json()).tokenSet).toBe(false)

  await page.getByTestId('ob-token').fill(TOKEN)
  await page.getByTestId('ob-connect').click()
  await expect(card).toBeHidden()
  await expect(page.getByTestId('toast-info')).toContainText('Grafana подключена')
  await expect(page.getByTestId('topbar-conn')).toContainText('127.0.0.1:3100')
  await expect(page.getByTestId('dashboard-item')).toHaveCount(2)            // dashboards load right away
  const s = await (await request.get(`${API}/api/settings`)).text()
  expect(s).toContain('"tokenSet":true'); expect(s).not.toContain(TOKEN)     // token stored server-side only
})

test('onboarding: unreachable host offers "save without checking"', async ({ page, request }) => {
  await unconfigured(request)
  await page.goto('/')
  await page.getByTestId('ob-url').fill('http://127.0.0.1:1'); await page.getByTestId('ob-token').fill('abc')
  await page.getByTestId('ob-connect').click()
  await expect(page.getByTestId('ob-result')).toContainText('not reachable')
  await page.getByTestId('ob-force').click()
  await expect(page.getByTestId('onboarding')).toBeHidden()
  expect((await (await request.get(`${API}/api/settings`)).json()).grafanaUrl).toBe('http://127.0.0.1:1')
})

test('token field can be revealed and hidden', async ({ page, request }) => {
  await unconfigured(request)
  await page.goto('/')
  const f = page.getByTestId('ob-token'); await f.fill('glsa_secret')
  await expect(f).toHaveAttribute('type', 'password')
  await page.getByTestId('ob-token-toggle').click(); await expect(f).toHaveAttribute('type', 'text')
  await page.getByTestId('ob-token-toggle').click(); await expect(f).toHaveAttribute('type', 'password')
})

test('settings dialog: replace the token, and delete the saved token', async ({ page, request }) => {
  await open(page)
  await page.getByTestId('topbar-conn').click()                               // opened from the top bar pill
  await expect(page.getByTestId('settings-dialog')).toBeVisible()
  await expect(page.getByTestId('set-clear')).toBeVisible()
  await page.getByTestId('set-token').fill('new-bad-token'); await page.getByTestId('set-test').click()
  await expect(page.getByTestId('test-result')).toContainText('Token rejected')
  await page.getByTestId('set-token').fill(TOKEN); await page.getByTestId('set-save').click()
  await expect(page.getByTestId('settings-dialog')).toBeHidden()
  await expect(page.getByTestId('dashboard-item')).toHaveCount(2)

  await page.getByTestId('open-settings').click()
  await page.getByTestId('set-clear').click()
  await expect(page.getByTestId('settings-dialog')).toBeHidden()
  expect((await (await request.get(`${API}/api/settings`)).json()).tokenSet).toBe(false)
  await expect(page.getByTestId('onboarding')).toBeVisible()                 // back to the connect card
  await expect(page.getByTestId('dashboard-item')).toHaveCount(0)
})

test('theme toggle switches light / dark and is remembered', async ({ page }) => {
  await open(page)
  const html = page.locator('html')
  const start = await html.getAttribute('data-theme')
  await page.getByTestId('theme-toggle').click()
  const flipped = start === 'dark' ? 'light' : 'dark'
  await expect(html).toHaveAttribute('data-theme', flipped)
  await page.reload(); await expect(html).toHaveAttribute('data-theme', flipped)
  await page.getByTestId('theme-toggle').click(); await expect(html).toHaveAttribute('data-theme', start!)
  // the document page itself always stays white (it mirrors the printed result)
  await page.getByTestId('theme-toggle').click()
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  expect(await page.getByTestId('page-0').evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgb(255, 255, 255)')
})

test('empty page shows a hint that disappears once something is added', async ({ page }) => {
  await open(page)
  await expect(page.getByTestId('empty-hint')).toBeVisible()
  await page.getByTestId('add-text').click()
  await expect(page.getByTestId('empty-hint')).toHaveCount(0)
})
