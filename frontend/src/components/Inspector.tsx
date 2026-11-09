import { useState } from 'react'
import { El, PAGE_SIZES, Tpl } from '../types'
import { Action } from '../lib/model'
import { AlignMode, Rect, bounds } from '../lib/geometry'
import { alignUnits, distributeUnits, groupMembers, groupVars, moveUnitTo, selectionUnits } from '../lib/blocks'
import { Selection } from './PageView'
import { Icon, IconName } from './Icon'
import { VarField } from './VarField'
import { useDashboard } from '../lib/useDashboard'
import { api } from '../api'
import { captionLine, figureNumbers } from '../lib/captions'

interface Props {
  tpl: Tpl
  sel: Selection
  dispatch: (a: Action) => void
  snap: boolean
  setSnap: (v: boolean) => void
  onSaveBlock: () => void
}

const N = ({ label, value, onChange, id, step = 1 }: { label: string; value: number; onChange: (v: number) => void; id: string; step?: number }) => (
  <div className="row" style={{ margin: 0 }}><label style={{ width: 20 }}>{label}</label>
    <input data-testid={id} type="number" step={step} value={Math.round(value * 10) / 10} onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v) }} /></div>
)

export function Inspector({ tpl, sel, dispatch, snap, setSnap, onSaveBlock }: Props) {
  const page = tpl.pages[sel.page]
  const els = page ? page.elements.filter(e => sel.ids.includes(e.id)) : []
  const pageRect: Rect = { x: 0, y: 0, w: tpl.pageWidth, h: tpl.pageHeight }

  const apply = (rects: Record<string, Rect>) => { dispatch({ t: 'checkpoint' }); dispatch({ t: 'setRects', page: sel.page, rects }) }
  const units = selectionUnits(els)
  const doAlign = (mode: AlignMode) => apply(alignUnits(els, mode, pageRect))
  const doDist = (axis: 'h' | 'v') => apply(distributeUnits(els, axis))

  if (!els.length) return <PageSettings tpl={tpl} dispatch={dispatch} snap={snap} setSnap={setSnap} />

  const one = els.length === 1 ? els[0] : null
  const members = page ? groupMembers(page.elements, els[0].id) : []
  const inGroup = els.length > 0 && els.every(e => e.group) && new Set(els.map(e => e.group!.id)).size === 1 && members.length === els.length
  const charts = els.filter(e => e.type === 'chart')
  const patch = (pt: Partial<El>) => dispatch({ t: 'patch', page: sel.page, ids: sel.ids, patch: pt })

  return (
    <div className="side right" data-testid="inspector">
      <h3>{inGroup ? `Блок «${els[0].group!.name ?? ''}»` : one ? { text: 'Текст', chart: 'График', image: 'Изображение' }[one.type] : `Выбрано: ${els.length}`}</h3>
      {one && (
        <div className="row" style={{ gap: 4 }}>
          <N label="X" id="ins-x" value={one.x} onChange={v => { dispatch({ t: 'checkpoint' }); dispatch({ t: 'setRects', page: sel.page, rects: { [one.id]: { x: v, y: one.y, w: one.w, h: one.h } } }) }} />
          <N label="Y" id="ins-y" value={one.y} onChange={v => { dispatch({ t: 'checkpoint' }); dispatch({ t: 'setRects', page: sel.page, rects: { [one.id]: { x: one.x, y: v, w: one.w, h: one.h } } }) }} />
          <N label="W" id="ins-w" value={one.w} onChange={v => { dispatch({ t: 'checkpoint' }); dispatch({ t: 'setRects', page: sel.page, rects: { [one.id]: { x: one.x, y: one.y, w: Math.max(20, v), h: one.h } } }) }} />
          <N label="H" id="ins-h" value={one.h} onChange={v => { dispatch({ t: 'checkpoint' }); dispatch({ t: 'setRects', page: sel.page, rects: { [one.id]: { x: one.x, y: one.y, w: one.w, h: Math.max(20, v) } } }) }} />
        </div>
      )}
      {!one && units.length === 1 && (() => { const b = bounds(els); return (
        <div className="row" style={{ gap: 4 }}>
          <N label="X" id="ins-x" value={b.x} onChange={v => apply(moveUnitTo(els, v, b.y))} />
          <N label="Y" id="ins-y" value={b.y} onChange={v => apply(moveUnitTo(els, b.x, v))} />
        </div>) })()}
      <div className="muted" style={{ fontSize: 11 }}>pt (1/72 дюйма){units.length > 1 ? ' · выравнивание — по границам выделения' : ' · выравнивание — по странице'}</div>

      <h3>Выравнивание</h3>
      <div className="btnrow grid3">
        {([['left', 'alignLeft', 'Лево'], ['hcenter', 'alignHCenter', 'Центр'], ['right', 'alignRight', 'Право'], ['top', 'alignTop', 'Верх'], ['vmiddle', 'alignVMiddle', 'Середина'], ['bottom', 'alignBottom', 'Низ']] as [AlignMode, IconName, string][]).map(([m, ic, l]) =>
          <button key={m} data-testid={`align-${m}`} title={l} onClick={() => doAlign(m)}><Icon name={ic} />{l}</button>)}
      </div>
      <div className="btnrow">
        <button data-testid="dist-h" disabled={units.length < 3} onClick={() => doDist('h')}><Icon name="distH" /> По горизонтали</button>
        <button data-testid="dist-v" disabled={units.length < 3} onClick={() => doDist('v')}><Icon name="distV" /> По вертикали</button>
      </div>

      <h3>Порядок и действия</h3>
      <div className="btnrow">
        <button data-testid="z-front" onClick={() => dispatch({ t: 'order', page: sel.page, ids: sel.ids, where: 'front' })}><Icon name="front" /> Вперёд</button>
        <button data-testid="z-back" onClick={() => dispatch({ t: 'order', page: sel.page, ids: sel.ids, where: 'back' })}><Icon name="back" /> Назад</button>
        <button data-testid="duplicate" onClick={() => dispatch({ t: 'duplicate', page: sel.page, ids: sel.ids })}><Icon name="copy" /> Дублировать</button>
        <button className="danger" data-testid="delete" onClick={() => dispatch({ t: 'remove', page: sel.page, ids: sel.ids })}><Icon name="trash" /> Удалить</button>
      </div>

      {one?.type === 'text' && (
        <>
          <h3>Текст</h3>
          <div className="row"><label>Интервал</label>
            <select data-testid="line-height" value={one.lineHeight ?? 1} onChange={e => { dispatch({ t: 'checkpoint' }); patch({ lineHeight: Number(e.target.value) }) }}>
              {[1, 1.15, 1.5, 2, 2.5, 3].map(v => <option key={v} value={v}>{v}</option>)}
            </select></div>
        </>
      )}

      {one && (one.type === 'chart' || one.type === 'image') && <CaptionProps el={one} page={sel.page} dispatch={dispatch} tpl={tpl} />}
      {els.filter(e => e.type === 'chart' || e.type === 'image').length > 0 && (els.length > 1 || inGroup) && (
        <>
          <h3>Подписи</h3>
          <div className="btnrow">
            <button data-testid="cap-all" onClick={() => dispatch({ t: 'captions', page: sel.page, items: Object.fromEntries(els.filter(e => e.type === 'chart' || e.type === 'image')
              .map(e => [e.id, e.caption ?? { text: e.chart?.title ?? '', position: 'below' as const }])) })}><Icon name="type" /> Подписать все</button>
            <button data-testid="cap-none" onClick={() => dispatch({ t: 'captions', page: sel.page, items: Object.fromEntries(els.filter(e => e.type === 'chart' || e.type === 'image').map(e => [e.id, null])) })}>Убрать подписи</button>
          </div>
          <div className="muted" style={{ fontSize: 11 }}>Текст по умолчанию — название панели; номера присваиваются автоматически по порядку чтения.</div>
        </>
      )}
      {inGroup && <GroupVars key={els[0].group!.id} els={members} page={sel.page} dispatch={dispatch} onSaveBlock={onSaveBlock} />}
      {!inGroup && charts.length > 0 && <div className="btnrow"><button data-testid="save-block" onClick={onSaveBlock}><Icon name="layers" /> Сохранить графики как блок…</button></div>}
      {one?.type === 'chart' && one.chart && !inGroup && <ChartProps el={one} page={sel.page} dispatch={dispatch} tpl={tpl} />}
      {one?.type === 'chart' && one.chart && inGroup && <ChartProps el={one} page={sel.page} dispatch={dispatch} tpl={tpl} compact />}
    </div>
  )
}

