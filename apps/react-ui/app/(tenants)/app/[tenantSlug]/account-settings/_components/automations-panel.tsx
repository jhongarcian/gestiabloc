"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { isAxiosError } from "axios"
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleDashed,
  GitBranch,
  History,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { serializeAutomationAction } from "@/lib/automation-action-payload"
import { formatDateTimeForDisplay } from "@/lib/date-time"
import { cn } from "@/lib/utils"

import type { AutomationCatalog, AutomationRecord } from "./automation-types"

type AutomationsPanelProps = { tenantId: string; tenantSlug: string }

const COMPACT_PRIMARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 transition hover:bg-blue-900 hover:text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"

const COMPACT_SECONDARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"

const COMPACT_HEADER_SECONDARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:bg-white/90 hover:text-slate-950"

const COMPACT_ICON_BUTTON_CLASS =
  "size-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white p-0 text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"

function mutationPayload(record: AutomationRecord, isEnabled = record.isEnabled) {
  return {
    name: record.name,
    isEnabled,
    trigger: record.trigger,
    conditions: record.conditions.map((condition) => ({
      source: condition.source,
      operator: condition.operator,
      customFieldId: condition.customFieldId,
      statusConfigId: condition.statusConfigId,
      assignedUserId: condition.assignedUserId,
      tagId: condition.tagId,
      compareValue: condition.compareValue,
    })),
    actions: record.actions.map(serializeAutomationAction),
  }
}

function requestErrorMessage(error: unknown, fallback: string) {
  if (!isAxiosError(error)) return fallback
  const message = error.response?.data?.message
  return typeof message === "string" && message.trim() ? message : fallback
}

function lastRunLabel(status: NonNullable<AutomationRecord["lastExecution"]>["status"]) {
  if (status === "SUCCEEDED") return "Succeeded"
  if (status === "EXITED") return "Exited early"
  return "Failed"
}

function AutomationRowSkeleton() {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex animate-pulse flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 gap-4">
          <div className="size-11 shrink-0 rounded-2xl bg-slate-100" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="h-4 w-52 max-w-full rounded-full bg-slate-100" />
            <div className="h-3 w-80 max-w-full rounded-full bg-slate-100" />
            <div className="h-3 w-64 max-w-full rounded-full bg-slate-100" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-20 rounded-full bg-slate-100" />
          <div className="h-8 w-16 rounded-full bg-slate-100" />
        </div>
      </div>
    </div>
  )
}

