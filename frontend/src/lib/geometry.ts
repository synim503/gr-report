export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom'

export const MIN_SIZE = 20
export const MARGIN = 36 // 0.5 inch guide

export interface SnapResult { dx: number; dy: number; vGuides: number[]; hGuides: number[] }

function xLines(page: Size, others: Rect[], margin: number): number[] {
  const l = [0, page.w / 2, page.w, margin, page.w - margin]
  for (const o of others) l.push(o.x, o.x + o.w / 2, o.x + o.w)
  return l
}
function yLines(page: Size, others: Rect[], margin: number): number[] {
  const l = [0, page.h / 2, page.h, margin, page.h - margin]
  for (const o of others) l.push(o.y, o.y + o.h / 2, o.y + o.h)
  return l
}

/** Finds the smallest correction that brings any of `mine` onto any of `targets` within `threshold`. */
function best(mine: number[], targets: number[], threshold: number): { d: number; at: number[] } | null {
  let d: number | null = null
  for (const m of mine) for (const t of targets) {
    const diff = t - m
    if (Math.abs(diff) <= threshold && (d === null || Math.abs(diff) < Math.abs(d) - 1e-9)) d = diff
  }
  if (d === null) return null
  const at: number[] = []
  for (const m of mine) for (const t of targets) if (Math.abs(t - (m + d)) < 1e-6 && !at.includes(t)) at.push(t)
  return { d, at }
}

/** Snap a rectangle being moved (left/centre/right and top/middle/bottom) to page and sibling guides. */
export function snapMove(r: Rect, others: Rect[], page: Size, threshold: number, margin = MARGIN): SnapResult {
  const bx = best([r.x, r.x + r.w / 2, r.x + r.w], xLines(page, others, margin), threshold)
  const by = best([r.y, r.y + r.h / 2, r.y + r.h], yLines(page, others, margin), threshold)
  return { dx: bx?.d ?? 0, dy: by?.d ?? 0, vGuides: bx?.at ?? [], hGuides: by?.at ?? [] }
}

/** Resize `r` by dragging `handle` to a raw rect, snapping only the edges that move. */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, others: Rect[], page: Size,
                           threshold: number, opts: { snap: boolean; keepAspect?: boolean } = { snap: true }): { rect: Rect; vGuides: number[]; hGuides: number[] } {
  let { x, y, w, h } = start
  let right = x + w, bottom = y + h
  const xs = xLines(page, others, MARGIN), ys = yLines(page, others, MARGIN)
  const vGuides: number[] = [], hGuides: number[] = []
  if (handle.includes('w')) x += dx
  if (handle.includes('e')) right += dx
  if (handle.includes('n')) y += dy
  if (handle.includes('s')) bottom += dy
  if (opts.snap) {
    if (handle.includes('w')) { const b = best([x], xs, threshold); if (b) { x += b.d; vGuides.push(...b.at) } }
    if (handle.includes('e')) { const b = best([right], xs, threshold); if (b) { right += b.d; vGuides.push(...b.at) } }
    if (handle.includes('n')) { const b = best([y], ys, threshold); if (b) { y += b.d; hGuides.push(...b.at) } }
    if (handle.includes('s')) { const b = best([bottom], ys, threshold); if (b) { bottom += b.d; hGuides.push(...b.at) } }
  }
  // enforce minimum size by pinning the opposite edge
  if (right - x < MIN_SIZE) { if (handle.includes('w')) x = right - MIN_SIZE; else right = x + MIN_SIZE }
  if (bottom - y < MIN_SIZE) { if (handle.includes('n')) y = bottom - MIN_SIZE; else bottom = y + MIN_SIZE }
  // keep inside page
  if (x < 0) x = 0
  if (y < 0) y = 0
  if (right > page.w) right = page.w
  if (bottom > page.h) bottom = page.h
  let rect = { x, y, w: right - x, h: bottom - y }
  if (opts.keepAspect && start.h > 0) {
    const ratio = start.w / start.h
    // adapt the dimension that moved least relative to the start
    if (handle === 'n' || handle === 's') rect.w = rect.h * ratio
    else if (handle === 'e' || handle === 'w') rect.h = rect.w / ratio
    else { const nh = rect.w / ratio; if (handle.includes('n')) rect.y = rect.y + rect.h - nh; rect.h = nh }
    if (handle.includes('w')) rect.x = start.x + start.w - rect.w
  }
  return { rect, vGuides, hGuides }
}

export function clampToPage(r: Rect, page: Size): Rect {
  const w = Math.min(r.w, page.w), h = Math.min(r.h, page.h)
  return { x: Math.max(0, Math.min(r.x, page.w - w)), y: Math.max(0, Math.min(r.y, page.h - h)), w, h }
}

export function bounds(rs: Rect[]): Rect {
  const x1 = Math.min(...rs.map(r => r.x)), y1 = Math.min(...rs.map(r => r.y))
  const x2 = Math.max(...rs.map(r => r.x + r.w)), y2 = Math.max(...rs.map(r => r.y + r.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** Aligns rectangles to `target` (page for a single element, selection bounds for several). Returns new rects. */
export function align(rs: Rect[], mode: AlignMode, target: Rect): Rect[] {
  return rs.map(r => {
    switch (mode) {
      case 'left': return { ...r, x: target.x }
      case 'hcenter': return { ...r, x: target.x + (target.w - r.w) / 2 }
      case 'right': return { ...r, x: target.x + target.w - r.w }
      case 'top': return { ...r, y: target.y }
      case 'vmiddle': return { ...r, y: target.y + (target.h - r.h) / 2 }
      case 'bottom': return { ...r, y: target.y + target.h - r.h }
    }
  })
}

/** Equal gaps between >=3 rects along an axis; outermost stay in place. Order of result matches input. */
export function distribute(rs: Rect[], axis: 'h' | 'v'): Rect[] {
  if (rs.length < 3) return rs.map(r => ({ ...r }))
  const pos = axis === 'h' ? 'x' : 'y', size = axis === 'h' ? 'w' : 'h'
  const idx = rs.map((_, i) => i).sort((a, b) => rs[a][pos] - rs[b][pos])
  const first = rs[idx[0]], last = rs[idx[idx.length - 1]]
  const span = last[pos] + last[size] - first[pos]
  const total = idx.reduce((s, i) => s + rs[i][size], 0)
  const gap = (span - total) / (rs.length - 1)
  const out = rs.map(r => ({ ...r }))
  let cur = first[pos]
  for (const i of idx) { out[i][pos] = cur; cur += rs[i][size] + gap }
  return out
}