function CaptionProps({ el, page, dispatch, tpl }: { el: El; page: number; dispatch: (a: Action) => void; tpl: Tpl }) {
  const c = el.caption
  const n = figureNumbers(tpl)[el.id]
  const label = tpl.captionLabel?.trim() || 'Рисунок'
  return (
    <>
      <h3>Подпись</h3>
      <label className="row" style={{ cursor: 'pointer' }}>
        <input data-testid="cap-enable" type="checkbox" checked={!!c} style={{ width: 15 }}
          onChange={e => dispatch({ t: 'captions', page, items: { [el.id]: e.target.checked ? { text: el.chart?.title ?? '', position: 'below' } : null } })} />
        <span style={{ width: 'auto', color: 'inherit' }}>Подпись с автонумерацией</span>
      </label>
      {c && (
        <>
          <div className="muted" data-testid="cap-preview" style={{ fontSize: 12 }}>{captionLine(label, n ?? 0, c.text)}</div>
          <div className="row"><input className="grow" data-testid="cap-text" placeholder="Текст подписи (необязательно)" value={c.text}
            onFocus={() => dispatch({ t: 'checkpoint' })} onChange={e => dispatch({ t: 'patch', page, ids: [el.id], patch: { caption: { ...c, text: e.target.value } } })} /></div>
          <div className="row"><label>Позиция</label>
            <select data-testid="cap-pos" value={c.position} onChange={e => { dispatch({ t: 'checkpoint' }); dispatch({ t: 'patch', page, ids: [el.id], patch: { caption: { ...c, position: e.target.value as 'above' | 'below' } } }) }}>
              <option value="below">Под элементом</option><option value="above">Над элементом</option></select></div>
        </>
      )}
    </>
  )
}

