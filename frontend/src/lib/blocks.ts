import { Block, El } from '../types'
import { makeEl, newId } from './model'
import { AlignMode, Rect, align, bounds, distribute } from './geometry'

const PAGE_MARGIN = 36

/**
 * Places a block on the page at (ox, oy). The block is only ever scaled down to fit the page WIDTH.
 * A block that is taller than a page (typical for a whole dashboard) is split across several pages,
 * row by row, keeping the dashboard's layout. Returns the elements of every page the block needs.
 */
export function instantiateBlockPages(b: Block, values: Record<string, string>, ox: number, oy: number, page: { w: number; h: number }): El[][] {
  const scale = Math.min(1, (page.w - 2 * PAGE_MARGIN) / b.width)
  const bw = b.width * scale
  const x0 = Math.max(0, Math.min(ox, page.w - bw))
  const vars: Record<string, string> = {}
  for (const v of b.variables) vars[v.name] = values[v.name] ?? v.defaultValue
  const charts = [...b.charts].sort((p, q) => p.y - q.y || p.x - q.x).map(c => ({ ...c, x: c.x * scale, y: c.y * scale, w: c.w * scale, h: c.h * scale }))
  const totalH = Math.max(...charts.map(c => c.y + c.h))
  const avail = page.h - 2 * PAGE_MARGIN

  // pages: [{ base (block-y where the page starts), top (page-y where it is placed), charts }]
  const chunks: { base: number; top: number; charts: typeof charts }[] = []
  if (totalH <= avail) {
    chunks.push({ base: 0, top: Math.max(0, Math.min(oy, page.h - totalH)), charts })
  } else {
    let cur = { base: 0, top: PAGE_MARGIN, charts: [] as typeof charts }
    for (const c of charts) {
      if (c.y - cur.base + c.h > avail && cur.charts.length) { chunks.push(cur); cur = { base: c.y, top: PAGE_MARGIN, charts: [] } }
      cur.charts.push(c)
    }
    chunks.push(cur)
  }
  return chunks.map(ch => {
    const group = { id: newId(), presetId: b.id, name: b.name }
    return ch.charts.map(c => makeEl('chart', round(x0 + c.x), round(ch.top + c.y - ch.base), {
      w: round(Math.min(c.w, page.w)), h: round(Math.min(c.h, page.h)), group,
      chart: { dashboardUid: b.dashboardUid, panelId: c.panelId, title: c.title, vars: { ...vars } },
    }))
  })
}

/** Elements of the first page only (blocks that fit on one page). */
export const instantiateBlock = (b: Block, values: Record<string, string>, ox: number, oy: number, page: { w: number; h: number }): El[] =>
  instantiateBlockPages(b, values, ox, oy, page)[0]

const round = (v: number) => Math.round(v * 10) / 10

export function groupMembers(els: El[], id: string): El[] {
  const e = els.find(x => x.id === id)
  if (!e?.group) return e ? [e] : []
  return els.filter(x => x.group?.id === e.group!.id)
}

/** Expands a selection so that clicking one member of a block selects the whole block. */
export function expandGroups(els: El[], ids: string[]): string[] {
  const out = new Set<string>()
  for (const id of ids) for (const m of groupMembers(els, id)) out.add(m.id)
  return [...out]
}

/** Variables currently set on a group (taken from its first chart). */
export function groupVars(members: El[]): Record<string, string> {
  return { ...(members.find(m => m.chart)?.chart?.vars ?? {}) }
}

/** Builds a reusable block from chart elements of a single dashboard (layout becomes relative to their bounding box). */
export function blockFromElements(els: El[], name: string): { block?: Block; error?: string } {
  const charts = els.filter(e => e.type === 'chart' && e.chart)
  if (!charts.length) return { error: 'Выберите хотя бы один график' }
  const uid = charts[0].chart!.dashboardUid
  if (charts.some(c => c.chart!.dashboardUid !== uid)) return { error: 'Блок может содержать графики только одного дашборда' }
  const x0 = Math.min(...charts.map(c => c.x)), y0 = Math.min(...charts.map(c => c.y))
  const x1 = Math.max(...charts.map(c => c.x + c.w)), y1 = Math.max(...charts.map(c => c.y + c.h))
  const vars = groupVars(charts)
  for (const c of charts) for (const [k, v] of Object.entries(c.chart!.vars ?? {})) if (!(k in vars)) vars[k] = v
  return {
    block: {
      name, dashboardUid: uid, width: round(x1 - x0), height: round(y1 - y0),
      variables: Object.entries(vars).map(([k, v]) => ({ name: k, label: k, defaultValue: v })),
      charts: charts.map(c => ({ panelId: c.chart!.panelId, title: c.chart!.title, x: round(c.x - x0), y: round(c.y - y0), w: c.w, h: c.h })),
    },
  }
}

// ---------- block-aware alignment: a block (group) always moves as one unit ----------

/** Splits a selection into units: each block is one unit, every other element is its own. */
export function selectionUnits(els: El[]): El[][] {
  const byGroup = new Map<string, El[]>(), units: El[][] = []
  for (const e of els) {
    if (!e.group) { units.push([e]); continue }
    const u = byGroup.get(e.group.id)
    if (u) u.push(e); else { const n = [e]; byGroup.set(e.group.id, n); units.push(n) }
  }
  return units
}

const rect = (e: El): Rect => ({ x: e.x, y: e.y, w: e.w, h: e.h })
const shifted = (unit: El[], from: Rect, to: Rect): Record<string, Rect> =>
  Object.fromEntries(unit.map(e => [e.id, { ...rect(e), x: e.x + (to.x - from.x), y: e.y + (to.y - from.y) }]))

/** One unit aligns to the page, several units to their common bounds. Returns new rects per element id. */
export function alignUnits(els: El[], mode: AlignMode, page: Rect): Record<string, Rect> {
  const units = selectionUnits(els), rects = units.map(u => bounds(u.map(rect)))
  const target = units.length > 1 ? bounds(rects) : page
  const out = align(rects, mode, target)
  return Object.assign({}, ...units.map((u, i) => shifted(u, rects[i], out[i])))
}

export function distributeUnits(els: El[], axis: 'h' | 'v'): Record<string, Rect> {
  const units = selectionUnits(els), rects = units.map(u => bounds(u.map(rect)))
  const out = distribute(rects, axis)
  return Object.assign({}, ...units.map((u, i) => shifted(u, rects[i], out[i])))
}

/** Moves a unit so that its bounding box starts at (x, y). */
export function moveUnitTo(els: El[], x: number, y: number): Record<string, Rect> {
  const b = bounds(els.map(rect))
  return shifted(els, b, { ...b, x, y })
}
