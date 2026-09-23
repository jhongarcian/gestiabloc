"use client"

import "@xyflow/react/dist/style.css"

import { useEffect, useMemo, useState } from "react"
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
  ListChecks,
  Loader2,
  MousePointerClick,
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
import { DateTimeInput } from "@/components/ui/date-time-input"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/lib/api"
import {
  dateTimeDraftToUtcIso,
  formatUtcIsoToDateTimeDraft,
  type DateTimeDraft,
} from "@/lib/date-time"
import { cn } from "@/lib/utils"

import { AutomationContactsTab } from "./automation-contacts-tab"
import { AutomationExecutionLogsTab } from "./automation-execution-logs-tab"
import type {
  AutomationAction,
  AutomationCatalog,
  AutomationCondition,
  AutomationOperator,
  AutomationRecord,
  AutomationTriggerType,
  AutomationWaitConfig,
  AutomationWaitUnit,
} from "./automation-types"
import {
  buildAutomationFlowGraph,
  type AutomationFlowNodeData as CanvasNodeData,
} from "./automation-flow-graph"

type AutomationFlowBuilderProps = {
  tenantId: string
  tenantSlug: string
  automationId?: string
  timezone?: string | null
}

type Draft = {
  name: string
  isEnabled: boolean
  triggerType: AutomationTriggerType | null
  pipelineId: string
  targetStageId: string
  conditions: AutomationCondition[]
  actions: AutomationAction[]
}

type CanvasNode = Node<CanvasNodeData>
type SelectedPanel =
  | { kind: "trigger" }
  | { kind: "action"; index: number }
  | { kind: "new-action"; insertionIndex: number }

const EMPTY_DRAFT: Draft = {
  name: "",
  isEnabled: false,
  triggerType: null,
  pipelineId: "",
  targetStageId: "",
  conditions: [],
  actions: [],
}

function cloneDraft(draft: Draft): Draft {
  return structuredClone(draft)
}

function draftSnapshot(draft: Draft) {
  return JSON.stringify({
    name: draft.name,
    isEnabled: draft.isEnabled,
    triggerType: draft.triggerType,
    pipelineId: draft.pipelineId,
    targetStageId: draft.targetStageId,
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
      nodeKey: action.nodeKey,
      type: action.type,
      customFieldId: action.customFieldId,
      statusConfigId: action.statusConfigId,
      assignedUserId: action.assignedUserId,
      tagId: action.tagId,
      value: action.value,
      waitConfig: action.waitConfig,
    })),
  })
}

function isTriggerReady(draft: Draft | null) {
  return Boolean(
    draft?.triggerType &&
      draft.pipelineId &&
      (draft.triggerType !== "OPPORTUNITY_STAGE_CHANGED" || draft.targetStageId),
  )
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
  SET_CONTACT_ASSIGNEE: "Assign contact",
  CLEAR_CONTACT_ASSIGNEE: "Clear contact assignee",
  ADD_CONTACT_TAG: "Add contact tag",
  REMOVE_CONTACT_TAG: "Remove contact tag",
  WAIT: "Wait",
}

const WAIT_UNIT_LABELS: Record<AutomationWaitUnit, string> = {
  SECONDS: "Seconds",
  MINUTES: "Minutes",
  HOURS: "Hours",
  DAYS: "Days",
}

const COMPACT_PRIMARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 transition hover:bg-blue-900 hover:text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"

const COMPACT_SECONDARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"

const COMPACT_DESTRUCTIVE_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-semibold shadow-sm transition disabled:cursor-not-allowed"

const COMPACT_SELECT_TRIGGER_CLASS =
  "h-8 w-full cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"

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
    data.kind === "trigger" && !data.configured ? (
      <MousePointerClick className="size-5" />
    ) : data.kind === "trigger" ? (
      <Zap className="h-5 w-5" />
    ) : data.kind === "action" ? (
      <Settings2 className="h-5 w-5" />
    ) : (
      <CheckCircle2 className="h-5 w-5" />
    )
  const tone =
    data.kind === "trigger"
      ? data.configured
        ? "border-primary bg-primary text-primary-foreground"
        : "cursor-pointer border-dashed border-primary/40 bg-card text-card-foreground hover:border-primary hover:bg-accent/40"
      : data.kind === "complete"
        ? "border-border bg-muted text-foreground"
        : "border-border bg-card text-card-foreground"

  return (
    <div className={cn("w-64 rounded-2xl border-2 px-4 py-3 shadow-sm transition-colors", tone)}>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl shadow-sm",
          data.kind === "trigger" && data.configured
            ? "bg-primary-foreground/90 text-primary"
            : "bg-background text-foreground",
        )}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{data.label}</p>
          {data.subtitle ? <p className="mt-0.5 truncate text-xs opacity-70">{data.subtitle}</p> : null}
        </div>
      </div>
      {data.kind === "complete" ? null : (
        <Handle type="source" position={Position.Bottom} className="opacity-0" />
      )}
    </div>
  )
}

const NODE_TYPES: NodeTypes = { automationNode: AutomationFlowNode }

