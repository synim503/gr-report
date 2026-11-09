import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Block, DashboardInfo, DashboardSummary, SettingsView } from '../types'
import { DND_MIME, DropPayload } from './PageView'
import { Icon } from './Icon'
import { VarField } from './VarField'
import { loadDashboard } from '../lib/useDashboard'

interface Props {
  settings: SettingsView | null
  blocks: Block[]
  onSettings: () => void
  onAddText: () => void
  onAddImage: (file: File) => void
  blockWidth: number
  onAddPanel: (chart: { dashboardUid: string; panelId: number; title?: string }, w: number, h: number, vars: Record<string, string>) => void
  onUseBlock: (b: Block) => void
  onDeleteBlock: (id: string) => void
  onError: (msg: string) => void
  refreshKey: number
}

const drag = (payload: DropPayload) => (e: React.DragEvent) => { e.dataTransfer.setData(DND_MIME, JSON.stringify(payload)); e.dataTransfer.effectAllowed = 'copy' }

/** Default chart size from the dashboard grid (24 columns ≈ 515 pt). */
export const panelSize = (gridW: number, gridH: number) => ({ w: Math.round(gridW / 24 * 515), h: Math.round(gridH * 515 / 24 * 0.76) })

export function Sidebar(p: Props) {
  const [query, setQuery] = useState('')
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, DashboardInfo>>({})
  const [varVals, setVarVals] = useState<Record<string, Record<string, string>>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  const configured = !!p.settings?.grafanaUrl && p.settings.tokenSet

  const load = useCallback((q: string) => {
    if (!configured) { setDashboards([]); return }
    api.dashboards(q).then(d => { setDashboards(d); setError(null) }).catch(e => { setDashboards([]); setError((e as Error).message) })
  }, [configured])
  useEffect(() => { const t = setTimeout(() => load(query), 250); return () => clearTimeout(t) }, [query, load, p.refreshKey])

  async function toggle(uid: string) {
    if (open === uid) { setOpen(null); return }
    setOpen(uid)
    if (!details[uid]) {
      try {
        const d = await loadDashboard(uid)
        setDetails(s => ({ ...s, [uid]: d }))
        setVarVals(v => ({ ...v, [uid]: Object.fromEntries(d.variables.map(x => [x.name, x.defaultValue])) }))
      } catch (e) { p.onError((e as Error).message) }
    }
  }
  async function wholeDashboard(uid: string) {
    try {
      const b = await api.dashboardBlock(uid, p.blockWidth)
      for (const v of b.variables) v.defaultValue = varVals[uid]?.[v.name] ?? v.defaultValue      // values picked in the sidebar
      p.onUseBlock(b)
    } catch (e) { p.onError((e as Error).message) }
  }

  return (
    <div className="side left" data-testid="sidebar">
      <h3>Элементы</h3>
      <div className="tiles">
        <div className="tile" draggable data-testid="add-text" onDragStart={drag({ kind: 'text' })} onClick={p.onAddText}>
          <span className="ico"><Icon name="type" size={17} /></span><span><b>Текст</b><small>перетащите или клик</small></span>
        </div>
        <div className="tile" data-testid="add-image" style={{ cursor: 'pointer' }} onClick={() => fileRef.current?.click()}>
          <span className="ico"><Icon name="image" size={17} /></span><span><b>Картинка</b><small>PNG · JPEG · GIF</small></span>
        </div>
      </div>
      <input ref={fileRef} data-testid="image-input" type="file" accept="image/png,image/jpeg,image/gif" hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) p.onAddImage(f); e.target.value = '' }} />

      <h3>Grafana</h3>
      <div className={`status ${configured ? 'ok' : 'bad'}`} data-testid="conn-status">
        <Icon name={configured ? 'check' : 'plug'} />
        <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{configured ? p.settings!.grafanaUrl : 'Не настроено'}</span>
        <button className="ghost icon-btn" style={{ width: 24, height: 24, padding: 3 }} title="Настройки подключения" data-testid="open-settings" onClick={p.onSettings}><Icon name="sliders" size={14} /></button>
      </div>
      {configured && <div className="searchbox"><Icon name="search" size={15} /><input data-testid="dash-search" placeholder="Поиск дашбордов…" value={query} onChange={e => setQuery(e.target.value)} /></div>}
      {error && <div className="status bad" data-testid="dash-error"><Icon name="alert" />{error}</div>}
      {dashboards.map(d => (
        <div className="dash" key={d.uid} data-testid="dashboard-item">
          <div className="title" onClick={() => toggle(d.uid)}><Icon name={open === d.uid ? 'chevD' : 'chevR'} size={14} /><span className="grow">{d.title}</span>{d.folder && <small className="muted">{d.folder}</small>}</div>
          {open === d.uid && (
            <div style={{ paddingLeft: 8 }}>
              <button data-testid="dash-as-block" style={{ width: '100%', marginBottom: 4 }} onClick={() => wholeDashboard(d.uid)}><Icon name="layers" /> Весь дашборд как блок…</button>
              {!details[d.uid] && <div className="muted" style={{ padding: 6 }}>Загрузка…</div>}
              {details[d.uid] && details[d.uid].variables.length > 0 && (
                <div className="vars-card" data-testid="dash-vars">
                  <div className="cap"><Icon name="braces" size={13} /> Переменные дашборда</div>
                  {details[d.uid].variables.map(v => (
                    <VarField key={v.name} name={v.name} label={v.label} testid={`sv-${v.name}`} options={v.options} value={varVals[d.uid]?.[v.name] ?? ''}
                      onChange={x => setVarVals(s => ({ ...s, [d.uid]: { ...s[d.uid], [v.name]: x } }))} />
                  ))}
                  <div className="muted" style={{ fontSize: 11 }}>Попадут в добавляемые графики и блок</div>
                </div>
              )}
              {details[d.uid]?.panels.map(pn => {
                const { w, h } = panelSize(pn.gridW, pn.gridH)
                const chart = { dashboardUid: d.uid, panelId: pn.id, title: pn.title }
                return (
                  <div className="chip" key={pn.id} draggable data-testid="panel-item" onDragStart={drag({ kind: 'panel', chart, w, h, vars: varVals[d.uid] ?? {} })} onClick={() => p.onAddPanel(chart, w, h, varVals[d.uid] ?? {})}>
                    <span className="ico"><Icon name="chart" size={15} /></span><span className="grow">{pn.title || `Панель ${pn.id}`}</span><small>{pn.type}</small>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
      {configured && !error && dashboards.length === 0 && <div className="empty">Дашборды не найдены</div>}

      <h3>Блоки</h3>
      {p.blocks.length === 0 && <div className="empty">Нет блоков. Вставьте дашборд целиком или выделите несколько графиков и сохраните их как блок.</div>}
      {p.blocks.map(b => (
        <div className="chip" key={b.id} draggable data-testid="block-item" onDragStart={drag({ kind: 'block', blockId: b.id! })} onClick={() => p.onUseBlock(b)}>
          <span className="ico"><Icon name="layers" size={15} /></span>
          <span className="grow">{b.name}<br /><small>{b.charts.length} граф. · {b.variables.map(v => v.name).join(', ') || 'без переменных'}</small></span>
          <button className="x danger ghost" data-testid="block-delete" title="Удалить блок" onClick={e => { e.stopPropagation(); p.onDeleteBlock(b.id!) }}><Icon name="trash" size={14} /></button>
        </div>
      ))}
    </div>
  )
}
