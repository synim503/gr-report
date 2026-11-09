import { test, expect, Page, Locator } from '@playwright/test'
import { reset, open, addText, elRect } from './helpers'

test.beforeEach(async ({ page, request }) => { await reset(request); await open(page) })

async function edit(page: Page, el: Locator, text?: string) {
  await el.dblclick()
  await expect(el.locator('.ProseMirror')).toBeFocused()   // autofocus happens right after mount
  if (text !== undefined) { await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type(text) }
}
async function done(page: Page) { await page.locator('[data-testid="page-0"]').click({ position: { x: 4, y: 4 } }) }
const html = (el: Locator) => el.getByTestId('text-static').innerHTML()
const tb = (page: Page, id: string) => page.getByTestId(`tb-${id}`)

test('toolbar is disabled until a text block is edited; editing keeps content after leaving', async ({ page }) => {
  await expect(page.getByTestId('text-toolbar')).toContainText('Дважды щёлкните')
  const t = await addText(page)
  await edit(page, t, 'Привет, мир')
  await expect(tb(page, 'bold')).toBeVisible()
  await done(page)
  await expect(page.getByTestId('text-toolbar')).toContainText('Дважды щёлкните')
  await expect(t.getByTestId('text-static')).toContainText('Привет, мир')
  await edit(page, t)                                    // re-open: content intact
  await expect(t.locator('.ProseMirror')).toContainText('Привет, мир')
})

test('inline styles: bold, italic, underline, strike, sub, sup (toolbar and shortcuts)', async ({ page }) => {
  const t = await addText(page)
  await edit(page, t, 'abc')
  await page.keyboard.press('ControlOrMeta+a')
  await tb(page, 'bold').click(); await expect(tb(page, 'bold')).toHaveClass(/on/)
  await tb(page, 'italic').click(); await tb(page, 'underline').click(); await tb(page, 'strike').click()
  await done(page)
  const h = await html(t)
  expect(h).toMatch(/<strong>/); expect(h).toMatch(/<em>/); expect(h).toMatch(/<u>/); expect(h).toMatch(/<s>/)

  await edit(page, t, 'x')
  await page.keyboard.press('ControlOrMeta+a')
  await tb(page, 'sub').click(); await done(page)
  expect(await html(t)).toContain('<sub>')
  await edit(page, t); await page.keyboard.press('ControlOrMeta+a')
  await tb(page, 'sub').click(); await tb(page, 'sup').click(); await done(page)
  expect(await html(t)).toContain('<sup>')

  await edit(page, t, 'k'); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('ControlOrMeta+b'); await done(page)
  expect(await html(t)).toContain('<strong>')
})

