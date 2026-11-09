import { useState } from 'react'
import { api } from '../api'
import { SettingsView } from '../types'
import { Icon, Logo } from './Icon'

/** Token field with show / hide toggle. */
export function TokenInput({ value, onChange, placeholder, testid }: { value: string; onChange: (v: string) => void; placeholder?: string; testid: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="input-affix">
      <input data-testid={testid} type={show ? 'text' : 'password'} value={value} autoComplete="off" spellCheck={false} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
      <button type="button" className="ghost" data-testid={`${testid}-toggle`} title={show ? 'Скрыть токен' : 'Показать токен'} onClick={() => setShow(s => !s)}><Icon name={show ? 'eyeOff' : 'eye'} /></button>
    </div>
  )
}

export function TokenHelp() {
  return (
    <ol className="steps">
      <li>В Grafana: <b>Administration → Users and access → Service accounts</b></li>
      <li>Создайте аккаунт с ролью <b>Viewer</b> и нажмите <b>Add service account token</b></li>
      <li>Скопируйте токен (<code>glsa_…</code>) и вставьте сюда — он хранится только на сервере</li>
    </ol>
  )
}

/** First-run card shown on the canvas until Grafana is connected: URL + token, verified before saving. */
export function Onboarding({ initial, onSaved }: { initial: SettingsView; onSaved: (s: SettingsView) => void }) {
  const [url, setUrl] = useState(initial.grafanaUrl)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null)

  const save = async () => { onSaved(await api.saveSettings({ grafanaUrl: url, token: token || undefined })) }
  async function connect() {
    setBusy(true); setRes(null)
    try {
      const r = await api.test({ grafanaUrl: url, token: token || undefined })
      if (!r.ok) { setRes({ ok: false, message: r.message }); return }
      await save()
    } catch (e) { setRes({ ok: false, message: (e as Error).message }) } finally { setBusy(false) }
  }
  return (
    <div className="onboard" data-testid="onboarding">
      <h2><Logo size={30} /> Подключите Grafana</h2>
      <p>Укажите адрес и токен — после этого дашборды и графики появятся в боковой панели.</p>
      <div className="field"><label>Адрес Grafana</label>
        <input data-testid="ob-url" value={url} placeholder="https://grafana.example.com" onChange={e => setUrl(e.target.value)} /></div>
      <div className="field"><label>Токен service account</label>
        <TokenInput testid="ob-token" value={token} onChange={setToken} placeholder="glsa_…" />
        <span className="hint">Токен отправляется на ваш сервер отчётов и в браузере больше не показывается.</span></div>
      {res && <div className={`status ${res.ok ? 'ok' : 'bad'}`} data-testid="ob-result"><Icon name={res.ok ? 'check' : 'alert'} /> {res.message}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" data-testid="ob-connect" disabled={busy || !url.trim() || !token.trim()} onClick={connect}>
          <Icon name={busy ? 'loader' : 'plug'} className={busy ? 'spin' : ''} /> {busy ? 'Проверяем…' : 'Проверить и подключить'}</button>
        {res && !res.ok && <button data-testid="ob-force" onClick={() => save().catch(e => setRes({ ok: false, message: (e as Error).message }))}>Сохранить без проверки</button>}
      </div>
      <TokenHelp />
    </div>
  )
}