function actionDefaults(
  type: AutomationAction["type"],
  catalog: AutomationCatalog,
  existingNodeKey?: string,
): AutomationAction {
  const nodeKey = existingNodeKey ?? crypto.randomUUID()
  if (type === "SET_CONTACT_CUSTOM_FIELD") return { nodeKey, type, customFieldId: catalog.customFields[0]?.id ?? "", value: "" }
  if (type === "CLEAR_CONTACT_CUSTOM_FIELD") return { nodeKey, type, customFieldId: catalog.customFields.find((field) => !field.isRequired)?.id ?? "" }
  if (type === "SET_CONTACT_STATUS") return { nodeKey, type, statusConfigId: catalog.statuses[0]?.id ?? "" }
  if (type === "SET_CONTACT_ASSIGNEE") return { nodeKey, type, assignedUserId: catalog.users[0]?.id ?? "" }
  if (type === "ADD_CONTACT_TAG" || type === "REMOVE_CONTACT_TAG") return { nodeKey, type, tagId: catalog.tags[0]?.id ?? "" }
  if (type === "WAIT") return { nodeKey, type, waitConfig: { mode: "DURATION", amount: 1, unit: "HOURS" } }
  return { nodeKey, type }
}

function isActionReady(action: AutomationAction | null, targetActions: AutomationAction[] = []) {
  if (!action) return false
  if (action.type === "SET_CONTACT_CUSTOM_FIELD") {
    const hasValue = Array.isArray(action.value)
      ? action.value.length > 0
      : action.value !== null && action.value !== undefined && action.value !== ""
    return Boolean(action.customFieldId) && hasValue
  }
  if (action.type === "CLEAR_CONTACT_CUSTOM_FIELD") return Boolean(action.customFieldId)
  if (action.type === "SET_CONTACT_STATUS") return Boolean(action.statusConfigId)
  if (action.type === "SET_CONTACT_ASSIGNEE") return Boolean(action.assignedUserId)
  if (action.type === "ADD_CONTACT_TAG" || action.type === "REMOVE_CONTACT_TAG") {
    return Boolean(action.tagId)
  }
  if (action.type === "WAIT") {
    const config = action.waitConfig
    if (!config) return false
    if (config.mode === "DURATION") return Number.isInteger(config.amount) && config.amount > 0
    if (Number.isNaN(new Date(config.dateTime).getTime())) return false
    if (config.timing !== "ON" && (!Number.isInteger(config.offsetAmount) || (config.offsetAmount ?? 0) <= 0 || !config.offsetUnit)) return false
    if (config.pastBehavior === "GO_TO_STEP") {
      return Boolean(config.targetNodeKey && targetActions.some((candidate) => candidate.nodeKey === config.targetNodeKey))
    }
  }
  return true
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

function draftValidationMessage(draft: Draft) {
  if (!draft.name.trim()) return "Enter an automation name."
  if (!draft.triggerType) return "Select a trigger."
  if (!draft.pipelineId) return "Select a pipeline."
  if (draft.triggerType === "OPPORTUNITY_STAGE_CHANGED" && !draft.targetStageId) return "Select a stage."
  if (draft.actions.length === 0) return "Add at least one action."
  const nodeKeys = draft.actions.map((action) => action.nodeKey).filter(Boolean)
  if (nodeKeys.length !== draft.actions.length || new Set(nodeKeys).size !== nodeKeys.length) {
    return "Every action needs a unique step identifier."
  }
  for (let index = 0; index < draft.actions.length; index += 1) {
    if (!isActionReady(draft.actions[index] ?? null, draft.actions.slice(index + 1))) {
      return `Finish configuring action ${index + 1}.`
    }
  }
  return null
}

function automationPayload(draft: Draft, isEnabled = draft.isEnabled) {
  if (!draft.triggerType) throw new Error("Select a trigger.")
  const trigger =
    draft.triggerType === "OPPORTUNITY_CREATED"
      ? { type: draft.triggerType, pipelineId: draft.pipelineId }
      : {
          type: draft.triggerType,
          pipelineId: draft.pipelineId,
          targetStageId: draft.targetStageId,
        }

  return {
    name: draft.name.trim(),
    isEnabled,
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
      nodeKey: action.nodeKey,
      type: action.type,
      customFieldId: action.customFieldId,
      statusConfigId: action.statusConfigId,
      assignedUserId: action.assignedUserId,
      tagId: action.tagId,
      value: action.value,
      waitConfig: action.waitConfig,
    })),
  }
}

