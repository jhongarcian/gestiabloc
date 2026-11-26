"use client"

import { useCallback, useEffect, useState } from "react"
import { isAxiosError } from "axios"
import { api } from "@/lib/api"
import type { AiAnalytics, AiAnalyticsChannel, AiAnalyticsPeriod } from "../_lib/analytics"

export function useAiAnalytics(tenantId: string, days: AiAnalyticsPeriod, channel: AiAnalyticsChannel) {
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{
    key: string; data?: AiAnalytics; error?: string
  } | null>(null)
  const key = `${tenantId}:${days}:${channel}:${version}`
  const refresh = useCallback(() => setVersion(value => value + 1), [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const changed = () => { clearTimeout(timer); timer = setTimeout(refresh, 200) }
    const visible = () => { if (!document.hidden) refresh() }
    const poll = setInterval(() => { if (!document.hidden) refresh() }, 30000)
    window.addEventListener("ai-activity-recorded", changed)
    window.addEventListener("ai-credits-changed", changed)
    window.addEventListener("focus", visible)
    document.addEventListener("visibilitychange", visible)
    return () => { clearInterval(poll); clearTimeout(timer); window.removeEventListener("ai-activity-recorded", changed); window.removeEventListener("ai-credits-changed", changed); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible) }
  }, [tenantId, refresh])

  useEffect(() => {
    const controller = new AbortController()
    api.get<{ analytics: AiAnalytics }>(`/api/account-settings/${tenantId}/ai/analytics`, {
      params: { days, channel }, signal: controller.signal,
    }).then(({ data }) => {
      if (!controller.signal.aborted) setResult({ key, data: data.analytics })
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      const status = isAxiosError(cause) ? cause.response?.status : undefined
      setResult({ key, error: status === 401 ? "Your session has expired. Sign in again to view Analytics."
        : status === 403 ? "Account administrator access is required to view Analytics."
        : "Analytics could not be loaded. Try refreshing the report." })
    })
    return () => controller.abort()
  }, [tenantId, days, channel, key])

  const current = result?.key === key ? result : null
  return { data: current?.data, error: current?.error, loading: !current,
    refresh }
}
