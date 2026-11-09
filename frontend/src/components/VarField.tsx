import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

/**
 * Text input (free text and {{report variables}} allowed) with a dropdown of the values known from Grafana.
 * `load` fetches the values when the menu is opened (query variables, possibly depending on other variables);
 * `options` are a static list / fallback.
 */
export function VarField({ name, label, value, options = [], load, onChange, onFocus, testid }: {
  name: string; label?: string; value: string; options?: string[]; load?: () => Promise<string[]>
  onChange: (v: string) => void; onFocus?: () => void; testid: string
}) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<string[]>(options)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', h); return () => window.removeEventListener('mousedown', h)
  }, [open])

  async function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true); setErr(null); setList(options)
    if (!load) return
    setLoading(true)
    try { setList(await load()) } catch (e) { if (!options.length) setErr((e as Error).message) } finally { setLoading(false) }
  }
  return (
    <div className="row varrow">
      <label title={name}>{label || name}</label>
      <div className="varfield grow" ref={box}>
        <input data-testid={testid} value={value} onFocus={onFocus} onChange={e => onChange(e.target.value)} />
        {(options.length > 0 || load) && (
          <button type="button" className="ghost" data-testid={`${testid}-menu`} title="Значения из Grafana" onMouseDown={e => e.preventDefault()} onClick={toggle}><Icon name={loading ? 'loader' : 'chevD'} size={14} className={loading ? 'spin' : ''} /></button>
        )}
        {open && (
          <div className="menu" data-testid={`${testid}-options`}>
            {loading && !list.length && <div className="menu-note">Загрузка из Grafana…</div>}
            {err && <div className="menu-note err" data-testid={`${testid}-error`}>{err}</div>}
            {!loading && !err && !list.length && <div className="menu-note">Нет значений — введите вручную</div>}
            {list.map(o => (
              <button type="button" key={o} className={`ghost${o === value ? ' on' : ''}`} data-testid={`${testid}-opt`} onClick={() => { onFocus?.(); onChange(o); setOpen(false) }}>
                {o === value && <Icon name="check" size={13} />}<span>{o}</span></button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
