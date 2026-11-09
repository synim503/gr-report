import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

/** Text input (free text and {{report variables}} allowed) with a dropdown of the values known from Grafana. */
export function VarField({ name, label, value, options = [], onChange, onFocus, testid }: {
  name: string; label?: string; value: string; options?: string[]; onChange: (v: string) => void; onFocus?: () => void; testid: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', h); return () => window.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div className="row varrow">
      <label title={name}>{label || name}</label>
      <div className="varfield grow" ref={box}>
        <input data-testid={testid} value={value} onFocus={onFocus} onChange={e => onChange(e.target.value)} />
        {options.length > 0 && (
          <button type="button" className="ghost" data-testid={`${testid}-menu`} title="Значения из Grafana" onMouseDown={e => e.preventDefault()} onClick={() => setOpen(o => !o)}><Icon name="chevD" size={14} /></button>
        )}
        {open && (
          <div className="menu" data-testid={`${testid}-options`}>
            {options.map(o => (
              <button type="button" key={o} className={`ghost${o === value ? ' on' : ''}`} data-testid={`${testid}-opt`} onClick={() => { onFocus?.(); onChange(o); setOpen(false) }}>
                {o === value && <Icon name="check" size={13} />}<span>{o}</span></button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