test('font family, size, text colour and highlight', async ({ page }) => {
  const t = await addText(page)
  await edit(page, t, 'styled'); await page.keyboard.press('ControlOrMeta+a')
  await tb(page, 'font').selectOption('Georgia')
  await tb(page, 'size').selectOption('24')
  await tb(page, 'color').fill('#ff0000')
  await tb(page, 'highlight').fill('#00ff00')
  await done(page)
  const h = (await html(t)).toLowerCase()
  expect(h).toContain('font-family: georgia'); expect(h).toContain('font-size: 24px')
  expect(h).toMatch(/color: (#ff0000|rgb\(255, 0, 0\))/); expect(h).toMatch(/background-color: (#00ff00|rgb\(0, 255, 0\))/)
  expect(h).toContain('<mark')
})

test('alignment: left, centre, right, justify', async ({ page }) => {
  const t = await addText(page)
  await edit(page, t, 'aligned')
  for (const [id, css] of [['center', 'center'], ['right', 'right'], ['justify', 'justify']] as const) {
    await tb(page, id).click()
    await expect(t.locator('.ProseMirror p')).toHaveCSS('text-align', css)
  }
  await tb(page, 'left').click(); await done(page)
  await expect(t.locator('.text-static p')).toHaveCSS('text-align', 'left')
})

test('headings, bullet and numbered lists, blockquote', async ({ page }) => {
  const t = await addText(page)
  await edit(page, t, 'Title')
  await tb(page, 'heading').selectOption('1')
  await page.keyboard.press('Enter'); await page.keyboard.type('item one')
  await tb(page, 'heading').selectOption('0')
  await tb(page, 'ul').click(); await page.keyboard.press('Enter'); await page.keyboard.type('item two')
  await tb(page, 'ul').click(); await tb(page, 'ol').click()
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.type('quoted')
  await tb(page, 'quote').click()
  await done(page)
  const h = await html(t)
  expect(h).toContain('<h1>'); expect(h).toContain('<ul>'); expect(h).toContain('<ol>'); expect(h).toContain('<blockquote>')
  const ol = t.locator('.text-static ol li'); await expect(ol).toHaveCount(1)
})

test('link: prompt, hyperlink created, can be removed', async ({ page }) => {
  const t = await addText(page)
  await edit(page, t, 'site'); await page.keyboard.press('ControlOrMeta+a')
  page.once('dialog', d => d.accept('https://grafana.com/'))
  await tb(page, 'link').click()
  await done(page)
  await expect(t.locator('.text-static a')).toHaveAttribute('href', 'https://grafana.com/')
  await edit(page, t); await page.keyboard.press('ControlOrMeta+a')
  page.once('dialog', d => d.accept(''))
  await tb(page, 'link').click(); await done(page)
  await expect(t.locator('.text-static a')).toHaveCount(0)
})

test('clear formatting removes marks', async ({ page }) => {
  const t = await addText(page)
  await edit(page, t, 'plain'); await page.keyboard.press('ControlOrMeta+a')
  await tb(page, 'bold').click(); await tb(page, 'italic').click()
  await tb(page, 'clear').click(); await done(page)
  const h = await html(t); expect(h).not.toContain('<strong>'); expect(h).not.toContain('<em>')
})

test('variables: inserted from the toolbar and substituted in the preview', async ({ page }) => {
  const t = await addText(page)
  await edit(page, t, 'Дата: ')
  await tb(page, 'variable').selectOption('date')
  await done(page)
  await expect(t.getByTestId('text-static')).toContainText(new RegExp(`Дата: ${new Date().toISOString().slice(0, 4)}-\\d\\d-\\d\\d`))
  // user variable defined in page settings appears in the list and resolves
  await page.getByTestId('rv-new').fill('server'); await page.getByTestId('rv-add').click()
  await page.getByTestId('rv-server').fill('db-07')
  await edit(page, t, ''); await tb(page, 'variable').selectOption('server'); await done(page)
  await expect(t.getByTestId('text-static')).toContainText('db-07')
})

test('line spacing from the inspector', async ({ page }) => {
  const t = await addText(page); await edit(page, t, 'x'); await done(page)
  await t.click({ position: { x: 10, y: 8 } })
  await page.getByTestId('line-height').selectOption('2')
  await expect(t.getByTestId('text-static')).toHaveCSS('line-height', '22px')  // 11px font × 2
})

test('pressing keys in a text block does not trigger shortcuts (Delete / arrows edit text, not the element)', async ({ page }) => {
  const t = await addText(page); await edit(page, t, 'abc')
  const r0 = await elRect(t)
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Backspace'); await page.keyboard.press('Delete')
  await expect(page.getByTestId('el-text')).toHaveCount(1)
  expect(await elRect(t)).toEqual(r0)
  await expect(t.locator('.ProseMirror')).toContainText('a')
})

test('pasting hostile HTML is rendered inert in the canvas', async ({ page, request }) => {
  const tpl = { name: 'x', pageWidth: 595.28, pageHeight: 841.89, timeRange: { from: 'now-6h', to: 'now' }, variables: {},
    pages: [{ elements: [{ id: 'e1', type: 'text', x: 10, y: 10, w: 300, h: 80, z: 0, html: '<p onclick="window.__pwned=1">hi<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script></p>' }] }] }
  const saved = await (await request.post('http://127.0.0.1:8090/api/templates', { data: tpl })).json()
  await page.getByTestId('open').click()
  await page.getByTestId('template-open').first().click()
  await expect(page.getByTestId('text-static')).toContainText('hi')
  await page.getByTestId('text-static').click()
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined()
  expect(saved.id).toBeTruthy()
})
