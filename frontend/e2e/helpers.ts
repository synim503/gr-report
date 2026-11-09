import { expect, Locator, Page, APIRequestContext } from '@playwright/test'
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'

export const GRAFANA = 'http://127.0.0.1:3100'
export const TOKEN = 'glsa_test_token'
export const API = 'http://127.0.0.1:8090'
export const PT = 96 / 72 * 1.25      // CSS px per pt at the default 125 % zoom

/** Resets backend state (settings, templates, blocks) and Grafana's request log. */
export async function reset(request: APIRequestContext) {
  await request.put(`${API}/api/settings`, { data: { grafanaUrl: GRAFANA, token: TOKEN, orgId: 1, imageScale: 1.5 } })
  for (const t of await (await request.get(`${API}/api/templates`)).json()) await request.delete(`${API}/api/templates/${t.id}`)
  for (const b of await (await request.get(`${API}/api/blocks`)).json()) await request.delete(`${API}/api/blocks/${b.id}`)
  await request.get(`${GRAFANA}/__reset`)
}

export async function grafanaRequests(request: APIRequestContext): Promise<Record<string, string>[]> {
  const list: string[] = await (await request.get(`${GRAFANA}/__requests`)).json()
  return list.map(r => Object.fromEntries(new URLSearchParams(r.slice(r.indexOf('?') + 1))))
}

export async function open(page: Page) {
  await page.goto('/')
  await expect(page.getByTestId('conn-status')).toContainText('127.0.0.1:3100')
}

/** Box of the page canvas (CSS px). */
export async function pageBox(page: Page, i = 0) {
  const b = await page.getByTestId(`page-${i}`).boundingBox()
  if (!b) throw new Error('no page')
  return b
}

/** Drops a sidebar chip onto the page at (x, y) in points. */
export async function dropOnPage(page: Page, source: Locator, x: number, y: number, pageIndex = 0) {
  const b = await pageBox(page, pageIndex)
  await source.dragTo(page.getByTestId(`page-${pageIndex}`), { targetPosition: { x: x * PT, y: y * PT } })
  return b
}

export async function elRect(el: Locator) {
  const [x, y, w, h] = await Promise.all(['left', 'top', 'width', 'height'].map(p => el.evaluate((n, prop) => parseFloat((n as HTMLElement).style[prop as 'left']), p)))
  return { x, y, w, h }
}

export async function addText(page: Page, x = 60, y = 60) {
  const before = await page.getByTestId('el-text').count()
  await dropOnPage(page, page.getByTestId('add-text'), x, y)
  await expect(page.getByTestId('el-text')).toHaveCount(before + 1)
  const id = await page.getByTestId('el-text').last().getAttribute('data-el-id')
  return page.locator(`[data-el-id="${id}"]`)   // stable locator (not "the last one")
}

export async function openDashboard(page: Page) {
  await page.getByTestId('dashboard-item').first().locator('.title').click()
  await expect(page.getByTestId('panel-item')).toHaveCount(3)
}

export async function dropPanel(page: Page, idx: number, x: number, y: number) {
  const r = await dropOnPage(page, page.getByTestId('panel-item').nth(idx), x, y)
  return r
}

export async function download(page: Page, trigger: () => Promise<void>) {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()])
  const path = await dl.path()
  const zip = await JSZip.loadAsync(readFileSync(path!))
  const xml = await zip.file('word/document.xml')!.async('string')
  return { zip, xml, filename: dl.suggestedFilename() }
}
