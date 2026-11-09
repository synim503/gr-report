import { useEffect, useState } from 'react'

const cache = new Map<string, string>()
const remember = (url: string, obj: string) => { cache.set(url, obj); if (cache.size > 60) cache.delete(cache.keys().next().value as string) }

/** Fetches the rendered Grafana panel (through the backend, which holds the token) and shows it. */
export function ChartPreview({ url, title }: { url: string; title?: string }) {
  const [state, setState] = useState<{ src?: string; error?: string; loading: boolean }>({ loading: true, src: cache.get(url) })
  useEffect(() => {
    if (cache.has(url)) { setState({ src: cache.get(url), loading: false }); return }
    const ctl = new AbortController()
    setState(s => ({ src: s.src, loading: true }))
    const t = setTimeout(async () => {
      try {
        const r = await fetch(url, { signal: ctl.signal })
        if (!r.ok) {
          let msg = `HTTP ${r.status}`
          try { msg = (await r.json()).message ?? msg } catch { /* */ }
          setState({ error: msg, loading: false }); return
        }
        const obj = URL.createObjectURL(await r.blob())
        remember(url, obj)
        setState({ src: obj, loading: false })
      } catch (e) { if ((e as Error).name !== 'AbortError') setState({ error: (e as Error).message, loading: false }) }
    }, 350)
    return () => { clearTimeout(t); ctl.abort() }
  }, [url])

  if (state.error) return <div className="ph err" data-testid="chart-error">⚠ {title ?? 'График'}: {state.error}</div>
  if (!state.src) return <div className="ph" data-testid="chart-loading">Загрузка графика {title ?? ''}…</div>
  return <img src={state.src} alt={title ?? 'chart'} data-testid="chart-img" style={{ opacity: state.loading ? 0.6 : 1 }} />
}
