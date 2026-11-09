import { describe, it, expect } from 'vitest'
import { reducer, emptyTpl, makeEl, State } from './model'

const init = (): State => ({ tpl: emptyTpl(), past: [], future: [], dirty: false })
const add = (s: State, x = 0) => reducer(s, { t: 'add', page: 0, el: makeEl('text', x, 0) })

describe('model reducer', () => {
  it('adds elements with increasing z', () => {
    let s = add(add(init()), 10)
    expect(s.tpl.pages[0].elements.map(e => e.z)).toEqual([0, 1]); expect(s.dirty).toBe(true)
  })
  it('undo / redo', () => {
    let s = add(init())
    s = reducer(s, { t: 'undo' }); expect(s.tpl.pages[0].elements).toHaveLength(0)
    s = reducer(s, { t: 'redo' }); expect(s.tpl.pages[0].elements).toHaveLength(1)
  })
  it('a drag (checkpoint + many patches) is a single undo step', () => {
    let s = add(init()); const id = s.tpl.pages[0].elements[0].id
    s = reducer(s, { t: 'checkpoint' })
    for (let i = 1; i <= 5; i++) s = reducer(s, { t: 'setRects', page: 0, rects: { [id]: { x: i * 10, y: 0, w: 200, h: 100 } } })
    expect(s.tpl.pages[0].elements[0].x).toBe(50)
    s = reducer(s, { t: 'undo' }); expect(s.tpl.pages[0].elements[0].x).toBe(0)
  })
  it('setRects clamps to the page', () => {
    let s = add(init()); const id = s.tpl.pages[0].elements[0].id
    s = reducer(s, { t: 'setRects', page: 0, rects: { [id]: { x: 9999, y: -50, w: 100, h: 100 } } })
    const e = s.tpl.pages[0].elements[0]; expect(e.x).toBeCloseTo(495.28); expect(e.y).toBe(0)
  })
  it('duplicate offsets and gets new ids on top', () => {
    let s = add(init()); const e0 = s.tpl.pages[0].elements[0]
    s = reducer(s, { t: 'duplicate', page: 0, ids: [e0.id] })
    const [a, b] = s.tpl.pages[0].elements; expect(b.id).not.toBe(a.id); expect(b.x).toBe(a.x + 12); expect(b.z).toBeGreaterThan(a.z)
  })
  it('remove', () => {
    let s = add(init()); s = reducer(s, { t: 'remove', page: 0, ids: [s.tpl.pages[0].elements[0].id] })
    expect(s.tpl.pages[0].elements).toHaveLength(0)
  })
  it('z-order front/back/forward/backward', () => {
    let s = init(); for (let i = 0; i < 3; i++) s = add(s, i)
    const ids = s.tpl.pages[0].elements.map(e => e.id)
    const order = (st: State) => [...st.tpl.pages[0].elements].sort((a, b) => a.z - b.z).map(e => ids.indexOf(e.id))
    s = reducer(s, { t: 'order', page: 0, ids: [ids[0]], where: 'front' }); expect(order(s)).toEqual([1, 2, 0])
    s = reducer(s, { t: 'order', page: 0, ids: [ids[0]], where: 'backward' }); expect(order(s)).toEqual([1, 0, 2])
    s = reducer(s, { t: 'order', page: 0, ids: [ids[2]], where: 'back' }); expect(order(s)).toEqual([2, 1, 0])
    s = reducer(s, { t: 'order', page: 0, ids: [ids[2]], where: 'forward' }); expect(order(s)).toEqual([1, 2, 0])
  })
  it('pages: add, remove, never below one', () => {
    let s = reducer(init(), { t: 'addPage' }); expect(s.tpl.pages).toHaveLength(2)
    s = reducer(s, { t: 'removePage', page: 1 }); expect(s.tpl.pages).toHaveLength(1)
    expect(reducer(s, { t: 'removePage', page: 0 }).tpl.pages).toHaveLength(1)
  })
  it('resizing the page pulls elements back inside', () => {
    let s = add(init(), 500)
    s = reducer(s, { t: 'resizePage', w: 419.53, h: 595.28 })
    const e = s.tpl.pages[0].elements[0]; expect(e.x + e.w).toBeLessThanOrEqual(419.53 + 1e-6)
  })
  it('load resets history; saved clears dirty', () => {
    let s = add(init()); s = reducer(s, { t: 'saved', id: 'abc' }); expect(s.dirty).toBe(false); expect(s.tpl.id).toBe('abc')
    s = reducer(s, { t: 'load', tpl: emptyTpl() }); expect(s.past).toHaveLength(0)
  })
})

describe('block actions', () => {
  it('addMany adds in one undo step; chartVars updates only given elements; ungroup drops group', () => {
    let s = init()
    const els = [makeEl('chart', 0, 0, { chart: { dashboardUid: 'u', panelId: 1, vars: { host: 'a' } }, group: { id: 'g' } }),
                 makeEl('chart', 0, 0, { chart: { dashboardUid: 'u', panelId: 2, vars: { host: 'a' } }, group: { id: 'g' } })]
    s = reducer(s, { t: 'addMany', page: 0, els })
    expect(s.tpl.pages[0].elements.map(e => e.z)).toEqual([0, 1])
    s = reducer(s, { t: 'chartVars', page: 0, ids: [els[0].id], vars: { host: 'b', job: 'n' } })
    expect(s.tpl.pages[0].elements[0].chart!.vars).toEqual({ host: 'b', job: 'n' })
    expect(s.tpl.pages[0].elements[1].chart!.vars).toEqual({ host: 'a' })
    s = reducer(s, { t: 'ungroup', page: 0, ids: els.map(e => e.id) })
    expect(s.tpl.pages[0].elements.every(e => !e.group)).toBe(true)
    s = reducer(s, { t: 'undo' }); s = reducer(s, { t: 'undo' }); s = reducer(s, { t: 'undo' })
    expect(s.tpl.pages[0].elements).toHaveLength(0)
  })
})

describe('captions action', () => {
  it('sets and removes captions in one undo step', () => {
    let s = init()
    const els = [makeEl('chart', 0, 0, { chart: { dashboardUid: 'u', panelId: 1 } }), makeEl('chart', 0, 100, { chart: { dashboardUid: 'u', panelId: 2 } })]
    s = reducer(s, { t: 'addMany', page: 0, els })
    s = reducer(s, { t: 'captions', page: 0, items: { [els[0].id]: { text: 'a', position: 'below' }, [els[1].id]: { text: 'b', position: 'above' } } })
    expect(s.tpl.pages[0].elements.map(e => e.caption?.text)).toEqual(['a', 'b'])
    s = reducer(s, { t: 'captions', page: 0, items: { [els[0].id]: null } })
    expect(s.tpl.pages[0].elements[0].caption).toBeUndefined(); expect(s.tpl.pages[0].elements[1].caption?.position).toBe('above')
    s = reducer(s, { t: 'undo' }); expect(s.tpl.pages[0].elements[0].caption?.text).toBe('a')
  })
})
