import { describe, it, expect } from 'vitest'
import { instantiateBlock, instantiateBlockPages, blockFromElements, expandGroups, groupVars, alignUnits, distributeUnits, moveUnitTo } from './blocks'
import { makeEl } from './model'
import { Block } from '../types'

const block: Block = {
  id: 'b1', name: 'Linux', dashboardUid: 'lin', width: 400, height: 200,
  variables: [{ name: 'host', defaultValue: 'srv1' }, { name: 'job', defaultValue: 'node' }],
  charts: [{ panelId: 1, title: 'CPU', x: 0, y: 0, w: 200, h: 100 }, { panelId: 2, title: 'Mem', x: 200, y: 0, w: 200, h: 100 }, { panelId: 3, x: 0, y: 100, w: 400, h: 100 }],
}
const page = { w: 595, h: 842 }

describe('instantiateBlock', () => {
  it('creates all charts with relative layout preserved and a shared group', () => {
    const els = instantiateBlock(block, { host: 'web-01' }, 50, 60, page)
    expect(els).toHaveLength(3)
    expect(els.map(e => [e.x, e.y])).toEqual([[50, 60], [250, 60], [50, 160]])
    expect(new Set(els.map(e => e.group!.id)).size).toBe(1)
    expect(els[0].group!.presetId).toBe('b1')
    expect(els.every(e => e.chart!.dashboardUid === 'lin')).toBe(true)
  })
  it('passes variables to every chart, falling back to defaults', () => {
    const els = instantiateBlock(block, { host: 'web-01' }, 0, 0, page)
    for (const e of els) expect(e.chart!.vars).toEqual({ host: 'web-01', job: 'node' })
  })
  it('scales down to the page width (not height) and keeps proportions', () => {
    const els = instantiateBlock({ ...block, width: 1046, height: 200 }, {}, 400, 0, { w: 595, h: 842 })   // usable width 523 = half
    expect(Math.max(...els.map(e => e.x + e.w))).toBeLessThanOrEqual(595.01)
    expect(els[0].w).toBeCloseTo(200 * 523 / 1046, 0)
    expect(els[0].h / els[0].w).toBeCloseTo(0.5, 1)
  })
  it('clamps drop position so the block stays on the page', () => {
    const els = instantiateBlock(block, {}, 500, 800, page)
    expect(Math.max(...els.map(e => e.x + e.w))).toBeLessThanOrEqual(595); expect(Math.max(...els.map(e => e.y + e.h))).toBeLessThanOrEqual(842)
  })
})

describe('whole dashboards (taller than a page)', () => {
  // 30 grid rows of two half-width charts, 100pt tall each -> 3000pt: needs ~4 pages
  const tall: Block = { id: 't', name: 'Linux', dashboardUid: 'lin', width: 400, height: 3000, variables: [{ name: 'host', defaultValue: 'a' }],
    charts: Array.from({ length: 60 }, (_, i) => ({ panelId: i + 1, title: `P${i + 1}`, x: (i % 2) * 200, y: Math.floor(i / 2) * 100, w: 200, h: 100 })) }
  const pages = instantiateBlockPages(tall, {}, 300, 500, page)

  it('is split over several pages instead of being squeezed into one', () => {
    expect(pages.length).toBeGreaterThan(3)
    expect(pages.flat()).toHaveLength(60)
    for (const els of pages) for (const e of els) { expect(e.w).toBe(200); expect(e.h).toBe(100) }       // no shrinking
  })
  it('keeps every chart inside the page margins and starts each page at the top margin', () => {
    for (const els of pages) {
      for (const e of els) { expect(e.y).toBeGreaterThanOrEqual(36); expect(e.y + e.h).toBeLessThanOrEqual(842 - 36 + 0.01); expect(e.x + e.w).toBeLessThanOrEqual(595) }
      expect(Math.min(...els.map(e => e.y))).toBe(36)
    }
  })
  it('keeps the rows intact: charts of one dashboard row stay together and in order', () => {
    const order = pages.flat().map(e => e.chart!.panelId); expect(order).toEqual([...order].sort((a, b) => a - b))
    for (const els of pages) { const ys = els.map(e => e.y); for (let i = 0; i < els.length; i += 2) expect(els[i].y).toBe(els[i + 1].y) }
  })
  it('every page has its own group and all charts carry the variables', () => {
    expect(new Set(pages.map(p => p[0].group!.id)).size).toBe(pages.length)
    expect(pages.flat().every(e => e.chart!.vars!.host === 'a')).toBe(true)
  })
  it('a block that fits one page is still a single page, placed where dropped', () => {
    const one = instantiateBlockPages(block, {}, 100, 100, page); expect(one).toHaveLength(1); expect(one[0][0].y).toBe(100)
  })
})

