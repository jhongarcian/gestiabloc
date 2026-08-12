"use client"

import "@xyflow/react/dist/style.css"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react"
import { isAxiosError } from "axios"
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  CircleStop,
  GitBranch,
  ListChecks,
  Loader2,
  Plus,
  Save,
  Settings2,
  Tags,
  Trash2,
  UserRound,
  X,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"

import type {
  AutomationAction,
  AutomationCatalog,
  AutomationCondition,
  AutomationExecution,
  AutomationOperator,
  AutomationRecord,
  AutomationTriggerType,
} from "./automation-types"
import {
  buildAutomationFlowGraph,
  type AutomationFlowNodeData as CanvasNodeData,
} from "./automation-flow-graph"

type AutomationFlowBuilderProps = {
  tenantId: string
  tenantSlug: string
  automationId?: string
}

type Draft = {
  name: string
  isEnabled: boolean
  triggerType: AutomationTriggerType
  pipelineId: string
  sourceStageId: string
  targetStageId: string
  conditions: AutomationCondition[]
  actions: AutomationAction[]
}

type CanvasNode = Node<CanvasNodeData>
type SelectedPanel = { kind: "setup" | "conditions" } | { kind: "action"; index: number }

const EMPTY_DRAFT: Draft = {
  name: "",
  isEnabled: false,
  triggerType: "OPPORTUNITY_CREATED",
  pipelineId: "",
  sourceStageId: "",
  targetStageId: "",
  conditions: [],
  actions: [],
}

const OPERATOR_LABELS: Record<AutomationOperator, string> = {
  EQUALS: "Equals",
  NOT_EQUALS: "Does not equal",
  CONTAINS: "Contains",
  NOT_CONTAINS: "Does not contain",
  GREATER_THAN: "Greater than",
  GREATER_THAN_OR_EQUAL: "Greater than or equal",
  LESS_THAN: "Less than",
  LESS_THAN_OR_EQUAL: "Less than or equal",
  BETWEEN: "Between",
  INCLUDES_ANY: "Includes any",
  INCLUDES_ALL: "Includes all",
  EXCLUDES_ALL: "Excludes all",
  IS_TRUE: "Is true",
  IS_FALSE: "Is false",
  IS_EMPTY: "Is empty",
  IS_NOT_EMPTY: "Is not empty",
}

const NUMERIC_OPERATORS: AutomationOperator[] = [
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "BETWEEN",
]
const STATUS_OPERATORS: AutomationOperator[] = ["EQUALS", "NOT_EQUALS", "IS_EMPTY", "IS_NOT_EMPTY"]
const VALUELESS_OPERATORS = new Set<AutomationOperator>(["IS_EMPTY", "IS_NOT_EMPTY", "IS_TRUE", "IS_FALSE"])

const ACTION_LABELS: Record<AutomationAction["type"], string> = {
  SET_CONTACT_CUSTOM_FIELD: "Set custom field",
  CLEAR_CONTACT_CUSTOM_FIELD: "Clear custom field",
  SET_CONTACT_STATUS: "Set contact status",
  CLEAR_CONTACT_STATUS: "Clear contact status",
  SET_CONTACT_ASSIGNEE: "Assign contact",
  CLEAR_CONTACT_ASSIGNEE: "Clear contact assignee",
  ADD_CONTACT_TAG: "Add contact tag",
  REMOVE_CONTACT_TAG: "Remove contact tag",
}

function AutomationFlowNode({ data }: NodeProps<CanvasNode>) {
  if (data.kind === "add") {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-cyan-400 bg-white text-cyan-700 shadow-sm transition hover:scale-105 hover:bg-cyan-50">
        <Handle type="target" position={Position.Top} className="opacity-0" />
        <Plus className="h-4 w-4" />
        <Handle type="source" position={Position.Bottom} className="opacity-0" />
      </div>
    )
  }

  const icon =
    data.kind === "trigger" ? (
      <Zap className="h-5 w-5" />
    ) : data.kind === "conditions" ? (
      <GitBranch className="h-5 w-5" />
    ) : data.kind === "action" ? (
      <Settings2 className="h-5 w-5" />
    ) : data.kind === "complete" ? (
      <CheckCircle2 className="h-5 w-5" />
    ) : (
      <CircleStop className="h-5 w-5" />
    )
  const tone =
    data.kind === "trigger"
      ? "border-cyan-300 bg-slate-950 text-white"
      : data.kind === "conditions"
        ? "border-amber-300 bg-amber-50 text-amber-950"
        : data.kind === "complete"
          ? "border-emerald-300 bg-emerald-50 text-emerald-950"
          : data.kind === "stop"
            ? "border-slate-300 bg-slate-100 text-slate-600"
            : "border-blue-200 bg-white text-slate-950"

  return (
    <div className={`w-64 rounded-2xl border-2 px-4 py-3 shadow-sm ${tone}`}>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 text-slate-700 shadow-sm">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{data.label}</p>
          {data.subtitle ? <p className="mt-0.5 truncate text-xs opacity-70">{data.subtitle}</p> : null}
        </div>
      </div>
      {data.kind === "conditions" ? (
        <>
          <Handle id="matched" type="source" position={Position.Bottom} className="opacity-0" />
          <Handle id="unmatched" type="source" position={Position.Right} className="opacity-0" />
        </>
      ) : data.kind === "stop" || data.kind === "complete" ? null : (
        <Handle type="source" position={Position.Bottom} className="opacity-0" />
      )}
    </div>
  )
}

