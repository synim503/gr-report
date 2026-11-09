import { describe, it, expect } from 'vitest'
import { snapMove, resizeRect, align, distribute, bounds, clampToPage, MIN_SIZE } from './geometry'

const page = { w: 600, h: 800 }

describe('snapMove', () => {
  it('snaps left edge to page edge', () => {
    const r = snapMove({ x: 4, y: 100, w: 100, h: 50 }, [], page, 6)
    expect(r.dx).toBe(-4); expect(r.vGuides).toContain(0)
  })
  it('snaps right edge to page right', () => {
    const r = snapMove({ x: 497, y: 100, w: 100, h: 50 }, [], page, 6)
    expect(r.dx).toBe(3); expect(r.vGuides).toContain(600)
  })
  it('snaps element centre to page centre (both axes)', () => {
    const r = snapMove({ x: 248, y: 376, w: 100, h: 50 }, [], page, 6)
    expect(r.dx).toBe(2); expect(r.dy).toBe(0 + (400 - 401)); expect(r.vGuides).toContain(300); expect(r.hGuides).toContain(400)
  })
  it('snaps to the margin guide', () => {
    expect(snapMove({ x: 40, y: 200, w: 50, h: 50 }, [], page, 6).dx).toBe(-4)
  })
  it('snaps to a neighbour edge and aligns tops', () => {
    const other = { x: 200, y: 300, w: 100, h: 80 }
    const r = snapMove({ x: 303, y: 297, w: 60, h: 40 }, [other], page, 6)
    expect(r.dx).toBe(-3); expect(r.dy).toBe(3)
    expect(r.vGuides).toContain(300); expect(r.hGuides).toContain(300)
  })
  it('does not snap beyond the threshold', () => {
    const r = snapMove({ x: 100, y: 100, w: 50, h: 50 }, [], page, 6)
    expect(r.dx).toBe(0); expect(r.dy).toBe(0); expect(r.vGuides).toEqual([])
  })
  it('chooses the closest of several candidates', () => {
    const r = snapMove({ x: 102, y: 500, w: 50, h: 50 }, [{ x: 100, y: 0, w: 10, h: 10 }, { x: 105, y: 0, w: 10, h: 10 }], page, 6)
    expect(r.dx).toBe(-2)
  })
})

describe('resizeRect', () => {
  const start = { x: 100, y: 100, w: 200, h: 100 }
  it('east handle changes only width', () => {
    const { rect } = resizeRect(start, 'e', 50, 999, [], page, 6, { snap: false })
    expect(rect).toEqual({ x: 100, y: 100, w: 250, h: 100 })
  })
  it('north-west handle moves origin and shrinks', () => {
    const { rect } = resizeRect(start, 'nw', 30, 20, [], page, 6, { snap: false })
    expect(rect).toEqual({ x: 130, y: 120, w: 170, h: 80 })
  })
  it('enforces minimum size with opposite edge fixed', () => {
    const { rect } = resizeRect(start, 'w', 500, 0, [], page, 6, { snap: false })
    expect(rect.w).toBe(MIN_SIZE); expect(rect.x + rect.w).toBe(300)
  })
  it('snaps the moving edge to page edge', () => {
    const { rect, vGuides } = resizeRect(start, 'e', 297, 0, [], page, 6, { snap: true })
    expect(rect.x + rect.w).toBe(600); expect(vGuides).toContain(600)
  })
  it('does not exceed the page', () => {
    const { rect } = resizeRect(start, 'se', 5000, 5000, [], page, 6, { snap: false })
    expect(rect.x + rect.w).toBe(600); expect(rect.y + rect.h).toBe(800)
  })
  it('keeps aspect ratio for corner handles', () => {
    const { rect } = resizeRect(start, 'se', 100, 0, [], page, 6, { snap: false, keepAspect: true })
    expect(rect.w / rect.h).toBeCloseTo(2)
  })
})

describe('align / distribute', () => {
  const a = { x: 10, y: 10, w: 50, h: 20 }, b = { x: 100, y: 50, w: 80, h: 40 }
  it('aligns to page', () => {
    expect(align([a], 'hcenter', { x: 0, y: 0, ...page })[0].x).toBe(275)
    expect(align([a], 'right', { x: 0, y: 0, ...page })[0].x).toBe(550)
    expect(align([a], 'bottom', { x: 0, y: 0, ...page })[0].y).toBe(780)
    expect(align([a], 'vmiddle', { x: 0, y: 0, ...page })[0].y).toBe(390)
    expect(align([a], 'left', { x: 0, y: 0, ...page })[0].x).toBe(0)
    expect(align([a], 'top', { x: 0, y: 0, ...page })[0].y).toBe(0)
  })
  it('aligns several to the selection bounds', () => {
    const bb = bounds([a, b]); expect(bb).toEqual({ x: 10, y: 10, w: 170, h: 80 })
    const [ra, rb] = align([a, b], 'right', bb)
    expect(ra.x + ra.w).toBe(180); expect(rb.x + rb.w).toBe(180)
    const [ta, tb] = align([a, b], 'vmiddle', bb)
    expect(ta.y + ta.h / 2).toBe(50); expect(tb.y + tb.h / 2).toBe(50)
  })
  it('distributes horizontally with equal gaps and keeps order of input', () => {
    const rs = [{ x: 300, y: 0, w: 50, h: 10 }, { x: 0, y: 0, w: 50, h: 10 }, { x: 60, y: 0, w: 100, h: 10 }]
    const out = distribute(rs, 'h')
    // outer fixed: 0..350, widths 200 -> gap 75
    expect(out[1].x).toBe(0); expect(out[2].x).toBe(125); expect(out[0].x).toBe(300)
  })
  it('distribute with fewer than 3 is a no-op', () => { expect(distribute([a, b], 'v')).toEqual([a, b]) })
  it('clampToPage keeps rect inside', () => {
    expect(clampToPage({ x: -5, y: 790, w: 100, h: 50 }, page)).toEqual({ x: 0, y: 750, w: 100, h: 50 })
  })
})
