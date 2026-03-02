"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import { ArrowRight, Layers2, ListChecks, Users } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type StatusConfigOverviewPanelProps = {
  tenantId: string
  tenantSlug: string
}

type StatusConfigResponse = {
  ok: boolean
  configurations: Array<{
    key: string
    label: string
    statusCount: number
    activeStatusCount: number
  }>
  contactStatuses?: Array<unknown>
  taskStatuses?: Array<unknown>
}

type ConfigCard = {
  key: string
  label: string
  description: string
  href: string
  icon: typeof Users
  alwaysAvailable?: boolean
}

const CONFIG_CARDS: ConfigCard[] = [
  {
    key: "contacts",
    label: "Contact Statuses",
    description:
      "Manage contact lifecycle statuses used across records. Includes default Active, Inactive, and Pending.",
    href: "contacts",
    icon: Users,
    alwaysAvailable: true,
  },
  {
    key: "tasks",
    label: "Task Statuses",
    description: "Define task workflow states for team operations.",
    href: "tasks",
    icon: ListChecks,
    alwaysAvailable: true,
  },
  {
    key: "services",
    label: "Service Statuses",
    description: "Configure service-specific status options and visibility.",
    href: "services",
    icon: Layers2,
  },
]

const formatSegment = (segment: string) =>
  segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

export function StatusConfigOverviewPanel({
  tenantId,
  tenantSlug,
}: StatusConfigOverviewPanelProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<StatusConfigResponse | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data: response } = await api.get<StatusConfigResponse>(
        `/api/account-settings/${tenantId}/status-config`,
      )
      setData(response)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? formatSegment(backendError)
            : "Could not load status configuration.",
        )
      } else {
        setErrorMessage("Could not load status configuration.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    void load()
  }, [load])

  const configuredKeys = useMemo(
    () => new Set((data?.configurations ?? []).map((item) => item.key)),
    [data?.configurations],
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Status Configuration</h2>
        <p className="text-sm text-slate-500">
          Select a status group to manage. Use this as your global configuration
          entry point.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Loading configuration groups...
        </div>
      ) : errorMessage ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
          {CONFIG_CARDS.map((card) => {
            const Icon = card.icon
            const config = data?.configurations.find((item) => item.key === card.key)
            const isConfigured =
              card.alwaysAvailable === true || configuredKeys.has(card.key)
            const href = `/app/${tenantSlug}/account-settings/status-config/${card.href}`
            const isPrimary = card.key === "contacts"

            return (
              <div
                key={card.key}
                className={cn(
                  "rounded-lg border border-slate-200 bg-white p-4",
                  isPrimary ? "lg:col-span-6" : "lg:col-span-3",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-md",
                        isPrimary
                          ? "bg-blue-950 text-white"
                          : "bg-slate-100 text-slate-700",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className="text-base font-semibold text-slate-900">{card.label}</p>
                  </div>
                  {isPrimary ? (
                    <Badge className="bg-blue-950 text-white hover:bg-blue-950">Primary</Badge>
                  ) : isConfigured ? (
                    <Badge variant="secondary">Configured</Badge>
                  ) : (
                    <Badge variant="outline">Coming Soon</Badge>
                  )}
                </div>

                <p className="mt-2 text-sm text-slate-600">{card.description}</p>

                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-slate-500">
                      {isConfigured ? (
                        <>
                          {config?.statusCount ?? 0} total
                          {" · "}
                          {config?.activeStatusCount ?? 0} active
                        </>
                      ) : (
                        "No statuses configured yet"
                      )}
                    </div>
                    {isConfigured ? (
                      <Link
                        href={href}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium transition",
                          isPrimary
                            ? "bg-blue-950 text-white hover:bg-blue-950/90"
                            : "text-slate-800 hover:bg-slate-100 hover:text-slate-950",
                        )}
                      >
                        Manage
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-400">Unavailable</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