const NODE_TYPES: NodeTypes = { automationNode: AutomationFlowNode }

function actionDefaults(type: AutomationAction["type"], catalog: AutomationCatalog): AutomationAction {
  if (type === "SET_CONTACT_CUSTOM_FIELD") return { type, customFieldId: catalog.customFields[0]?.id ?? "", value: "" }
  if (type === "CLEAR_CONTACT_CUSTOM_FIELD") return { type, customFieldId: catalog.customFields.find((field) => !field.isRequired)?.id ?? "" }
  if (type === "SET_CONTACT_STATUS") return { type, statusConfigId: catalog.statuses[0]?.id ?? "" }
  if (type === "SET_CONTACT_ASSIGNEE") return { type, assignedUserId: catalog.users[0]?.id ?? "" }
  if (type === "ADD_CONTACT_TAG" || type === "REMOVE_CONTACT_TAG") return { type, tagId: catalog.tags[0]?.id ?? "" }
  return { type }
}

function conditionDefaults(
  source: AutomationCondition["source"],
  catalog: AutomationCatalog,
): AutomationCondition {
  if (source === "CONTACT_CUSTOM_FIELD") {
    const field = catalog.customFields[0]
    const operator = field?.operators[0] ?? "EQUALS"
    const compareValue =
      field?.fieldType === "CHECKBOX"
        ? null
        : field?.fieldType === "NUMBER" || field?.fieldType === "CURRENCY"
          ? 0
          : field?.fieldType === "MULTI_SELECT"
            ? []
            : field?.options[0] ?? ""
    return {
      source,
      operator,
      customFieldId: field?.id ?? null,
      compareValue,
    }
  }
  if (source === "CONTACT_STATUS") {
    return {
      source,
      operator: "EQUALS",
      statusConfigId: catalog.statuses[0]?.id ?? null,
    }
  }
  if (source === "CONTACT_ASSIGNEE") {
    return {
      source,
      operator: "EQUALS",
      assignedUserId: catalog.users[0]?.id ?? null,
    }
  }
  if (source === "CONTACT_TAGS") {
    return {
      source,
      operator: "EQUALS",
      tagId: catalog.tags[0]?.id ?? null,
    }
  }
  return { source, operator: "GREATER_THAN_OR_EQUAL", compareValue: 0 }
}

function defaultCondition(catalog: AutomationCatalog) {
  if (catalog.customFields.length > 0) return conditionDefaults("CONTACT_CUSTOM_FIELD", catalog)
  if (catalog.statuses.length > 0) return conditionDefaults("CONTACT_STATUS", catalog)
  if (catalog.users.length > 0) return conditionDefaults("CONTACT_ASSIGNEE", catalog)
  if (catalog.tags.length > 0) return conditionDefaults("CONTACT_TAGS", catalog)
  return conditionDefaults("OPPORTUNITY_VALUE", catalog)
}

function apiError(error: unknown) {
  if (!isAxiosError(error)) return "Could not save the automation."
  const message = error.response?.data?.message
  return typeof message === "string" ? message : "Could not save the automation."
}

