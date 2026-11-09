import { Block, DashboardInfo, DashboardSummary, JobView, SettingsView, Tpl } from './types'

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try { const b = await r.json(); if (b?.message) msg = b.message } catch { /* not json */ }
    throw new Error(msg)
  }
  return (r.status === 204 ? undefined : await r.json()) as T
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  settings: () => req<SettingsView>('/api/settings'),
  saveSettings: (b: { grafanaUrl?: string; token?: string; orgId?: number; imageScale?: number; parallelism?: number }) => req<SettingsView>('/api/settings', json('PUT', b)),
  test: (b: { grafanaUrl?: string; token?: string }) => req<{ ok: boolean; version?: string; org?: string; message: string }>('/api/grafana/test', json('POST', b)),
  dashboards: (q: string) => req<DashboardSummary[]>(`/api/grafana/dashboards?query=${encodeURIComponent(q)}`),
  dashboard: (uid: string) => req<DashboardInfo>(`/api/grafana/dashboards/${encodeURIComponent(uid)}`),
  dashboardBlock: (uid: string, width: number) => req<Block>(`/api/grafana/dashboards/${encodeURIComponent(uid)}/block?width=${width}`),
  templates: () => req<{ id: string; name: string; updatedAt?: string }[]>('/api/templates'),
  template: (id: string) => req<Tpl>(`/api/templates/${id}`),
  saveTemplate: (t: Tpl) => t.id ? req<Tpl>(`/api/templates/${t.id}`, json('PUT', t)) : req<Tpl>('/api/templates', json('POST', t)),
  deleteTemplate: (id: string) => req<void>(`/api/templates/${id}`, { method: 'DELETE' }),
  blocks: () => req<Block[]>('/api/blocks'),
  saveBlock: (b: Block) => b.id ? req<Block>(`/api/blocks/${b.id}`, json('PUT', b)) : req<Block>('/api/blocks', json('POST', b)),
  deleteBlock: (id: string) => req<void>(`/api/blocks/${id}`, { method: 'DELETE' }),
  startJob: (t: Tpl, overrides: Record<string, string> = {}) => {
    const q = new URLSearchParams(); for (const [k, v] of Object.entries(overrides)) q.set(`var-${k}`, v)
    return req<JobView>(`/api/reports/jobs?${q}`, json('POST', t))
  },
  jobs: () => req<JobView[]>('/api/reports/jobs'),
  /** Cancels a running job; for a finished one removes it from the list. */
  cancelJob: (id: string) => req<void>(`/api/reports/jobs/${id}`, { method: 'DELETE' }),
  jobFile: async (id: string): Promise<GenerateResult> => {
    const r = await fetch(`/api/reports/jobs/${id}/file`)
    if (!r.ok) throw new Error(r.status === 409 ? 'Отчёт ещё не готов или задача не завершилась успешно' : `${r.status} ${r.statusText}`)
    return parseDocx(r)
  },
}

export function panelImageUrl(c: { dashboardUid: string; panelId: number; from: string; to: string; theme?: string; vars?: Record<string, string> },
                              wPx: number, hPx: number, reportVars: Record<string, string>): string {
  const p = new URLSearchParams({ uid: c.dashboardUid, panelId: String(c.panelId), width: String(wPx), height: String(hPx), from: c.from, to: c.to, theme: c.theme ?? 'light' })
  for (const [k, v] of Object.entries(c.vars ?? {})) p.set(`var-${k}`, resolveRefs(v, reportVars))
  return `/api/grafana/panel-image?${p}`
}

export const resolveRefs = (v: string, vars: Record<string, string>) =>
  v.replace(/\{\{\s*([\w.-]+)\s*}}/g, (m, k) => vars[k] ?? m)

export interface GenerateResult { blob: Blob; filename: string; warnings: string[] }

export async function generate(t: Tpl, overrides: Record<string, string> = {}): Promise<GenerateResult> {
  const q = new URLSearchParams(); for (const [k, v] of Object.entries(overrides)) q.set(`var-${k}`, v)
  const r = await fetch(`/api/reports/generate?${q}`, json('POST', t))
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`
    try { const b = await r.json(); if (b?.message) msg = b.message } catch { /* */ }
    throw new Error(msg)
  }
  return parseDocx(r)
}

async function parseDocx(r: Response): Promise<GenerateResult> {
  const cd = r.headers.get('Content-Disposition') ?? ''
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd)
  const warn = decodeURIComponent(r.headers.get('X-Report-Warnings') ?? '')
  return { blob: await r.blob(), filename: m ? decodeURIComponent(m[1]) : 'report.docx', warnings: warn ? warn.split('\n') : [] }
}
