"use client"
import { useCallback, useEffect, useState } from "react"
import { isAxiosError } from "axios"
import { api } from "./api"
import { nextCreditRefresh, type AiCreditOverview } from "./ai-credit-usage"

export function useAiCreditOverview(tenantId: string, enabled = true) {
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{ tenantId: string; version: number; data?: AiCreditOverview; error?: string } | null>(null)
  const refresh = useCallback(() => setVersion(value => value + 1), [])
  const current = enabled && result?.tenantId === tenantId ? result : null
  const loading = enabled && (!current || current.version !== version)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    api.get<AiCreditOverview>(`/api/billing/${tenantId}/credits`, { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setResult({ tenantId, version, data })
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      const status = isAxiosError(cause) ? cause.response?.status : undefined
      setResult({ tenantId, version, error: status === 401 ? "Your session expired. Sign in again to view credit usage." : status === 403 ? "Your account administrator can view credit usage and purchase credits." : "Credit usage could not be refreshed. Try again shortly." })
    })
    return () => controller.abort()
  }, [tenantId, enabled, version])
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => { clearTimeout(timer); if (!document.hidden && !loading) timer = setTimeout(refresh, nextCreditRefresh(current?.data)) }
    const visible = () => { if (!document.hidden) refresh(); else clearTimeout(timer) }
    // Debounce refresh signals: generation and analytics events can arrive together.
    let activityTimer: ReturnType<typeof setTimeout> | undefined
    const changed = () => { clearTimeout(activityTimer); activityTimer = setTimeout(() => { if (!document.hidden) refresh() }, 200) }
    schedule()
    window.addEventListener("focus", visible)
    document.addEventListener("visibilitychange", visible)
    window.addEventListener("ai-activity-recorded", changed)
    window.addEventListener("ai-credits-changed", changed)
    return () => { clearTimeout(timer); clearTimeout(activityTimer); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); window.removeEventListener("ai-activity-recorded", changed); window.removeEventListener("ai-credits-changed", changed) }
  }, [tenantId, enabled, loading, current?.data, refresh])
  return { data: current?.data, error: current?.error, loading, refresh }
}
export type AiCreditOverviewController = ReturnType<typeof useAiCreditOverview>