export function AutomationFlowBuilder({ tenantId, tenantSlug, automationId }: AutomationFlowBuilderProps) {
  const router = useRouter()
  const [catalog, setCatalog] = useState<AutomationCatalog | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [selected, setSelected] = useState<SelectedPanel>({ kind: "setup" })
  const [activeTab, setActiveTab] = useState<"builder" | "logs">("builder")
  const [logs, setLogs] = useState<AutomationExecution[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const [catalogResponse, automationResponse] = await Promise.all([
          api.get<{ catalog: AutomationCatalog }>(`/api/account-settings/${tenantId}/automations/catalog`),
          automationId
            ? api.get<{ automation: AutomationRecord }>(`/api/account-settings/${tenantId}/automations/${automationId}`)
            : Promise.resolve(null),
        ])
        if (cancelled) return
        const nextCatalog = catalogResponse.data.catalog
        setCatalog(nextCatalog)
        if (automationResponse) {
          const record = automationResponse.data.automation
          setDraft({
            name: record.name,
            isEnabled: record.isEnabled,
            triggerType: record.trigger.type,
            pipelineId: record.trigger.pipelineId,
            sourceStageId: record.trigger.type === "OPPORTUNITY_STAGE_CHANGED" ? record.trigger.sourceStageId ?? "" : "",
            targetStageId: record.trigger.type === "OPPORTUNITY_STAGE_CHANGED" ? record.trigger.targetStageId : "",
            conditions: record.conditions,
            actions: record.actions,
          })
        } else {
          const pipeline = nextCatalog.pipelines[0]
          setDraft({ ...EMPTY_DRAFT, pipelineId: pipeline?.id ?? "", targetStageId: pipeline?.stages[0]?.id ?? "" })
        }
      } catch {
        toast.error("Could not load the automation builder.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [automationId, tenantId])

  const loadLogs = useCallback(async () => {
    if (!automationId) return
    setLogsLoading(true)
    try {
      const { data } = await api.get<{ items: AutomationExecution[] }>(
        `/api/account-settings/${tenantId}/automation-executions`,
        { params: { automationId, pageSize: 50 } },
      )
      setLogs(data.items)
    } catch {
      toast.error("Could not load execution logs.")
    } finally {
      setLogsLoading(false)
    }
  }, [automationId, tenantId])

  useEffect(() => {
    if (activeTab === "logs") void loadLogs()
  }, [activeTab, loadLogs])

  const graph = useMemo(
    () => buildAutomationFlowGraph(draft, catalog, ACTION_LABELS),
    [catalog, draft],
  )
  const pipeline = catalog?.pipelines.find((item) => item.id === draft.pipelineId)

  const updateCondition = (index: number, patch: Partial<AutomationCondition>) => {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition, conditionIndex) =>
        conditionIndex === index ? { ...condition, ...patch } : condition,
      ),
    }))
  }

  const updateAction = (index: number, action: AutomationAction) => {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((item, actionIndex) => (actionIndex === index ? action : item)),
    }))
  }

  const insertAction = (index: number) => {
    if (!catalog) return
    const initialType: AutomationAction["type"] = catalog.statuses.length > 0 ? "SET_CONTACT_STATUS" : "CLEAR_CONTACT_STATUS"
    const action = actionDefaults(initialType, catalog)
    setDraft((current) => {
      const actions = [...current.actions]
      actions.splice(index, 0, action)
      return { ...current, actions }
    })
    setSelected({ kind: "action", index })
  }

  const moveAction = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= draft.actions.length) return
    setDraft((current) => {
      const actions = [...current.actions]
      ;[actions[index], actions[target]] = [actions[target]!, actions[index]!]
      return { ...current, actions }
    })
    setSelected({ kind: "action", index: target })
  }

  const save = async () => {
    if (!draft.name.trim()) return toast.error("Enter an automation name.")
    if (!draft.pipelineId) return toast.error("Select a pipeline.")
    if (draft.triggerType === "OPPORTUNITY_STAGE_CHANGED" && !draft.targetStageId) return toast.error("Select a destination stage.")
    if (draft.actions.length === 0) return toast.error("Add at least one action.")
    const trigger =
      draft.triggerType === "OPPORTUNITY_CREATED"
        ? { type: draft.triggerType, pipelineId: draft.pipelineId }
        : {
            type: draft.triggerType,
            pipelineId: draft.pipelineId,
            sourceStageId: draft.sourceStageId || null,
            targetStageId: draft.targetStageId,
          }
    setSaving(true)
    try {
      const payload = {
        name: draft.name.trim(),
        isEnabled: draft.isEnabled,
        trigger,
        conditions: draft.conditions.map((condition) => ({
          source: condition.source,
          operator: condition.operator,
          customFieldId: condition.customFieldId,
          statusConfigId: condition.statusConfigId,
          assignedUserId: condition.assignedUserId,
          tagId: condition.tagId,
          compareValue: condition.compareValue,
        })),
        actions: draft.actions.map((action) => ({
          type: action.type,
          customFieldId: action.customFieldId,
          statusConfigId: action.statusConfigId,
          assignedUserId: action.assignedUserId,
          tagId: action.tagId,
          value: action.value,
        })),
      }
      if (automationId) {
        await api.patch(`/api/account-settings/${tenantId}/automations/${automationId}`, payload)
        toast.success("Automation saved.")
      } else {
        const { data } = await api.post<{ automation: AutomationRecord }>(
          `/api/account-settings/${tenantId}/automations`,
          payload,
        )
        toast.success("Automation created as a draft.")
        router.replace(`/app/${tenantSlug}/account-settings/automations/${data.automation.id}`)
      }
    } catch (error) {
      toast.error(apiError(error))
    } finally {
      setSaving(false)
    }
  }

  if (loading || !catalog) {
    return <div className="flex h-full items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading automation builder…</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-slate-50 p-3 md:p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild size="icon" variant="ghost"><Link href={`/app/${tenantSlug}/account-settings/automations`} aria-label="Back to automations"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Opportunity automation</p>
            <h1 className="truncate text-lg font-semibold text-slate-950">{draft.name || "Untitled automation"}</h1>
          </div>
          <Badge className={draft.isEnabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}>{draft.isEnabled ? "Active" : "Draft"}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant={activeTab === "builder" ? "default" : "outline"} onClick={() => setActiveTab("builder")}>Builder</Button>
          <Button type="button" variant={activeTab === "logs" ? "default" : "outline"} disabled={!automationId} onClick={() => setActiveTab("logs")}>Execution Logs</Button>
          <Button type="button" onClick={() => void save()} disabled={saving} className="bg-cyan-600 hover:bg-cyan-700">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </Button>
        </div>
      </header>

      {activeTab === "logs" ? (
        <ExecutionLogs logs={logs} loading={logsLoading} />
      ) : (
        <section className="flex min-h-0 flex-1 gap-3">
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
            <ReactFlowProvider>
              <ReactFlow<CanvasNode, Edge>
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={NODE_TYPES}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                onNodeClick={(_, node) => {
                  if (node.data.kind === "trigger") return setSelected({ kind: "setup" })
                  if (node.data.kind === "conditions") return setSelected({ kind: "conditions" })
                  if (node.data.kind === "action" && node.data.index !== undefined) return setSelected({ kind: "action", index: node.data.index })
                  if (node.data.kind === "add" && node.data.insertionIndex !== undefined) insertAction(node.data.insertionIndex)
                }}
              >
                <Controls position="bottom-left" />
                <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
              </ReactFlow>
            </ReactFlowProvider>
          </div>

          <aside className="flex h-full min-h-0 w-full max-w-md shrink-0 flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Configuration</p>
                <h2 className="text-sm font-semibold text-slate-950">{selected.kind === "action" ? `Action ${selected.index + 1}` : selected.kind === "conditions" ? "All conditions" : "Trigger setup"}</h2>
              </div>
              {selected.kind !== "setup" ? <Button type="button" size="icon" variant="ghost" onClick={() => setSelected({ kind: "setup" })}><X className="h-4 w-4" /></Button> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {selected.kind === "action" ? (
                <ActionEditor
                  action={draft.actions[selected.index]!}
                  index={selected.index}
                  total={draft.actions.length}
                  catalog={catalog}
                  onChange={(action) => updateAction(selected.index, action)}
                  onMove={(direction) => moveAction(selected.index, direction)}
                  onDelete={() => {
                    setDraft((current) => ({ ...current, actions: current.actions.filter((_, index) => index !== selected.index) }))
                    setSelected({ kind: "setup" })
                  }}
                />
              ) : selected.kind === "conditions" ? (
                <ConditionsEditor draft={draft} catalog={catalog} onChange={(conditions) => setDraft((current) => ({ ...current, conditions }))} updateCondition={updateCondition} />
              ) : (
                <SetupEditor draft={draft} pipeline={pipeline} catalog={catalog} onChange={setDraft} />
              )}
            </div>
          </aside>
        </section>
      )}
    </div>
  )
}

