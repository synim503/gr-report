import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { api, generate } from './api'
import { Block, El, SettingsView, Tpl } from './types'
import { emptyTpl, makeEl, chartEl, reducer, State } from './lib/model'
import { blockFromElements, instantiateBlock } from './lib/blocks'
import { DropPayload, PageView, Selection } from './components/PageView'
import { TextToolbar } from './components/TextToolbar'
import { Sidebar } from './components/Sidebar'
import { Inspector } from './components/Inspector'
import { InsertBlockDialog, SaveBlockDialog, SettingsDialog, TemplatesDialog } from './components/Dialogs'
import { Icon, Logo } from './components/Icon'
import { Onboarding } from './components/Onboarding'

interface Toast { id: number; kind: 'info' | 'err' | 'warn'; text: string }
interface Pending { block: Block; page: number; x: number; y: number }

const init = (): State => ({ tpl: emptyTpl(), past: [], future: [], dirty: false })

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, init)
  const { tpl } = state
  const [sel, setSel] = useState<Selection>({ page: 0, ids: [] })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [zoom, setZoom] = useState(1.25)
  const [snap, setSnap] = useState(true)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [dialog, setDialog] = useState<null | 'settings' | 'templates' | 'saveBlock'>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [templates, setTemplates] = useState<{ id: string; name: string; updatedAt?: string }[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [busy, setBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const toastId = useRef(0)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { const t = localStorage.getItem('theme'); if (t === 'dark' || t === 'light') return t } catch { /* storage blocked */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('theme', theme) } catch { /* ignore */ }
  }, [theme])

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastId.current
    setToasts(t => [...t, { id, kind, text }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'info' ? 3500 : 9000)
  }, [])
  const fail = useCallback((m: string) => toast(m, 'err'), [toast])

  useEffect(() => {
    api.settings().then(setSettings).catch(e => fail((e as Error).message))
    api.blocks().then(setBlocks).catch(() => { /* backend may be starting */ })
  }, [fail])

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (state.dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h)
  }, [state.dirty])

  const scale = zoom * 96 / 72
  const pageSize = { w: tpl.pageWidth, h: tpl.pageHeight }
  const curPage = Math.min(sel.page, tpl.pages.length - 1)
  const selEls: El[] = tpl.pages[curPage]?.elements.filter(e => sel.ids.includes(e.id)) ?? []

  // ---------- adding things ----------
  const nextSpot = (page: number) => { const n = tpl.pages[page].elements.length; return { x: 36 + (n % 8) * 14, y: 36 + (n % 8) * 14 } }
  const addEl = (page: number, el: El) => { dispatch({ t: 'add', page, el }); setSel({ page, ids: [el.id] }) }

  const addText = (page = curPage, x?: number, y?: number) => {
    const s = nextSpot(page)
    addEl(page, makeEl('text', Math.min(x ?? s.x, tpl.pageWidth - 240), Math.min(y ?? s.y, tpl.pageHeight - 60), { w: 240, h: 60 }))
  }
  const addPanel = (chart: { dashboardUid: string; panelId: number; title?: string }, w: number, h: number, page = curPage, x?: number, y?: number) => {
    const s = nextSpot(page)
    const cw = Math.min(w, tpl.pageWidth), ch = Math.min(h, tpl.pageHeight)
    addEl(page, chartEl(Math.max(0, Math.min(x ?? s.x, tpl.pageWidth - cw)), Math.max(0, Math.min(y ?? s.y, tpl.pageHeight - ch)), { ...chart, vars: {} }, cw, ch))
  }
  const addImage = (file: File, page = curPage, x?: number, y?: number) => {
    if (!/^image\/(png|jpe?g|gif)$/.test(file.type)) { fail('Поддерживаются PNG, JPEG и GIF'); return }
    if (file.size > 8 * 1024 * 1024) { fail('Файл больше 8 МБ'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      const img = new Image()
      img.onload = () => {
        const k = Math.min(1, 300 / img.naturalWidth, 300 / img.naturalHeight)
        const w = Math.max(20, Math.round(img.naturalWidth * k)), h = Math.max(20, Math.round(img.naturalHeight * k))
        const s = nextSpot(page)
        addEl(page, makeEl('image', Math.min(x ?? s.x, tpl.pageWidth - w), Math.min(y ?? s.y, tpl.pageHeight - h), { w, h, dataUrl }))
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }
  const onDrop = (page: number, x: number, y: number, pl: DropPayload) => {
    if (pl.kind === 'text') addText(page, x, y)
    else if (pl.kind === 'panel') addPanel(pl.chart, pl.w, pl.h, page, x, y)
    else { const b = blocks.find(b => b.id === pl.blockId); if (b) setPending({ block: b, page, x, y }) }
  }
  const useBlock = (b: Block) => { const s = nextSpot(curPage); setPending({ block: b, page: curPage, x: s.x, y: s.y }) }

  async function confirmInsert(values: Record<string, string>, save: boolean) {
    if (!pending) return
    let b = pending.block
    try {
      if (save && !b.id) { b = await api.saveBlock(b); setBlocks(await api.blocks()) }
      const els = instantiateBlock(b, values, pending.x, pending.y, pageSize)
      dispatch({ t: 'addMany', page: pending.page, els })
      setSel({ page: pending.page, ids: els.map(e => e.id) })
      setPending(null)
    } catch (e) { fail((e as Error).message) }
  }

  async function saveBlock(name: string) {
    const { block, error } = blockFromElements(selEls, name)
    if (!block) { fail(error ?? 'Не удалось создать блок'); return }
    try { await api.saveBlock(block); setBlocks(await api.blocks()); setDialog(null); toast(`Блок «${name}» сохранён`) } catch (e) { fail((e as Error).message) }
  }

  // ---------- template persistence / generation ----------
  async function save() {
    try { const t = await api.saveTemplate(tpl); dispatch({ t: 'saved', id: t.id!, updatedAt: t.updatedAt }); toast('Отчёт сохранён') } catch (e) { fail((e as Error).message) }
  }
  async function openList() { try { setTemplates(await api.templates()); setDialog('templates') } catch (e) { fail((e as Error).message) } }
  async function openTemplate(id: string) {
    try {
      const t = await api.template(id)
      t.variables ??= {}
      dispatch({ t: 'load', tpl: t }); setSel({ page: 0, ids: [] }); setEditingId(null); setDialog(null)
    } catch (e) { fail((e as Error).message) }
  }
  async function run() {
    setBusy(true)
    try {
      const r = await generate(tpl)
      const url = URL.createObjectURL(r.blob)
      const a = document.createElement('a'); a.href = url; a.download = r.filename; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast(`Готово: ${r.filename}`)
      if (r.warnings.length) toast(`Предупреждения:\n${r.warnings.join('\n')}`, 'warn')
    } catch (e) { fail(`Ошибка генерации: ${(e as Error).message}`) } finally { setBusy(false) }
  }

  // ---------- keyboard ----------
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.closest('input,textarea,select,[contenteditable="true"]')
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); return }
      if (typing) return
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); dispatch({ t: e.shiftKey ? 'redo' : 'undo' }); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); dispatch({ t: 'redo' }); return }
      if (!sel.ids.length) return
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); dispatch({ t: 'duplicate', page: curPage, ids: sel.ids }); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); dispatch({ t: 'remove', page: curPage, ids: sel.ids }); setSel({ page: curPage, ids: [] }); return }
      if (e.key === 'Escape') { setSel({ page: curPage, ids: [] }); return }
      const step = e.shiftKey ? 10 : 1
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
      if (d) {
        e.preventDefault()
        dispatch({ t: 'checkpoint' })
        dispatch({ t: 'setRects', page: curPage, rects: Object.fromEntries(selEls.map(el => [el.id, { x: el.x + d[0], y: el.y + d[1], w: el.w, h: el.h }])) })
      }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  })

  const varNames = ['date', 'datetime', 'from', 'to', 'name', ...Object.keys(tpl.variables)]

  const configured = !!settings?.grafanaUrl && settings.tokenSet
  const iconBtn = (id: string, name: Parameters<typeof Icon>[0]['name'], title: string, onClick: () => void, disabled = false) =>
    <button className="icon-btn" data-testid={id} title={title} disabled={disabled} onClick={onClick}><Icon name={name} /></button>

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><Logo /><div>Grafana Reporter<small>редактор отчётов Word</small></div></div>
        <div className="sep" />
        <input className="name" data-testid="report-name" value={tpl.name} aria-label="Название отчёта" onChange={e => dispatch({ t: 'meta', patch: { name: e.target.value } })} />
        <span className={`dirty ${state.dirty ? 'unsaved' : tpl.id ? 'saved' : ''}`} data-testid="dirty">{state.dirty ? 'не сохранено' : tpl.id ? 'сохранено' : ''}</span>
        <div className="seg">
          {iconBtn('undo', 'undo', 'Отменить (Ctrl+Z)', () => dispatch({ t: 'undo' }), !state.past.length)}
          {iconBtn('redo', 'redo', 'Повторить (Ctrl+Y)', () => dispatch({ t: 'redo' }), !state.future.length)}
        </div>
        <button data-testid="add-page" onClick={() => dispatch({ t: 'addPage' })}><Icon name="plus" /> Страница</button>
        <div className="spacer" />
        <button className={`pill ${configured ? 'ok' : ''}`} data-testid="topbar-conn" title="Настройки подключения к Grafana" onClick={() => setDialog('settings')}>
          <i className="dot" /><span>{configured ? settings!.grafanaUrl.replace(/^https?:\/\//, '') : 'Grafana не подключена'}</span></button>
        <button className="icon-btn" data-testid="theme-toggle" title="Светлая / тёмная тема" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
        <div className="sep" />
        <button data-testid="new" onClick={() => { if (!state.dirty || confirm('Несохранённые изменения будут потеряны. Создать новый отчёт?')) { dispatch({ t: 'load', tpl: emptyTpl() }); setSel({ page: 0, ids: [] }) } }}><Icon name="filePlus" /> Новый</button>
        <button data-testid="open" onClick={openList}><Icon name="folder" /> Открыть</button>
        <button data-testid="save" onClick={save}><Icon name="save" /> Сохранить</button>
        <button className="primary" data-testid="generate" disabled={busy} onClick={run}><Icon name={busy ? 'loader' : 'download'} className={busy ? 'spin' : ''} /> {busy ? 'Генерация…' : 'Сформировать Word'}</button>
      </div>
      <TextToolbar editor={editor} variables={varNames} />
      <div className="main">
        <Sidebar settings={settings} blocks={blocks} refreshKey={refreshKey} onSettings={() => setDialog('settings')} onAddText={() => addText()}
          onAddImage={f => addImage(f)} onAddPanel={(c, w, h) => addPanel(c, w, h)} onUseBlock={useBlock} onError={fail}
          onDeleteBlock={async id => { try { await api.deleteBlock(id); setBlocks(await api.blocks()) } catch (e) { fail((e as Error).message) } }} />
        <div className="canvas-wrap">
          <div className="canvas" data-testid="canvas">
            {settings && !configured && <Onboarding initial={settings} onSaved={s => { setSettings(s); setRefreshKey(k => k + 1); toast('Grafana подключена') }} />}
            {tpl.pages.map((_, i) => (
              <PageView key={i} index={i} tpl={tpl} scale={scale} snap={snap} sel={sel} editingId={editingId}
                dispatch={dispatch} onSelect={s => { setSel(s); if (editingId && !s.ids.includes(editingId)) setEditingId(null) }}
                onEdit={setEditingId} onEditor={setEditor} onDrop={onDrop} onDropFile={(p, x, y, f) => addImage(f, p, x, y)}
                onDeletePage={p => { dispatch({ t: 'removePage', page: p }); setSel({ page: 0, ids: [] }) }} />
            ))}
          </div>
          <div className="zoombar">
            <button className="icon-btn" data-testid="zoom-out" title="Уменьшить" onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(2)))}><Icon name="minus" /></button>
            <span data-testid="zoom">{Math.round(zoom * 100)}%</span>
            <button className="icon-btn" data-testid="zoom-in" title="Увеличить" onClick={() => setZoom(z => Math.min(2.5, +(z + 0.1).toFixed(2)))}><Icon name="plus" /></button>
          </div>
        </div>
        <Inspector tpl={tpl} sel={{ page: curPage, ids: sel.ids }} dispatch={dispatch} snap={snap} setSnap={setSnap} onSaveBlock={() => setDialog('saveBlock')} />
      </div>

      {dialog === 'settings' && settings && <SettingsDialog initial={settings} onClose={() => setDialog(null)} onSaved={s => { setSettings(s); setRefreshKey(k => k + 1) }} />}
      {dialog === 'templates' && <TemplatesDialog items={templates} onClose={() => setDialog(null)} onOpen={openTemplate}
        onDelete={async id => { try { await api.deleteTemplate(id); setTemplates(await api.templates()) } catch (e) { fail((e as Error).message) } }} />}
      {dialog === 'saveBlock' && <SaveBlockDialog defaultName={selEls[0]?.group?.name ?? selEls[0]?.chart?.title ?? 'Мой блок'} onClose={() => setDialog(null)} onSave={saveBlock} />}
      {pending && <InsertBlockDialog block={pending.block} onClose={() => setPending(null)} onInsert={confirmInsert} />}
      <div className="toast" data-testid="toasts">{toasts.map(t => <div key={t.id} className={t.kind === 'err' ? 'err' : t.kind === 'warn' ? 'warn' : ''} data-testid={`toast-${t.kind}`}>
        <Icon name={t.kind === 'info' ? 'check' : 'alert'} size={16} /><span>{t.text}</span></div>)}</div>
    </div>
  )
}
