"use client"
import { useCallback, useEffect, useState } from "react"
import { isAxiosError } from "axios"
import { api } from "./api"
import type { AiCreditOverview } from "./ai-credit-usage"

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
  return { data: current?.data, error: current?.error, loading, refresh }
}
export type AiCreditOverviewController = ReturnType<typeof useAiCreditOverview>
