import { useEffect, useState } from 'react'
import { JobView } from '../types'
import { Icon } from './Icon'

const LABEL: Record<JobView['state'], string> = { RUNNING: 'Выполняется', DONE: 'Готово', FAILED: 'Ошибка', CANCELLED: 'Отменена' }
const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${s % 60} с` }

/** Popover with all report builds: progress, cancel (running), download / remove (finished). */
export function JobsPanel({ jobs, onCancel, onDownload, onClearFinished, onClose }: {
  jobs: JobView[]; onCancel: (id: string) => void; onDownload: (id: string) => void; onClearFinished: () => void; onClose: () => void
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const finished = jobs.filter(j => j.state !== 'RUNNING').length
  return (
    <div className="jobs-pop" data-testid="jobs-panel" onMouseDown={e => e.stopPropagation()}>
      <div className="jobs-head">
        <b>Задачи сборки</b>
        <span className="grow" />
        <button className="ghost" data-testid="jobs-clear" disabled={!finished} onClick={onClearFinished}><Icon name="trash" size={13} /> Очистить завершённые</button>
        <button className="ghost icon-btn" style={{ width: 26, height: 26 }} title="Закрыть" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      {jobs.length === 0 && <div className="empty" data-testid="jobs-empty">Нет задач. Нажмите «Сформировать Word» — отчёт соберётся в фоне.</div>}
      <div className="jobs-list">
        {jobs.map(j => {
          const pct = j.state === 'DONE' ? 100 : j.total > 0 ? Math.round(j.done / j.total * 100) : (j.state === 'RUNNING' ? 8 : 0)
          return (
            <div className={`job ${j.state.toLowerCase()}`} key={j.id} data-testid="job-item" data-job-id={j.id}>
              <div className="job-top">
                <span className="job-name">{j.name}</span>
                <span className={`job-state ${j.state.toLowerCase()}`} data-testid="job-state">{LABEL[j.state]}</span>
              </div>
              <div className="bar" data-testid="job-progress"><i style={{ width: `${pct}%` }} /></div>
              <div className="job-meta">
                <span data-testid="job-counter">{j.total > 0 ? `${j.done} / ${j.total} графиков` : 'без графиков'}</span>
                <span>{fmt((j.finishedAt ?? now) - j.startedAt)}</span>
                {j.sizeBytes ? <span>{(j.sizeBytes / 1024).toFixed(0)} КБ</span> : null}
                {j.warnings.length > 0 && <span className="warn" title={j.warnings.join('\n')}>⚠ {j.warnings.length}</span>}
                <span className="grow" />
                {j.state === 'RUNNING' && <button className="danger" data-testid="job-cancel" onClick={() => onCancel(j.id)}><Icon name="x" size={13} /> Отменить</button>}
                {j.state === 'DONE' && <button data-testid="job-download" onClick={() => onDownload(j.id)}><Icon name="download" size={13} /> Скачать</button>}
                {j.state !== 'RUNNING' && <button className="ghost icon-btn" style={{ width: 26, height: 26 }} data-testid="job-remove" title="Убрать из списка" onClick={() => onCancel(j.id)}><Icon name="trash" size={13} /></button>}
              </div>
              {j.error && <div className="job-error" data-testid="job-error">{j.error}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
