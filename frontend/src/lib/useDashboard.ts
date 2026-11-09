import { useEffect, useState } from 'react'
import { api } from '../api'
import { DashboardInfo } from '../types'

const cache = new Map<string, Promise<DashboardInfo>>()

/** Dashboard details (panels + variables with their options), fetched once per uid. */
export function loadDashboard(uid: string): Promise<DashboardInfo> {
  let p = cache.get(uid)
  if (!p) { p = api.dashboard(uid); cache.set(uid, p); p.catch(() => cache.delete(uid)) }
  return p
}
export const forgetDashboards = () => cache.clear()

export function useDashboard(uid: string | undefined): DashboardInfo | null {
  const [d, setD] = useState<DashboardInfo | null>(null)
  useEffect(() => {
    setD(null)
    if (!uid) return
    let live = true
    loadDashboard(uid).then(x => { if (live) setD(x) }).catch(() => { /* Grafana unreachable: manual entry still works */ })
    return () => { live = false }
  }, [uid])
  return d
}
