import { describe, it, expect } from 'vitest'
import { figureNumbers, orderedOnPage, pictureArea, captionLine, CAP_H } from './captions'
import { emptyTpl, makeEl } from './model'
import { El } from '../types'

const chart = (x: number, y: number, caption = true, extra: Partial<El> = {}) =>
  makeEl('chart', x, y, { w: 100, h: 50, chart: { dashboardUid: 'a', panelId: 1 }, ...(caption ? { caption: { text: 't', position: 'below' as const } } : {}), ...extra })
const tplOf = (...pages: El[][]) => ({ ...emptyTpl(), pages: pages.map(elements => ({ elements })) })

describe('figure numbering (same algorithm as the backend)', () => {
  it('reading order: rows top to bottom, then left to right, regardless of insertion order', () => {
    const br = chart(300, 400), tr = chart(300, 104), tl = chart(20, 100), bl = chart(20, 400)
    const n = figureNumbers(tplOf([br, tr, tl, bl]))
    expect([n[tl.id], n[tr.id], n[bl.id], n[br.id]]).toEqual([1, 2, 3, 4])
  })
  it('row tolerance of 8pt is measured from the first element of a row', () => {
    const left = chart(20, 100), rightHigher = chart(300, 92.5)
    expect(orderedOnPage([left, rightHigher]).map(e => e.id)).toEqual([left.id, rightHigher.id])
    const far = chart(20, 109), topRight = chart(300, 100)
    expect(orderedOnPage([far, topRight, left]).map(e => e.id)).toEqual([left.id, topRight.id, far.id])
  })
  it('continues over pages, skips uncaptioned elements and text blocks', () => {
    const a = chart(10, 10), plain = chart(10, 100, false), txt = makeEl('text', 10, 200, { caption: { text: '', position: 'below' } }), b = chart(10, 10)
    const n = figureNumbers(tplOf([a, plain, txt], [b]))
    expect(n).toEqual({ [a.id]: 1, [b.id]: 2 })
  })
  it('numbers update when elements move', () => {
    const a = chart(20, 100), b = chart(300, 100)
    expect(figureNumbers(tplOf([a, b]))[a.id]).toBe(1)
    expect(figureNumbers(tplOf([{ ...a, x: 400 }, b]))[a.id]).toBe(2)
  })
})

describe('caption geometry and text', () => {
  it('picture area excludes the caption line (below / above) and is the full box without a caption', () => {
    const e = chart(0, 0, true, { h: 200 })
    expect(pictureArea(e)).toEqual({ top: 0, height: 200 - CAP_H })
    expect(pictureArea({ ...e, caption: { text: '', position: 'above' } })).toEqual({ top: CAP_H, height: 200 - CAP_H })
    expect(pictureArea(chart(0, 0, false, { h: 80 }))).toEqual({ top: 0, height: 80 })
  })
  it('caption line: label, number, optional text', () => {
    expect(captionLine('Рисунок', 3, 'Загрузка CPU')).toBe('Рисунок 3 — Загрузка CPU')
    expect(captionLine('Рис.', 1, '  ')).toBe('Рис. 1')
    expect(captionLine('', 2, 'x')).toBe('Рисунок 2 — x')
  })
})