function GroupVars({ els, page, dispatch, onSaveBlock }: { els: El[]; page: number; dispatch: (a: Action) => void; onSaveBlock: () => void }) {
  const vars = groupVars(els)
  const ids = els.map(e => e.id)
  const dash = useDashboard(els.find(e => e.chart)?.chart?.dashboardUid)
  const [newName, setNewName] = useState('')
  const set = (name: string, value: string) => dispatch({ t: 'chartVars', page, ids, vars: { [name]: value } })
  // dashboard variables are listed right away (with Grafana's values to pick from); custom ones follow
  const known = dash?.variables ?? []
  const names = [...known.map(v => v.name), ...Object.keys(vars).filter(k => !known.some(v => v.name === k))]
  return (
    <>
      <h3>Переменные блока</h3>
      <div className="muted" style={{ fontSize: 11 }}>Уходят в Grafana как var-имя для всех {els.length} графиков. <code>{'{{имя}}'}</code> — из переменных отчёта.</div>
      {names.map(k => {
        const dv = known.find(v => v.name === k)
        const uid = els.find(e => e.chart)?.chart?.dashboardUid
        const cur = { ...Object.fromEntries(known.map(x => [x.name, x.defaultValue])), ...vars }
        return <VarField key={k} name={k} label={dv?.label} testid={`gv-${k}`} options={dv?.options} value={vars[k] ?? dv?.defaultValue ?? ''}
          load={dv?.dynamic && uid ? () => api.varOptions(uid, k, cur) : undefined}
          onFocus={() => dispatch({ t: 'checkpoint' })} onChange={v => set(k, v)} />
      })}
      <div className="row"><input className="grow" data-testid="gv-new-name" placeholder="новая переменная" value={newName} onChange={e => setNewName(e.target.value)} />
        <button data-testid="gv-add" disabled={!/^[\w.-]+$/.test(newName) || names.includes(newName)} onClick={() => { set(newName, ''); setNewName('') }}>+</button></div>
      <div className="btnrow">
        <button data-testid="save-block" onClick={onSaveBlock}><Icon name="layers" /> Сохранить как блок…</button>
        <button data-testid="ungroup" onClick={() => dispatch({ t: 'ungroup', page, ids })}>Разгруппировать</button>
      </div>
    </>
  )
}

