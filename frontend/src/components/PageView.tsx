import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, Editor } from '@tiptap/react'
import { El, Tpl } from '../types'
import { Action } from '../lib/model'
import { Handle, Rect, bounds, clampToPage, resizeRect, snapMove } from '../lib/geometry'
import { expandGroups } from '../lib/blocks'
import { sanitizeHtml } from '../lib/sanitize'
import { panelImageUrl, resolveRefs } from '../api'
import { ChartPreview } from './ChartPreview'
import { extensions } from './editorExtensions'
import { Icon } from './Icon'
import { CAP_H, captionLine, figureNumbers, hasCaption, pictureArea } from '../lib/captions'

export const DND_MIME = 'application/x-reporter'
export type DropPayload =
  | { kind: 'text' }
  | { kind: 'panel'; chart: { dashboardUid: string; panelId: number; title?: string }; w: number; h: number; vars?: Record<string, string> }
  | { kind: 'block'; blockId: string }

export interface Selection { page: number; ids: string[] }

interface Props {
  index: number
  tpl: Tpl
  scale: number
  snap: boolean
  sel: Selection
  editingId: string | null
  dispatch: (a: Action) => void
  onSelect: (s: Selection) => void
  onEdit: (id: string | null) => void
  onEditor: (e: Editor | null) => void
  onDrop: (page: number, x: number, y: number, payload: DropPayload) => void
  onDropFile: (page: number, x: number, y: number, file: File) => void
  onDeletePage: (page: number) => void
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const cursor: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }

function handlePos(h: Handle, r: Rect) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : cx
  const y = h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : cy
  return { x, y }
}