function SetupEditor({
  draft,
  pipeline,
  catalog,
  onChange,
}: {
  draft: Draft
  pipeline?: AutomationCatalog["pipelines"][number]
  catalog: AutomationCatalog
  onChange: (draft: Draft) => void
}) {
  const setConditions = (conditions: AutomationCondition[]) => onChange({ ...draft, conditions })
  const updateCondition = (index: number, patch: Partial<AutomationCondition>) => {
    setConditions(
      draft.conditions.map((condition, conditionIndex) =>
        conditionIndex === index ? { ...condition, ...patch } : condition,
      ),
    )
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Step 1</p>
          <h3 className="mt-1 text-sm font-semibold text-slate-950">Choose a trigger</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">Select the opportunity event that starts this automation.</p>
        </div>
        <div className="grid gap-2">
          <TriggerChoice
            active={draft.triggerType === "OPPORTUNITY_CREATED"}
            icon={<Zap className="h-4 w-4" />}
            title="Opportunity created"
            description="Runs when an opportunity is added to the selected pipeline."
            onClick={() =>
              onChange({
                ...draft,
                triggerType: "OPPORTUNITY_CREATED",
                sourceStageId: "",
                targetStageId: "",
              })
            }
          />
          <TriggerChoice
            active={draft.triggerType === "OPPORTUNITY_STAGE_CHANGED"}
            icon={<GitBranch className="h-4 w-4" />}
            title="Opportunity stage changed"
            description="Runs when an opportunity moves into a destination stage."
            onClick={() =>
              onChange({
                ...draft,
                triggerType: "OPPORTUNITY_STAGE_CHANGED",
                sourceStageId: "",
                targetStageId: pipeline?.stages[0]?.id ?? "",
              })
            }
          />
        </div>
      </section>

      <section className="space-y-4 border-t border-slate-200 pt-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Step 2</p>
          <h3 className="mt-1 text-sm font-semibold text-slate-950">Choose the pipeline</h3>
        </div>
        <div className="space-y-2">
          <Label>Pipeline</Label>
          <Select
            value={draft.pipelineId}
            onValueChange={(pipelineId) => {
              const nextPipeline = catalog.pipelines.find((item) => item.id === pipelineId)
              onChange({
                ...draft,
                pipelineId,
                sourceStageId: "",
                targetStageId:
                  draft.triggerType === "OPPORTUNITY_STAGE_CHANGED"
                    ? nextPipeline?.stages[0]?.id ?? ""
                    : "",
              })
            }}
          >
            <SelectTrigger><SelectValue placeholder="Select pipeline" /></SelectTrigger>
            <SelectContent>
              {catalog.pipelines.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {draft.triggerType === "OPPORTUNITY_STAGE_CHANGED" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>From stage</Label>
              <Select value={draft.sourceStageId || "ANY"} onValueChange={(value) => onChange({ ...draft, sourceStageId: value === "ANY" ? "" : value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANY">Any stage</SelectItem>
                  {pipeline?.stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>To stage</Label>
              <Select value={draft.targetStageId} onValueChange={(targetStageId) => onChange({ ...draft, targetStageId })}>
                <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                <SelectContent>
                  {pipeline?.stages.filter((stage) => stage.id !== draft.sourceStageId).map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-4 border-t border-slate-200 pt-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Step 3</p>
          <h3 className="mt-1 text-sm font-semibold text-slate-950">Add filters</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">Optional. All filters must match the same contact snapshot.</p>
        </div>
        <ConditionsEditor
          compact
          draft={draft}
          catalog={catalog}
          onChange={setConditions}
          updateCondition={updateCondition}
        />
      </section>

      <section className="space-y-4 border-t border-slate-200 pt-5">
        <div className="space-y-2">
          <Label htmlFor="automation-name">Automation name</Label>
          <Input id="automation-name" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="Qualify new opportunity" />
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
          <Checkbox checked={draft.isEnabled} onCheckedChange={(checked) => onChange({ ...draft, isEnabled: checked === true })} />
          <span>
            <span className="block text-sm font-medium text-slate-900">Enable automation</span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">Enabled flows run immediately when the trigger matches.</span>
          </span>
        </label>
        <Button type="button" variant="outline" className="w-full" onClick={() => { const type: AutomationAction["type"] = catalog.statuses.length ? "SET_CONTACT_STATUS" : "CLEAR_CONTACT_STATUS"; onChange({ ...draft, actions: [...draft.actions, actionDefaults(type, catalog)] }) }}><Plus className="h-4 w-4" /> Add action</Button>
      </section>
    </div>
  )
}

function TriggerChoice({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
        active
          ? "border-cyan-400 bg-cyan-50 ring-1 ring-cyan-200"
          : "border-slate-200 bg-white hover:border-cyan-200 hover:bg-slate-50"
      }`}
    >
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? "bg-cyan-600 text-white" : "bg-slate-100 text-slate-600"}`}>{icon}</span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
    </button>
  )
}

function ConditionsEditor({
  draft,
  catalog,
  onChange,
  updateCondition,
  compact = false,
}: {
  draft: Draft
  catalog: AutomationCatalog
  onChange: (conditions: AutomationCondition[]) => void
  updateCondition: (index: number, patch: Partial<AutomationCondition>) => void
  compact?: boolean
}) {
  if (draft.conditions.length === 0) {
    return (
      <div className={compact ? "rounded-xl border border-dashed border-slate-300 p-4 text-center" : "py-10 text-center"}>
        <ListChecks className="mx-auto h-7 w-7 text-slate-300" />
        <p className="mt-2 text-sm text-slate-600">No filters. Every matching trigger will run.</p>
        <Button type="button" variant="outline" className="mt-3" onClick={() => onChange([defaultCondition(catalog)])}>
          <Plus className="h-4 w-4" /> Add filter
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {draft.conditions.map((condition, index) => (
        <ConditionCard
          key={condition.id ?? index}
          condition={condition}
          index={index}
          catalog={catalog}
          onChange={(patch) => updateCondition(index, patch)}
          onDelete={() => onChange(draft.conditions.filter((_, itemIndex) => itemIndex !== index))}
        />
      ))}
      <Button type="button" variant="outline" className="w-full" onClick={() => onChange([...draft.conditions, defaultCondition(catalog)])}>
        <Plus className="h-4 w-4" /> Add filter
      </Button>
    </div>
  )
}

function ConditionCard({
  condition,
  index,
  catalog,
  onChange,
  onDelete,
}: {
  condition: AutomationCondition
  index: number
  catalog: AutomationCatalog
  onChange: (patch: Partial<AutomationCondition>) => void
  onDelete: () => void
}) {
  const field = catalog.customFields.find((item) => item.id === condition.customFieldId)
  const operators =
    condition.source === "OPPORTUNITY_VALUE"
      ? NUMERIC_OPERATORS
      : condition.source === "CONTACT_CUSTOM_FIELD"
        ? field?.operators ?? []
        : STATUS_OPERATORS
  const sourceIcon =
    condition.source === "CONTACT_ASSIGNEE" ? (
      <UserRound className="h-4 w-4" />
    ) : condition.source === "CONTACT_TAGS" ? (
      <Tags className="h-4 w-4" />
    ) : condition.source === "OPPORTUNITY_VALUE" ? (
      <Zap className="h-4 w-4" />
    ) : (
      <ListChecks className="h-4 w-4" />
    )

  const operatorLabel = (operator: AutomationOperator) => {
    if (condition.source === "CONTACT_TAGS" && operator === "EQUALS") return "Has tag"
    if (condition.source === "CONTACT_TAGS" && operator === "NOT_EQUALS") return "Does not have tag"
    if (condition.source === "CONTACT_ASSIGNEE" && operator === "EQUALS") return "Is assigned to"
    if (condition.source === "CONTACT_ASSIGNEE" && operator === "NOT_EQUALS") return "Is not assigned to"
    return OPERATOR_LABELS[operator]
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">{sourceIcon}</span>
          <p className="text-sm font-semibold text-slate-900">Filter {index + 1}</p>
        </div>
        <Button type="button" size="icon" variant="ghost" onClick={onDelete} className="text-rose-600" aria-label={`Delete filter ${index + 1}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-2">
        <Label>Filter by</Label>
        <Select
          value={condition.source}
          onValueChange={(source: AutomationCondition["source"]) =>
            onChange({
              customFieldId: null,
              statusConfigId: null,
              assignedUserId: null,
              tagId: null,
              compareValue: null,
              ...conditionDefaults(source, catalog),
            })
          }
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="CONTACT_CUSTOM_FIELD" disabled={catalog.customFields.length === 0}>Custom field</SelectItem>
            <SelectItem value="CONTACT_STATUS" disabled={catalog.statuses.length === 0}>Contact status</SelectItem>
            <SelectItem value="CONTACT_ASSIGNEE" disabled={catalog.users.length === 0}>Assigned to</SelectItem>
            <SelectItem value="CONTACT_TAGS" disabled={catalog.tags.length === 0}>Tags</SelectItem>
            <SelectItem value="OPPORTUNITY_VALUE">Opportunity value</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {condition.source === "CONTACT_CUSTOM_FIELD" ? (
        <div className="space-y-2">
          <Label>Custom field</Label>
          <Select
            value={condition.customFieldId ?? ""}
            onValueChange={(customFieldId) => {
              const selectedField = catalog.customFields.find((item) => item.id === customFieldId)
              const operator = selectedField?.operators[0] ?? "EQUALS"
              const compareValue =
                selectedField?.fieldType === "CHECKBOX"
                  ? null
                  : selectedField?.fieldType === "NUMBER" || selectedField?.fieldType === "CURRENCY"
                    ? 0
                    : selectedField?.fieldType === "MULTI_SELECT"
                      ? []
                      : selectedField?.options[0] ?? ""
              onChange({ customFieldId, operator, compareValue })
            }}
          >
            <SelectTrigger><SelectValue placeholder="Select field" /></SelectTrigger>
            <SelectContent>
              {catalog.customFields.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="space-y-2">
        <Label>Operator</Label>
        <Select
          value={condition.operator}
          onValueChange={(operator: AutomationOperator) => {
            const valueless = VALUELESS_OPERATORS.has(operator)
            onChange({
              operator,
              compareValue: valueless ? null : condition.compareValue,
              ...(condition.source === "CONTACT_STATUS"
                ? { statusConfigId: valueless ? null : condition.statusConfigId ?? catalog.statuses[0]?.id ?? null }
                : {}),
              ...(condition.source === "CONTACT_ASSIGNEE"
                ? { assignedUserId: valueless ? null : condition.assignedUserId ?? catalog.users[0]?.id ?? null }
                : {}),
              ...(condition.source === "CONTACT_TAGS"
                ? { tagId: valueless ? null : condition.tagId ?? catalog.tags[0]?.id ?? null }
                : {}),
            })
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {operators.map((operator) => <SelectItem key={operator} value={operator}>{operatorLabel(operator)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <ConditionValueInput
        condition={condition}
        field={field}
        catalog={catalog}
        onChange={(compareValue) => onChange({ compareValue })}
        onStatusChange={(statusConfigId) => onChange({ statusConfigId })}
        onAssigneeChange={(assignedUserId) => onChange({ assignedUserId })}
        onTagChange={(tagId) => onChange({ tagId })}
      />
    </div>
  )
}

function ConditionValueInput({
  condition,
  field,
  catalog,
  onChange,
  onStatusChange,
  onAssigneeChange,
  onTagChange,
}: {
  condition: AutomationCondition
  field?: AutomationCatalog["customFields"][number]
  catalog: AutomationCatalog
  onChange: (value: unknown) => void
  onStatusChange: (value: string) => void
  onAssigneeChange: (value: string) => void
  onTagChange: (value: string) => void
}) {
  if (VALUELESS_OPERATORS.has(condition.operator)) return null
  if (condition.source === "CONTACT_STATUS") {
    return <div className="space-y-2"><Label>Status</Label><Select value={condition.statusConfigId ?? ""} onValueChange={onStatusChange}><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger><SelectContent>{catalog.statuses.map((status) => <SelectItem key={status.id} value={status.id}>{status.name}</SelectItem>)}</SelectContent></Select></div>
  }
  if (condition.source === "CONTACT_ASSIGNEE") {
    return <div className="space-y-2"><Label>Assigned to</Label><Select value={condition.assignedUserId ?? ""} onValueChange={onAssigneeChange}><SelectTrigger><SelectValue placeholder="Select team member" /></SelectTrigger><SelectContent>{catalog.users.map((user) => <SelectItem key={user.id} value={user.id}>{user.name} · {user.email}</SelectItem>)}</SelectContent></Select></div>
  }
  if (condition.source === "CONTACT_TAGS") {
    return <div className="space-y-2"><Label>Tag</Label><Select value={condition.tagId ?? ""} onValueChange={onTagChange}><SelectTrigger><SelectValue placeholder="Select tag" /></SelectTrigger><SelectContent>{catalog.tags.map((tag) => <SelectItem key={tag.id} value={tag.id}>{tag.name}</SelectItem>)}</SelectContent></Select></div>
  }
  if (condition.operator === "BETWEEN") {
    const range = (condition.compareValue ?? {}) as { min?: unknown; max?: unknown }
    const type = field?.fieldType === "DATE" ? "date" : "number"
    return <div className="grid grid-cols-2 gap-2"><div className="space-y-2"><Label>Minimum</Label><Input type={type} value={String(range.min ?? "")} onChange={(event) => onChange({ ...range, min: type === "number" ? Number(event.target.value) : event.target.value })} /></div><div className="space-y-2"><Label>Maximum</Label><Input type={type} value={String(range.max ?? "")} onChange={(event) => onChange({ ...range, max: type === "number" ? Number(event.target.value) : event.target.value })} /></div></div>
  }
  if (field && (field.fieldType === "SELECT" || field.fieldType === "RADIO")) {
    return <div className="space-y-2"><Label>Value</Label><Select value={String(condition.compareValue ?? "")} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Select value" /></SelectTrigger><SelectContent>{field.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div>
  }
  if (field?.fieldType === "MULTI_SELECT") {
    return <div className="space-y-2"><Label>Values</Label><Input value={Array.isArray(condition.compareValue) ? condition.compareValue.join(", ") : ""} onChange={(event) => onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="Option A, Option B" /></div>
  }
  const isOpportunityValue = condition.source === "OPPORTUNITY_VALUE"
  const type = field?.fieldType === "DATE" ? "date" : field?.fieldType === "NUMBER" || field?.fieldType === "CURRENCY" || isOpportunityValue ? "number" : "text"
  const shownValue = isOpportunityValue ? Number(condition.compareValue ?? 0) / 100 : condition.compareValue ?? ""
  return <div className="space-y-2"><Label>{isOpportunityValue ? "Value (USD)" : "Value"}</Label><Input type={type} value={String(shownValue)} onChange={(event) => onChange(isOpportunityValue ? Math.round(Number(event.target.value) * 100) : type === "number" ? Number(event.target.value) : event.target.value)} /></div>
}

function ActionEditor({ action, index, total, catalog, onChange, onMove, onDelete }: { action: AutomationAction; index: number; total: number; catalog: AutomationCatalog; onChange: (action: AutomationAction) => void; onMove: (direction: -1 | 1) => void; onDelete: () => void }) {
  const field = catalog.customFields.find((item) => item.id === action.customFieldId)
  return <div className="space-y-5"><div className="space-y-2"><Label>Action type</Label><Select value={action.type} onValueChange={(type: AutomationAction["type"]) => onChange(actionDefaults(type, catalog))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ACTION_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>{action.type === "SET_CONTACT_CUSTOM_FIELD" || action.type === "CLEAR_CONTACT_CUSTOM_FIELD" ? <div className="space-y-2"><Label>Custom field</Label><Select value={action.customFieldId ?? ""} onValueChange={(customFieldId) => onChange({ ...action, customFieldId })}><SelectTrigger><SelectValue placeholder="Select field" /></SelectTrigger><SelectContent>{catalog.customFields.filter((item) => action.type !== "CLEAR_CONTACT_CUSTOM_FIELD" || !item.isRequired).map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select></div> : null}{action.type === "SET_CONTACT_CUSTOM_FIELD" && field ? <ActionValueInput action={action} field={field} onChange={(value) => onChange({ ...action, value })} /> : null}{action.type === "SET_CONTACT_STATUS" ? <div className="space-y-2"><Label>Status</Label><Select value={action.statusConfigId ?? ""} onValueChange={(statusConfigId) => onChange({ ...action, statusConfigId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{catalog.statuses.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div> : null}{action.type === "SET_CONTACT_ASSIGNEE" ? <div className="space-y-2"><Label>Assignee</Label><Select value={action.assignedUserId ?? ""} onValueChange={(assignedUserId) => onChange({ ...action, assignedUserId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{catalog.users.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.email}</SelectItem>)}</SelectContent></Select></div> : null}{action.type === "ADD_CONTACT_TAG" || action.type === "REMOVE_CONTACT_TAG" ? <div className="space-y-2"><Label>Tag</Label><Select value={action.tagId ?? ""} onValueChange={(tagId) => onChange({ ...action, tagId })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{catalog.tags.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div> : null}<div className="flex gap-2 border-t border-slate-200 pt-4"><Button type="button" size="icon" variant="outline" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move action up"><ArrowUp className="h-4 w-4" /></Button><Button type="button" size="icon" variant="outline" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move action down"><ArrowDown className="h-4 w-4" /></Button><Button type="button" variant="outline" className="ml-auto text-rose-600" onClick={onDelete}><Trash2 className="h-4 w-4" /> Delete</Button></div></div>
}

function ActionValueInput({ action, field, onChange }: { action: AutomationAction; field: AutomationCatalog["customFields"][number]; onChange: (value: unknown) => void }) {
  if (field.fieldType === "CHECKBOX") return <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><Checkbox checked={action.value === true} onCheckedChange={(checked) => onChange(checked === true)} /><span className="text-sm font-medium">Checked</span></label>
  if (field.fieldType === "SELECT" || field.fieldType === "RADIO") return <div className="space-y-2"><Label>Value</Label><Select value={String(action.value ?? "")} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Select value" /></SelectTrigger><SelectContent>{field.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div>
  if (field.fieldType === "MULTI_SELECT") return <div className="space-y-2"><Label>Values</Label><Input value={Array.isArray(action.value) ? action.value.join(", ") : ""} onChange={(event) => onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="Option A, Option B" /></div>
  if (field.fieldType === "TEXTAREA") return <div className="space-y-2"><Label>Value</Label><Textarea value={String(action.value ?? "")} onChange={(event) => onChange(event.target.value)} /></div>
  const type = field.fieldType === "DATE" ? "date" : field.fieldType === "NUMBER" || field.fieldType === "CURRENCY" ? "number" : "text"
  return <div className="space-y-2"><Label>Value</Label><Input type={type} value={String(action.value ?? "")} onChange={(event) => onChange(type === "number" ? Number(event.target.value) : event.target.value)} /></div>
}

function ExecutionLogs({ logs, loading }: { logs: AutomationExecution[]; loading: boolean }) {
  return <section className="min-h-0 flex-1 overflow-y-auto rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">{loading ? <div className="flex h-40 items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading executions…</div> : logs.length === 0 ? <div className="flex h-56 flex-col items-center justify-center text-center"><ListChecks className="h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-700">No executions yet</p><p className="mt-1 text-xs text-slate-500">Matched runs will appear here after this automation is enabled.</p></div> : <div className="space-y-2">{logs.map((log) => <article key={log.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3"><div><div className="flex items-center gap-2"><Badge className={log.status === "SUCCEEDED" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}>{log.status}</Badge><span className="text-sm font-medium text-slate-900">{log.automationName}</span></div><p className="mt-1 text-xs text-slate-500">{log.triggerType.replaceAll("_", " ")} · {log.actionCount} action{log.actionCount === 1 ? "" : "s"}</p>{log.errorMessage ? <p className="mt-1 text-xs text-rose-700">{log.errorMessage}</p> : null}</div><time className="text-xs text-slate-500">{new Date(log.createdAt).toLocaleString()}</time></article>)}</div>}</section>
}