describe('groups', () => {
  it('selecting one member selects the whole block, plain elements stay single', () => {
    const els = [...instantiateBlock(block, {}, 0, 0, page), makeEl('text', 300, 500)]
    expect(expandGroups(els, [els[1].id]).sort()).toEqual([els[0].id, els[1].id, els[2].id].sort())
    expect(expandGroups(els, [els[3].id])).toEqual([els[3].id])
  })
  it('groupVars reads the first chart', () => {
    expect(groupVars(instantiateBlock(block, { host: 'x' }, 0, 0, page))).toEqual({ host: 'x', job: 'node' })
  })
})

describe('blockFromElements', () => {
  it('round-trips layout relative to bounding box and keeps variables', () => {
    const els = instantiateBlock(block, { host: 'a' }, 100, 100, page)
    const { block: b } = blockFromElements(els, 'Copy')
    expect(b!.width).toBe(400); expect(b!.height).toBe(200)
    expect(b!.charts[1]).toMatchObject({ panelId: 2, x: 200, y: 0 })
    expect(b!.variables).toEqual([{ name: 'host', label: 'host', defaultValue: 'a' }, { name: 'job', label: 'job', defaultValue: 'node' }])
  })
  it('rejects mixed dashboards and empty selections', () => {
    const a = instantiateBlock(block, {}, 0, 0, page), b = instantiateBlock({ ...block, dashboardUid: 'other' }, {}, 0, 0, page)
    expect(blockFromElements([a[0], b[0]], 'x').error).toMatch(/одного дашборда/)
    expect(blockFromElements([makeEl('text', 0, 0)], 'x').error).toBeTruthy()
  })
})

describe('block-aware alignment', () => {
  const pageRect = { x: 0, y: 0, w: 595, h: 842 }
  it('aligning a block aligns it as one unit and keeps its internal layout', () => {
    const els = instantiateBlock(block, {}, 100, 100, page)          // spans x 100..500
    const out = alignUnits(els, 'hcenter', pageRect)
    const dx = out[els[0].id].x - els[0].x
    expect(dx).toBeCloseTo((595 - 400) / 2 - 100)
    for (const e of els) { expect(out[e.id].x - e.x).toBeCloseTo(dx); expect(out[e.id].y).toBe(e.y) }
    const right = alignUnits(els, 'right', pageRect)
    expect(Math.max(...els.map(e => right[e.id].x + right[e.id].w))).toBeCloseTo(595)
  })
  it('a block and a loose element align to their common bounds', () => {
    const els = [...instantiateBlock(block, {}, 100, 100, page), makeEl('text', 450, 400, { w: 100, h: 50 })]
    const out = alignUnits(els, 'left', pageRect)
    expect(out[els[3].id].x).toBe(100)                                // text moves to the block's left edge
    expect(out[els[0].id].x).toBe(100); expect(out[els[1].id].x).toBe(300)   // block untouched
  })
  it('distribute treats a block as one item', () => {
    const a = makeEl('text', 0, 0, { w: 50, h: 20 }), c = makeEl('text', 500, 0, { w: 50, h: 20 })
    const blk = instantiateBlock({ ...block, width: 100, height: 40, charts: [block.charts[0], block.charts[1]].map((ch, i) => ({ ...ch, x: i * 50, w: 50, h: 40, y: 0 })) }, {}, 120, 0, page)
    const out = distributeUnits([a, ...blk, c], 'h')
    expect(out[blk[0].id].x - out[blk[1].id].x).toBe(-50)             // internal spacing kept
    const gap1 = out[blk[0].id].x - 50, gap2 = 500 - (out[blk[1].id].x + 50)
    expect(gap1).toBeCloseTo(gap2)
  })
  it('moveUnitTo moves the block bounding box', () => {
    const els = instantiateBlock(block, {}, 100, 100, page)
    const out = moveUnitTo(els, 10, 20)
    expect(out[els[0].id]).toMatchObject({ x: 10, y: 20 }); expect(out[els[1].id]).toMatchObject({ x: 210, y: 20 })
  })
})