export function PageView(p: Props) {
  const { index, tpl, scale, sel, editingId } = p
  const page = tpl.pages[index]
  const pageSize = { w: tpl.pageWidth, h: tpl.pageHeight }
  const innerRef = useRef<HTMLDivElement>(null)
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })
  const [dropping, setDropping] = useState(false)
  const numbers = useMemo(() => figureNumbers(tpl), [tpl])
  const latest = useRef({ p, page })
  latest.current = { p, page }

  const selectedHere = sel.page === index ? sel.ids : []
  const selEls = page.elements.filter(e => selectedHere.includes(e.id))

  // ---------- drag / resize ----------
  function begin(e: React.PointerEvent, ids: string[], mode: { type: 'move' } | { type: 'resize'; handle: Handle }, collapseTo?: string[]) {
    const startX = e.clientX, startY = e.clientY
    const els = latest.current.page.elements
    const picked = els.filter(x => ids.includes(x.id))
    const startRects: Record<string, Rect> = {}
    picked.forEach(x => { startRects[x.id] = { x: x.x, y: x.y, w: x.w, h: x.h } })
    const others: Rect[] = els.filter(x => !ids.includes(x.id)).map(x => ({ x: x.x, y: x.y, w: x.w, h: x.h }))
    const box = bounds(Object.values(startRects))
    let started = false

    const move = (ev: PointerEvent) => {
      const { p: pp } = latest.current
      const dx = (ev.clientX - startX) / pp.scale, dy = (ev.clientY - startY) / pp.scale
      if (!started) {
        if (Math.abs(dx) + Math.abs(dy) < 2 / pp.scale) return
        started = true
        pp.dispatch({ t: 'checkpoint' })
      }
      const th = 6 / pp.scale
      const useSnap = pp.snap && !ev.altKey
      if (mode.type === 'move') {
        let m = clampToPage({ x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }, pageSize)
        if (useSnap) {
          const s = snapMove(m, others, pageSize, th)
          m = clampToPage({ ...m, x: m.x + s.dx, y: m.y + s.dy }, pageSize)
          setGuides({ v: s.vGuides, h: s.hGuides })
        }
        const ox = m.x - box.x, oy = m.y - box.y
        const rects: Record<string, Rect> = {}
        for (const id of ids) { const r = startRects[id]; rects[id] = { ...r, x: r.x + ox, y: r.y + oy } }
        pp.dispatch({ t: 'setRects', page: index, rects })
      } else {
        const id = ids[0]
        const res = resizeRect(startRects[id], mode.handle, dx, dy, others, pageSize, th, { snap: useSnap, keepAspect: ev.shiftKey })
        setGuides({ v: res.vGuides, h: res.hGuides })
        pp.dispatch({ t: 'setRects', page: index, rects: { [id]: res.rect } })
      }
    }
    const up = () => {
      // a plain click (no drag) on one item of a multi-selection narrows the selection to it
      if (!started && collapseTo) latest.current.p.onSelect({ page: index, ids: collapseTo })
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setGuides({ v: [], h: [] })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function onElDown(e: React.PointerEvent, el: El) {
    if (e.button !== 0 || editingId === el.id) return
    e.stopPropagation()
    p.onEdit(null)
    const single = e.ctrlKey || e.metaKey
    const ids = single ? [el.id] : expandGroups(page.elements, [el.id])
    const already = selectedHere.includes(el.id)
    let next: string[]
    if (e.shiftKey) next = already ? selectedHere.filter(i => !ids.includes(i)) : [...new Set([...selectedHere, ...ids])]
    else next = already && !single ? selectedHere : ids
    p.onSelect({ page: index, ids: next })
    if (e.shiftKey && already) return
    const collapse = !e.shiftKey && already && !single && selectedHere.length > ids.length ? ids : undefined
    if (next.length) begin(e, next, { type: 'move' }, collapse)
  }

  // ---------- drop ----------
  const pos = (ev: React.DragEvent) => {
    const r = innerRef.current!.getBoundingClientRect()
    return { x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale }
  }
  const hasPayload = (ev: React.DragEvent) => ev.dataTransfer.types.includes(DND_MIME) || ev.dataTransfer.types.includes('Files')

  const selBox = selEls.length ? bounds(selEls) : null
  const single = selEls.length === 1 && !editingId ? selEls[0] : null

  return (
    <div className="pagewrap" data-testid={`pagewrap-${index}`}>
      <div className="pagehead">
        <span>Страница {index + 1}</span>
        {tpl.pages.length > 1 && <button className="danger ghost" data-testid={`delete-page-${index}`} onClick={() => p.onDeletePage(index)}><Icon name="trash" size={13} /> Удалить страницу</button>}
      </div>
      <div className={`page${dropping ? ' dropping' : ''}`} data-testid={`page-${index}`}
        style={{ width: tpl.pageWidth * scale, height: tpl.pageHeight * scale }}
        onPointerDown={() => { p.onEdit(null); p.onSelect({ page: index, ids: [] }) }}
        onDragOver={ev => { if (hasPayload(ev)) { ev.preventDefault(); setDropping(true) } }}
        onDragLeave={() => setDropping(false)}
        onDrop={ev => {
          setDropping(false)
          if (!hasPayload(ev)) return
          ev.preventDefault()
          const { x, y } = pos(ev)
          const raw = ev.dataTransfer.getData(DND_MIME)
          if (raw) p.onDrop(index, x, y, JSON.parse(raw) as DropPayload)
          else if (ev.dataTransfer.files[0]) p.onDropFile(index, x, y, ev.dataTransfer.files[0])
        }}>
        <div ref={innerRef} className="page-inner" style={{ width: tpl.pageWidth, height: tpl.pageHeight, transform: `scale(${scale})` }}>
          <div className="margin-box" style={{ left: 36, top: 36, width: tpl.pageWidth - 72, height: tpl.pageHeight - 72 }} />
          {page.elements.map(el => (
            <ElementView key={el.id} el={el} tpl={tpl} figure={numbers[el.id]} selected={selectedHere.includes(el.id)} multi={selectedHere.length > 1}
              editing={editingId === el.id}
              onDown={e => onElDown(e, el)}
              onDouble={() => { if (el.type === 'text') { p.onSelect({ page: index, ids: [el.id] }); p.dispatch({ t: 'checkpoint' }); p.onEdit(el.id) } }}
              onHtml={html => p.dispatch({ t: 'patch', page: index, ids: [el.id], patch: { html } })}
              onEditor={p.onEditor} />
          ))}
          {selBox && !editingId && selEls.length > 1 && <div className="selbox" data-testid="selection-box" style={{ left: selBox.x, top: selBox.y, width: selBox.w, height: selBox.h }} />}
          {single && HANDLES.map(h => {
            const hp = handlePos(h, single)
            return <div key={h} className="handle" data-testid={`handle-${h}`} style={{ left: hp.x - 4.5, top: hp.y - 4.5, cursor: cursor[h], transform: `scale(${1 / scale * 1.2})` }}
              onPointerDown={e => { e.stopPropagation(); e.preventDefault(); begin(e, [single.id], { type: 'resize', handle: h }) }} />
          })}
          {guides.v.map((x, i) => <div key={`v${i}`} className="guide-v" data-testid="guide-v" style={{ left: x, width: 1 / scale }} />)}
          {guides.h.map((y, i) => <div key={`h${i}`} className="guide-h" data-testid="guide-h" style={{ top: y, height: 1 / scale }} />)}
        </div>
        {page.elements.length === 0 && (
          <div className="empty-hint" data-testid="empty-hint">
            <span className="badge"><Icon name="layers" size={26} /></span>
            <div><b>Пустая страница</b><br />Перетащите сюда график, блок или текст из левой панели</div>
          </div>
        )}
      </div>
    </div>
  )
}

function ElementView(p: {
  el: El; tpl: Tpl; figure?: number; selected: boolean; multi: boolean; editing: boolean
  onDown: (e: React.PointerEvent) => void; onDouble: () => void; onHtml: (h: string) => void; onEditor: (e: Editor | null) => void
}) {
  const { el } = p
  const cls = `el ${el.type}${p.selected ? (p.multi ? ' group-sel' : ' sel') : ''}${p.editing ? ' editing' : ''}`
  return (
    <div className={cls} data-testid={`el-${el.type}`} data-el-id={el.id} data-group={el.group?.id}
      style={{ left: el.x, top: el.y, width: el.w, height: el.h, zIndex: el.z, cursor: p.editing ? 'text' : 'move' }}
      onPointerDown={p.onDown} onDoubleClick={p.onDouble}>
      {el.type === 'text' && (p.editing
        ? <TextEditor html={el.html ?? ''} lineHeight={el.lineHeight ?? 1} onHtml={p.onHtml} onEditor={p.onEditor} />
        : <div className="text-static" data-testid="text-static" style={{ lineHeight: el.lineHeight ?? 1 }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(substitutePreview(el.html ?? '', p.tpl)) }} />)}
      {(el.type === 'chart' || el.type === 'image') && (() => {
        const area = pictureArea(el)
        return (
          <div className="pic" style={{ top: area.top, height: area.height }}>
            {el.type === 'chart' && el.chart && <>
              <VarBadge vars={el.chart.vars} report={p.tpl.variables} w={el.w} h={area.height} />
              <ChartPreview title={el.chart.title}
                url={panelImageUrl({ ...el.chart, from: el.chart.from || p.tpl.timeRange.from, to: el.chart.to || p.tpl.timeRange.to },
                  Math.max(100, Math.round(el.w * 96 / 72 / 50) * 50), Math.max(60, Math.round(area.height * 96 / 72 / 50) * 50), p.tpl.variables)} />
            </>}
            {el.type === 'image' && (el.dataUrl ? <img src={el.dataUrl} alt="" /> : <div className="ph">Изображение</div>)}
          </div>
        )
      })()}
      {hasCaption(el) && p.figure !== undefined && (
        <div className="cap" data-testid="figure-caption" style={{ height: CAP_H, ...(el.caption!.position === 'above' ? { top: 0 } : { bottom: 0 }) }}>
          <b>{(p.tpl.captionLabel?.trim() || 'Рисунок')} {p.figure}</b>
          {substitutePreview(el.caption!.text ?? '', p.tpl).trim() ? ` — ${substitutePreview(el.caption!.text, p.tpl).trim()}` : ''}
        </div>
      )}
    </div>
  )
}

