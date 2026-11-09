import { useState } from 'react'
import { api } from '../api'
import { Block, SettingsView } from '../types'
import { Icon } from './Icon'
import { VarField } from './VarField'
import { TokenHelp, TokenInput } from './Onboarding'

export function Modal({ title, onClose, children, testid }: { title: string; onClose: () => void; children: React.ReactNode; testid?: string }) {
  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" data-testid={testid}><h2>{title}</h2>{children}</div>
    </div>
  )
}

export function SettingsDialog({ initial, onClose, onSaved }: { initial: SettingsView; onClose: () => void; onSaved: (s: SettingsView) => void }) {
  const [url, setUrl] = useState(initial.grafanaUrl)
  const [token, setToken] = useState('')
  const [orgId, setOrgId] = useState(initial.orgId)
  const [scale, setScale] = useState(initial.imageScale)
  const [par, setPar] = useState(initial.parallelism ?? 4)
  const parOk = Number.isInteger(par) && par >= 1 && par <= 16
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f() } catch (e) { setResult({ ok: false, message: (e as Error).message }) } finally { setBusy(false) } }
  return (
    <Modal title="Подключение к Grafana" onClose={onClose} testid="settings-dialog">
      <div className="row"><label>URL</label><input data-testid="set-url" value={url} placeholder="https://grafana.example.com" onChange={e => setUrl(e.target.value)} /></div>
      <div className="row"><label>Токен</label><div className="grow"><TokenInput testid="set-token" value={token} onChange={setToken}
        placeholder={initial.tokenSet ? `сохранён ${initial.tokenHint} · пусто = не менять` : 'Service account token (glsa_…)'} /></div></div>
      {initial.tokenSet && <div className="row"><label />
        <button className="danger" data-testid="set-clear" disabled={busy} onClick={() => run(async () => { onSaved(await api.saveSettings({ token: '' })); onClose() })}><Icon name="trash" /> Удалить сохранённый токен</button></div>}
      <div className="row"><label>Org ID</label><input data-testid="set-org" type="number" min={1} value={orgId} onChange={e => setOrgId(Number(e.target.value))} /></div>
      <div className="row"><label>Качество (×)</label><input data-testid="set-scale" type="number" min={1} max={4} step={0.5} value={scale} onChange={e => setScale(Number(e.target.value))} /></div>
      <div className="row"><label>Параллельность</label>
        <input data-testid="set-parallel" type="number" min={1} max={16} step={1} value={par} style={{ maxWidth: 90 }} onChange={e => setPar(Number(e.target.value))} />
        <span className="muted" style={{ fontSize: 12 }}>графиков одного отчёта одновременно (1–16)</span></div>
      {!parOk && <div className="status bad" data-testid="par-error"><Icon name="alert" />Параллельность: целое число от 1 до 16</div>}
      <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>Больше — быстрее отчёты, но выше нагрузка на Grafana и renderer. Для тяжёлых дашбордов начните с 2–4.</p>
      <TokenHelp />
      <p className="muted" style={{ marginTop: 10 }}>Для картинок графиков в Grafana должен быть установлен <code>grafana-image-renderer</code>.</p>
      {result && <div data-testid="test-result" className={`status ${result.ok ? 'ok' : 'bad'}`}><Icon name={result.ok ? 'check' : 'alert'} />{result.message}</div>}
      <div className="actions">
        <button data-testid="set-test" disabled={busy || !url} onClick={() => run(async () => {
          const r = await api.test({ grafanaUrl: url, token: token || undefined })
          setResult({ ok: r.ok, message: r.ok ? `✓ Подключено: Grafana ${r.version ?? ''}, организация «${r.org}»` : r.message })
        })}>Проверить</button>
        <button onClick={onClose}>Отмена</button>
        <button className="primary" data-testid="set-save" disabled={busy || !url || !parOk} onClick={() => run(async () => {
          onSaved(await api.saveSettings({ grafanaUrl: url, token: token || undefined, orgId, imageScale: scale, parallelism: par })); onClose()
        })}>Сохранить</button>
      </div>
    </Modal>
  )
}

/** Asks for the block's variable values (e.g. host) before placing it on the page. */
export function InsertBlockDialog({ block, onInsert, onClose }: { block: Block; onInsert: (values: Record<string, string>, save: boolean) => void; onClose: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(block.variables.map(v => [v.name, v.defaultValue])))
  const [save, setSave] = useState(false)
  return (
    <Modal title={`Вставить блок «${block.name}»`} onClose={onClose} testid="insert-block-dialog">
      <p className="muted">{block.charts.length} граф. · дашборд {block.dashboardTitle ?? block.dashboardUid}. Значения уйдут в Grafana как <code>var-имя=значение</code>.
        Можно указать <code>{'{{имя}}'}</code> — тогда значение берётся из переменных отчёта.</p>
      {block.variables.length === 0 && <p className="muted">У блока нет переменных.</p>}
      {block.variables.map(v => (
        <VarField key={v.name} name={v.name} label={v.label} testid={`bv-${v.name}`} value={vals[v.name] ?? ''} options={v.options}
          onChange={x => setVals({ ...vals, [v.name]: x })} />
      ))}
      {!block.id && <label className="row"><input data-testid="bv-save" type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} /> Сохранить в библиотеку блоков</label>}
      <div className="actions"><button onClick={onClose}>Отмена</button><button className="primary" data-testid="bv-insert" onClick={() => onInsert(vals, save)}>Вставить</button></div>
    </Modal>
  )
}

export function SaveBlockDialog({ defaultName, onSave, onClose }: { defaultName: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(defaultName)
  return (
    <Modal title="Сохранить выделенные графики как блок" onClose={onClose} testid="save-block-dialog">
      <div className="row"><label>Название</label><input data-testid="block-name" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
      <p className="muted">Сохранятся состав графиков, их взаимное расположение и переменные (с текущими значениями как значениями по умолчанию).</p>
      <div className="actions"><button onClick={onClose}>Отмена</button><button className="primary" data-testid="block-save" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Сохранить</button></div>
    </Modal>
  )
}

export function TemplatesDialog({ items, onOpen, onDelete, onClose }: {
  items: { id: string; name: string; updatedAt?: string }[]; onOpen: (id: string) => void; onDelete: (id: string) => void; onClose: () => void
}) {
  return (
    <Modal title="Сохранённые отчёты" onClose={onClose} testid="templates-dialog">
      {items.length === 0 && <p className="muted">Пока нет сохранённых отчётов.</p>}
      {items.map(t => (
        <div className="chip" key={t.id} style={{ cursor: 'default' }} data-testid="template-item">
          <span className="grow" style={{ cursor: 'pointer' }} onClick={() => onOpen(t.id)}><b>{t.name}</b><br /><small>{t.updatedAt?.slice(0, 16).replace('T', ' ')}</small></span>
          <button data-testid="template-open" onClick={() => onOpen(t.id)}>Открыть</button>
          <button className="danger" data-testid="template-delete" onClick={() => onDelete(t.id)}>✕</button>
        </div>
      ))}
      <div className="actions"><button onClick={onClose}>Закрыть</button></div>
    </Modal>
  )
}
