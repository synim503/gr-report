import { El, Tpl, Page, ChartSpec, ElType, Caption } from '../types'
import { clampToPage } from './geometry'

export interface State {
  tpl: Tpl
  past: Tpl[]
  future: Tpl[]
  dirty: boolean
}

export type Action =
  | { t: 'load'; tpl: Tpl }
  | { t: 'checkpoint' }                                   // push history snapshot (start of a drag / edit session)
  | { t: 'patch'; page: number; ids: string[]; patch: Partial<El> }
  | { t: 'setRects'; page: number; rects: Record<string, { x: number; y: number; w: number; h: number }> }
  | { t: 'add'; page: number; el: El }
  | { t: 'remove'; page: number; ids: string[] }
  | { t: 'duplicate'; page: number; ids: string[] }
  | { t: 'order'; page: number; ids: string[]; where: 'front' | 'back' | 'forward' | 'backward' }
  | { t: 'addMany'; page: number; els: El[] }
  | { t: 'chartVars'; page: number; ids: string[]; vars: Record<string, string> }
  | { t: 'ungroup'; page: number; ids: string[] }
  | { t: 'captions'; page: number; items: Record<string, Caption | null> }
  | { t: 'addPage' }
  | { t: 'removePage'; page: number }
  | { t: 'meta'; patch: Partial<Omit<Tpl, 'pages'>> }
  | { t: 'resizePage'; w: number; h: number }
  | { t: 'undo' }
  | { t: 'redo' }
  | { t: 'saved'; id: string; updatedAt?: string }

export const emptyTpl = (): Tpl => ({
  name: 'Новый отчёт', pageWidth: 595.28, pageHeight: 841.89, timeRange: { from: 'now-6h', to: 'now' }, variables: {}, captionLabel: 'Рисунок', pages: [{ elements: [] }],
})

let counter = 0
export const newId = () => `el_${Date.now().toString(36)}_${(counter++).toString(36)}`

export function makeEl(type: ElType, x: number, y: number, extra: Partial<El> = {}): El {
  const base: El = { id: newId(), type, x, y, w: 200, h: 100, z: 0, ...extra }
  if (type === 'text') { base.html ??= '<p>Текст</p>'; base.lineHeight ??= 1 }
  return base
}

export function chartEl(x: number, y: number, chart: ChartSpec, w = 260, h = 160): El {
  return makeEl('chart', x, y, { w, h, chart })
}

const MAX_HISTORY = 100
const mapPage = (tpl: Tpl, page: number, f: (els: El[]) => El[]): Tpl =>
  ({ ...tpl, pages: tpl.pages.map((p, i) => i === page ? { ...p, elements: f(p.elements) } : p) })
const nextZ = (els: El[]) => els.reduce((m, e) => Math.max(m, e.z), -1) + 1

function withHistory(s: State, tpl: Tpl): State {
  return { tpl, past: [...s.past, s.tpl].slice(-MAX_HISTORY), future: [], dirty: true }
}

export function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'load': return { tpl: a.tpl, past: [], future: [], dirty: false }
    case 'saved': return { ...s, tpl: { ...s.tpl, id: a.id, updatedAt: a.updatedAt }, dirty: false }
    case 'checkpoint': return { ...s, past: [...s.past, s.tpl].slice(-MAX_HISTORY), future: [] }
    case 'patch': return { ...s, dirty: true, tpl: mapPage(s.tpl, a.page, els => els.map(e => a.ids.includes(e.id) ? { ...e, ...a.patch } : e)) }
    case 'setRects': {
      const page = { w: s.tpl.pageWidth, h: s.tpl.pageHeight }
      return { ...s, dirty: true, tpl: mapPage(s.tpl, a.page, els => els.map(e => a.rects[e.id] ? { ...e, ...clampToPage(a.rects[e.id], page) } : e)) }
    }
    case 'add': return withHistory(s, mapPage(s.tpl, a.page, els => [...els, { ...a.el, z: nextZ(els) }]))
    case 'addMany': return withHistory(s, mapPage(s.tpl, a.page, els => { let z = nextZ(els); return [...els, ...a.els.map(e => ({ ...e, z: z++ }))] }))
    case 'chartVars': return withHistory(s, mapPage(s.tpl, a.page, els => els.map(e =>
      a.ids.includes(e.id) && e.chart ? { ...e, chart: { ...e.chart, vars: { ...(e.chart.vars ?? {}), ...a.vars } } } : e)))
    case 'ungroup': return withHistory(s, mapPage(s.tpl, a.page, els => els.map(e => {
      if (!a.ids.includes(e.id)) return e
      const { group: _g, ...rest } = e; return rest as El })))
    case 'captions': return withHistory(s, mapPage(s.tpl, a.page, els => els.map(e => {
      if (!(e.id in a.items)) return e
      const c = a.items[e.id]
      if (c) return { ...e, caption: c }
      const { caption: _c, ...rest } = e; return rest as El
    })))
    case 'remove': return withHistory(s, mapPage(s.tpl, a.page, els => els.filter(e => !a.ids.includes(e.id))))
    case 'duplicate': return withHistory(s, mapPage(s.tpl, a.page, els => {
      let z = nextZ(els)
      const copies = els.filter(e => a.ids.includes(e.id)).map(e => ({
        ...JSON.parse(JSON.stringify(e)), id: newId(), x: Math.min(e.x + 12, s.tpl.pageWidth - e.w), y: Math.min(e.y + 12, s.tpl.pageHeight - e.h), z: z++,
      }))
      return [...els, ...copies]
    }))
    case 'order': return withHistory(s, mapPage(s.tpl, a.page, els => {
      const sorted = [...els].sort((p, q) => p.z - q.z)
      const sel = sorted.filter(e => a.ids.includes(e.id)), rest = sorted.filter(e => !a.ids.includes(e.id))
      let out: El[]
      if (a.where === 'front') out = [...rest, ...sel]
      else if (a.where === 'back') out = [...sel, ...rest]
      else {
        out = [...sorted]
        const step = a.where === 'forward' ? 1 : -1
        const order = step === 1 ? [...sel].reverse() : sel
        for (const e of order) {
          const i = out.findIndex(o => o.id === e.id), j = i + step
          if (j < 0 || j >= out.length || a.ids.includes(out[j].id)) continue
          ;[out[i], out[j]] = [out[j], out[i]]
        }
      }
      return out.map((e, i) => ({ ...e, z: i }))
    }))
    case 'addPage': return withHistory(s, { ...s.tpl, pages: [...s.tpl.pages, { elements: [] } as Page] })
    case 'removePage':
      if (s.tpl.pages.length <= 1) return s
      return withHistory(s, { ...s.tpl, pages: s.tpl.pages.filter((_, i) => i !== a.page) })
    case 'meta': return withHistory(s, { ...s.tpl, ...a.patch })
    case 'resizePage': {
      const tpl: Tpl = { ...s.tpl, pageWidth: a.w, pageHeight: a.h, pages: s.tpl.pages.map(p => ({
        elements: p.elements.map(e => ({ ...e, ...clampToPage(e, { w: a.w, h: a.h }) })) })) }
      return withHistory(s, tpl)
    }
    case 'undo': {
      if (!s.past.length) return s
      const prev = s.past[s.past.length - 1]
      return { tpl: prev, past: s.past.slice(0, -1), future: [s.tpl, ...s.future], dirty: true }
    }
    case 'redo': {
      if (!s.future.length) return s
      return { tpl: s.future[0], past: [...s.past, s.tpl], future: s.future.slice(1), dirty: true }
    }
  }
}
