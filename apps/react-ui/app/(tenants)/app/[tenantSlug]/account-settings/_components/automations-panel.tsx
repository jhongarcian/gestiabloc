"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, GitBranch, Plus, Settings2, Trash2, Zap } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"

import type { AutomationCatalog, AutomationRecord } from "./automation-types"

type AutomationsPanelProps = { tenantId: string; tenantSlug: string }

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
    actions: record.actions.map((action) => ({
      type: action.type,
      customFieldId: action.customFieldId,
      statusConfigId: action.statusConfigId,
      assignedUserId: action.assignedUserId,
      tagId: action.tagId,
      value: action.value,
    })),
  }
}

export function AutomationsPanel({ tenantId, tenantSlug }: AutomationsPanelProps) {
  const [items, setItems] = useState<AutomationRecord[]>([])
  const [catalog, setCatalog] = useState<AutomationCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [automationResponse, catalogResponse] = await Promise.all([
        api.get<{ items: AutomationRecord[] }>(`/api/account-settings/${tenantId}/automations`),
        api.get<{ catalog: AutomationCatalog }>(
          `/api/account-settings/${tenantId}/automations/catalog`,
        ),
      ])
      setItems(automationResponse.data.items)
      setCatalog(catalogResponse.data.catalog)
    } catch {
      toast.error("Could not load opportunity automations.")
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    void load()
  }, [load])

  const toggleAutomation = async (record: AutomationRecord) => {
    setBusyId(record.id)
    try {
      const { data } = await api.patch<{ automation: AutomationRecord }>(
        `/api/account-settings/${tenantId}/automations/${record.id}`,
        mutationPayload(record, !record.isEnabled),
      )
      setItems((current) => current.map((item) => (item.id === record.id ? data.automation : item)))
      toast.success(data.automation.isEnabled ? "Automation enabled." : "Automation paused.")
    } catch {
      toast.error("Could not change the automation status. Check its configuration and try again.")
    } finally {
      setBusyId(null)
    }
  }

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setItems(next)
    try {
      await api.patch(`/api/account-settings/${tenantId}/automations/reorder`, {
        automationIds: next.map((item) => item.id),
      })
    } catch {
      toast.error("Could not reorder automations.")
      void load()
    }
  }

  const remove = async (record: AutomationRecord) => {
    if (!window.confirm(`Delete “${record.name}”? Execution history will be preserved.`)) return
    setBusyId(record.id)
    try {
      await api.delete(`/api/account-settings/${tenantId}/automations/${record.id}`)
      setItems((current) => current.filter((item) => item.id !== record.id))
      toast.success("Automation deleted.")
    } catch {
      toast.error("Could not delete the automation.")
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
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <section className="overflow-hidden rounded-[26px] border border-slate-200 bg-[linear-gradient(120deg,#07111f_0%,#12233e_55%,#0f766e_145%)] text-white shadow-sm">
        <div className="flex flex-col gap-5 p-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200">
              <Zap className="h-4 w-4" /> Opportunity operations
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Automations</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Turn pipeline events into immediate, auditable updates to contact data.
              </p>
            </div>
          </div>
          <Button asChild className="bg-cyan-300 text-slate-950 hover:bg-cyan-200">
            <Link href={`/app/${tenantSlug}/account-settings/automations/new`}>
              <Plus className="h-4 w-4" /> New automation
            </Link>
          </Button>
        </div>
      </section>

      {loading ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-cyan-200">
            <GitBranch className="h-6 w-6" />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-slate-950">No automations yet</h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
            Build your first flow from an opportunity trigger to one or more contact actions.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((record, index) => {
            const triggerDescription =
              record.trigger.type === "OPPORTUNITY_CREATED"
                ? `Opportunity created in ${pipelineName(record.trigger.pipelineId)}`
                : `${stageName(record.trigger.pipelineId, record.trigger.sourceStageId)} → ${stageName(record.trigger.pipelineId, record.trigger.targetStageId)}`
            return (
              <article
                key={record.id}
                className="group grid gap-4 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm transition hover:border-cyan-300 md:grid-cols-[52px_minmax(0,1fr)_auto] md:items-center"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-cyan-200">
                  <Zap className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-semibold text-slate-950">{record.name}</h3>
                    <Badge className={record.isEnabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}>
                      {record.isEnabled ? "Active" : "Draft"}
                    </Badge>
                    {record.lastExecution ? (
                      <Badge variant="outline" className={record.lastExecution.status === "SUCCEEDED" ? "border-emerald-200 text-emerald-700" : "border-rose-200 text-rose-700"}>
                        Last run {record.lastExecution.status.toLowerCase()}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-sm text-slate-600">{triggerDescription}</p>
                  <p className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                    {record.conditions.length} condition{record.conditions.length === 1 ? "" : "s"} · {record.actions.length} action{record.actions.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="icon" variant="outline" disabled={index === 0} onClick={() => void move(index, -1)} aria-label="Move automation up">
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon" variant="outline" disabled={index === items.length - 1} onClick={() => void move(index, 1)} aria-label="Move automation down">
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" disabled={busyId === record.id} onClick={() => void toggleAutomation(record)}>
                    {record.isEnabled ? "Pause" : "Enable"}
                  </Button>
                  <Button asChild variant="outline">
                    <Link href={`/app/${tenantSlug}/account-settings/automations/${record.id}`}>
                      <Settings2 className="h-4 w-4" /> Edit
                    </Link>
                  </Button>
                  <Button type="button" size="icon" variant="ghost" disabled={busyId === record.id} onClick={() => void remove(record)} aria-label="Delete automation" className="text-rose-600 hover:text-rose-700">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