export function AutomationFlowBuilder({ tenantId, tenantSlug, automationId, timezone }: AutomationFlowBuilderProps) {
  const router = useRouter()
  const [catalog, setCatalog] = useState<AutomationCatalog | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [lastSavedDraft, setLastSavedDraft] = useState<Draft>(EMPTY_DRAFT)
  const [selected, setSelected] = useState<SelectedPanel | null>(null)
  const [pendingAction, setPendingAction] = useState<AutomationAction | null>(null)
  const [editingAction, setEditingAction] = useState<AutomationAction | null>(null)
  const [triggerEditorDraft, setTriggerEditorDraft] = useState<Draft | null>(null)
  const [panelOriginalDraft, setPanelOriginalDraft] = useState<Draft | null>(null)
  const [activeTab, setActiveTab] = useState<"builder" | "contacts" | "logs">("builder")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [statusSaving, setStatusSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
          const loadedDraft: Draft = {
            name: record.name,
            isEnabled: record.isEnabled,
            triggerType: record.trigger.type,
            pipelineId: record.trigger.pipelineId,
            targetStageId: record.trigger.type === "OPPORTUNITY_STAGE_CHANGED" ? record.trigger.targetStageId : "",
            conditions: record.conditions,
            actions: record.actions,
          }
          setDraft(loadedDraft)
          setLastSavedDraft(cloneDraft(loadedDraft))
        } else {
          const emptyDraft = cloneDraft(EMPTY_DRAFT)
          setDraft(emptyDraft)
          setLastSavedDraft(cloneDraft(emptyDraft))
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

  const graph = useMemo(
    () => buildAutomationFlowGraph(draft, catalog, ACTION_LABELS, timezone),
    [catalog, draft, timezone],
  )
  const triggerPipeline = catalog?.pipelines.find(
    (item) => item.id === triggerEditorDraft?.pipelineId,
  )
  const hasUnsavedChanges = useMemo(
    () => draftSnapshot(draft) !== draftSnapshot(lastSavedDraft),
    [draft, lastSavedDraft],
  )
  const triggerPanelHasChanges = Boolean(
    selected?.kind === "trigger" &&
      triggerEditorDraft &&
      draftSnapshot(triggerEditorDraft) !== draftSnapshot(draft),
  )
  const actionPanelHasChanges = Boolean(
    selected?.kind === "action" &&
      editingAction &&
      (JSON.stringify(editingAction) !== JSON.stringify(draft.actions[selected.index]) ||
        (panelOriginalDraft && draftSnapshot(panelOriginalDraft) !== draftSnapshot(draft))),
  )
  const hasUncommittedPanelChanges =
    triggerPanelHasChanges || actionPanelHasChanges || (selected?.kind === "new-action" && pendingAction !== null)

  const updateAction = (index: number, action: AutomationAction) => {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((item, actionIndex) => (actionIndex === index ? action : item)),
    }))
  }

  const insertAction = (index: number, action: AutomationAction) => {
    setDraft((current) => {
      const actions = [...current.actions]
      actions.splice(index, 0, action)
      return { ...current, actions }
    })
  }

  const closePanel = () => {
    setSelected(null)
    setPendingAction(null)
    setEditingAction(null)
    setTriggerEditorDraft(null)
    setPanelOriginalDraft(null)
  }

  const cancelPanelChanges = () => {
    if (selected?.kind === "action" && panelOriginalDraft) {
      setDraft(cloneDraft(panelOriginalDraft))
    }
    closePanel()
  }

  const openTriggerPanel = () => {
    const originalDraft = cloneDraft(draft)
    setPendingAction(null)
    setEditingAction(null)
    setPanelOriginalDraft(originalDraft)
    setTriggerEditorDraft(cloneDraft(originalDraft))
    setSelected({ kind: "trigger" })
  }

  const openActionPanel = (index: number) => {
    const action = draft.actions[index]
    if (!action) return
    setPendingAction(null)
    setTriggerEditorDraft(null)
    setPanelOriginalDraft(cloneDraft(draft))
    setEditingAction(structuredClone(action))
    setSelected({ kind: "action", index })
  }

  const openNewActionPanel = (insertionIndex: number) => {
    setEditingAction(null)
    setTriggerEditorDraft(null)
    setPanelOriginalDraft(cloneDraft(draft))
    setPendingAction(null)
    setSelected({ kind: "new-action", insertionIndex })
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

  const saveChanges = async () => {
    if (selected) {
      toast.error("Save or cancel the sidebar changes first.")
      return
    }
    if (!hasUnsavedChanges) return
    const validationMessage = draftValidationMessage(draft)
    if (validationMessage) return toast.error(validationMessage)

    const sourceSnapshot = draftSnapshot(draft)
    const submittedDraft = cloneDraft(draft)
    submittedDraft.name = submittedDraft.name.trim()
    setSaving(true)
    try {
      const payload = automationPayload(submittedDraft)
      let savedAutomation: AutomationRecord
      if (automationId) {
        const { data } = await api.patch<{ automation: AutomationRecord }>(
          `/api/account-settings/${tenantId}/automations/${automationId}`,
          payload,
        )
        savedAutomation = data.automation
      } else {
        const { data } = await api.post<{ automation: AutomationRecord }>(
          `/api/account-settings/${tenantId}/automations`,
          payload,
        )
        savedAutomation = data.automation
        router.replace(`/app/${tenantSlug}/account-settings/automations/${data.automation.id}`)
      }
      const persistedDraft = {
        ...submittedDraft,
        isEnabled: savedAutomation.isEnabled,
      }
      setLastSavedDraft(cloneDraft(persistedDraft))
      setDraft((current) =>
        draftSnapshot(current) === sourceSnapshot
          ? cloneDraft(persistedDraft)
          : { ...current, isEnabled: savedAutomation.isEnabled },
      )
      toast.success(automationId ? "Automation saved." : "Automation created as a draft.")
    } catch (error) {
      toast.error(apiError(error))
    } finally {
      setSaving(false)
    }
  }

  const togglePublished = async () => {
    if (!automationId) {
      toast.error("Save the automation before publishing it.")
      return
    }
    if (selected) {
      toast.error("Save or cancel the sidebar changes first.")
      return
    }

    const nextPublished = !lastSavedDraft.isEnabled
    if (nextPublished && hasUnsavedChanges) {
      toast.error("Save the automation changes before publishing it.")
      return
    }

    setStatusSaving(true)
    try {
      const { data } = await api.patch<{ automation: AutomationRecord }>(
        `/api/account-settings/${tenantId}/automations/${automationId}`,
        automationPayload(lastSavedDraft, nextPublished),
      )
      const persistedDraft = {
        ...lastSavedDraft,
        isEnabled: data.automation.isEnabled,
      }
      setLastSavedDraft(cloneDraft(persistedDraft))
      setDraft((current) => ({ ...current, isEnabled: data.automation.isEnabled }))
      toast.success(data.automation.isEnabled ? "Automation published." : "Automation moved to draft.")
    } catch (error) {
      toast.error(apiError(error))
    } finally {
      setStatusSaving(false)
    }
  }

  const removeAutomation = async () => {
    if (!automationId) return
    if (!window.confirm(`Delete “${draft.name || "Untitled automation"}”? Execution history will be preserved.`)) return

    setDeleting(true)
    try {
      await api.delete(`/api/account-settings/${tenantId}/automations/${automationId}`)
      toast.success("Automation deleted.")
      router.push(`/app/${tenantSlug}/account-settings/automations`)
      router.refresh()
    } catch {
      toast.error("Could not delete the automation.")
    } finally {
      setDeleting(false)
    }
  }

  if (loading || !catalog) {
    return <div className="flex h-full items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading automation builder…</div>
  }

  const mutationBusy = saving || statusSaving || deleting

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-slate-50 p-3 md:p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild size="icon" variant="ghost"><Link href={`/app/${tenantSlug}/account-settings/automations`} aria-label="Back to automations"><ArrowLeft className="h-4 w-4" /></Link></Button>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-cyan-700">Opportunity automation</p>
            <h1 className="truncate text-lg font-semibold text-slate-950">{draft.name || "Untitled automation"}</h1>
          </div>
          <button
            type="button"
            role="switch"
            aria-label={lastSavedDraft.isEnabled ? "Move automation to draft" : "Publish automation"}
            aria-checked={lastSavedDraft.isEnabled}
            aria-busy={statusSaving}
            onClick={() => void togglePublished()}
            disabled={mutationBusy}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-full border border-slate-200 bg-slate-100 px-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <span
              className={cn(
                "rounded-full px-3 py-1 transition",
                !lastSavedDraft.isEnabled ? "bg-slate-700 text-white" : "text-slate-600",
              )}
            >
              Draft
            </span>
            <span
              className={cn(
                "rounded-full px-3 py-1 transition",
                lastSavedDraft.isEnabled ? "bg-blue-950 text-white" : "text-slate-600",
              )}
            >
              Publish
            </span>
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge
            variant="outline"
            className={cn(
              selected || hasUnsavedChanges
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-700",
            )}
          >
            {selected
              ? hasUncommittedPanelChanges
                ? "Finish sidebar changes"
                : "Close sidebar to save"
              : hasUnsavedChanges
                ? "Unsaved changes"
                : "Saved"}
          </Badge>
          {automationId ? (
            <Button
              type="button"
              variant="destructive"
              className={COMPACT_DESTRUCTIVE_BUTTON_CLASS}
              onClick={() => void removeAutomation()}
              disabled={mutationBusy}
            >
              {deleting ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : null}
              {deleting ? "Deleting" : "Delete"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => void saveChanges()}
            disabled={mutationBusy || !hasUnsavedChanges || selected !== null}
            className={COMPACT_PRIMARY_BUTTON_CLASS}
            title={selected ? "Save or cancel the sidebar changes first." : undefined}
          >
            {saving ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <Save data-icon="inline-start" aria-hidden="true" />} {saving ? "Saving" : hasUnsavedChanges ? "Save changes" : "Saved"}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 px-1">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "builder" | "contacts" | "logs")}
        >
          <TabsList className="h-9 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
            <TabsTrigger className="h-7 cursor-pointer rounded-full px-3 text-xs font-semibold" value="builder">
              Builder
            </TabsTrigger>
            <TabsTrigger
              className="h-7 cursor-pointer rounded-full px-3 text-xs font-semibold"
              value="contacts"
              disabled={!automationId}
            >
              Contacts
            </TabsTrigger>
            <TabsTrigger
              className="h-7 cursor-pointer rounded-full px-3 text-xs font-semibold"
              value="logs"
              disabled={!automationId}
            >
              Execution logs
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {activeTab === "builder" ? (
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
                  if (node.data.kind === "trigger") {
                    openTriggerPanel()
                    return
                  }
                  if (node.data.kind === "action" && node.data.index !== undefined) {
                    openActionPanel(node.data.index)
                    return
                  }
                  if (node.data.kind === "add" && node.data.insertionIndex !== undefined) {
                    openNewActionPanel(node.data.insertionIndex)
                  }
                }}
              >
                <Controls position="bottom-left" />
                <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
              </ReactFlow>
            </ReactFlowProvider>
          </div>

          {selected ? (
            <aside className="flex h-full min-h-0 w-full max-w-md shrink-0 flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
                <div>
                  <p className="text-xs font-medium text-slate-500">Configuration</p>
                  <h2 className="text-sm font-semibold text-slate-950">
                    {selected.kind === "action"
                      ? `Action ${selected.index + 1}`
                      : selected.kind === "new-action"
                        ? "Add action"
                        : "Trigger setup"}
                  </h2>
                </div>
                <Button type="button" size="icon" variant="ghost" onClick={cancelPanelChanges} aria-label="Cancel configuration changes">
                  <X data-icon="inline-start" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                {selected.kind === "action" && editingAction ? (
                  <ActionEditor
                    action={editingAction}
                    catalog={catalog}
                    onChange={setEditingAction}
                    targetActions={draft.actions.slice(selected.index + 1)}
                    actionIndex={selected.index}
                    timezone={timezone}
                    management={{
                      index: selected.index,
                      total: draft.actions.length,
                      onMove: (direction) => moveAction(selected.index, direction),
                      onDelete: () => {
                        setDraft((current) => ({ ...current, actions: current.actions.filter((_, index) => index !== selected.index) }))
                        closePanel()
                      },
                    }}
                  />
                ) : selected.kind === "new-action" ? (
                  <NewActionEditor
                    action={pendingAction}
                    catalog={catalog}
                    onChange={setPendingAction}
                    targetActions={draft.actions.slice(selected.insertionIndex)}
                    actionIndex={selected.insertionIndex}
                    timezone={timezone}
                  />
                ) : selected.kind === "trigger" && triggerEditorDraft ? (
                  <TriggerEditor
                    draft={triggerEditorDraft}
                    pipeline={triggerPipeline}
                    catalog={catalog}
                    onChange={setTriggerEditorDraft}
                  />
                ) : null}
              </div>
              {selected.kind === "action" ? (
                <>
                  <Separator />
                  <div className="flex items-center justify-end gap-2 p-3">
                    <Button type="button" variant="outline" className={COMPACT_SECONDARY_BUTTON_CLASS} onClick={cancelPanelChanges}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className={COMPACT_PRIMARY_BUTTON_CLASS}
                      disabled={!isActionReady(editingAction, draft.actions.slice(selected.index + 1)) || !actionPanelHasChanges}
                      onClick={() => {
                        if (!editingAction) return
                        updateAction(selected.index, structuredClone(editingAction))
                        closePanel()
                      }}
                    >
                      Save changes
                    </Button>
                  </div>
                </>
              ) : selected.kind === "trigger" ? (
                <>
                  <Separator />
                  <div className="flex items-center justify-end gap-2 p-3">
                    <Button type="button" variant="outline" className={COMPACT_SECONDARY_BUTTON_CLASS} onClick={cancelPanelChanges}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className={COMPACT_PRIMARY_BUTTON_CLASS}
                      disabled={!isTriggerReady(triggerEditorDraft) || !triggerPanelHasChanges}
                      onClick={() => {
                        if (!triggerEditorDraft) return
                        setDraft(cloneDraft(triggerEditorDraft))
                        closePanel()
                      }}
                    >
                      Save changes
                    </Button>
                  </div>
                </>
              ) : selected.kind === "new-action" ? (
                <>
                  <Separator />
                  <div className="flex items-center justify-end gap-2 p-3">
                    <Button type="button" variant="outline" className={COMPACT_SECONDARY_BUTTON_CLASS} onClick={cancelPanelChanges}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className={COMPACT_PRIMARY_BUTTON_CLASS}
                      disabled={!isActionReady(pendingAction, draft.actions.slice(selected.insertionIndex))}
                      onClick={() => {
                        if (!pendingAction) return
                        insertAction(selected.insertionIndex, pendingAction)
                        closePanel()
                      }}
                    >
                      Save action
                    </Button>
                  </div>
                </>
              ) : null}
            </aside>
          ) : null}
        </section>
      ) : activeTab === "contacts" && automationId ? (
        <AutomationContactsTab
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          automationId={automationId}
        />
      ) : automationId ? (
        <AutomationExecutionLogsTab
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          automationId={automationId}
          timezone={timezone}
        />
      ) : null}
    </div>
  )
}

