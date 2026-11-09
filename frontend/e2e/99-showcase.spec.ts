import { test, expect } from '@playwright/test'
import { reset, open, addText, elRect } from './helpers'
import { copyFileSync, mkdirSync } from 'node:fs'

// Produces a screenshot of the editor and the generated .docx for visual inspection (SHOWCASE_DIR=…)
test.skip(!process.env.SHOWCASE_DIR, 'set SHOWCASE_DIR to produce a visual sample')

test('showcase', async ({ page, request }) => {
  const dir = process.env.SHOWCASE_DIR!; mkdirSync(dir, { recursive: true })
  await reset(request); await open(page)
  await page.getByTestId('report-name').fill('Утилизация Linux')
  await page.getByTestId('rv-new').fill('server'); await page.getByTestId('rv-add').click(); await page.getByTestId('rv-server').fill('web-01')

  const title = await addText(page, 36, 30)
  await title.dblclick(); await expect(title.locator('.ProseMirror')).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('Утилизация Linux — {{server}}')
  await page.keyboard.press('ControlOrMeta+a'); await page.getByTestId('tb-heading').selectOption('1'); await page.getByTestId('tb-center').click()
  await page.getByTestId('tb-color').fill('#1f4e9c')
  await page.locator('[data-testid="page-0"]').click({ position: { x: 4, y: 4 } })
  await title.click({ position: { x: 10, y: 8 } }); await page.getByTestId('ins-w').fill('523'); await page.getByTestId('ins-h').fill('36')

  const note = await addText(page, 36, 76)
  await note.dblclick(); await expect(note.locator('.ProseMirror')).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Период: {{from}} → {{to}}. Отчёт сформирован {{date}}.')
  await page.keyboard.press('ControlOrMeta+a'); await page.getByTestId('tb-italic').click(); await page.getByTestId('tb-size').selectOption('10')
  await page.locator('[data-testid="page-0"]').click({ position: { x: 4, y: 4 } })
  await note.click({ position: { x: 10, y: 8 } }); await page.getByTestId('ins-w').fill('523'); await page.getByTestId('ins-h').fill('20')

  await page.getByTestId('dashboard-item').first().locator('.title').click()
  await page.getByTestId('dash-as-block').click()
  await page.getByTestId('bv-host').fill('{{server}}'); await page.getByTestId('bv-insert').click()
  await expect(page.getByTestId('chart-img')).toHaveCount(3)
  // put the block under the heading, aligned left with the margin
  await page.getByTestId('el-chart').first().click()
  await page.getByTestId('ins-x').fill('36'); await page.getByTestId('ins-y').fill('120')
  await page.screenshot({ path: `${dir}/editor.png` })
  const dl = await Promise.all([page.waitForEvent('download'), page.getByTestId('generate').click()])
  copyFileSync((await dl[0].path())!, `${dir}/report.docx`)
})