/** Editor-only chip line showing which dashboard variables the chart is rendered with (not part of the document). */
function VarBadge({ vars, report, w, h }: { vars?: Record<string, string>; report: Record<string, string>; w: number; h: number }) {
  const e = Object.entries(vars ?? {}).filter(([, v]) => v !== '').map(([k, v]) => [k, resolveRefs(v, report)] as const)
  if (!e.length) return null
  const title = e.map(([k, v]) => `${k} = ${v}`).join('\n')
  if (w < 150 || h < 60)                                    // small charts: just a counter, details in the tooltip
    return <div className="var-badge mini" data-testid="var-badge" title={title}><span>{e.length}</span></div>
  return <div className="var-badge" data-testid="var-badge" title={title}><span>{e.map(([k, v]) => `${k} ${v}`).join(' · ')}</span></div>
}

/** Shows report variables / built-ins in the canvas the way they will appear in the document. */
function substitutePreview(html: string, tpl: Tpl): string {
  const today = new Date().toISOString().slice(0, 10)
  const vars: Record<string, string> = { date: today, datetime: `${today} ${new Date().toTimeString().slice(0, 5)}`, from: tpl.timeRange.from, to: tpl.timeRange.to, name: tpl.name, ...tpl.variables }
  return resolveRefs(html, vars)
}

function TextEditor({ html, lineHeight, onHtml, onEditor }: { html: string; lineHeight: number; onHtml: (h: string) => void; onEditor: (e: Editor | null) => void }) {
  const editor = useEditor({ extensions, content: html, autofocus: 'end', onUpdate: ({ editor }) => onHtml(editor.getHTML()) })
  useEffect(() => { onEditor(editor); return () => onEditor(null) }, [editor])  // eslint-disable-line react-hooks/exhaustive-deps
  return <EditorContent editor={editor} style={{ lineHeight }} data-testid="text-editor" />
}