function TriggerEditor({
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
    <div className="flex flex-col gap-4">
      <section>
        <Field>
          <FieldLabel htmlFor="automation-trigger">Trigger</FieldLabel>
          <Select
            value={draft.triggerType ?? undefined}
            onValueChange={(value) => {
              const triggerType = value as AutomationTriggerType
              onChange({
                ...draft,
                triggerType,
                targetStageId: "",
              })
            }}
          >
            <SelectTrigger id="automation-trigger" className={COMPACT_SELECT_TRIGGER_CLASS}>
              <SelectValue placeholder="Select a trigger" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="OPPORTUNITY_CREATED">Opportunity created</SelectItem>
                <SelectItem value="OPPORTUNITY_STAGE_CHANGED">Opportunity enters a stage</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </section>

      {draft.triggerType ? (
        <>
          <Separator />
          <section>
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor="automation-pipeline">Pipeline</FieldLabel>
                <Select
                  value={draft.pipelineId}
                  onValueChange={(pipelineId) =>
                    onChange({
                      ...draft,
                      pipelineId,
                      targetStageId: "",
                    })
                  }
                >
                  <SelectTrigger id="automation-pipeline" className={COMPACT_SELECT_TRIGGER_CLASS}>
                    <SelectValue placeholder="Select pipeline" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {catalog.pipelines.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {draft.triggerType === "OPPORTUNITY_STAGE_CHANGED" ? (
                <Field>
                  <FieldLabel htmlFor="automation-trigger-stage">Stage</FieldLabel>
                  <Select
                    value={draft.targetStageId}
                    disabled={!draft.pipelineId}
                    onValueChange={(targetStageId) =>
                      onChange({ ...draft, targetStageId })
                    }
                  >
                    <SelectTrigger id="automation-trigger-stage" className={COMPACT_SELECT_TRIGGER_CLASS}>
                      <SelectValue placeholder="Select stage" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {pipeline?.stages.map((stage) => (
                          <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </FieldGroup>
          </section>

          <Separator />
          <section className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Contact filters</h3>
              <p className="text-xs text-muted-foreground">Optional · all filters must match</p>
            </div>
            <ConditionsEditor
              compact
              draft={draft}
              catalog={catalog}
              onChange={setConditions}
              updateCondition={updateCondition}
            />
          </section>
        </>
      ) : null}

      <Separator />
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">Automation details</h3>
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor="automation-name">Automation name</FieldLabel>
            <Input
              id="automation-name"
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              placeholder="Qualify new opportunity"
            />
          </Field>
        </FieldGroup>
      </section>
    </div>
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
      <div className={compact ? "flex items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 p-2.5" : "py-10 text-center"}>
        {compact ? null : <ListChecks className="mx-auto size-7 text-slate-300" />}
        <p className={compact ? "text-xs text-slate-600" : "mt-2 text-sm text-slate-600"}>No contact filters</p>
        <Button
          type="button"
          variant="outline"
          className={compact ? COMPACT_SECONDARY_BUTTON_CLASS : "mt-3"}
          onClick={() => onChange([defaultCondition(catalog)])}
        >
          <Plus data-icon="inline-start" /> Add filter
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
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
      <Button
        type="button"
        variant="outline"
        className={cn(COMPACT_SECONDARY_BUTTON_CLASS, "w-full")}
        onClick={() => onChange([...draft.conditions, defaultCondition(catalog)])}
      >
        <Plus data-icon="inline-start" /> Add filter
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

function NewActionEditor({
  action,
  catalog,
  onChange,
  targetActions,
  actionIndex,
  timezone,
}: {
  action: AutomationAction | null
  catalog: AutomationCatalog
  onChange: (action: AutomationAction | null) => void
  targetActions: AutomationAction[]
  actionIndex: number
  timezone?: string | null
}) {
  if (action) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Action</p>
            <p className="truncate text-sm font-semibold text-slate-950">{ACTION_LABELS[action.type]}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className={COMPACT_SECONDARY_BUTTON_CLASS}
            onClick={() => onChange(null)}
          >
            Change
          </Button>
        </div>
        <ActionEditor
          action={action}
          catalog={catalog}
          onChange={onChange}
          showTypePicker={false}
          targetActions={targetActions}
          actionIndex={actionIndex}
          timezone={timezone}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-slate-950">Choose an action</p>
      <div className="flex flex-col gap-2">
        {Object.entries(ACTION_LABELS).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant="outline"
            className={cn(COMPACT_SECONDARY_BUTTON_CLASS, "w-full justify-start")}
            onClick={() => onChange(actionDefaults(value as AutomationAction["type"], catalog))}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function ActionEditor({
  action,
  catalog,
  onChange,
  management,
  showTypePicker = true,
  targetActions = [],
  actionIndex = 0,
  timezone,
}: {
  action: AutomationAction
  catalog: AutomationCatalog
  onChange: (action: AutomationAction) => void
  showTypePicker?: boolean
  targetActions?: AutomationAction[]
  actionIndex?: number
  timezone?: string | null
  management?: {
    index: number
    total: number
    onMove: (direction: -1 | 1) => void
    onDelete: () => void
  }
}) {
  const field = catalog.customFields.find((item) => item.id === action.customFieldId)

  return (
    <div className="flex flex-col gap-4">
      <FieldGroup className="gap-3">
        {showTypePicker ? (
          <Field>
            <FieldLabel htmlFor="action-type">Action type</FieldLabel>
            <Select
              value={action.type}
              onValueChange={(type: AutomationAction["type"]) => onChange(actionDefaults(type, catalog, action.nodeKey))}
            >
              <SelectTrigger id="action-type" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Object.entries(ACTION_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        {action.type === "SET_CONTACT_CUSTOM_FIELD" || action.type === "CLEAR_CONTACT_CUSTOM_FIELD" ? (
          <Field>
            <FieldLabel htmlFor="action-custom-field">Custom field</FieldLabel>
            <Select
              value={action.customFieldId ?? ""}
              onValueChange={(customFieldId) => onChange({ ...action, customFieldId })}
            >
              <SelectTrigger id="action-custom-field" className={COMPACT_SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder="Select field" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {catalog.customFields
                    .filter((item) => action.type !== "CLEAR_CONTACT_CUSTOM_FIELD" || !item.isRequired)
                    .map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        {action.type === "SET_CONTACT_CUSTOM_FIELD" && field ? (
          <ActionValueInput action={action} field={field} onChange={(value) => onChange({ ...action, value })} />
        ) : null}

        {action.type === "SET_CONTACT_STATUS" ? (
          <Field>
            <FieldLabel htmlFor="action-status">Status</FieldLabel>
            <Select value={action.statusConfigId ?? ""} onValueChange={(statusConfigId) => onChange({ ...action, statusConfigId })}>
              <SelectTrigger id="action-status" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue placeholder="Select status" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {catalog.statuses.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        {action.type === "SET_CONTACT_ASSIGNEE" ? (
          <Field>
            <FieldLabel htmlFor="action-assignee">Assignee</FieldLabel>
            <Select value={action.assignedUserId ?? ""} onValueChange={(assignedUserId) => onChange({ ...action, assignedUserId })}>
              <SelectTrigger id="action-assignee" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue placeholder="Select assignee" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {catalog.users.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.email}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        {action.type === "ADD_CONTACT_TAG" || action.type === "REMOVE_CONTACT_TAG" ? (
          <Field>
            <FieldLabel htmlFor="action-tag">Tag</FieldLabel>
            <Select value={action.tagId ?? ""} onValueChange={(tagId) => onChange({ ...action, tagId })}>
              <SelectTrigger id="action-tag" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue placeholder="Select tag" /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {catalog.tags.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        {action.type === "WAIT" && action.waitConfig ? (
          <WaitActionEditor
            config={action.waitConfig}
            targetActions={targetActions}
            actionIndex={actionIndex}
            timezone={timezone}
            onChange={(waitConfig) => onChange({ ...action, waitConfig })}
          />
        ) : null}
      </FieldGroup>

      {management ? (
        <>
          <Separator />
          <div className="flex gap-2">
            <Button type="button" size="icon" variant="outline" disabled={management.index === 0} onClick={() => management.onMove(-1)} aria-label="Move action up">
              <ArrowUp data-icon="inline-start" />
            </Button>
            <Button type="button" size="icon" variant="outline" disabled={management.index === management.total - 1} onClick={() => management.onMove(1)} aria-label="Move action down">
              <ArrowDown data-icon="inline-start" />
            </Button>
            <Button type="button" variant="outline" className="ml-auto text-rose-600" onClick={management.onDelete}>
              <Trash2 data-icon="inline-start" /> Delete
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}

function WaitActionEditor({
  config,
  targetActions,
  actionIndex,
  timezone,
  onChange,
}: {
  config: AutomationWaitConfig
  targetActions: AutomationAction[]
  actionIndex: number
  timezone?: string | null
  onChange: (config: AutomationWaitConfig) => void
}) {
  const [dateTimeDraft, setDateTimeDraft] = useState<DateTimeDraft>(() =>
    config.mode === "FIXED_DATE"
      ? formatUtcIsoToDateTimeDraft(config.dateTime, timezone)
      : { date: "", time: "" },
  )

  const changeMode = (mode: AutomationWaitConfig["mode"]) => {
    if (mode === "DURATION") {
      onChange({ mode: "DURATION", amount: 1, unit: "HOURS" })
      return
    }
    const nextHour = new Date(Date.now() + 3_600_000)
    nextHour.setSeconds(0, 0)
    const dateTime = nextHour.toISOString()
    setDateTimeDraft(formatUtcIsoToDateTimeDraft(dateTime, timezone))
    onChange({ mode: "FIXED_DATE", dateTime, timing: "ON", pastBehavior: "CONTINUE" })
  }

  const updateFixedDate = (nextDraft: DateTimeDraft) => {
    if (config.mode !== "FIXED_DATE") return
    setDateTimeDraft(nextDraft)
    onChange({
      ...config,
      dateTime: dateTimeDraftToUtcIso(nextDraft, timezone) ?? "",
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="wait-mode">Wait type</FieldLabel>
        <Select value={config.mode} onValueChange={(value) => changeMode(value as AutomationWaitConfig["mode"])}>
          <SelectTrigger id="wait-mode" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="DURATION">A set amount of time</SelectItem>
              <SelectItem value="FIXED_DATE">A specific date and time</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      {config.mode === "DURATION" ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2">
          <Field>
            <FieldLabel htmlFor="wait-amount">Amount</FieldLabel>
            <Input
              id="wait-amount"
              type="number"
              min={1}
              step={1}
              value={config.amount}
              onChange={(event) => onChange({ ...config, amount: Number(event.target.value) })}
              className="h-8 rounded-full"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="wait-unit">Unit</FieldLabel>
            <Select value={config.unit} onValueChange={(unit) => onChange({ ...config, unit: unit as AutomationWaitUnit })}>
              <SelectTrigger id="wait-unit" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{Object.entries(WAIT_UNIT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
        </div>
      ) : (
        <>
          <Field>
            <FieldLabel>Date and time</FieldLabel>
            <DateTimeInput value={dateTimeDraft} onValueChange={updateFixedDate} timezone={timezone} layout="joined" />
            <p className="text-xs text-slate-500">{timezone?.trim() || "America/Chicago"}</p>
          </Field>

          <Field>
            <FieldLabel htmlFor="wait-timing">When should the contact proceed?</FieldLabel>
            <Select
              value={config.timing}
              onValueChange={(value) => {
                const timing = value as "ON" | "BEFORE" | "AFTER"
                onChange(timing === "ON"
                  ? { ...config, timing, offsetAmount: undefined, offsetUnit: undefined }
                  : { ...config, timing, offsetAmount: config.offsetAmount ?? 1, offsetUnit: config.offsetUnit ?? "HOURS" })
              }}
            >
              <SelectTrigger id="wait-timing" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="ON">On the specific date</SelectItem><SelectItem value="BEFORE">Before</SelectItem><SelectItem value="AFTER">After</SelectItem></SelectGroup></SelectContent>
            </Select>
          </Field>

          {config.timing !== "ON" ? (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2">
              <Field>
                <FieldLabel htmlFor="wait-offset-amount">Offset</FieldLabel>
                <Input
                  id="wait-offset-amount"
                  type="number"
                  min={1}
                  step={1}
                  value={config.offsetAmount ?? 1}
                  onChange={(event) => onChange({ ...config, offsetAmount: Number(event.target.value) })}
                  className="h-8 rounded-full"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="wait-offset-unit">Unit</FieldLabel>
                <Select value={config.offsetUnit ?? "HOURS"} onValueChange={(unit) => onChange({ ...config, offsetUnit: unit as AutomationWaitUnit })}>
                  <SelectTrigger id="wait-offset-unit" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{Object.entries(WAIT_UNIT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
            </div>
          ) : null}

          <Field>
            <FieldLabel htmlFor="wait-past-behavior">If this date has already passed</FieldLabel>
            <Select
              value={config.pastBehavior}
              onValueChange={(value) => {
                const pastBehavior = value as "CONTINUE" | "EXIT" | "GO_TO_STEP"
                onChange({
                  ...config,
                  pastBehavior,
                  targetNodeKey: pastBehavior === "GO_TO_STEP" ? targetActions[0]?.nodeKey : undefined,
                })
              }}
            >
              <SelectTrigger id="wait-past-behavior" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="CONTINUE">Continue with the next action</SelectItem>
                  <SelectItem value="EXIT">Exit this automation run</SelectItem>
                  <SelectItem value="GO_TO_STEP" disabled={targetActions.length === 0}>Go to a specific step</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          {config.pastBehavior === "GO_TO_STEP" ? (
            <Field>
              <FieldLabel htmlFor="wait-target-step">Step</FieldLabel>
              <Select value={config.targetNodeKey ?? ""} onValueChange={(targetNodeKey) => onChange({ ...config, targetNodeKey })}>
                <SelectTrigger id="wait-target-step" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue placeholder="Select a later action" /></SelectTrigger>
                <SelectContent><SelectGroup>{targetActions.map((target, index) => <SelectItem key={target.nodeKey} value={target.nodeKey ?? `missing-${index}`}>Action {actionIndex + index + 2}: {ACTION_LABELS[target.type]}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </Field>
          ) : null}
        </>
      )}
    </div>
  )
}

function ActionValueInput({ action, field, onChange }: { action: AutomationAction; field: AutomationCatalog["customFields"][number]; onChange: (value: unknown) => void }) {
  if (field.fieldType === "CHECKBOX") return <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><Checkbox checked={action.value === true} onCheckedChange={(checked) => onChange(checked === true)} /><span className="text-sm font-medium">Checked</span></label>
  if (field.fieldType === "SELECT" || field.fieldType === "RADIO") return <div className="space-y-2"><Label>Value</Label><Select value={String(action.value ?? "")} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Select value" /></SelectTrigger><SelectContent>{field.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></div>
  if (field.fieldType === "MULTI_SELECT") return <div className="space-y-2"><Label>Values</Label><Input value={Array.isArray(action.value) ? action.value.join(", ") : ""} onChange={(event) => onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="Option A, Option B" /></div>
  if (field.fieldType === "TEXTAREA") return <div className="space-y-2"><Label>Value</Label><Textarea value={String(action.value ?? "")} onChange={(event) => onChange(event.target.value)} /></div>
  const type = field.fieldType === "DATE" ? "date" : field.fieldType === "NUMBER" || field.fieldType === "CURRENCY" ? "number" : "text"
  return <div className="space-y-2"><Label>Value</Label><Input type={type} value={String(action.value ?? "")} onChange={(event) => onChange(type === "number" ? Number(event.target.value) : event.target.value)} /></div>
}