export function AutomationsPanel({ tenantId, tenantSlug }: AutomationsPanelProps) {
  const [items, setItems] = useState<AutomationRecord[]>([])
  const [catalog, setCatalog] = useState<AutomationCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [isReordering, setIsReordering] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [automationResponse, catalogResponse] = await Promise.all([
        api.get<{ items: AutomationRecord[] }>(`/api/account-settings/${tenantId}/automations`),
        api.get<{ catalog: AutomationCatalog }>(
          `/api/account-settings/${tenantId}/automations/catalog`,
        ),
      ])
      setItems(automationResponse.data.items)
      setCatalog(catalogResponse.data.catalog)
    } catch (error) {
      const message = requestErrorMessage(error, "Could not load automations. Try again.")
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    void load()
  }, [load])

  const publishedCount = useMemo(
    () => items.filter((item) => item.isEnabled).length,
    [items],
  )

  const toggleAutomation = async (record: AutomationRecord) => {
    setBusyId(record.id)
    try {
      const { data } = await api.patch<{ automation: AutomationRecord }>(
        `/api/account-settings/${tenantId}/automations/${record.id}`,
        mutationPayload(record, !record.isEnabled),
      )
      setItems((current) => current.map((item) => (item.id === record.id ? data.automation : item)))
      toast.success(data.automation.isEnabled ? "Automation published." : "Automation moved to draft.")
    } catch (error) {
      toast.error(
        requestErrorMessage(
          error,
          "Could not change the automation status. Check its configuration and try again.",
        ),
      )
    } finally {
      setBusyId(null)
    }
  }

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= items.length || isReordering) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setItems(next)
    setIsReordering(true)
    try {
      await api.patch(`/api/account-settings/${tenantId}/automations/reorder`, {
        automationIds: next.map((item) => item.id),
      })
    } catch (error) {
      toast.error(requestErrorMessage(error, "Could not reorder automations."))
      void load()
    } finally {
      setIsReordering(false)
    }
  }

  const remove = async (record: AutomationRecord) => {
    if (!window.confirm(`Delete “${record.name}”? Execution history will be preserved.`)) return
    setBusyId(record.id)
    try {
      await api.delete(`/api/account-settings/${tenantId}/automations/${record.id}`)
      setItems((current) => current.filter((item) => item.id !== record.id))
      toast.success("Automation deleted.")
    } catch (error) {
      toast.error(requestErrorMessage(error, "Could not delete the automation."))
    } finally {
      setBusyId(null)
    }
  }

  const pipelineName = (pipelineId: string) =>
    catalog?.pipelines.find((pipeline) => pipeline.id === pipelineId)?.name ?? "Unknown pipeline"
  const stageName = (pipelineId: string, stageId: string | null | undefined) =>
    catalog?.pipelines
      .find((pipeline) => pipeline.id === pipelineId)
      ?.stages.find((stage) => stage.id === stageId)?.name ?? "Any stage"

  return (
    <section aria-labelledby="automation-settings-title" className="flex min-h-0 flex-1 flex-col gap-5">
      <header className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-4 sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-xs font-semibold text-blue-700">Automation settings</p>
            <div className="flex flex-col gap-1">
              <h2 id="automation-settings-title" className="text-2xl font-semibold text-slate-950">
                Build reliable workflows
              </h2>
              <p className="max-w-2xl text-sm text-slate-600">
                Turn opportunity events into consistent contact updates, team tasks, and follow-through.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 md:self-center">
            <Button asChild type="button" variant="ghost" className={COMPACT_HEADER_SECONDARY_BUTTON_CLASS}>
              <Link href={`/app/${tenantSlug}/automation-processes`}>
                <History data-icon="inline-start" aria-hidden="true" />
                Process history
              </Link>
            </Button>
            <Button asChild type="button" variant="ghost" className={COMPACT_PRIMARY_BUTTON_CLASS}>
              <Link href={`/app/${tenantSlug}/account-settings/automations/new`}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                New automation
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Workflow order</h3>
          <p className="mt-1 text-sm text-slate-500">
            Keep your automations organized and manage which workflows are live.
          </p>
        </div>
        {!loading && !loadError && items.length > 0 ? (
          <p className="text-xs font-medium text-slate-500" aria-live="polite">
            <span className="font-semibold tabular-nums text-slate-800">{publishedCount}</span> published
            <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
            <span className="font-semibold tabular-nums text-slate-800">{items.length - publishedCount}</span> draft
          </p>
        ) : null}
      </div>

      <div aria-busy={loading} aria-live="polite">
        {loading ? (
          <div className="grid gap-3" aria-label="Loading automations">
            {[0, 1, 2].map((item) => (
              <AutomationRowSkeleton key={item} />
            ))}
          </div>
        ) : loadError ? (
          <div role="alert" className="flex flex-col items-center justify-center rounded-[24px] border border-rose-200 bg-rose-50/70 px-6 py-12 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-white text-rose-600 shadow-sm ring-1 ring-rose-100">
              <AlertCircle aria-hidden="true" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-slate-950">Automations could not be loaded</h3>
            <p className="mt-1 max-w-md text-sm leading-6 text-slate-600">{loadError}</p>
            <Button type="button" variant="outline" className={cn(COMPACT_SECONDARY_BUTTON_CLASS, "mt-4")} onClick={() => void load()}>
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-6 py-14 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-blue-950 text-white shadow-sm ring-1 ring-black/5">
              <GitBranch aria-hidden="true" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-slate-950">Create your first automation</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
              Start with an opportunity trigger, add any conditions, then choose the actions your team wants to run.
            </p>
            <Button asChild type="button" variant="ghost" className={cn(COMPACT_PRIMARY_BUTTON_CLASS, "mt-5")}>
              <Link href={`/app/${tenantSlug}/account-settings/automations/new`}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                New automation
              </Link>
            </Button>
          </div>
        ) : (
          <TooltipProvider>
            <ol className="grid gap-3">
              {items.map((record, index) => {
                const isBusy = busyId === record.id
                const triggerDescription =
                  record.trigger.type === "OPPORTUNITY_CREATED"
                    ? `Opportunity created in ${pipelineName(record.trigger.pipelineId)}`
                    : `Opportunity enters ${stageName(record.trigger.pipelineId, record.trigger.targetStageId)} in ${pipelineName(record.trigger.pipelineId)}`
                return (
                  <li key={record.id}>
                    <article className="group rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 transition hover:border-blue-200 hover:shadow-sm sm:p-5">
                      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex min-w-0 flex-1 gap-3.5 sm:gap-4">
                          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-900 shadow-sm">
                            <Zap aria-hidden="true" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold tabular-nums text-slate-500">
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <h4 className="min-w-0 truncate text-base font-semibold text-slate-950">{record.name}</h4>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-none",
                                  record.isEnabled
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-slate-200 bg-white text-slate-600",
                                )}
                              >
                                {record.isEnabled ? (
                                  <CircleCheck aria-hidden="true" />
                                ) : (
                                  <CircleDashed aria-hidden="true" />
                                )}
                                {record.isEnabled ? "Published" : "Draft"}
                              </Badge>
                            </div>

                            <p className="mt-2 flex min-w-0 items-center gap-2 text-sm text-slate-600">
                              <GitBranch className="shrink-0 text-slate-400" aria-hidden="true" />
                              <span className="truncate">{triggerDescription}</span>
                            </p>

                            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
                              <span>
                                <span className="font-semibold tabular-nums text-slate-700">{record.conditions.length}</span>{" "}
                                condition{record.conditions.length === 1 ? "" : "s"}
                              </span>
                              <span className="text-slate-300" aria-hidden="true">·</span>
                              <span>
                                <span className="font-semibold tabular-nums text-slate-700">{record.actions.length}</span>{" "}
                                action{record.actions.length === 1 ? "" : "s"}
                              </span>
                              {record.lastExecution ? (
                                <>
                                  <span className="text-slate-300" aria-hidden="true">·</span>
                                  <span
                                    className={cn(
                                      "font-medium",
                                      record.lastExecution.status === "SUCCEEDED"
                                        ? "text-emerald-700"
                                        : record.lastExecution.status === "EXITED"
                                          ? "text-amber-700"
                                          : "text-rose-700",
                                    )}
                                    title={record.lastExecution.errorMessage ?? undefined}
                                  >
                                    Last run {lastRunLabel(record.lastExecution.status).toLowerCase()}
                                  </span>
                                  <span className="text-slate-300" aria-hidden="true">·</span>
                                  <span>{formatDateTimeForDisplay(record.lastExecution.createdAt)}</span>
                                </>
                              ) : (
                                <>
                                  <span className="text-slate-300" aria-hidden="true">·</span>
                                  <span>Not run yet</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 xl:shrink-0 xl:border-0 xl:pt-0">
                          <div className="flex items-center gap-1" aria-label={`Reorder ${record.name}`}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="outline"
                                  disabled={index === 0 || isReordering || busyId !== null}
                                  onClick={() => void move(index, -1)}
                                  aria-label={`Move ${record.name} up`}
                                  className={COMPACT_ICON_BUTTON_CLASS}
                                >
                                  <ArrowUp aria-hidden="true" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">Move up</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="outline"
                                  disabled={index === items.length - 1 || isReordering || busyId !== null}
                                  onClick={() => void move(index, 1)}
                                  aria-label={`Move ${record.name} down`}
                                  className={COMPACT_ICON_BUTTON_CLASS}
                                >
                                  <ArrowDown aria-hidden="true" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top">Move down</TooltipContent>
                            </Tooltip>
                          </div>

                          <Button
                            type="button"
                            variant={record.isEnabled ? "outline" : "ghost"}
                            disabled={isBusy || isReordering}
                            className={record.isEnabled ? COMPACT_SECONDARY_BUTTON_CLASS : COMPACT_PRIMARY_BUTTON_CLASS}
                            onClick={() => void toggleAutomation(record)}
                          >
                            {isBusy ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : null}
                            {isBusy ? "Updating" : record.isEnabled ? "Move to draft" : "Publish"}
                          </Button>
                          <Button asChild type="button" variant="outline" className={COMPACT_SECONDARY_BUTTON_CLASS}>
                            <Link href={`/app/${tenantSlug}/account-settings/automations/${record.id}`}>
                              <Pencil data-icon="inline-start" aria-hidden="true" />
                              Edit
                            </Link>
                          </Button>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="outline"
                                disabled={isBusy || isReordering}
                                onClick={() => void remove(record)}
                                aria-label={`Delete ${record.name}`}
                                className={cn(
                                  COMPACT_ICON_BUTTON_CLASS,
                                  "text-rose-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700",
                                )}
                              >
                                <Trash2 aria-hidden="true" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">Delete automation</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </article>
                  </li>
                )
              })}
            </ol>
          </TooltipProvider>
        )}
      </div>
    </section>
  )
}
