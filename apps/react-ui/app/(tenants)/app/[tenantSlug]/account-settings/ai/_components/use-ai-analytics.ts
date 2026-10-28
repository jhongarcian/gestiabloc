"use client"

import { useEffect, useState } from "react"
import { isAxiosError } from "axios"
import { api } from "@/lib/api"
import type { AiAnalytics, AiAnalyticsChannel, AiAnalyticsPeriod } from "../_lib/analytics"

export function useAiAnalytics(tenantId: string, days: AiAnalyticsPeriod, channel: AiAnalyticsChannel) {
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{
    key: string; data?: AiAnalytics; error?: string
  } | null>(null)
  const key = `${tenantId}:${days}:${channel}:${version}`

  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1)
    window.addEventListener("ai-activity-recorded", refresh)
    return () => window.removeEventListener("ai-activity-recorded", refresh)
  }, [])

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
        : "Activity could not be loaded. Try refreshing the report." })
    })
    return () => controller.abort()
  }, [tenantId, days, channel, key])

  const current = result?.key === key ? result : null
  return { data: current?.data, error: current?.error, loading: !current,
    refresh: () => setVersion((value) => value + 1) }
}