function ChartProps({ el, page, dispatch, tpl, compact }: { el: El; page: number; dispatch: (a: Action) => void; tpl: Tpl; compact?: boolean }) {
  const c = el.chart!
  const upd = (pt: Partial<NonNullable<El['chart']>>) => dispatch({ t: 'patch', page, ids: [el.id], patch: { chart: { ...c, ...pt } } })
  const [k, setK] = useState('')
  const dash = useDashboard(c.dashboardUid)
  const known = dash?.variables ?? []
  const names = [...known.map(v => v.name), ...Object.keys(c.vars ?? {}).filter(x => !known.some(v => v.name === x))]
  return (
    <>
      <h3>График</h3>
      <div className="muted" style={{ fontSize: 11 }}>{c.title} · {c.dashboardUid} / панель {c.panelId}</div>
      <div className="row"><label>С</label><input className="grow" data-testid="chart-from" placeholder={tpl.timeRange.from} value={c.from ?? ''} onFocus={() => dispatch({ t: 'checkpoint' })} onChange={e => upd({ from: e.target.value })} /></div>
      <div className="row"><label>По</label><input className="grow" data-testid="chart-to" placeholder={tpl.timeRange.to} value={c.to ?? ''} onFocus={() => dispatch({ t: 'checkpoint' })} onChange={e => upd({ to: e.target.value })} /></div>
      <div className="row"><label>Тема</label>
        <select data-testid="chart-theme" value={c.theme ?? 'light'} onChange={e => { dispatch({ t: 'checkpoint' }); upd({ theme: e.target.value as 'light' | 'dark' }) }}><option value="light">светлая</option><option value="dark">тёмная</option></select></div>
      {!compact && (
        <>
          <h3>Переменные дашборда</h3>
          {names.map(name => {
            const dv = known.find(v => v.name === name)
            return (
              <div key={name} className="kv1">
                <VarField name={name} label={dv?.label} testid={`cv-${name}`} options={dv?.options} value={c.vars?.[name] ?? dv?.defaultValue ?? ''}
                  load={dv?.dynamic ? () => api.varOptions(c.dashboardUid, name, { ...Object.fromEntries(known.map(x => [x.name, x.defaultValue])), ...c.vars }) : undefined}
                  onFocus={() => dispatch({ t: 'checkpoint' })} onChange={v => upd({ vars: { ...c.vars, [name]: v } })} />
              </div>
            )
          })}
          <div className="row"><input className="grow" data-testid="cv-new" placeholder="своя переменная" value={k} onChange={e => setK(e.target.value)} />
            <button data-testid="cv-add" disabled={!/^[\w.-]+$/.test(k) || names.includes(k)} onClick={() => { dispatch({ t: 'checkpoint' }); upd({ vars: { ...c.vars, [k]: '' } }); setK('') }}>+</button></div>
        </>
      )}
    </>
  )
}

