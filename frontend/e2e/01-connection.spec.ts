import { test, expect } from '@playwright/test'
import { reset, open, openDashboard, GRAFANA } from './helpers'

test.beforeEach(async ({ request }) => { await reset(request) })

test('settings dialog: wrong token fails, right token passes, token is never shown back', async ({ page }) => {
  await open(page)
  await page.getByTestId('open-settings').click()
  await expect(page.getByTestId('set-url')).toHaveValue(GRAFANA)
  await expect(page.getByTestId('set-token')).toHaveValue('')
  await expect(page.getByTestId('set-token')).toHaveAttribute('placeholder', /••••oken/)

  await page.getByTestId('set-token').fill('wrong-token')
  await page.getByTestId('set-test').click()
  await expect(page.getByTestId('test-result')).toContainText('Token rejected')
  await expect(page.getByTestId('test-result')).toHaveClass(/bad/)

  await page.getByTestId('set-token').fill('glsa_test_token')
  await page.getByTestId('set-test').click()
  await expect(page.getByTestId('test-result')).toContainText('Подключено: Grafana 10.4.0')
  await expect(page.getByTestId('test-result')).toHaveClass(/ok/)

  await page.getByTestId('set-save').click()
  await expect(page.getByTestId('settings-dialog')).toBeHidden()
  // after saving, the stored token still is not exposed by the API
  const body = await (await page.request.get('http://127.0.0.1:8090/api/settings')).text()
  expect(body).not.toContain('glsa_test_token')
})

test('unreachable Grafana URL gives a readable error', async ({ page }) => {
  await open(page)
  await page.getByTestId('open-settings').click()
  await page.getByTestId('set-url').fill('http://127.0.0.1:1')
  await page.getByTestId('set-test').click()
  await expect(page.getByTestId('test-result')).toContainText('not reachable')
})

test('dashboards list, search and panels', async ({ page }) => {
  await open(page)
  await expect(page.getByTestId('dashboard-item')).toHaveCount(2)
  await page.getByTestId('dash-search').fill('cpu')
  await expect(page.getByTestId('dashboard-item')).toHaveCount(1)
  await expect(page.getByTestId('dashboard-item')).toContainText('CPU Overview')
  await openDashboard(page)
  await expect(page.getByTestId('panel-item').nth(0)).toContainText('CPU usage')
  await expect(page.getByTestId('panel-item').nth(2)).toContainText('Disk')   // from a collapsed row
})

test('without a token the sidebar asks to configure Grafana', async ({ page, request }) => {
  await request.put('http://127.0.0.1:8090/api/settings', { data: { token: '' } })
  await page.goto('/')
  await expect(page.getByTestId('conn-status')).toContainText('Не настроено')
  await expect(page.getByTestId('dashboard-item')).toHaveCount(0)
})

test('Grafana rejecting the saved token shows the error in the sidebar', async ({ page, request }) => {
  await request.put('http://127.0.0.1:8090/api/settings', { data: { token: 'revoked' } })
  await page.goto('/')
  await expect(page.getByTestId('dash-error')).toContainText('token')
})
