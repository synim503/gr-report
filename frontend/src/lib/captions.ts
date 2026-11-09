import { El, Tpl } from '../types'

/** Height of the caption line inside an element box (pt). Must match backend Captions.HEIGHT. */
export const CAP_H = 22
/** Elements whose tops differ by at most this much form one row (backend Captions.ROW_TOLERANCE). */
export const ROW_TOLERANCE = 8

export const hasCaption = (e: El): boolean => !!e.caption && (e.type === 'chart' || e.type === 'image')

/** Captioned elements of one page in numbering order: rows top to bottom, left to right inside a row. */
export function orderedOnPage(els: El[]): El[] {
  const list = els.filter(hasCaption).sort((a, b) => a.y - b.y || a.x - b.x)
  const out: El[] = []
  let i = 0
  while (i < list.length) {
    const anchor = list[i].y, row: El[] = []
    while (i < list.length && list[i].y - anchor <= ROW_TOLERANCE) row.push(list[i++])
    out.push(...row.sort((a, b) => a.x - b.x))
  }
  return out
}

/** Automatic figure numbers (id → n), continuous over all pages. */
export function figureNumbers(tpl: Tpl): Record<string, number> {
  const out: Record<string, number> = {}
  let n = 0
  for (const p of tpl.pages) for (const e of orderedOnPage(p.elements)) out[e.id] = ++n
  return out
}

/** The part of the element box that holds the picture, in element-local coordinates. */
export function pictureArea(e: El): { top: number; height: number } {
  if (!hasCaption(e)) return { top: 0, height: e.h }
  const h = Math.max(10, e.h - CAP_H)
  return { top: e.caption!.position === 'above' ? e.h - h : 0, height: h }
}

export const captionLine = (label: string, n: number, text: string) => `${label.trim() || 'Рисунок'} ${n}${text.trim() ? ` — ${text.trim()}` : ''}`