function PageSettings({ tpl, dispatch, snap, setSnap }: { tpl: Tpl; dispatch: (a: Action) => void; snap: boolean; setSnap: (v: boolean) => void }) {
  const landscape = tpl.pageWidth > tpl.pageHeight
  const current = Object.entries(PAGE_SIZES).find(([, s]) => (Math.abs(s.w - tpl.pageWidth) < 1 && Math.abs(s.h - tpl.pageHeight) < 1) || (Math.abs(s.h - tpl.pageWidth) < 1 && Math.abs(s.w - tpl.pageHeight) < 1))?.[0] ?? 'A4'
  const setSize = (name: string, land: boolean) => { const s = PAGE_SIZES[name]; dispatch({ t: 'resizePage', w: land ? s.h : s.w, h: land ? s.w : s.h }) }
  const [k, setK] = useState('')
  return (
    <div className="side right" data-testid="page-settings">
      <h3>Страница</h3>
      <div className="row"><label>Формат</label>
        <select data-testid="page-size" value={current} onChange={e => setSize(e.target.value, landscape)}>{Object.keys(PAGE_SIZES).map(n => <option key={n}>{n}</option>)}</select>
        <select data-testid="page-orient" value={landscape ? 'l' : 'p'} onChange={e => setSize(current, e.target.value === 'l')}><option value="p">Книжная</option><option value="l">Альбомная</option></select></div>
      <div className="row"><label>Привязка</label><label style={{ width: 'auto' }}><input data-testid="snap-toggle" type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /> к краям, центру, полям и соседним блокам (Alt — временно выкл.)</label></div>

      <h3>Подписи рисунков</h3>
      <div className="row"><label>Префикс</label><input className="grow" data-testid="cap-label" value={tpl.captionLabel ?? 'Рисунок'} maxLength={40} onChange={e => dispatch({ t: 'meta', patch: { captionLabel: e.target.value } })} /></div>
      <div className="muted" style={{ fontSize: 11 }}>«Рисунок 1 — …»: нумерация автоматическая по порядку чтения, в Word это настоящее поле SEQ.</div>

      <h3>Период по умолчанию</h3>
      <div className="row"><label>С</label><input className="grow" data-testid="range-from" value={tpl.timeRange.from} onChange={e => dispatch({ t: 'meta', patch: { timeRange: { ...tpl.timeRange, from: e.target.value } } })} /></div>
      <div className="row"><label>По</label><input className="grow" data-testid="range-to" value={tpl.timeRange.to} onChange={e => dispatch({ t: 'meta', patch: { timeRange: { ...tpl.timeRange, to: e.target.value } } })} /></div>
      <div className="muted" style={{ fontSize: 11 }}>Формат Grafana: now-6h, now-7d/d, now, либо epoch ms. Можно переопределить для каждого графика.</div>

      <h3>Переменные отчёта</h3>
      <div className="muted" style={{ fontSize: 11 }}>Используются как <code>{'{{имя}}'}</code> в тексте и в значениях переменных блоков. Встроенные: date, datetime, from, to, name.</div>
      {Object.entries(tpl.variables).map(([name, v]) => (
        <div className="kv" key={name}><input value={name} readOnly /><input data-testid={`rv-${name}`} value={v} onChange={e => dispatch({ t: 'meta', patch: { variables: { ...tpl.variables, [name]: e.target.value } } })} />
          <button data-testid={`rv-del-${name}`} onClick={() => { const { [name]: _x, ...rest } = tpl.variables; dispatch({ t: 'meta', patch: { variables: rest } }) }}>✕</button></div>
      ))}
      <div className="row"><input className="grow" data-testid="rv-new" placeholder="имя (например server)" value={k} onChange={e => setK(e.target.value)} />
        <button data-testid="rv-add" disabled={!/^[\w.-]+$/.test(k) || k in tpl.variables} onClick={() => { dispatch({ t: 'meta', patch: { variables: { ...tpl.variables, [k]: '' } } }); setK('') }}>+</button></div>
    </div>
  )
}
