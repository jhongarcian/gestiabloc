"use client"

import "@xyflow/react/dist/style.css"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react"
import { isAxiosError } from "axios"
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BadgeCheck,
  BellRing,
  Calculator,
  CalendarClock,
  Check,
  ChevronsUpDown,
  Clock3,
  CheckCircle2,
  ContactRound,
  GitBranch,
  GripVertical,
  Hash,
  Kanban,
  ListChecks,
  ListTodo,
  Loader2,
  MessageSquareText,
  MousePointerClick,
  Plus,
  Route as RouteIcon,
  Save,
  Shuffle,
  StickyNote,
  Tag,
  Tags,
  Trash2,
  Type,
  Unlink2,
  UserMinus,
  UserPlus,
  UserRound,
  UserRoundPlus,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  ContactDateValueInput,
  type ContactDateValue,
} from "@/components/contact-date-value-input"
import { ContactTemplateInput } from "@/components/contact-template-input"
import { DateTimeInput } from "@/components/ui/date-time-input"
import { DateInput } from "@/components/ui/date-input"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/lib/api"
import { serializeAutomationAction } from "@/lib/automation-action-payload"
import {
  automationGoToDestinations,
  automationGoToTargetIssue,
  validateAutomationGoToGraph,
} from "@/lib/automation-go-to"
import {
  ifElseWrapIssue,
  MAX_AUTOMATION_ACTION_NODES,
  wrapFollowingActionsInFirstBranch,
} from "@/lib/automation-if-else-insertion"
import { parseAutomationWaitIntegerDraft } from "@/lib/automation-wait-input"
import { uniqueAutomationOutputs, validateContactTemplate } from "@/lib/contact-template"
import {
  dateTimeDraftToUtcIso,
  formatUtcIsoToDateTimeDraft,
  type DateTimeDraft,
} from "@/lib/date-time"
import { cn } from "@/lib/utils"

import { AutomationContactsTab } from "./automation-contacts-tab"
import { AutomationExecutionLogsTab } from "./automation-execution-logs-tab"
import { AutomationFieldPicker } from "./automation-field-picker"
import { AutomationWaitingRunsSheet } from "./automation-waiting-runs-sheet"
import type {
  AutomationAction,
  AutomationCatalog,
  AutomationCondition,
  AutomationCreateContactConfig,
  AutomationCreateContactTypedSource,
  AutomationCreateContactValueSource,
  AutomationDateSource,
  AutomationDateTimeFormatterConfig,
  AutomationFieldUpdate,
  AutomationBranchCondition,
  AutomationIfElseBranch,
  AutomationInternalNotificationConfig,
  AutomationFormatterDateSource,
  AutomationMathOperationConfig,
  AutomationNumberFormatterConfig,
  AutomationNumberSource,
  AutomationOperator,
  AutomationRecord,
  AutomationSplitRoute,
  AutomationTaskConfig,
  AutomationTaskDateTime,
  AutomationTextFormatterConfig,
  AutomationTextSource,
  AutomationTriggerType,
  AutomationValueDefinition,
  AutomationWaitConfig,
  AutomationWaitNodeCount,
  AutomationWaitUnit,
} from "./automation-types"
import {
  buildAutomationFlowGraph,
  type AutomationGraphBranchPath,
  type AutomationFlowNodeData as CanvasNodeData,
  type AutomationGoToEdgeData,
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
  | { kind: "action"; nodeKey: string; path: AutomationGraphBranchPath; index: number }
  | { kind: "new-action"; path: AutomationGraphBranchPath; insertionIndex: number }

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

function actionsAtPath(actions: AutomationAction[], path: AutomationGraphBranchPath) {
  let current = actions
  for (const part of path) {
    const routingAction = current.find((action) =>
      action.nodeKey === part.routingNodeKey && (action.type === "IF_ELSE" || action.type === "SPLIT")
    )
    const branch = routingAction?.type === "IF_ELSE"
      ? routingAction.ifElseConfig?.branches.find((candidate) => candidate.branchKey === part.branchKey)
      : routingAction?.splitConfig?.routes.find((candidate) => candidate.branchKey === part.branchKey)
    if (!branch) return null
    current = branch.actions
  }
  return current
}

function ancestorActionsForPath(actions: AutomationAction[], path: AutomationGraphBranchPath) {
  const ancestors: AutomationAction[] = []
  let current = actions
  for (const part of path) {
    const routingIndex = current.findIndex((action) =>
      action.nodeKey === part.routingNodeKey && (action.type === "IF_ELSE" || action.type === "SPLIT")
    )
    if (routingIndex < 0) return ancestors
    ancestors.push(...current.slice(0, routingIndex))
    const routingAction = current[routingIndex]
    const branch = routingAction?.type === "IF_ELSE"
      ? routingAction.ifElseConfig?.branches.find((candidate) => candidate.branchKey === part.branchKey)
      : routingAction?.splitConfig?.routes.find((candidate) => candidate.branchKey === part.branchKey)
    if (!branch) return ancestors
    current = branch.actions
  }
  return ancestors
}

function mutateActionsAtPath(
  draft: Draft,
  path: AutomationGraphBranchPath,
  mutate: (actions: AutomationAction[]) => void,
) {
  const next = cloneDraft(draft)
  const actions = actionsAtPath(next.actions, path)
  if (!actions) return draft
  mutate(actions)
  return next
}

function flattenDraftActions(actions: AutomationAction[]) {
  const flattened: AutomationAction[] = []
  const visit = (pathActions: AutomationAction[]) => {
    for (const action of pathActions) {
      flattened.push(action)
      if (action.type === "IF_ELSE") {
        for (const branch of action.ifElseConfig?.branches ?? []) visit(branch.actions)
      } else if (action.type === "SPLIT") {
        for (const route of action.splitConfig?.routes ?? []) visit(route.actions)
      }
    }
  }
  visit(actions)
  return flattened
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
    actions: draft.actions.map(serializeAutomationAction),
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

type AutomationActionGroupId = "INTERNAL" | "OPPORTUNITY" | "CONTACT" | "COMMUNICATION"

const ACTION_GROUPS: ReadonlyArray<{
  id: AutomationActionGroupId
  label: string
  description: string
  icon: LucideIcon
}> = [
  {
    id: "INTERNAL",
    label: "Internal actions",
    description: "Control timing, create work, and prepare values for later steps.",
    icon: Workflow,
  },
  {
    id: "OPPORTUNITY",
    label: "Opportunity actions",
    description: "Create or update an opportunity in a pipeline.",
    icon: Kanban,
  },
  {
    id: "CONTACT",
    label: "Contact actions",
    description: "Create or update contact records and manage contact data.",
    icon: ContactRound,
  },
  {
    id: "COMMUNICATION",
    label: "Communication actions",
    description: "Send information to the contact through connected channels.",
    icon: MessageSquareText,
  },
]

const ACTION_GROUP_STYLES: Record<AutomationActionGroupId, {
  section: string
  icon: string
  actionIcon: string
  actionHover: string
}> = {
  INTERNAL: {
    section: "border-slate-200 bg-white",
    icon: "bg-slate-50 text-violet-700 ring-slate-200",
    actionIcon: "bg-slate-50 text-violet-700",
    actionHover: "hover:border-slate-300 hover:bg-slate-50",
  },
  OPPORTUNITY: {
    section: "border-slate-200 bg-white",
    icon: "bg-slate-50 text-amber-800 ring-slate-200",
    actionIcon: "bg-slate-50 text-amber-800",
    actionHover: "hover:border-slate-300 hover:bg-slate-50",
  },
  CONTACT: {
    section: "border-slate-200 bg-white",
    icon: "bg-slate-50 text-blue-700 ring-slate-200",
    actionIcon: "bg-slate-50 text-blue-700",
    actionHover: "hover:border-slate-300 hover:bg-slate-50",
  },
  COMMUNICATION: {
    section: "border-slate-200 bg-white",
    icon: "bg-slate-50 text-emerald-700 ring-slate-200",
    actionIcon: "bg-slate-50 text-emerald-700",
    actionHover: "hover:border-slate-300 hover:bg-slate-50",
  },
}

const ACTION_DEFINITIONS = {
  WAIT: {
    label: "Wait",
    description: "Pause the contact before the next action.",
    group: "INTERNAL",
    order: 0,
    icon: Clock3,
  },
  FORMAT_DATE_TIME: {
    label: "Date/Time formatter",
    description: "Format or compare dates for later actions.",
    group: "INTERNAL",
    order: 1,
    icon: CalendarClock,
  },
  FORMAT_NUMBER: {
    label: "Number formatter",
    description: "Convert or format a number for later actions.",
    group: "INTERNAL",
    order: 2,
    icon: Hash,
  },
  FORMAT_TEXT: {
    label: "Text formatter",
    description: "Transform text for later actions.",
    group: "INTERNAL",
    order: 3,
    icon: Type,
  },
  MATH_OPERATION: {
    label: "Math operation",
    description: "Calculate a number or adjust a date.",
    group: "INTERNAL",
    order: 4,
    icon: Calculator,
  },
  IF_ELSE: {
    label: "If/Else",
    description: "Route the contact through the first matching branch.",
    group: "INTERNAL",
    order: 5,
    icon: GitBranch,
  },
  SPLIT: {
    label: "Split",
    description: "Randomly route each run by percentage.",
    group: "INTERNAL",
    order: 6,
    icon: Shuffle,
  },
  GO_TO: {
    label: "Go to",
    description: "Continue this run at an action in another path.",
    group: "INTERNAL",
    order: 7,
    icon: RouteIcon,
  },
  ADD_TO_WORKFLOW: {
    label: "Add to workflow",
    description: "Start another published workflow for this contact.",
    group: "INTERNAL",
    order: 8,
    icon: Workflow,
  },
  REMOVE_FROM_WORKFLOW: {
    label: "Remove from workflow",
    description: "End every active run in a published workflow for this contact.",
    group: "INTERNAL",
    order: 9,
    icon: Unlink2,
  },
  CREATE_TASK: {
    label: "Create task",
    description: "Create a task linked to this contact.",
    group: "INTERNAL",
    order: 10,
    icon: ListTodo,
  },
  SEND_INTERNAL_NOTIFICATION: {
    label: "Internal notification",
    description: "Notify the contact assignee or a specific teammate.",
    group: "INTERNAL",
    order: 11,
    icon: BellRing,
  },
  ADD_CONTACT_NOTE: {
    label: "Add contact note",
    description: "Add a note using live contact information.",
    group: "INTERNAL",
    order: 12,
    icon: StickyNote,
  },
  UPDATE_OPPORTUNITY: {
    label: "Update/create opportunity",
    description: "Create an opportunity or update its stage, value, and outcome.",
    group: "OPPORTUNITY",
    order: 0,
    icon: Kanban,
  },
  DELETE_OPPORTUNITY: {
    label: "Delete opportunity",
    description: "Remove the contact's opportunity from a selected pipeline.",
    group: "OPPORTUNITY",
    order: 1,
    icon: Trash2,
  },
  UPDATE_CONTACT_CUSTOM_FIELDS: {
    label: "Update contact fields",
    description: "Set or clear multiple contact and custom fields.",
    group: "CONTACT",
    order: 1,
    icon: ContactRound,
  },
  CREATE_CONTACT: {
    label: "Create contact",
    description: "Create a standalone contact from fixed or dynamic values.",
    group: "CONTACT",
    order: 0,
    icon: UserRoundPlus,
  },
  SET_CONTACT_STATUS: {
    label: "Set contact status",
    description: "Change the contact's current status.",
    group: "CONTACT",
    order: 2,
    icon: BadgeCheck,
  },
  SET_CONTACT_ASSIGNEE: {
    label: "Assign contact",
    description: "Assign the contact to a teammate.",
    group: "CONTACT",
    order: 3,
    icon: UserPlus,
  },
  CLEAR_CONTACT_ASSIGNEE: {
    label: "Clear contact assignee",
    description: "Remove the contact's current assignee.",
    group: "CONTACT",
    order: 4,
    icon: UserMinus,
  },
  ADD_CONTACT_TAG: {
    label: "Add contact tag",
    description: "Add an existing tag to the contact.",
    group: "CONTACT",
    order: 5,
    icon: Tag,
  },
  REMOVE_CONTACT_TAG: {
    label: "Remove contact tag",
    description: "Remove an existing tag from the contact.",
    group: "CONTACT",
    order: 6,
    icon: Tags,
  },
  DELETE_CONTACT: {
    label: "Delete contact",
    description: "Permanently delete the contact as the final action.",
    group: "CONTACT",
    order: 7,
    icon: Trash2,
  },
} satisfies Record<AutomationAction["type"], {
  label: string
  description: string
  group: AutomationActionGroupId
  order: number
  icon: LucideIcon
}>

const ACTION_LABELS = Object.fromEntries(
  Object.entries(ACTION_DEFINITIONS).map(([type, definition]) => [type, definition.label]),
) as Record<AutomationAction["type"], string>

function actionsForGroup(groupId: AutomationActionGroupId) {
  return (Object.entries(ACTION_DEFINITIONS) as Array<[
    AutomationAction["type"],
    (typeof ACTION_DEFINITIONS)[AutomationAction["type"]],
  ]>)
    .filter(([, definition]) => definition.group === groupId)
    .sort((left, right) => left[1].order - right[1].order)
}

function ActionTypeIcon({
  type,
  className = "size-4",
}: {
  type: AutomationAction["type"]
  className?: string
}) {
  const Icon = ACTION_DEFINITIONS[type].icon
  return <Icon aria-hidden="true" className={className} />
}

const WAIT_UNIT_LABELS: Record<AutomationWaitUnit, string> = {
  SECONDS: "Seconds",
  MINUTES: "Minutes",
  HOURS: "Hours",
  DAYS: "Days",
}

const DATE_FORMAT_OPTIONS = [
  ["YYYY-MM-DD", "2026-09-25"],
  ["MM/DD/YYYY", "09/25/2026"],
  ["DD/MM/YYYY", "25/09/2026"],
  ["MMMM DD YYYY", "September 25 2026"],
  ["dddd, MMMM D, YYYY", "Friday, September 25, 2026"],
  ["MMM D, YYYY", "Sep 25, 2026"],
  ["MMMM Do YYYY", "September 25th 2026"],
  ["MM-DD-YYYY", "09-25-2026"],
  ["DD-MMM-YYYY", "25-Sep-2026"],
  ["X", "1790294400"],
] as const

const DATE_TIME_FORMAT_OPTIONS = [
  ["ddd MMM DD HH:mm:ss YYYY", "Fri Sep 25 13:30:59 2026"],
  ["MMMM DD YYYY HH:mm:ss", "September 25 2026 13:30:59"],
  ["YYYY-MM-DD HH:mm:ss", "2026-09-25 13:30:59"],
  ["YYYY-MM-DD hh:mm A", "2026-09-25 01:30 PM"],
  ["DD/MM/YYYY HH:mm:ss", "25/09/2026 13:30:59"],
  ["MM/DD/YYYY hh:mm A", "09/25/2026 01:30 PM"],
  ["dddd, MMMM D, YYYY hh:mm A", "Friday, September 25, 2026 01:30 PM"],
  ["MMM D, YYYY hh:mm:ss A", "Sep 25, 2026 01:30:59 PM"],
  ["YYYY-MM-DDTHH:mm:ss", "2026-09-25T13:30:59"],
  ["MMMM Do YYYY hh:mm A", "September 25th 2026 01:30 PM"],
  ["MM-DD-YYYY hh:mm A", "09-25-2026 01:30 PM"],
  ["DD-MMM-YYYY hh:mm A", "25-Sep-2026 01:30 PM"],
  ["X", "1790343059"],
] as const

const NUMBER_GROUPING_OPTIONS = [
  ["COMMA_PERIOD", "Comma grouping, period decimal", "1,234,567.89"],
  ["PERIOD_COMMA", "Period grouping, comma decimal", "1.234.567,89"],
  ["SPACE_COMMA", "Space grouping, comma decimal", "1 234 567,89"],
  ["SPACE_PERIOD", "Space grouping, period decimal", "1 234 567.89"],
] as const

const NUMBER_PHONE_FORMAT_OPTIONS = [
  ["E164", "E164", "+15413134664"],
  ["INTERNATIONAL", "International", "+1 541-313-4664"],
  ["INTERNATIONAL_NO_COUNTRY_CODE", "International, no country code", "541-313-4664"],
  ["INTERNATIONAL_NO_HYPHENS", "International, no hyphens", "+1 541 313 4664"],
  ["INTERNATIONAL_NO_SYMBOLS", "International, no symbols", "15413134664"],
  ["NATIONAL", "National", "(541) 313-4664"],
  ["NATIONAL_NO_PARENTHESIS", "National, no parenthesis", "541 313-4664"],
  ["NATIONAL_NO_SYMBOLS", "National, no symbols", "5413134664"],
  ["RFC3966", "RFC3966", "tel:+1-541-313-4664"],
  ["RFC3966_NO_TEL", "RFC3966, no tel", "+1-541-313-4664"],
] as const

const NUMBER_CURRENCY_OPTIONS = [
  ["USD", "USD - US Dollar"], ["EUR", "EUR - Euro"], ["GBP", "GBP - British Pound"],
  ["CAD", "CAD - Canadian Dollar"], ["AUD", "AUD - Australian Dollar"],
  ["MXN", "MXN - Mexican Peso"], ["BRL", "BRL - Brazilian Real"],
  ["COP", "COP - Colombian Peso"], ["ARS", "ARS - Argentine Peso"],
  ["CLP", "CLP - Chilean Peso"], ["PEN", "PEN - Peruvian Sol"],
  ["JPY", "JPY - Japanese Yen"], ["CNY", "CNY - Chinese Yuan"],
  ["INR", "INR - Indian Rupee"], ["KRW", "KRW - South Korean Won"],
  ["SGD", "SGD - Singapore Dollar"], ["HKD", "HKD - Hong Kong Dollar"],
  ["NZD", "NZD - New Zealand Dollar"], ["CHF", "CHF - Swiss Franc"],
  ["SEK", "SEK - Swedish Krona"], ["NOK", "NOK - Norwegian Krone"],
  ["DKK", "DKK - Danish Krone"], ["PLN", "PLN - Polish Zloty"],
  ["CZK", "CZK - Czech Koruna"], ["TRY", "TRY - Turkish Lira"],
  ["ZAR", "ZAR - South African Rand"], ["AED", "AED - UAE Dirham"],
  ["SAR", "SAR - Saudi Riyal"], ["EGP", "EGP - Egyptian Pound"],
  ["ILS", "ILS - Israeli New Shekel"],
] as const

const COMPACT_PRIMARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 transition hover:bg-blue-900 hover:text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"

const COMPACT_SECONDARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"

const COMPACT_DESTRUCTIVE_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-semibold shadow-sm transition disabled:cursor-not-allowed"

const COMPACT_SELECT_TRIGGER_CLASS =
  "h-8 w-full cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"

function AutomationFlowNode({ data }: NodeProps<CanvasNode>) {
  if (data.kind === "route-bound") return <div aria-hidden="true" className="size-px" />
  if (data.kind === "add") {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-cyan-400 bg-white text-cyan-700 shadow-sm transition hover:scale-105 hover:bg-cyan-50">
        <Handle id="flow-target" type="target" position={Position.Top} className="opacity-0" />
        <Plus className="h-4 w-4" />
        <Handle id="flow-source" type="source" position={Position.Bottom} className="opacity-0" />
      </div>
    )
  }

  const icon =
    data.kind === "trigger" && !data.configured ? (
      <MousePointerClick className="size-5" />
    ) : data.kind === "trigger" ? (
      <Zap className="h-5 w-5" />
    ) : data.kind === "action" ? (
      data.actionType ? <ActionTypeIcon type={data.actionType} className="size-5" /> : <Workflow className="size-5" />
    ) : data.kind === "branch" ? (
      <GitBranch className="size-5" />
    ) : (
      <CheckCircle2 className="size-5" />
    )
  const tone =
    data.kind === "trigger"
      ? data.configured
        ? "border-primary bg-primary text-primary-foreground"
        : "cursor-pointer border-dashed border-primary/40 bg-card text-card-foreground hover:border-primary hover:bg-accent/40"
      : data.kind === "action" && data.actionGroup === "CONTACT"
        ? "border-blue-200 bg-blue-50/90 text-slate-950 hover:border-blue-300"
      : data.kind === "action" && data.actionGroup === "OPPORTUNITY"
        ? "border-amber-200 bg-amber-50/90 text-slate-950 hover:border-amber-300"
      : data.kind === "action" && data.actionGroup === "COMMUNICATION"
        ? "border-emerald-200 bg-emerald-50/90 text-slate-950 hover:border-emerald-300"
      : data.kind === "action"
        ? "border-violet-200 bg-violet-50/90 text-slate-950 hover:border-violet-300"
      : data.kind === "complete"
        ? "border-border bg-muted text-foreground"
        : "border-border bg-card text-card-foreground"
  const iconTone =
    data.kind === "trigger" && data.configured
      ? "bg-primary-foreground/90 text-primary"
      : data.kind === "action" && data.actionGroup === "CONTACT"
        ? "bg-white/90 text-blue-700 ring-1 ring-blue-200"
      : data.kind === "action" && data.actionGroup === "OPPORTUNITY"
        ? "bg-white/90 text-amber-800 ring-1 ring-amber-200"
      : data.kind === "action" && data.actionGroup === "COMMUNICATION"
        ? "bg-white/90 text-emerald-700 ring-1 ring-emerald-200"
      : data.kind === "action"
        ? "bg-white/90 text-violet-700 ring-1 ring-violet-200"
      : "bg-background text-foreground"

  const waitBadgeLabel = data.waitBadge
    ? data.waitBadge.state === "loading"
      ? "Loading contacts waiting at this action"
      : data.waitBadge.state === "error"
        ? "Waiting contacts could not be loaded. Open the list to retry."
        : data.waitBadge.state === "unsaved"
          ? "Save the automation before viewing waiting contacts"
          : `View ${data.waitBadge.count} waiting ${data.waitBadge.count === 1 ? "run" : "runs"}`
    : null
  const isGoToDestination = data.goToSelection === "eligible"

  return (
    <div
      className={cn(
        "relative w-64 rounded-2xl border-2 px-4 py-3 shadow-sm transition-colors",
        tone,
        isGoToDestination && "cursor-crosshair hover:border-emerald-500 hover:bg-emerald-50",
      )}
      title={data.goToIssue ?? undefined}
    >
      <Handle id="flow-target" type="target" position={Position.Top} className="opacity-0" />
      {data.kind === "action" ? (
        <>
          <Handle id="go-to-target-top" type="target" position={Position.Top} className="opacity-0" />
          <Handle id="go-to-source-bottom" type="source" position={Position.Bottom} className="opacity-0" />
        </>
      ) : null}
      {data.waitBadge ? (
        <Badge
          asChild
          variant="outline"
          className={cn(
            "nodrag nopan absolute -right-2.5 -top-3 z-10 inline-flex min-h-7 min-w-7 items-center justify-center rounded-full border px-2 text-[11px] font-bold shadow-sm transition",
            data.waitBadge.state === "ready" && data.waitBadge.count > 0
              ? "cursor-pointer border-blue-800 bg-blue-950 text-white hover:bg-blue-900"
              : data.waitBadge.state === "error"
                ? "cursor-pointer border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                : "border-slate-200 bg-white text-slate-600",
            data.waitBadge.state === "loading" || data.waitBadge.state === "unsaved"
              ? "cursor-not-allowed"
              : null,
          )}
        >
          <button
            type="button"
            aria-label={waitBadgeLabel ?? undefined}
            title={waitBadgeLabel ?? undefined}
            disabled={data.waitBadge.state === "loading" || data.waitBadge.state === "unsaved"}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              data.waitBadge?.onClick?.()
            }}
          >
            {data.waitBadge.state === "loading"
              ? "…"
              : data.waitBadge.state === "error"
                ? "!"
                : data.waitBadge.state === "unsaved"
                  ? "0 · Save first"
                  : data.waitBadge.count}
          </button>
        </Badge>
      ) : null}
      {data.actionType === "GO_TO" && data.onGoToUnlink ? (
        <button
          type="button"
          className="nodrag nopan absolute -right-2.5 -bottom-3 z-10 flex size-7 cursor-pointer items-center justify-center rounded-full border border-violet-200 bg-white text-violet-700 shadow-sm transition hover:border-violet-400 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          aria-label="Change Go To destination"
          title="Change destination"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            data.onGoToUnlink?.()
          }}
        >
          <Unlink2 className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl shadow-sm",
          iconTone,
        )}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{data.label}</p>
          {data.subtitle ? <p className="mt-0.5 truncate text-xs opacity-70">{data.subtitle}</p> : null}
        </div>
      </div>
      {data.kind === "complete" ? null : (
        <Handle id="flow-source" type="source" position={Position.Bottom} className="opacity-0" />
      )}
    </div>
  )
}

const NODE_TYPES: NodeTypes = { automationNode: AutomationFlowNode }

type GoToCanvasEdge = Edge<AutomationGoToEdgeData, "goTo">

function GoToEdge({ id, sourceX, sourceY, targetX, targetY, data, markerEnd }: EdgeProps<GoToCanvasEdge>) {
  const laneX = data?.laneX ?? Math.max(sourceX, targetX) + 90
  const sourceLaneY = sourceY + 36
  const targetLaneY = targetY - 36
  const path = `M ${sourceX} ${sourceY} L ${sourceX} ${sourceLaneY} L ${laneX} ${sourceLaneY} L ${laneX} ${targetLaneY} L ${targetX} ${targetLaneY} L ${targetX} ${targetY}`
  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      interactionWidth={18}
      className={cn(
        "[stroke-dasharray:8_7] [stroke-linecap:round] [stroke-width:2.5px]",
        data?.highlighted
          ? "stroke-emerald-500"
          : "stroke-violet-500",
      )}
    />
  )
}

const EDGE_TYPES: EdgeTypes = { goTo: GoToEdge }

type AutomationCustomField = AutomationCatalog["customFields"][number]
type AutomationContactUpdateField = AutomationCatalog["contactUpdateFields"][number]
type AutomationValueField = {
  label: string
  fieldType: AutomationCustomField["fieldType"] | "EMAIL"
  isRequired: boolean
  options: string[]
  maxLength?: number
  formatOptionLabels?: boolean
}

function defaultFieldUpdateValue(field: AutomationValueField) {
  if (field.fieldType === "CHECKBOX") return field.isRequired
  if (field.fieldType === "MULTI_SELECT") return []
  if (field.fieldType === "SELECT" || field.fieldType === "RADIO") {
    return field.options[0] ?? ""
  }
  return ""
}

function updateIdentity(update: AutomationFieldUpdate) {
  return "contactFieldKey" in update
    ? `contact:${update.contactFieldKey}`
    : `custom:${update.customFieldId}`
}

function contactValueField(field: AutomationContactUpdateField): AutomationValueField {
  return { ...field, formatOptionLabels: true }
}

function fieldUpdateForReference(
  fieldReference: string,
  requestedOperation: "SET" | "CLEAR",
  catalog: AutomationCatalog,
): AutomationFieldUpdate | null {
  if (fieldReference.startsWith("contact:")) {
    const contactFieldKey = fieldReference.slice("contact:".length)
    const field = catalog.contactUpdateFields.find((item) => item.key === contactFieldKey)
    if (!field) return null
    if (requestedOperation === "CLEAR" && !field.isRequired) {
      return { contactFieldKey, operation: "CLEAR" }
    }
    return {
      contactFieldKey,
      operation: "SET",
      value: defaultFieldUpdateValue(contactValueField(field)),
    }
  }
  if (!fieldReference.startsWith("custom:")) return null
  const customFieldId = fieldReference.slice("custom:".length)
  const field = catalog.customFields.find((item) => item.id === customFieldId)
  if (!field) return null
  if (requestedOperation === "CLEAR" && !field.isRequired) {
    return { customFieldId, operation: "CLEAR" }
  }
  return {
    customFieldId,
    operation: "SET",
    value: defaultFieldUpdateValue(field),
  }
}

function isFieldUpdateReady(
  update: AutomationFieldUpdate,
  catalog: AutomationCatalog,
) {
  const field: AutomationValueField | undefined = "contactFieldKey" in update
    ? catalog.contactUpdateFields.find((item) => item.key === update.contactFieldKey)
    : catalog.customFields.find((item) => item.id === update.customFieldId)
  if (!field) return false
  if (update.operation === "CLEAR") return !field.isRequired
  const value = update.value
  if (field.fieldType === "CHECKBOX") {
    return typeof value === "boolean" && (!field.isRequired || value)
  }
  if (field.fieldType === "MULTI_SELECT") {
    return Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === "string" && field.options.includes(item))
  }
  if (field.fieldType === "NUMBER" || field.fieldType === "CURRENCY") {
    return typeof value === "number" && Number.isFinite(value)
  }
  if (field.fieldType === "PHONE") {
    return typeof value === "string" && /^\+[1-9]\d{7,14}$/.test(value.trim())
  }
  if (field.fieldType === "EMAIL") {
    return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  }
  if (field.fieldType === "DATE") {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime())
  }
  if (field.fieldType === "SELECT" || field.fieldType === "RADIO") {
    return typeof value === "string" && field.options.includes(value)
  }
  return typeof value === "string" &&
    value.trim().length > 0 &&
    (!field.maxLength || value.trim().length <= field.maxLength)
}

function createContactUsesTemplate(fieldType: AutomationValueField["fieldType"]) {
  return fieldType === "TEXT" || fieldType === "TEXTAREA" || fieldType === "PHONE"
}

function createContactSourceFieldIsCompatible(
  destinationType: AutomationValueField["fieldType"],
  sourceType: AutomationCatalog["templateFields"]["contact"][number]["fieldType"],
) {
  if (destinationType === "NUMBER" || destinationType === "CURRENCY") {
    return sourceType === "NUMBER" || sourceType === "CURRENCY"
  }
  if (destinationType === "DATE") return sourceType === "DATE"
  if (destinationType === "SELECT" || destinationType === "RADIO") {
    return sourceType === "SELECT" || sourceType === "RADIO" || sourceType === "TEXT"
  }
  if (destinationType === "MULTI_SELECT") return sourceType === "MULTI_SELECT"
  if (destinationType === "CHECKBOX") return sourceType === "CHECKBOX"
  return false
}

function createContactAutomationValueIsCompatible(
  destinationType: AutomationValueField["fieldType"],
  valueKind: AutomationValueDefinition["valueKind"],
) {
  if (destinationType === "NUMBER" || destinationType === "CURRENCY") return valueKind === "NUMBER"
  if (destinationType === "DATE") return valueKind === "DATE"
  if (destinationType === "SELECT" || destinationType === "RADIO") return valueKind === "TEXT"
  return false
}

function isDateOnly(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isCreateContactTypedSourceReady(
  source: AutomationCreateContactTypedSource,
  field: AutomationValueField,
  catalog: AutomationCatalog,
  automationOutputs: AutomationValueDefinition[],
  customFieldId?: string,
) {
  if (source.type === "FIXED") {
    if (field.fieldType === "DATE") return isDateOnly(source.value)
    if (!customFieldId) return false
    return isFieldUpdateReady(
      { customFieldId, operation: "SET", value: source.value },
      catalog,
    )
  }
  if (source.type === "CONTACT_FIELD") {
    const sourceField = catalog.templateFields.contact.find((candidate) => candidate.key === source.key)
    return Boolean(sourceField && createContactSourceFieldIsCompatible(field.fieldType, sourceField.fieldType))
  }
  if (source.type === "CUSTOM_FIELD") {
    const sourceField = catalog.customFields.find((candidate) => candidate.key === source.key)
    return Boolean(sourceField && createContactSourceFieldIsCompatible(field.fieldType, sourceField.fieldType))
  }
  const output = automationOutputs.find((candidate) => candidate.key === source.key)
  return Boolean(output && createContactAutomationValueIsCompatible(field.fieldType, output.valueKind))
}

function isCreateContactReady(
  config: AutomationCreateContactConfig,
  catalog: AutomationCatalog,
  automationOutputs: AutomationValueDefinition[],
) {
  if (!config.actionName.trim() || config.actionName.trim().length > 120) return false
  if (createContactNameTemplateError("First name", config.firstNameTemplate, false, catalog, automationOutputs)) return false
  if (createContactNameTemplateError("Middle name", config.middleNameTemplate, true, catalog, automationOutputs)) return false
  if (createContactNameTemplateError("Last name", config.lastNameTemplate, false, catalog, automationOutputs)) return false
  if (createContactEmailTemplateError(config.emailTemplate, catalog, automationOutputs)) return false
  if (createContactPhoneTemplateError(config.phoneTemplate, catalog, automationOutputs)) return false
  if (!catalog.statuses.some((status) => status.id === config.statusConfigId)) return false
  if (config.dateOfBirth && !isCreateContactTypedSourceReady(
    config.dateOfBirth,
    { label: "Date of birth", fieldType: "DATE", isRequired: false, options: [] },
    catalog,
    automationOutputs,
  )) return false
  if (config.customFieldValues.length > 20) return false
  const fieldIds = config.customFieldValues.map((assignment) => assignment.customFieldId)
  if (new Set(fieldIds).size !== fieldIds.length) return false
  return config.customFieldValues.every((assignment) => {
    const field = catalog.customFields.find((candidate) => candidate.id === assignment.customFieldId)
    if (!field) return false
    if (createContactUsesTemplate(field.fieldType)) {
      return assignment.source.type === "TEMPLATE" &&
        !noteTemplateError(assignment.source.template, 1_000, catalog, automationOutputs)
    }
    return assignment.source.type !== "TEMPLATE" && isCreateContactTypedSourceReady(
      assignment.source,
      field,
      catalog,
      automationOutputs,
      field.id,
    )
  })
}

function createContactNameTemplateError(
  label: string,
  value: string | null | undefined,
  optional: boolean,
  catalog: AutomationCatalog,
  automationOutputs: AutomationValueDefinition[],
) {
  const templateError = optional
    ? optionalTemplateError(value, 1_000, catalog, automationOutputs)
    : noteTemplateError(value ?? "", 1_000, catalog, automationOutputs)
  if (templateError) return templateError
  const literal = value?.trim() ?? ""
  return literal && !literal.includes("{") && literal.length > 120
    ? `${label} must contain 120 characters or fewer.`
    : null
}

function createContactEmailTemplateError(
  value: string | null | undefined,
  catalog: AutomationCatalog,
  automationOutputs: AutomationValueDefinition[],
) {
  const templateError = optionalTemplateError(value, 1_000, catalog, automationOutputs)
  if (templateError) return templateError
  const literal = value?.trim() ?? ""
  return literal && !literal.includes("{") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(literal)
    ? "Enter a valid email address or insert automation data."
    : null
}

function createContactPhoneTemplateError(
  value: string | null | undefined,
  catalog: AutomationCatalog,
  automationOutputs: AutomationValueDefinition[],
) {
  const templateError = optionalTemplateError(value, 1_000, catalog, automationOutputs)
  if (templateError) return templateError
  const literal = value?.trim() ?? ""
  return literal && !literal.includes("{") && !/^\+[1-9]\d{7,14}$/.test(literal)
    ? "Enter an E.164 phone number, such as +15551234567, or insert automation data."
    : null
}

function actionDefaults(
  type: AutomationAction["type"],
  catalog: AutomationCatalog,
  existingNodeKey?: string,
  sourceAutomationId?: string,
): AutomationAction {
  const nodeKey = existingNodeKey ?? crypto.randomUUID()
  if (type === "CREATE_CONTACT") {
    const defaultStatus = catalog.statuses.find((status) => status.name === "Active") ?? catalog.statuses[0]
    return {
      nodeKey,
      type,
      createContactConfig: {
        actionName: "Create contact",
        firstNameTemplate: "",
        middleNameTemplate: "",
        lastNameTemplate: "",
        emailTemplate: "",
        phoneTemplate: "",
        dateOfBirth: null,
        statusConfigId: defaultStatus?.id ?? "",
        customFieldValues: [],
      },
    }
  }
  if (type === "UPDATE_CONTACT_CUSTOM_FIELDS") {
    const contactField = catalog.contactUpdateFields[0]
    const customField = catalog.customFields[0]
    return {
      nodeKey,
      type,
      customFieldUpdates: contactField
        ? [{
            contactFieldKey: contactField.key,
            operation: "SET",
            value: defaultFieldUpdateValue(contactValueField(contactField)),
          }]
        : customField
          ? [{
              customFieldId: customField.id,
              operation: "SET",
              value: defaultFieldUpdateValue(customField),
            }]
          : [],
    }
  }
  if (type === "SET_CONTACT_STATUS") return { nodeKey, type, statusConfigId: catalog.statuses[0]?.id ?? "" }
  if (type === "SET_CONTACT_ASSIGNEE") return { nodeKey, type, assignedUserId: catalog.users[0]?.id ?? "" }
  if (type === "ADD_CONTACT_TAG" || type === "REMOVE_CONTACT_TAG") return { nodeKey, type, tagId: catalog.tags[0]?.id ?? "" }
  if (type === "ADD_CONTACT_NOTE") return { nodeKey, type, noteTitle: "", noteBody: "" }
  if (type === "CREATE_TASK") {
    const defaultStatus = catalog.taskStatuses.find((status) => status.name === "To Do") ?? catalog.taskStatuses[0]
    return {
      nodeKey,
      type,
      taskConfig: {
        nameTemplate: "",
        descriptionTemplate: "",
        statusConfigId: defaultStatus?.id ?? "",
        assignee: { mode: "CONTACT_ASSIGNEE" },
        linkedService: null,
        dueAt: null,
        reminder: null,
      },
    }
  }
  if (type === "SEND_INTERNAL_NOTIFICATION") {
    return {
      nodeKey,
      type,
      internalNotificationConfig: {
        actionName: "Internal notification",
        recipient: { mode: "CONTACT_ASSIGNEE" },
        titleTemplate: "",
        bodyTemplate: "",
      },
    }
  }
  if (type === "FORMAT_DATE_TIME") {
    return {
      nodeKey,
      type,
      dateTimeFormatterConfig: {
        mode: "DATE",
        source: { type: "CURRENT_DATE" },
        format: "MMM D, YYYY",
        outputKey: "formatted_date",
      },
    }
  }
  if (type === "FORMAT_NUMBER") {
    const preferredCustomField = catalog.customFields.find(
      (field) => field.fieldType === "NUMBER" || field.fieldType === "CURRENCY",
    )
    const preferredContactField = catalog.templateFields.contact.find(
      (field) => field.key === "weight",
    ) ?? catalog.templateFields.contact.find((field) => field.fieldType === "TEXT")
    const source: AutomationNumberSource = preferredCustomField
      ? { type: "CUSTOM_FIELD", key: preferredCustomField.key }
      : { type: "CONTACT_FIELD", key: preferredContactField?.key ?? "weight" }
    return {
      nodeKey,
      type,
      numberFormatterConfig: {
        mode: "FORMAT_NUMBER",
        source,
        decimalMark: "PERIOD",
        groupingStyle: "COMMA_PERIOD",
        outputKey: "formatted_number",
      },
    }
  }
  if (type === "FORMAT_TEXT") {
    const preferredContactField = catalog.templateFields.contact.find(
      (field) => textFormatterAcceptsFieldType(field.fieldType),
    )
    const preferredCustomField = catalog.customFields.find(
      (field) => textFormatterAcceptsFieldType(field.fieldType),
    )
    const source: AutomationTextSource = preferredContactField
      ? { type: "CONTACT_FIELD", key: preferredContactField.key }
      : { type: "CUSTOM_FIELD", key: preferredCustomField?.key ?? "" }
    return {
      nodeKey,
      type,
      textFormatterConfig: {
        actionName: "Text formatter",
        mode: "UPPER_CASE",
        source,
        outputKey: "formatted_text",
      },
    }
  }
  if (type === "MATH_OPERATION") {
    const preferredCustomField = catalog.customFields.find(
      (field) => field.fieldType === "NUMBER" || field.fieldType === "CURRENCY",
    )
    const preferredContactField = catalog.templateFields.contact.find(
      (field) => field.fieldType === "NUMBER" || field.fieldType === "CURRENCY",
    )
    const source = preferredCustomField
      ? { type: "CUSTOM_FIELD" as const, key: preferredCustomField.key }
      : { type: "CONTACT_FIELD" as const, key: preferredContactField?.key ?? "" }
    return {
      nodeKey,
      type,
      mathOperationConfig: {
        mode: "NUMBER",
        source,
        operation: "ADD",
        operand: 1,
        outputKey: "calculated_value",
      },
    }
  }
  if (type === "IF_ELSE") {
    return {
      nodeKey,
      type,
      ifElseConfig: {
        actionName: "If/Else",
        branches: [
          {
            branchKey: crypto.randomUUID(),
            name: "Branch 1",
            isDefault: false,
            matchMode: "ALL",
            conditions: [defaultBranchCondition(catalog)],
            actions: [],
          },
          {
            branchKey: crypto.randomUUID(),
            name: "Default",
            isDefault: true,
            matchMode: "ALL",
            conditions: [],
            actions: [],
          },
        ],
      },
    }
  }
  if (type === "SPLIT") {
    return {
      nodeKey,
      type,
      splitConfig: {
        actionName: "Split",
        routes: [
          {
            branchKey: crypto.randomUUID(),
            name: "Route 1",
            percentage: 50,
            actions: [],
          },
          {
            branchKey: crypto.randomUUID(),
            name: "Route 2",
            percentage: 50,
            actions: [],
          },
        ],
      },
    }
  }
  if (type === "GO_TO") return { nodeKey, type, goToConfig: { targetNodeKey: "" } }
  if (type === "ADD_TO_WORKFLOW") {
    const target = catalog.workflowAutomations.find((automation) => automation.id !== sourceAutomationId)
    return {
      nodeKey,
      type,
      addToWorkflowConfig: {
        actionName: "Add to workflow",
        targetAutomationId: target?.id ?? "",
        targetAutomationNameSnapshot: target?.name ?? "",
      },
    }
  }
  if (type === "REMOVE_FROM_WORKFLOW") {
    const target = catalog.workflowAutomations[0]
    return {
      nodeKey,
      type,
      removeFromWorkflowConfig: {
        actionName: "Remove from workflow",
        targetAutomationId: target?.id ?? "",
        targetAutomationNameSnapshot: target?.name ?? "",
      },
    }
  }
  if (type === "UPDATE_OPPORTUNITY") {
    const pipeline = catalog.pipelines[0]
    const stage = pipeline?.stages[0]
    return {
      nodeKey,
      type,
      opportunityConfig: {
        actionName: "Update/create opportunity",
        pipelineId: pipeline?.id ?? "",
        pipelineNameSnapshot: pipeline?.name ?? "",
        stageId: stage?.id ?? "",
        stageNameSnapshot: stage?.name ?? "",
        resultMode: "KEEP_CURRENT",
        valueCents: 0,
      },
    }
  }
  if (type === "DELETE_OPPORTUNITY") {
    const pipeline = catalog.pipelines[0]
    return {
      nodeKey,
      type,
      deleteOpportunityConfig: {
        actionName: "Delete opportunity",
        pipelineId: pipeline?.id ?? "",
        pipelineNameSnapshot: pipeline?.name ?? "",
      },
    }
  }
  if (type === "WAIT") return { nodeKey, type, waitConfig: { mode: "DURATION", amount: 1, unit: "HOURS" } }
  return { nodeKey, type }
}

function noteTemplateError(
  value: string | null | undefined,
  maxLength: number,
  catalog: AutomationCatalog,
  automationOutputs: AutomationValueDefinition[] = [],
) {
  if (!value) return "This field is required."
  if (value.length > maxLength) return `Use ${maxLength.toLocaleString()} characters or fewer.`
  const hasText = value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim().length > 0
  if (!hasText) return "This field is required."
  return validateContactTemplate(value, catalog, automationOutputs)
}

function optionalTemplateError(
  value: string | null | undefined,
  maxLength: number,
  catalog: AutomationCatalog,
  automationOutputs: AutomationValueDefinition[] = [],
) {
  if (!value) return null
  if (value.length > maxLength) return `Use ${maxLength.toLocaleString()} characters or fewer.`
  return validateContactTemplate(value, catalog, automationOutputs)
}

function formatterOutputs(actions: AutomationAction[]): AutomationValueDefinition[] {
  return uniqueAutomationOutputs(actions.flatMap((action) => {
    const key = action.type === "FORMAT_DATE_TIME"
      ? action.dateTimeFormatterConfig?.outputKey.trim()
      : action.type === "FORMAT_NUMBER"
        ? action.numberFormatterConfig?.outputKey.trim()
        : action.type === "FORMAT_TEXT"
          ? action.textFormatterConfig?.outputKey.trim()
          : action.type === "MATH_OPERATION"
            ? action.mathOperationConfig?.outputKey.trim()
            : ""
    const valueKind: AutomationValueDefinition["valueKind"] = action.type === "FORMAT_DATE_TIME"
      ? action.dateTimeFormatterConfig?.mode === "COMPARE_DATES"
        ? "NUMBER"
        : action.dateTimeFormatterConfig?.format === "X"
          ? "NUMERIC_TEXT"
          : "TEXT"
      : action.type === "FORMAT_NUMBER"
        ? action.numberFormatterConfig?.mode === "TEXT_TO_NUMBER" ||
          action.numberFormatterConfig?.mode === "RANDOM_NUMBER"
          ? "NUMBER"
          : action.numberFormatterConfig?.mode === "FORMAT_NUMBER"
            ? "NUMERIC_TEXT"
            : action.numberFormatterConfig?.mode === "FORMAT_PHONE_NUMBER"
              ? "PHONE"
              : "TEXT"
        : action.type === "FORMAT_TEXT"
          ? action.textFormatterConfig?.mode === "FIND" ||
            action.textFormatterConfig?.mode === "WORD_COUNT" ||
            action.textFormatterConfig?.mode === "LENGTH"
            ? "NUMBER"
            : "TEXT"
          : action.type === "MATH_OPERATION"
            ? action.mathOperationConfig?.mode === "DATE" ? "DATE" : "NUMBER"
            : "TEXT"
    return key && /^[a-z][a-z0-9_]{0,63}$/.test(key)
      ? [{ key, label: key, valueKind }]
      : []
  }))
}

function numberFormatterAcceptsFieldType(
  mode: AutomationNumberFormatterConfig["mode"],
  fieldType: string,
) {
  if (mode === "RANDOM_NUMBER") return false
  if (mode === "FORMAT_PHONE_NUMBER") return fieldType === "PHONE"
  return ["TEXT", "TEXTAREA", "NUMBER", "CURRENCY"].includes(fieldType)
}

function numberFormatterAcceptsValueKind(
  mode: AutomationNumberFormatterConfig["mode"],
  valueKind: AutomationValueDefinition["valueKind"],
) {
  if (mode === "RANDOM_NUMBER") return false
  if (mode === "FORMAT_PHONE_NUMBER") return valueKind === "PHONE"
  return valueKind === "NUMBER" || valueKind === "NUMERIC_TEXT"
}

function textFormatterAcceptsFieldType(fieldType: string) {
  return ["TEXT", "TEXTAREA", "PHONE", "SELECT", "RADIO", "MULTI_SELECT"].includes(fieldType)
}

function textFormatterAcceptsValueKind(valueKind: AutomationValueDefinition["valueKind"]) {
  return valueKind === "TEXT" || valueKind === "PHONE" || valueKind === "NUMERIC_TEXT"
}

function isTextFormatterSourceReady(
  source: AutomationTextSource,
  catalog: AutomationCatalog,
  automationOutputs: AutomationValueDefinition[],
) {
  if (source.type === "CONTACT_FIELD") {
    return catalog.templateFields.contact.some(
      (field) => field.key === source.key && textFormatterAcceptsFieldType(field.fieldType),
    )
  }
  if (source.type === "CUSTOM_FIELD") {
    return catalog.customFields.some(
      (field) => field.key === source.key && textFormatterAcceptsFieldType(field.fieldType),
    )
  }
  return automationOutputs.some(
    (output) => output.key === source.key && textFormatterAcceptsValueKind(output.valueKind),
  )
}

function isNumberFormatterSourceReady(
  source: AutomationNumberSource,
  mode: AutomationNumberFormatterConfig["mode"],
  catalog: AutomationCatalog,
  automationOutputs: AutomationValueDefinition[],
) {
  if (source.type === "CONTACT_FIELD") {
    const field = catalog.templateFields.contact.find((candidate) => candidate.key === source.key)
    return Boolean(field && numberFormatterAcceptsFieldType(mode, field.fieldType))
  }
  if (source.type === "CUSTOM_FIELD") {
    const field = catalog.customFields.find((candidate) => candidate.key === source.key)
    return Boolean(field && numberFormatterAcceptsFieldType(mode, field.fieldType))
  }
  const output = automationOutputs.find((candidate) => candidate.key === source.key)
  return Boolean(output && numberFormatterAcceptsValueKind(mode, output.valueKind))
}

function isFormatterSourceReady(
  source: AutomationFormatterDateSource,
  catalog: AutomationCatalog,
  automationOutputs: AutomationValueDefinition[],
) {
  if (source.type === "CURRENT_DATE") return true
  if (source.type === "RELATIVE_DATE") {
    return Number.isInteger(source.amount) && source.amount > 0 && source.amount <= 10_000
  }
  if (source.type === "SPECIFIC_DATE") {
    return /^\d{4}-\d{2}-\d{2}$/.test(source.date) && Boolean(source.timezone)
  }
  if (source.type === "CONTACT_FIELD") {
    return catalog.templateFields.contact.some(
      (field) => field.key === source.key && field.fieldType === "DATE",
    )
  }
  if (source.type === "AUTOMATION_VALUE") {
    return automationOutputs.some(
      (output) => output.key === source.key && output.valueKind === "DATE",
    )
  }
  return catalog.customFields.some(
    (field) => field.key === source.key && field.fieldType === "DATE",
  )
}

function formatterSourceNeedsTime(source: AutomationFormatterDateSource) {
  return source.type === "CUSTOM_FIELD" ||
    source.type === "SPECIFIC_DATE" ||
    source.type === "AUTOMATION_VALUE" ||
    (source.type === "CONTACT_FIELD" && source.key !== "created_at" && source.key !== "updated_at")
}

function isMathSourceReady(
  config: AutomationMathOperationConfig,
  catalog: AutomationCatalog,
  automationOutputs: AutomationValueDefinition[],
) {
  const { source } = config
  if (source.type === "AUTOMATION_VALUE") {
    const expectedKind = config.mode === "DATE" ? "DATE" : "NUMBER"
    return automationOutputs.some(
      (output) => output.key === source.key && output.valueKind === expectedKind,
    )
  }
  const field = source.type === "CONTACT_FIELD"
    ? catalog.templateFields.contact.find((candidate) => candidate.key === source.key)
    : catalog.customFields.find((candidate) => candidate.key === source.key)
  if (!field) return false
  return config.mode === "DATE"
    ? field.fieldType === "DATE"
    : field.fieldType === "NUMBER" || field.fieldType === "CURRENCY"
}

function isTaskDateTimeReady(value: AutomationTaskDateTime, catalog: AutomationCatalog) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) return false
  const source = value.source
  if (source.type === "SPECIFIC_DATE") {
    return /^\d{4}-\d{2}-\d{2}$/.test(source.date) && Boolean(source.timezone)
  }
  if (source.type === "RELATIVE_DATE") {
    return Number.isInteger(source.amount) &&
      source.amount > 0 &&
      source.amount <= 10_000 &&
      ["DAYS", "WEEKS", "MONTHS"].includes(source.unit)
  }
  if (source.type === "CONTACT_FIELD") {
    return catalog.templateFields.contact.some(
      (field) => field.key === source.key && field.fieldType === "DATE",
    )
  }
  if (source.type === "CUSTOM_FIELD") {
    return catalog.customFields.some(
      (field) => field.key === source.key && field.fieldType === "DATE",
    )
  }
  return true
}

function isBranchConditionReady(
  condition: AutomationBranchCondition,
  catalog: AutomationCatalog,
  automationOutputs: AutomationValueDefinition[],
) {
  if (!condition.conditionKey) return false
  if (condition.source === "CONTACT_FIELD" && !catalog.templateFields.contact.some((field) => field.key === condition.fieldKey)) return false
  if (condition.source === "CONTACT_CUSTOM_FIELD" && !catalog.customFields.some((field) => field.id === condition.customFieldId)) return false
  if (condition.source === "CONTACT_STATUS" && !VALUELESS_OPERATORS.has(condition.operator) && !catalog.statuses.some((item) => item.id === condition.statusConfigId)) return false
  if (condition.source === "CONTACT_ASSIGNEE" && !VALUELESS_OPERATORS.has(condition.operator) && !catalog.users.some((item) => item.id === condition.assignedUserId)) return false
  if (condition.source === "CONTACT_TAGS" && !VALUELESS_OPERATORS.has(condition.operator) && !catalog.tags.some((item) => item.id === condition.tagId)) return false
  if (condition.source === "AUTOMATION_VALUE" && !automationOutputs.some((item) => item.key === condition.key)) return false
  if (condition.source === "OPPORTUNITY_FIELD" && !condition.field) return false
  if (!VALUELESS_OPERATORS.has(condition.operator)) {
    if (condition.operator === "BETWEEN") {
      const range = condition.compareValue as { min?: unknown; max?: unknown } | null
      return range?.min !== "" && range?.min !== undefined && range?.max !== "" && range?.max !== undefined
    }
    if (["CONTACT_STATUS", "CONTACT_ASSIGNEE", "CONTACT_TAGS"].includes(condition.source)) return true
    if (Array.isArray(condition.compareValue)) return condition.compareValue.length > 0
    if (condition.compareValue === null || condition.compareValue === undefined || condition.compareValue === "") return false
  }
  return true
}

function isIfElseReady(
  action: AutomationAction,
  catalog: AutomationCatalog,
  previousActions: AutomationAction[],
  depth = 1,
  requireBranchActions = true,
): boolean {
  const config = action.ifElseConfig
  if (!config || !config.actionName.trim() || config.actionName.trim().length > 120 || depth > 3) return false
  if (config.branches.length < 2 || config.branches.length > 20) return false
  const names = config.branches.map((branch) => branch.name.trim().toLocaleLowerCase())
  if (names.some((name) => !name) || new Set(names).size !== names.length) return false
  const keys = config.branches.map((branch) => branch.branchKey)
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) return false
  const defaultIndexes = config.branches.flatMap((branch, index) => branch.isDefault ? [index] : [])
  if (defaultIndexes.length !== 1 || defaultIndexes[0] !== config.branches.length - 1) return false
  const inheritedOutputs = formatterOutputs(previousActions)

  return config.branches.every((branch) => {
    if (branch.isDefault) return branch.conditions.length === 0 && branch.actions.length === 0
    if (branch.conditions.length < 1 || branch.conditions.length > 20) return false
    if (!branch.conditions.every((condition) => isBranchConditionReady(condition, catalog, inheritedOutputs))) return false
    if (!requireBranchActions && branch.actions.length === 0) return true
    if (branch.actions.length === 0) return false
    return branch.actions.every((branchAction, index) => {
      if ((branchAction.type === "IF_ELSE" || branchAction.type === "SPLIT" || branchAction.type === "GO_TO") && index !== branch.actions.length - 1) return false
      if (branchAction.type === "DELETE_CONTACT" && index !== branch.actions.length - 1) return false
      return branchAction.type === "IF_ELSE"
        ? isIfElseReady(branchAction, catalog, [...previousActions, ...branch.actions.slice(0, index)], depth + 1, requireBranchActions)
        : branchAction.type === "SPLIT"
          ? isSplitReady(branchAction, catalog, [...previousActions, ...branch.actions.slice(0, index)], depth + 1)
        : isActionReady(
            branchAction,
            catalog,
            branch.actions.slice(index + 1),
            [...previousActions, ...branch.actions.slice(0, index)],
          )
    })
  })
}

function isSplitReady(
  action: AutomationAction,
  catalog: AutomationCatalog,
  previousActions: AutomationAction[],
  depth = 1,
): boolean {
  const config = action.splitConfig
  if (!config || !config.actionName.trim() || config.actionName.trim().length > 120 || depth > 3) return false
  if (config.routes.length < 2 || config.routes.length > 20) return false
  const names = config.routes.map((route) => route.name.trim().toLocaleLowerCase())
  if (names.some((name) => !name) || new Set(names).size !== names.length) return false
  const keys = config.routes.map((route) => route.branchKey)
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) return false
  if (config.routes.some((route) => !Number.isInteger(route.percentage) || route.percentage < 1 || route.percentage > 99)) return false
  if (config.routes.reduce((total, route) => total + route.percentage, 0) !== 100) return false

  return config.routes.every((route) => route.actions.every((routeAction, index) => {
    if (
      (routeAction.type === "IF_ELSE" || routeAction.type === "SPLIT" || routeAction.type === "GO_TO" || routeAction.type === "DELETE_CONTACT") &&
      index !== route.actions.length - 1
    ) return false
    return routeAction.type === "IF_ELSE"
      ? isIfElseReady(routeAction, catalog, [...previousActions, ...route.actions.slice(0, index)], depth + 1)
      : routeAction.type === "SPLIT"
        ? isSplitReady(routeAction, catalog, [...previousActions, ...route.actions.slice(0, index)], depth + 1)
        : isActionReady(
            routeAction,
            catalog,
            route.actions.slice(index + 1),
            [...previousActions, ...route.actions.slice(0, index)],
          )
  }))
}

function isActionReady(
  action: AutomationAction | null,
  catalog: AutomationCatalog,
  targetActions: AutomationAction[] = [],
  previousActions: AutomationAction[] = [],
) {
  if (!action) return false
  const availableOutputs = formatterOutputs(previousActions)
  if (action.type === "CREATE_CONTACT") {
    return Boolean(
      action.createContactConfig &&
      isCreateContactReady(action.createContactConfig, catalog, availableOutputs),
    )
  }
  if (action.type === "UPDATE_CONTACT_CUSTOM_FIELDS") {
    const updates = action.customFieldUpdates ?? []
    const fieldIds = updates.map(updateIdentity)
    return updates.length > 0 &&
      updates.length <= 20 &&
      new Set(fieldIds).size === fieldIds.length &&
      updates.every((update) => isFieldUpdateReady(update, catalog))
  }
  if (action.type === "SET_CONTACT_STATUS") return Boolean(action.statusConfigId)
  if (action.type === "SET_CONTACT_ASSIGNEE") return Boolean(action.assignedUserId)
  if (action.type === "ADD_CONTACT_TAG" || action.type === "REMOVE_CONTACT_TAG") {
    return Boolean(action.tagId)
  }
  if (action.type === "ADD_CONTACT_NOTE") {
    return !noteTemplateError(action.noteTitle, 160, catalog, availableOutputs) &&
      !noteTemplateError(action.noteBody, 5_000, catalog, availableOutputs)
  }
  if (action.type === "CREATE_TASK") {
    const config = action.taskConfig
    if (!config) return false
    if (noteTemplateError(config.nameTemplate, 160, catalog, availableOutputs)) return false
    if (optionalTemplateError(config.descriptionTemplate, 4_000, catalog, availableOutputs)) return false
    if (!catalog.taskStatuses.some((status) => status.id === config.statusConfigId)) return false
    if (config.assignee.mode === "SPECIFIC_USER") {
      const userId = config.assignee.userId
      if (!catalog.users.some((user) => user.id === userId)) return false
    }
    if (
      config.linkedService &&
      !catalog.services.some((service) => service.id === config.linkedService?.id)
    ) return false
    if (config.dueAt && !isTaskDateTimeReady(config.dueAt, catalog)) return false
    if (config.reminder) {
      if (!config.dueAt || config.assignee.mode === "UNASSIGNED") return false
      if (!isTaskDateTimeReady(config.reminder.at, catalog)) return false
      if (optionalTemplateError(config.reminder.messageTemplate, 500, catalog, availableOutputs)) return false
    }
    return true
  }
  if (action.type === "SEND_INTERNAL_NOTIFICATION") {
    const config = action.internalNotificationConfig
    if (!config || !config.actionName.trim() || config.actionName.trim().length > 120) return false
    if (noteTemplateError(config.titleTemplate, 160, catalog, availableOutputs)) return false
    if (optionalTemplateError(config.bodyTemplate, 1_000, catalog, availableOutputs)) return false
    if (config.recipient.mode === "SPECIFIC_USER") {
      const specificUserId = config.recipient.userId
      if (!specificUserId || !catalog.users.some((user) => user.id === specificUserId)) return false
    }
    return true
  }
  if (action.type === "FORMAT_DATE_TIME") {
    const config = action.dateTimeFormatterConfig
    if (!config || !/^[a-z][a-z0-9_]{0,63}$/.test(config.outputKey)) return false
    if (availableOutputs.some((output) => output.key === config.outputKey)) return false
    if (config.mode === "COMPARE_DATES") {
      return isFormatterSourceReady(config.from, catalog, availableOutputs) &&
        isFormatterSourceReady(config.to, catalog, availableOutputs)
    }
    if (!isFormatterSourceReady(config.source, catalog, availableOutputs)) return false
    if (
      config.mode === "DATE_TIME" &&
      formatterSourceNeedsTime(config.source) &&
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(config.time ?? "")
    ) return false
    return true
  }
  if (action.type === "FORMAT_NUMBER") {
    const config = action.numberFormatterConfig
    if (!config || !/^[a-z][a-z0-9_]{0,63}$/.test(config.outputKey)) return false
    if (availableOutputs.some((output) => output.key === config.outputKey)) return false
    if (config.mode === "RANDOM_NUMBER") {
      return Number.isSafeInteger(config.min) &&
        Number.isSafeInteger(config.max) &&
        config.min <= config.max
    }
    if (!isNumberFormatterSourceReady(config.source, config.mode, catalog, availableOutputs)) return false
    if (config.mode === "FORMAT_PHONE_NUMBER") return /^\+\d{1,4}$/.test(config.countryCode)
    return config.decimalMark === "PERIOD" || config.decimalMark === "COMMA"
  }
  if (action.type === "FORMAT_TEXT") {
    const config = action.textFormatterConfig
    if (!config || !config.actionName.trim() || config.actionName.trim().length > 120) return false
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(config.outputKey)) return false
    if (availableOutputs.some((output) => output.key === config.outputKey)) return false
    if (!isTextFormatterSourceReady(config.source, catalog, availableOutputs)) return false
    if (config.mode === "DEFAULT_VALUE") {
      return config.defaultValue.trim().length > 0 && config.defaultValue.length <= 5_000
    }
    if (config.mode === "TRIM") {
      return Number.isInteger(config.maxLength) && config.maxLength > 0 && config.maxLength <= 10_000
    }
    if (config.mode === "REPLACE_TEXT") {
      return config.searchText.length > 0 &&
        config.searchText.length <= 5_000 &&
        config.replacementText.length <= 5_000
    }
    if (config.mode === "FIND") {
      return config.searchText.length > 0 && config.searchText.length <= 5_000
    }
    if (config.mode === "SPLIT_TEXT") {
      return config.separator.length > 0 &&
        config.separator.length <= 100 &&
        Number.isInteger(config.segment) &&
        config.segment > 0 &&
        config.segment <= 10_000
    }
    return true
  }
  if (action.type === "MATH_OPERATION") {
    const config = action.mathOperationConfig
    if (!config || !/^[a-z][a-z0-9_]{0,63}$/.test(config.outputKey)) return false
    if (availableOutputs.some((output) => output.key === config.outputKey)) return false
    if (!isMathSourceReady(config, catalog, availableOutputs)) return false
    if (config.mode === "DATE") {
      return Number.isInteger(config.amount) &&
        config.amount > 0 &&
        config.amount <= 10_000
    }
    return Number.isFinite(config.operand) &&
      !(config.operation === "DIVIDE" && config.operand === 0)
  }
  if (action.type === "IF_ELSE") {
    return targetActions.length === 0 && isIfElseReady(action, catalog, previousActions)
  }
  if (action.type === "SPLIT") {
    return targetActions.length === 0 && isSplitReady(action, catalog, previousActions)
  }
  if (action.type === "GO_TO") {
    return targetActions.length === 0 && Boolean(action.goToConfig?.targetNodeKey)
  }
  if (action.type === "ADD_TO_WORKFLOW") {
    const config = action.addToWorkflowConfig
    return Boolean(
      config &&
      config.actionName.trim() &&
      config.actionName.trim().length <= 120 &&
      catalog.workflowAutomations.some((automation) => automation.id === config.targetAutomationId),
    )
  }
  if (action.type === "REMOVE_FROM_WORKFLOW") {
    const config = action.removeFromWorkflowConfig
    return Boolean(
      config &&
      config.actionName.trim() &&
      config.actionName.trim().length <= 120 &&
      catalog.workflowAutomations.some((automation) => automation.id === config.targetAutomationId),
    )
  }
  if (action.type === "UPDATE_OPPORTUNITY") {
    const config = action.opportunityConfig
    if (!config || !config.actionName.trim() || config.actionName.trim().length > 120) return false
    const pipeline = catalog.pipelines.find((candidate) => candidate.id === config.pipelineId)
    if (!pipeline?.stages.some((stage) => stage.id === config.stageId)) return false
    return typeof config.valueCents === "number" &&
      Number.isSafeInteger(config.valueCents) &&
      config.valueCents >= 0 &&
      config.valueCents <= 2_147_483_647
  }
  if (action.type === "DELETE_OPPORTUNITY") {
    const config = action.deleteOpportunityConfig
    if (!config || !config.actionName.trim() || config.actionName.trim().length > 120) return false
    return catalog.pipelines.some((pipeline) => pipeline.id === config.pipelineId)
  }
  if (action.type === "WAIT") {
    const config = action.waitConfig
    if (!config) return false
    if (config.mode === "DURATION") return Number.isSafeInteger(config.amount) && config.amount > 0
    if (Number.isNaN(new Date(config.dateTime).getTime())) return false
    if (config.timing !== "ON" && (!Number.isSafeInteger(config.offsetAmount) || (config.offsetAmount ?? 0) <= 0 || !config.offsetUnit)) return false
    if (config.pastBehavior === "GO_TO_STEP") {
      return Boolean(config.targetNodeKey && targetActions.some((candidate) => candidate.nodeKey === config.targetNodeKey))
    }
  }
  if (action.type === "DELETE_CONTACT") return targetActions.length === 0
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

function draftValidationMessage(draft: Draft, catalog: AutomationCatalog) {
  if (!draft.name.trim()) return "Enter an automation name."
  if (!draft.triggerType) return "Select a trigger."
  if (!draft.pipelineId) return "Select a pipeline."
  if (draft.triggerType === "OPPORTUNITY_STAGE_CHANGED" && !draft.targetStageId) return "Select a stage."
  if (draft.actions.length === 0) return "Add at least one action."
  const allActions = flattenDraftActions(draft.actions)
  if (allActions.length > MAX_AUTOMATION_ACTION_NODES) {
    return `An automation can contain at most ${MAX_AUTOMATION_ACTION_NODES} action nodes across all branches.`
  }
  const nodeKeys = allActions.map((action) => action.nodeKey).filter(Boolean)
  if (nodeKeys.length !== allActions.length || new Set(nodeKeys).size !== nodeKeys.length) {
    return "Every action needs a unique step identifier."
  }
  const validatePath = (actions: AutomationAction[], inherited: AutomationAction[]): string | null => {
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index]!
      if ((action.type === "DELETE_CONTACT" || action.type === "IF_ELSE" || action.type === "SPLIT" || action.type === "GO_TO") && index !== actions.length - 1) {
        return `${ACTION_LABELS[action.type]} can only be the final action in its path.`
      }
      if (!isActionReady(action, catalog, actions.slice(index + 1), [...inherited, ...actions.slice(0, index)])) {
        return `Finish configuring ${ACTION_LABELS[action.type]}.`
      }
      if (action.type === "IF_ELSE") {
        for (const branch of action.ifElseConfig?.branches ?? []) {
          if (branch.isDefault) continue
          const nestedIssue = validatePath(branch.actions, [...inherited, ...actions.slice(0, index)])
          if (nestedIssue) return nestedIssue
        }
      } else if (action.type === "SPLIT") {
        for (const route of action.splitConfig?.routes ?? []) {
          const nestedIssue = validatePath(route.actions, [...inherited, ...actions.slice(0, index)])
          if (nestedIssue) return nestedIssue
        }
      }
    }
    return null
  }
  return validatePath(draft.actions, []) ?? validateAutomationGoToGraph(draft.actions)
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
    actions: draft.actions.map(serializeAutomationAction),
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
  const [waitNodeCounts, setWaitNodeCounts] = useState<Record<string, number>>({})
  const [waitNodeCountState, setWaitNodeCountState] = useState<"loading" | "ready" | "error">(
    automationId ? "loading" : "ready",
  )
  const [waitingNodeKey, setWaitingNodeKey] = useState<string | null>(null)
  const [goToPicking, setGoToPicking] = useState(false)

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

  const loadWaitNodeCounts = useCallback(async () => {
    if (!automationId) {
      setWaitNodeCounts({})
      setWaitNodeCountState("ready")
      return
    }
    setWaitNodeCountState("loading")
    try {
      const { data } = await api.get<{ ok: boolean; items: AutomationWaitNodeCount[] }>(
        `/api/account-settings/${tenantId}/automations/${automationId}/wait-nodes`,
      )
      setWaitNodeCounts(Object.fromEntries(data.items.map((item) => [item.nodeKey, item.count])))
      setWaitNodeCountState("ready")
    } catch {
      setWaitNodeCountState("error")
    }
  }, [automationId, tenantId])

  useEffect(() => {
    void loadWaitNodeCounts()
  }, [loadWaitNodeCounts])

  const updateWaitNodeCount = useCallback((nodeKey: string, count: number) => {
    setWaitNodeCounts((current) => ({ ...current, [nodeKey]: count }))
  }, [])

  const savedWaitNodeKeys = useMemo(
    () => new Set(
      flattenDraftActions(lastSavedDraft.actions)
        .filter((action) => action.type === "WAIT" && action.nodeKey)
        .map((action) => action.nodeKey!),
    ),
    [lastSavedDraft.actions],
  )

  const waitNodeBadges = useMemo(() => Object.fromEntries(
    flattenDraftActions(draft.actions)
      .filter((action) => action.type === "WAIT" && action.nodeKey)
      .map((action) => {
        const nodeKey = action.nodeKey!
        const isSaved = Boolean(automationId) && savedWaitNodeKeys.has(nodeKey)
        return [
          nodeKey,
          isSaved
            ? {
                count: waitNodeCounts[nodeKey] ?? 0,
                state: waitNodeCountState,
                onClick: () => setWaitingNodeKey(nodeKey),
              }
            : { count: 0, state: "unsaved" as const },
        ]
      }),
  ), [automationId, draft.actions, savedWaitNodeKeys, waitNodeCountState, waitNodeCounts])

  const goToPreviewDraft = useMemo(() => {
    if (selected?.kind === "action" && editingAction?.type === "GO_TO") {
      return mutateActionsAtPath(draft, selected.path, (actions) => {
        actions[selected.index] = structuredClone(editingAction)
      })
    }
    if (selected?.kind === "new-action" && pendingAction?.type === "GO_TO") {
      return mutateActionsAtPath(draft, selected.path, (actions) => {
        actions.splice(selected.insertionIndex, 0, structuredClone(pendingAction))
      })
    }
    return draft
  }, [draft, editingAction, pendingAction, selected])
  const goToSourceKey = selected?.kind === "action" && editingAction?.type === "GO_TO"
    ? editingAction.nodeKey ?? null
    : selected?.kind === "new-action" && pendingAction?.type === "GO_TO"
      ? pendingAction.nodeKey ?? null
      : null
  const goToDestinations = useMemo(
    () => goToSourceKey
      ? automationGoToDestinations(goToPreviewDraft.actions, goToSourceKey)
      : [],
    [goToPreviewDraft.actions, goToSourceKey],
  )
  const baseGraph = useMemo(
    () => buildAutomationFlowGraph(goToPreviewDraft, catalog, ACTION_LABELS, timezone, waitNodeBadges),
    [catalog, goToPreviewDraft, timezone, waitNodeBadges],
  )
  const graph = useMemo(() => {
    const destinationByKey = new Map(goToDestinations.map((destination) => [destination.nodeKey, destination]))
    const actionByNodeKey = new Map(
      flattenDraftActions(goToPreviewDraft.actions)
        .filter((action): action is AutomationAction & { nodeKey: string } => Boolean(action.nodeKey))
        .map((action) => [action.nodeKey, action]),
    )
    const nodes = baseGraph.nodes.map((node) => {
      const nodeKey = node.data.actionNodeKey
      if (!nodeKey) return node
      const destination = destinationByKey.get(nodeKey)
      const canSelect = Boolean(goToPicking && destination && !destination.issue)
      const goToAction = actionByNodeKey.get(nodeKey)
      const canUnlink = goToAction?.type === "GO_TO" && Boolean(goToAction.goToConfig?.targetNodeKey)
      if (!canSelect && !canUnlink) return node
      return {
        ...node,
        data: {
          ...node.data,
          goToSelection: canSelect ? "eligible" as const : undefined,
          ...(canUnlink
            ? {
                onGoToUnlink: () => {
                  const path = node.data.actionPath ?? []
                  const pathActions = actionsAtPath(draft.actions, path) ?? []
                  const index = pathActions.findIndex((action) => action.nodeKey === nodeKey)
                  if (index < 0) return
                  const action = pathActions[index]
                  if (action?.type !== "GO_TO") return
                  setPendingAction(null)
                  setTriggerEditorDraft(null)
                  setPanelOriginalDraft(cloneDraft(draft))
                  setEditingAction({ ...structuredClone(action), goToConfig: { targetNodeKey: "" } })
                  setSelected({ kind: "action", nodeKey, path, index })
                  setGoToPicking(true)
                },
              }
            : {}),
        },
      }
    })
    return { nodes, edges: baseGraph.edges }
  }, [baseGraph, draft, goToDestinations, goToPicking, goToPreviewDraft.actions])
  useEffect(() => {
    if (!goToSourceKey) {
      setGoToPicking(false)
      return
    }
    const action = editingAction?.type === "GO_TO"
      ? editingAction
      : pendingAction?.type === "GO_TO"
        ? pendingAction
        : null
    setGoToPicking(!action?.goToConfig?.targetNodeKey)
  }, [editingAction, goToSourceKey, pendingAction])
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
  const selectedPathActions = selected?.kind === "action" || selected?.kind === "new-action"
    ? actionsAtPath(draft.actions, selected.path) ?? []
    : []
  const selectedStoredAction = selected?.kind === "action"
    ? selectedPathActions[selected.index] ?? null
    : null
  const actionPanelHasChanges = Boolean(
    selected?.kind === "action" &&
      editingAction &&
      (JSON.stringify(editingAction) !== JSON.stringify(selectedStoredAction) ||
        (panelOriginalDraft && draftSnapshot(panelOriginalDraft) !== draftSnapshot(draft))),
  )
  const hasUncommittedPanelChanges =
    triggerPanelHasChanges || actionPanelHasChanges || (selected?.kind === "new-action" && pendingAction !== null)
  const actionCount = flattenDraftActions(draft.actions).length
  const isRoutingAction = (action: AutomationAction | null | undefined) =>
    action?.type === "IF_ELSE" || action?.type === "SPLIT"
  const editingWillWrapFollowingActions = Boolean(
    selected?.kind === "action" &&
      isRoutingAction(editingAction) &&
      editingAction?.type !== selectedStoredAction?.type,
  )
  const editingFollowingActions = selected?.kind === "action" && editingWillWrapFollowingActions
    ? selectedPathActions.slice(selected.index + 1)
    : []
  const editingIfElseWrapIssue = selected?.kind === "action" && isRoutingAction(editingAction) && editingWillWrapFollowingActions
    ? ifElseWrapIssue({
        action: editingAction!,
        followingActions: editingFollowingActions,
        precedingPathActions: selectedPathActions.slice(0, selected.index),
        pathDepth: selected.path.length,
        currentActionCount: actionCount,
        replacesExistingAction: true,
      })
    : null
  const pendingFollowingActions = selected?.kind === "new-action"
    ? selectedPathActions.slice(selected.insertionIndex)
    : []
  const pendingIfElseWrapIssue = selected?.kind === "new-action" && isRoutingAction(pendingAction)
    ? ifElseWrapIssue({
        action: pendingAction!,
        followingActions: pendingFollowingActions,
        precedingPathActions: selectedPathActions.slice(0, selected.insertionIndex),
        pathDepth: selected.path.length,
        currentActionCount: actionCount,
        replacesExistingAction: false,
      })
    : null
  const activeGoToAction = editingAction?.type === "GO_TO"
    ? editingAction
    : pendingAction?.type === "GO_TO"
      ? pendingAction
      : null
  const activeGoToTarget = activeGoToAction?.goToConfig?.targetNodeKey ?? ""
  const goToPanelIssue = goToSourceKey
    ? activeGoToTarget
      ? automationGoToTargetIssue(goToPreviewDraft.actions, goToSourceKey, activeGoToTarget)
      : "Choose a destination for Go To."
    : null

  const selectGoToTarget = (targetNodeKey: string) => {
    if (!goToSourceKey) return
    const issue = automationGoToTargetIssue(goToPreviewDraft.actions, goToSourceKey, targetNodeKey)
    if (issue) {
      toast.error(issue)
      return
    }
    if (editingAction?.type === "GO_TO") {
      setEditingAction({ ...editingAction, goToConfig: { targetNodeKey } })
    } else if (pendingAction?.type === "GO_TO") {
      setPendingAction({ ...pendingAction, goToConfig: { targetNodeKey } })
    }
    setGoToPicking(false)
  }

  const updateAction = (path: AutomationGraphBranchPath, index: number, action: AutomationAction) => {
    setDraft((current) => mutateActionsAtPath(current, path, (actions) => {
      actions[index] = action
    }))
  }

  const insertAction = (path: AutomationGraphBranchPath, index: number, action: AutomationAction) => {
    setDraft((current) => mutateActionsAtPath(current, path, (actions) => {
      actions.splice(index, 0, action)
    }))
  }

  const wrapFollowingActionsWithRoutingAction = (
    path: AutomationGraphBranchPath,
    index: number,
    action: AutomationAction,
    replacesExistingAction: boolean,
  ) => {
    setDraft((current) => mutateActionsAtPath(current, path, (actions) => {
      const followingStart = replacesExistingAction ? index + 1 : index
      const followingActions = actions.splice(followingStart)
      const wrappedAction = wrapFollowingActionsInFirstBranch(action, followingActions)
      if (replacesExistingAction) actions[index] = wrappedAction
      else actions.splice(index, 0, wrappedAction)
    }))
  }

  const closePanel = () => {
    setSelected(null)
    setPendingAction(null)
    setEditingAction(null)
    setTriggerEditorDraft(null)
    setPanelOriginalDraft(null)
    setGoToPicking(false)
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

  const openActionPanel = (path: AutomationGraphBranchPath, index: number, nodeKey: string) => {
    const action = actionsAtPath(draft.actions, path)?.[index]
    if (!action) return
    setPendingAction(null)
    setTriggerEditorDraft(null)
    setPanelOriginalDraft(cloneDraft(draft))
    setEditingAction(structuredClone(action))
    setSelected({ kind: "action", nodeKey, path, index })
  }

  const openNewActionPanel = (path: AutomationGraphBranchPath, insertionIndex: number) => {
    setEditingAction(null)
    setTriggerEditorDraft(null)
    setPanelOriginalDraft(cloneDraft(draft))
    setPendingAction(null)
    setSelected({ kind: "new-action", path, insertionIndex })
  }

  const moveAction = (path: AutomationGraphBranchPath, index: number, direction: -1 | 1) => {
    const pathActions = actionsAtPath(draft.actions, path) ?? []
    const target = index + direction
    if (target < 0 || target >= pathActions.length) return
    const nextActions = [...pathActions]
    ;[nextActions[index], nextActions[target]] = [nextActions[target]!, nextActions[index]!]
    if (nextActions.some((action, actionIndex) =>
      (action.type === "DELETE_CONTACT" || action.type === "IF_ELSE" || action.type === "SPLIT" || action.type === "GO_TO") && actionIndex !== nextActions.length - 1
    )) return
    setDraft((current) => mutateActionsAtPath(current, path, (actions) => {
      ;[actions[index], actions[target]] = [actions[target]!, actions[index]!]
    }))
    setSelected((current) => current?.kind === "action" ? { ...current, index: target } : current)
  }

  const saveChanges = async () => {
    if (selected) {
      toast.error("Save or cancel the sidebar changes first.")
      return
    }
    if (!hasUnsavedChanges) return
    if (!catalog) return toast.error("The automation catalog is still loading.")
    const validationMessage = draftValidationMessage(draft, catalog)
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
      if (automationId) void loadWaitNodeCounts()
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
    <div className="flex h-[calc(100dvh-var(--tenant-shell-header-height))] max-h-[calc(100dvh-var(--tenant-shell-header-height))] min-h-0 flex-col gap-3 overflow-hidden bg-slate-50 p-3 md:p-4">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
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

      <div className="flex shrink-0 flex-wrap items-center gap-2 px-1">
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
        <section className="flex min-h-0 flex-1 gap-3 overflow-hidden">
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
            <ReactFlowProvider>
              <ReactFlow<CanvasNode, Edge>
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                onNodeClick={(_, node) => {
                  if (goToPicking && goToSourceKey) {
                    const targetNodeKey = node.data.actionNodeKey
                    if (targetNodeKey) selectGoToTarget(targetNodeKey)
                    return
                  }
                  if (node.data.kind === "trigger") {
                    openTriggerPanel()
                    return
                  }
                  if (
                    node.data.kind === "action" &&
                    node.data.actionNodeKey &&
                    node.data.actionPath &&
                    node.data.index !== undefined
                  ) {
                    openActionPanel(node.data.actionPath, node.data.index, node.data.actionNodeKey)
                    return
                  }
                  if (node.data.kind === "action" && node.data.actionNodeKey && node.data.actionPath) {
                    const pathActions = actionsAtPath(draft.actions, node.data.actionPath) ?? []
                    const index = pathActions.findIndex((action) => action.nodeKey === node.data.actionNodeKey)
                    if (index >= 0) openActionPanel(node.data.actionPath, index, node.data.actionNodeKey)
                    return
                  }
                  if (
                    node.data.kind === "add" &&
                    node.data.insertionIndex !== undefined &&
                    node.data.insertionPath
                  ) {
                    openNewActionPanel(node.data.insertionPath, node.data.insertionIndex)
                  }
                }}
              >
                <Controls position="bottom-left" />
                <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
              </ReactFlow>
            </ReactFlowProvider>
          </div>

          {selected ? (
            <aside className="flex h-full max-h-full min-h-0 w-full max-w-md shrink-0 flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white/95 shadow-sm backdrop-blur">
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2.5">
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
              <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable]">
                {selected.kind === "action" && editingAction ? (
                  <ActionEditor
                    action={editingAction}
                    catalog={catalog}
                    onChange={setEditingAction}
                    targetActions={selectedPathActions.slice(selected.index + 1)}
                    previousActions={[
                      ...ancestorActionsForPath(draft.actions, selected.path),
                      ...selectedPathActions.slice(0, selected.index),
                    ]}
                    actionIndex={selected.index}
                    timezone={timezone}
                    ifElseWrapIssue={editingIfElseWrapIssue}
                    goToDestinations={goToDestinations}
                    goToIssue={goToPanelIssue}
                    isPickingGoTo={goToPicking}
                    onPickGoToOnCanvas={() => setGoToPicking(true)}
                    sourceAutomationId={automationId}
                    management={{
                      index: selected.index,
                      total: selectedPathActions.length,
                      onMove: (direction) => moveAction(selected.path, selected.index, direction),
                      onDelete: () => {
                        const hasNestedActions = editingAction?.type === "IF_ELSE"
                          ? editingAction.ifElseConfig?.branches.some((branch) => branch.actions.length > 0)
                          : editingAction?.type === "SPLIT"
                            ? editingAction.splitConfig?.routes.some((route) => route.actions.length > 0)
                            : false
                        if (
                          hasNestedActions &&
                          !window.confirm(
                            editingAction?.type === "SPLIT"
                              ? "Delete this Split action and every action inside its routes?"
                              : "Delete this If/Else action and every action inside its branches?",
                          )
                        ) return
                        setDraft((current) => mutateActionsAtPath(current, selected.path, (actions) => {
                          actions.splice(selected.index, 1)
                        }))
                        closePanel()
                      },
                    }}
                  />
                ) : selected.kind === "new-action" ? (
                  <NewActionEditor
                    action={pendingAction}
                    catalog={catalog}
                    onChange={setPendingAction}
                    targetActions={selectedPathActions.slice(selected.insertionIndex)}
                    previousActions={[
                      ...ancestorActionsForPath(draft.actions, selected.path),
                      ...selectedPathActions.slice(0, selected.insertionIndex),
                    ]}
                    actionIndex={selected.insertionIndex}
                    timezone={timezone}
                    ifElseWrapIssue={pendingIfElseWrapIssue}
                    goToDestinations={goToDestinations}
                    goToIssue={goToPanelIssue}
                    isPickingGoTo={goToPicking}
                    onPickGoToOnCanvas={() => setGoToPicking(true)}
                    sourceAutomationId={automationId}
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
                  <div className="flex shrink-0 items-center justify-end gap-2 p-3">
                    <Button type="button" variant="outline" className={COMPACT_SECONDARY_BUTTON_CLASS} onClick={cancelPanelChanges}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className={COMPACT_PRIMARY_BUTTON_CLASS}
                      disabled={Boolean(editingAction?.type === "GO_TO" && goToPanelIssue) || !(editingAction?.type === "IF_ELSE"
                        ? !editingIfElseWrapIssue && isIfElseReady(
                            editingWillWrapFollowingActions
                              ? wrapFollowingActionsInFirstBranch(editingAction, editingFollowingActions)
                              : editingAction,
                            catalog,
                            [
                              ...ancestorActionsForPath(draft.actions, selected.path),
                              ...selectedPathActions.slice(0, selected.index),
                            ],
                            selected.path.length + 1,
                            false,
                          )
                        : editingAction?.type === "SPLIT"
                          ? !editingIfElseWrapIssue && isSplitReady(
                              editingWillWrapFollowingActions
                                ? wrapFollowingActionsInFirstBranch(editingAction, editingFollowingActions)
                                : editingAction,
                              catalog,
                              [
                                ...ancestorActionsForPath(draft.actions, selected.path),
                                ...selectedPathActions.slice(0, selected.index),
                              ],
                              selected.path.length + 1,
                            )
                        : isActionReady(
                            editingAction,
                            catalog,
                            selectedPathActions.slice(selected.index + 1),
                            [
                              ...ancestorActionsForPath(draft.actions, selected.path),
                              ...selectedPathActions.slice(0, selected.index),
                            ],
                          )) || !actionPanelHasChanges}
                      onClick={() => {
                        if (!editingAction) return
                        if (editingWillWrapFollowingActions) {
                          wrapFollowingActionsWithRoutingAction(selected.path, selected.index, editingAction, true)
                        } else {
                          updateAction(selected.path, selected.index, structuredClone(editingAction))
                        }
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
                  <div className="flex shrink-0 items-center justify-end gap-2 p-3">
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
                  <div className="flex shrink-0 items-center justify-end gap-2 p-3">
                    <Button type="button" variant="outline" className={COMPACT_SECONDARY_BUTTON_CLASS} onClick={cancelPanelChanges}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className={COMPACT_PRIMARY_BUTTON_CLASS}
                      disabled={actionCount >= MAX_AUTOMATION_ACTION_NODES || Boolean(pendingAction?.type === "GO_TO" && goToPanelIssue) || !(pendingAction?.type === "IF_ELSE"
                        ? !pendingIfElseWrapIssue && isIfElseReady(
                            wrapFollowingActionsInFirstBranch(pendingAction, pendingFollowingActions),
                            catalog,
                            [
                              ...ancestorActionsForPath(draft.actions, selected.path),
                              ...selectedPathActions.slice(0, selected.insertionIndex),
                            ],
                            selected.path.length + 1,
                            false,
                          )
                        : pendingAction?.type === "SPLIT"
                          ? !pendingIfElseWrapIssue && isSplitReady(
                              wrapFollowingActionsInFirstBranch(pendingAction, pendingFollowingActions),
                              catalog,
                              [
                                ...ancestorActionsForPath(draft.actions, selected.path),
                                ...selectedPathActions.slice(0, selected.insertionIndex),
                              ],
                              selected.path.length + 1,
                            )
                        : isActionReady(
                            pendingAction,
                            catalog,
                            selectedPathActions.slice(selected.insertionIndex),
                            [
                              ...ancestorActionsForPath(draft.actions, selected.path),
                              ...selectedPathActions.slice(0, selected.insertionIndex),
                            ],
                          ))}
                      onClick={() => {
                        if (!pendingAction) return
                        if (pendingAction.type === "IF_ELSE" || pendingAction.type === "SPLIT") {
                          wrapFollowingActionsWithRoutingAction(selected.path, selected.insertionIndex, pendingAction, false)
                        } else {
                          insertAction(selected.path, selected.insertionIndex, pendingAction)
                        }
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

      {automationId && waitingNodeKey ? (
        <AutomationWaitingRunsSheet
          key={waitingNodeKey}
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setWaitingNodeKey(null)
          }}
          tenantId={tenantId}
          automationId={automationId}
          nodeKey={waitingNodeKey}
          timezone={timezone}
          onCountChange={updateWaitNodeCount}
          onRefreshCounts={loadWaitNodeCounts}
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
      <section className="flex flex-col gap-3">
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

      <Separator />
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
  previousActions,
  actionIndex,
  timezone,
  ifElseWrapIssue,
  goToDestinations,
  goToIssue,
  isPickingGoTo,
  onPickGoToOnCanvas,
  sourceAutomationId,
}: {
  action: AutomationAction | null
  catalog: AutomationCatalog
  onChange: (action: AutomationAction | null) => void
  targetActions: AutomationAction[]
  previousActions: AutomationAction[]
  actionIndex: number
  timezone?: string | null
  ifElseWrapIssue?: string | null
  goToDestinations: ReturnType<typeof automationGoToDestinations>
  goToIssue?: string | null
  isPickingGoTo: boolean
  onPickGoToOnCanvas: () => void
  sourceAutomationId?: string
}) {
  if (action) {
    const definition = ACTION_DEFINITIONS[action.type]
    const groupStyle = ACTION_GROUP_STYLES[definition.group]
    return (
      <div className="flex flex-col gap-3">
        <div className={cn("flex items-center justify-between gap-3 rounded-xl border p-2.5", groupStyle.section)}>
          <div className="flex min-w-0 items-center gap-2.5">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", groupStyle.actionIcon)}>
              <ActionTypeIcon type={action.type} className="size-4.5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-slate-500">Action</p>
              <p className="truncate text-sm font-semibold text-slate-950">{definition.label}</p>
              <p className="text-xs leading-4 text-slate-500">
                {definition.description}
              </p>
            </div>
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
          previousActions={previousActions}
          actionIndex={actionIndex}
          timezone={timezone}
          ifElseWrapIssue={ifElseWrapIssue}
          goToDestinations={goToDestinations}
          goToIssue={goToIssue}
          isPickingGoTo={isPickingGoTo}
          onPickGoToOnCanvas={onPickGoToOnCanvas}
          sourceAutomationId={sourceAutomationId}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-slate-950">Choose an action</p>
        <p className="text-xs leading-4 text-slate-500">Select what you want to add between workflow steps.</p>
      </div>
      <div className="flex flex-col gap-3">
        {ACTION_GROUPS.map((group) => {
          const actions = actionsForGroup(group.id)
          if (actions.length === 0) return null
          const GroupIcon = group.icon
          const groupStyle = ACTION_GROUP_STYLES[group.id]
          return (
            <section
              key={group.id}
              className={cn("flex flex-col gap-2 rounded-xl border p-3", groupStyle.section)}
            >
              <div className="flex items-start gap-2.5">
                <span className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg ring-1",
                  groupStyle.icon,
                )}>
                  <GroupIcon aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800">{group.label}</p>
                  <p className="text-xs leading-4 text-slate-500">{group.description}</p>
                </div>
              </div>
              <Separator />
              <div className="flex flex-col gap-2">
                {actions.map(([value, definition]) => (
                  <Button
                    key={value}
                    type="button"
                    variant="outline"
                    className={cn(
                      "h-auto w-full cursor-pointer items-start justify-start gap-3 whitespace-normal rounded-lg border-slate-200 bg-white px-3 py-2.5 text-left shadow-none transition disabled:cursor-not-allowed disabled:bg-slate-100",
                      groupStyle.actionHover,
                    )}
                    disabled={
                      (value === "UPDATE_CONTACT_CUSTOM_FIELDS" &&
                        catalog.contactUpdateFields.length === 0 &&
                        catalog.customFields.length === 0) ||
                      ((value === "DELETE_CONTACT" || value === "GO_TO") && targetActions.length > 0)
                    }
                    onClick={() => onChange(actionDefaults(value, catalog, undefined, sourceAutomationId))}
                  >
                    <span className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      groupStyle.actionIcon,
                    )}>
                      <ActionTypeIcon type={value} className="size-4" />
                    </span>
                    <span className="min-w-0 text-left">
                      <span className="block text-sm font-medium text-slate-900">{definition.label}</span>
                      <span className="mt-0.5 block text-xs font-normal leading-4 text-slate-500">
                        {definition.description}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </section>
          )
        })}
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
  previousActions = [],
  actionIndex = 0,
  timezone,
  ifElseWrapIssue,
  goToDestinations = [],
  goToIssue,
  isPickingGoTo = false,
  onPickGoToOnCanvas,
  sourceAutomationId,
}: {
  action: AutomationAction
  catalog: AutomationCatalog
  onChange: (action: AutomationAction) => void
  showTypePicker?: boolean
  targetActions?: AutomationAction[]
  previousActions?: AutomationAction[]
  actionIndex?: number
  timezone?: string | null
  ifElseWrapIssue?: string | null
  goToDestinations?: ReturnType<typeof automationGoToDestinations>
  goToIssue?: string | null
  isPickingGoTo?: boolean
  onPickGoToOnCanvas?: () => void
  sourceAutomationId?: string
  management?: {
    index: number
    total: number
    onMove: (direction: -1 | 1) => void
    onDelete: () => void
  }
}) {
  const availableAutomationOutputs = formatterOutputs(previousActions)
  const noteTitleError = action.type === "ADD_CONTACT_NOTE"
    ? noteTemplateError(action.noteTitle, 160, catalog, availableAutomationOutputs)
    : null
  const noteBodyError = action.type === "ADD_CONTACT_NOTE"
    ? noteTemplateError(action.noteBody, 5_000, catalog, availableAutomationOutputs)
    : null

  return (
    <div className="flex flex-col gap-4">
      <FieldGroup className="gap-3">
        {showTypePicker ? (
          <Field>
            <FieldLabel htmlFor="action-type">Action type</FieldLabel>
            <Select
              value={action.type}
              onValueChange={(type: AutomationAction["type"]) => onChange(actionDefaults(type, catalog, action.nodeKey, sourceAutomationId))}
            >
              <SelectTrigger id="action-type" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACTION_GROUPS.map((group) => {
                  const actions = actionsForGroup(group.id)
                  if (actions.length === 0) return null
                  return (
                    <SelectGroup key={group.id}>
                      <SelectLabel className="font-semibold">{group.label}</SelectLabel>
                      {actions.map(([value, definition]) => (
                        <SelectItem
                          key={value}
                          value={value}
                          disabled={(value === "DELETE_CONTACT" || value === "GO_TO") && targetActions.length > 0}
                        >
                          <span className="flex items-center gap-2">
                            <span className={cn(
                              "flex size-6 shrink-0 items-center justify-center rounded-md",
                              ACTION_GROUP_STYLES[group.id].actionIcon,
                            )}>
                              <ActionTypeIcon type={value} className="size-3.5" />
                            </span>
                            {definition.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )
                })}
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        {action.type === "CREATE_CONTACT" && action.createContactConfig ? (
          <CreateContactActionEditor
            actionKey={action.nodeKey ?? "create-contact"}
            config={action.createContactConfig}
            catalog={catalog}
            timezone={timezone}
            automationOutputs={availableAutomationOutputs}
            onChange={(createContactConfig) => onChange({ ...action, createContactConfig })}
          />
        ) : null}

        {action.type === "UPDATE_CONTACT_CUSTOM_FIELDS" ? (
          <ContactFieldUpdatesEditor action={action} catalog={catalog} onChange={onChange} />
        ) : null}

        {action.type === "UPDATE_OPPORTUNITY" && action.opportunityConfig ? (
          <UpdateOpportunityActionEditor
            config={action.opportunityConfig}
            catalog={catalog}
            onChange={(opportunityConfig) => onChange({ ...action, opportunityConfig })}
          />
        ) : null}

        {action.type === "DELETE_OPPORTUNITY" && action.deleteOpportunityConfig ? (
          <DeleteOpportunityActionEditor
            config={action.deleteOpportunityConfig}
            catalog={catalog}
            onChange={(deleteOpportunityConfig) => onChange({ ...action, deleteOpportunityConfig })}
          />
        ) : null}

        {action.type === "ADD_TO_WORKFLOW" && action.addToWorkflowConfig ? (
          <AddToWorkflowActionEditor
            config={action.addToWorkflowConfig}
            catalog={catalog}
            sourceAutomationId={sourceAutomationId}
            onChange={(addToWorkflowConfig) => onChange({ ...action, addToWorkflowConfig })}
          />
        ) : null}

        {action.type === "REMOVE_FROM_WORKFLOW" && action.removeFromWorkflowConfig ? (
          <RemoveFromWorkflowActionEditor
            config={action.removeFromWorkflowConfig}
            catalog={catalog}
            sourceAutomationId={sourceAutomationId}
            onChange={(removeFromWorkflowConfig) => onChange({ ...action, removeFromWorkflowConfig })}
          />
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

        {action.type === "ADD_CONTACT_NOTE" ? (
          <>
            <ContactTemplateInput
              id="action-note-title"
              label="Title"
              value={action.noteTitle ?? ""}
              maxLength={160}
              catalog={catalog}
              timezone={timezone}
              automationOutputs={availableAutomationOutputs}
              error={noteTitleError}
              onChange={(noteTitle) => onChange({ ...action, noteTitle })}
              placeholder="Note title"
            />
            <ContactTemplateInput
              id="action-note-body"
              label="Note"
              value={action.noteBody ?? ""}
              maxLength={5000}
              catalog={catalog}
              timezone={timezone}
              automationOutputs={availableAutomationOutputs}
              error={noteBodyError}
              onChange={(noteBody) => onChange({ ...action, noteBody })}
              multiline
              placeholder="Write the note"
            />
          </>
        ) : null}

        {action.type === "CREATE_TASK" && action.taskConfig ? (
          <TaskActionEditor
            config={action.taskConfig}
            catalog={catalog}
            timezone={timezone}
            automationOutputs={availableAutomationOutputs}
            onChange={(taskConfig) => onChange({ ...action, taskConfig })}
          />
        ) : null}

        {action.type === "SEND_INTERNAL_NOTIFICATION" && action.internalNotificationConfig ? (
          <InternalNotificationActionEditor
            actionKey={action.nodeKey ?? "internal-notification"}
            config={action.internalNotificationConfig}
            catalog={catalog}
            timezone={timezone}
            automationOutputs={availableAutomationOutputs}
            onChange={(internalNotificationConfig) => onChange({
              ...action,
              internalNotificationConfig,
            })}
          />
        ) : null}

        {action.type === "FORMAT_DATE_TIME" && action.dateTimeFormatterConfig ? (
          <DateTimeFormatterActionEditor
            config={action.dateTimeFormatterConfig}
            catalog={catalog}
            timezone={timezone}
            automationOutputs={availableAutomationOutputs}
            onChange={(dateTimeFormatterConfig) => onChange({ ...action, dateTimeFormatterConfig })}
          />
        ) : null}

        {action.type === "FORMAT_NUMBER" && action.numberFormatterConfig ? (
          <NumberFormatterActionEditor
            config={action.numberFormatterConfig}
            catalog={catalog}
            automationOutputs={availableAutomationOutputs}
            onChange={(numberFormatterConfig) => onChange({ ...action, numberFormatterConfig })}
          />
        ) : null}

        {action.type === "FORMAT_TEXT" && action.textFormatterConfig ? (
          <TextFormatterActionEditor
            actionKey={action.nodeKey ?? "text-formatter"}
            config={action.textFormatterConfig}
            catalog={catalog}
            automationOutputs={availableAutomationOutputs}
            onChange={(textFormatterConfig) => onChange({ ...action, textFormatterConfig })}
          />
        ) : null}

        {action.type === "MATH_OPERATION" && action.mathOperationConfig ? (
          <MathOperationActionEditor
            actionKey={action.nodeKey ?? "math-operation"}
            config={action.mathOperationConfig}
            catalog={catalog}
            automationOutputs={availableAutomationOutputs}
            onChange={(mathOperationConfig) => onChange({ ...action, mathOperationConfig })}
          />
        ) : null}

        {action.type === "IF_ELSE" && action.ifElseConfig ? (
          <>
            {targetActions.length > 0 || ifElseWrapIssue ? (
              <div className={cn(
                "rounded-xl border px-3 py-2.5 text-xs leading-5",
                ifElseWrapIssue
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-sky-200 bg-sky-50 text-sky-900",
              )}>
                {ifElseWrapIssue ?? `${targetActions.length} following action${targetActions.length === 1 ? "" : "s"} will move to Branch 1.`}
              </div>
            ) : null}
            <IfElseActionEditor
              action={action}
              catalog={catalog}
              automationOutputs={availableAutomationOutputs}
              timezone={timezone}
              onChange={onChange}
            />
          </>
        ) : null}

        {action.type === "SPLIT" && action.splitConfig ? (
          <>
            {targetActions.length > 0 || ifElseWrapIssue ? (
              <div className={cn(
                "rounded-xl border px-3 py-2.5 text-xs leading-5",
                ifElseWrapIssue
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : "border-sky-200 bg-sky-50 text-sky-900",
              )}>
                {ifElseWrapIssue ?? `${targetActions.length} following action${targetActions.length === 1 ? "" : "s"} will move to Route 1.`}
              </div>
            ) : null}
            <SplitActionEditor action={action} onChange={onChange} />
          </>
        ) : null}

        {action.type === "GO_TO" && action.goToConfig ? (
          <GoToActionEditor
            config={action.goToConfig}
            destinations={goToDestinations}
            issue={goToIssue}
            isPickingOnCanvas={isPickingGoTo}
            onChange={(goToConfig) => onChange({ ...action, goToConfig })}
            onPickOnCanvas={() => onPickGoToOnCanvas?.()}
          />
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

        {action.type === "DELETE_CONTACT" ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-sm leading-5 text-rose-800">
            This action can only be the last step of the workflow. The contact will be removed from all workflows and permanently deleted from this account.
          </div>
        ) : null}
      </FieldGroup>

      {management ? (
        <>
          <Separator />
          <div className="flex gap-2">
            <Button type="button" size="icon" variant="outline" disabled={management.index === 0 || ["DELETE_CONTACT", "IF_ELSE", "SPLIT", "GO_TO"].includes(action.type)} onClick={() => management.onMove(-1)} aria-label="Move action up">
              <ArrowUp data-icon="inline-start" />
            </Button>
            <Button type="button" size="icon" variant="outline" disabled={management.index === management.total - 1 || ["DELETE_CONTACT", "IF_ELSE", "SPLIT", "GO_TO"].includes(targetActions[0]?.type ?? "")} onClick={() => management.onMove(1)} aria-label="Move action down">
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

function UpdateOpportunityActionEditor({
  config,
  catalog,
  onChange,
}: {
  config: NonNullable<AutomationAction["opportunityConfig"]>
  catalog: AutomationCatalog
  onChange: (config: NonNullable<AutomationAction["opportunityConfig"]>) => void
}) {
  const [valueDraft, setValueDraft] = useState(
    config.valueCents === null ? "" : (config.valueCents / 100).toFixed(2),
  )

  const pipeline = catalog.pipelines.find((candidate) => candidate.id === config.pipelineId)
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
        <div className="mb-3">
          <p className="text-sm font-semibold text-slate-950">Opportunity</p>
          <p className="text-xs leading-4 text-slate-600">Choose the pipeline, stage, value, and outcome.</p>
        </div>
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor="opportunity-action-name">Action name</FieldLabel>
            <Input
              id="opportunity-action-name"
              value={config.actionName}
              maxLength={120}
              onChange={(event) => onChange({ ...config, actionName: event.target.value })}
              placeholder="Update/create opportunity"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="opportunity-action-pipeline">Pipeline</FieldLabel>
            <Select
              value={config.pipelineId}
              onValueChange={(pipelineId) => {
                const selectedPipeline = catalog.pipelines.find((candidate) => candidate.id === pipelineId)
                onChange({
                  ...config,
                  pipelineId,
                  pipelineNameSnapshot: selectedPipeline?.name ?? "",
                  stageId: "",
                  stageNameSnapshot: "",
                })
              }}
            >
              <SelectTrigger id="opportunity-action-pipeline" className={COMPACT_SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder="Select pipeline" />
              </SelectTrigger>
              <SelectContent>
                {catalog.pipelines.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="opportunity-action-stage">Stage</FieldLabel>
            <Select
              value={config.stageId}
              disabled={!pipeline}
              onValueChange={(stageId) => {
                const stage = pipeline?.stages.find((candidate) => candidate.id === stageId)
                onChange({ ...config, stageId, stageNameSnapshot: stage?.name ?? "" })
              }}
            >
              <SelectTrigger id="opportunity-action-stage" className={COMPACT_SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder="Select stage" />
              </SelectTrigger>
              <SelectContent>
                {pipeline?.stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
        <p className="mb-3 text-sm font-semibold text-slate-950">Value and outcome</p>
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor="opportunity-action-result">Outcome</FieldLabel>
            <Select
              value={config.resultMode}
              onValueChange={(resultMode: NonNullable<AutomationAction["opportunityConfig"]>["resultMode"]) =>
                onChange({ ...config, resultMode })
              }
            >
              <SelectTrigger id="opportunity-action-result" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="KEEP_CURRENT">Keep current</SelectItem>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="WON">Won</SelectItem>
                <SelectItem value="LOST">Lost</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="opportunity-action-value">Opportunity value</FieldLabel>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">$</span>
              <Input
                id="opportunity-action-value"
                inputMode="decimal"
                className="pl-7"
                value={valueDraft}
                placeholder="0.00"
                onChange={(event) => {
                  const next = event.target.value
                  if (!/^\d*(?:\.\d{0,2})?$/.test(next)) return
                  setValueDraft(next)
                  if (!next || next === ".") {
                    onChange({ ...config, valueCents: null })
                    return
                  }
                  const cents = Math.round(Number(next) * 100)
                  onChange({
                    ...config,
                    valueCents: Number.isSafeInteger(cents) && cents <= 2_147_483_647 ? cents : null,
                  })
                }}
              />
            </div>
          </Field>
        </FieldGroup>
      </section>
    </div>
  )
}

function DeleteOpportunityActionEditor({
  config,
  catalog,
  onChange,
}: {
  config: NonNullable<AutomationAction["deleteOpportunityConfig"]>
  catalog: AutomationCatalog
  onChange: (config: NonNullable<AutomationAction["deleteOpportunityConfig"]>) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
        <div className="mb-3">
          <p className="text-sm font-semibold text-slate-950">Opportunity</p>
          <p className="text-xs leading-4 text-slate-600">Choose the pipeline to remove the opportunity from.</p>
        </div>
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor="delete-opportunity-action-name">Action name</FieldLabel>
            <Input
              id="delete-opportunity-action-name"
              value={config.actionName}
              maxLength={120}
              onChange={(event) => onChange({ ...config, actionName: event.target.value })}
              placeholder="Delete opportunity"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="delete-opportunity-action-pipeline">Pipeline</FieldLabel>
            <Select
              value={config.pipelineId}
              onValueChange={(pipelineId) => {
                const pipeline = catalog.pipelines.find((candidate) => candidate.id === pipelineId)
                onChange({
                  ...config,
                  pipelineId,
                  pipelineNameSnapshot: pipeline?.name ?? "",
                })
              }}
            >
              <SelectTrigger id="delete-opportunity-action-pipeline" className={COMPACT_SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder="Select pipeline" />
              </SelectTrigger>
              <SelectContent>
                {catalog.pipelines.map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      </section>

      <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs leading-5 text-rose-800">
        This removes only the opportunity in the selected pipeline. The contact, other opportunities, and automation history remain available.
      </div>
    </div>
  )
}

function defaultBranchCondition(catalog: AutomationCatalog): AutomationBranchCondition {
  const contactField = catalog.templateFields.contact.find((field) => field.key === "name") ?? catalog.templateFields.contact[0]
  return {
    conditionKey: crypto.randomUUID(),
    source: "CONTACT_FIELD",
    fieldKey: contactField?.key ?? "name",
    operator: "EQUALS",
    compareValue: "",
  }
}

function branchConditionOperators(
  condition: AutomationBranchCondition,
  catalog: AutomationCatalog,
  automationOutputs: AutomationValueDefinition[],
) {
  if (condition.source === "CONTACT_STATUS" || condition.source === "CONTACT_ASSIGNEE") return STATUS_OPERATORS
  if (condition.source === "CONTACT_TAGS") return ["INCLUDES_ANY", "INCLUDES_ALL", "EXCLUDES_ALL", "IS_EMPTY", "IS_NOT_EMPTY"] as AutomationOperator[]
  if (condition.source === "CURRENT_DATE_TIME") return [...NUMERIC_OPERATORS, "IS_EMPTY", "IS_NOT_EMPTY"] as AutomationOperator[]
  if (condition.source === "OPPORTUNITY_FIELD") {
    return condition.field === "VALUE"
      ? [...NUMERIC_OPERATORS, "IS_EMPTY", "IS_NOT_EMPTY"] as AutomationOperator[]
      : [...STATUS_OPERATORS]
  }
  const fieldType = condition.source === "CONTACT_FIELD"
    ? catalog.templateFields.contact.find((field) => field.key === condition.fieldKey)?.fieldType
    : condition.source === "CONTACT_CUSTOM_FIELD"
      ? catalog.customFields.find((field) => field.id === condition.customFieldId)?.fieldType
      : automationOutputs.find((output) => output.key === condition.key)?.valueKind
  if (fieldType === "NUMBER" || fieldType === "CURRENCY" || fieldType === "DATE") {
    return [...NUMERIC_OPERATORS, "IS_EMPTY", "IS_NOT_EMPTY"] as AutomationOperator[]
  }
  if (fieldType === "CHECKBOX") return ["IS_TRUE", "IS_FALSE", "IS_EMPTY", "IS_NOT_EMPTY"] as AutomationOperator[]
  if (fieldType === "MULTI_SELECT") return ["INCLUDES_ANY", "INCLUDES_ALL", "EXCLUDES_ALL", "IS_EMPTY", "IS_NOT_EMPTY"] as AutomationOperator[]
  return ["EQUALS", "NOT_EQUALS", "CONTAINS", "NOT_CONTAINS", "IS_EMPTY", "IS_NOT_EMPTY"] as AutomationOperator[]
}

function defaultBranchOperator(fieldType: string | undefined): AutomationOperator {
  if (fieldType === "CHECKBOX") return "IS_TRUE"
  if (fieldType === "MULTI_SELECT") return "INCLUDES_ANY"
  return "EQUALS"
}

function SortableBranchCard({
  branch,
  children,
}: {
  branch: AutomationIfElseBranch
  children: React.ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: branch.branchKey ?? branch.name })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("rounded-xl border border-slate-200 bg-white p-3 shadow-sm", isDragging && "z-20 opacity-70 shadow-lg")}
    >
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          className="cursor-grab touch-none rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing"
          aria-label={`Move ${branch.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="text-xs font-semibold text-slate-600">Condition branch</span>
      </div>
      {children}
    </div>
  )
}

function IfElseActionEditor({
  action,
  catalog,
  automationOutputs,
  timezone,
  onChange,
}: {
  action: AutomationAction
  catalog: AutomationCatalog
  automationOutputs: AutomationValueDefinition[]
  timezone?: string | null
  onChange: (action: AutomationAction) => void
}) {
  const config = action.ifElseConfig!
  const conditionBranches = config.branches.filter((branch) => !branch.isDefault)
  const defaultBranch = config.branches.find((branch) => branch.isDefault)!
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const updateBranches = (branches: AutomationIfElseBranch[]) => onChange({
    ...action,
    ifElseConfig: { ...config, branches: [...branches, defaultBranch] },
  })
  const updateBranch = (branchKey: string | undefined, patch: Partial<AutomationIfElseBranch>) => {
    updateBranches(conditionBranches.map((branch) => branch.branchKey === branchKey ? { ...branch, ...patch } : branch))
  }
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = conditionBranches.findIndex((branch) => branch.branchKey === active.id)
    const newIndex = conditionBranches.findIndex((branch) => branch.branchKey === over.id)
    if (oldIndex >= 0 && newIndex >= 0) updateBranches(arrayMove(conditionBranches, oldIndex, newIndex))
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
        <Field className="gap-1.5">
          <FieldLabel htmlFor={`if-name-${action.nodeKey}`}>Action name</FieldLabel>
          <Input
            id={`if-name-${action.nodeKey}`}
            value={config.actionName}
            maxLength={120}
            onChange={(event) => onChange({ ...action, ifElseConfig: { ...config, actionName: event.target.value } })}
            placeholder="If/Else"
          />
          <p className="text-xs leading-4 text-slate-500">The first matching branch runs. If none match, the contact exits through Default.</p>
        </Field>
      </section>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={conditionBranches.map((branch) => branch.branchKey ?? branch.name)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-3">
            {conditionBranches.map((branch, branchIndex) => (
              <SortableBranchCard key={branch.branchKey} branch={branch}>
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <Input
                      aria-label={`Branch ${branchIndex + 1} name`}
                      value={branch.name}
                      maxLength={120}
                      onChange={(event) => updateBranch(branch.branchKey, { name: event.target.value })}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="text-rose-600"
                      aria-label={`Delete ${branch.name}`}
                      onClick={() => {
                        if (conditionBranches.length === 1) return
                        if (branch.actions.length > 0 && !window.confirm(`Delete “${branch.name}” and all actions inside it?`)) return
                        updateBranches(conditionBranches.filter((candidate) => candidate.branchKey !== branch.branchKey))
                      }}
                      disabled={conditionBranches.length === 1}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Field className="gap-1.5">
                    <FieldLabel>Match</FieldLabel>
                    <Select value={branch.matchMode} onValueChange={(matchMode: "ALL" | "ANY") => updateBranch(branch.branchKey, { matchMode })}>
                      <SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All conditions (AND)</SelectItem>
                        <SelectItem value="ANY">Any condition (OR)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="flex flex-col gap-2">
                    {branch.conditions.map((condition, conditionIndex) => (
                      <BranchConditionEditor
                        key={condition.conditionKey}
                        condition={condition}
                        index={conditionIndex}
                        catalog={catalog}
                        automationOutputs={automationOutputs}
                        timezone={timezone}
                        onChange={(nextCondition) => updateBranch(branch.branchKey, {
                          conditions: branch.conditions.map((item, index) => index === conditionIndex ? nextCondition : item),
                        })}
                        onDelete={() => updateBranch(branch.branchKey, {
                          conditions: branch.conditions.filter((_, index) => index !== conditionIndex),
                        })}
                      />
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(COMPACT_SECONDARY_BUTTON_CLASS, "w-full")}
                      disabled={branch.conditions.length >= 20}
                      onClick={() => updateBranch(branch.branchKey, {
                        conditions: [...branch.conditions, defaultBranchCondition(catalog)],
                      })}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add condition
                    </Button>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
                    {branch.actions.length} {branch.actions.length === 1 ? "action" : "actions"} in this branch. Add and edit them on the canvas.
                  </div>
                </div>
              </SortableBranchCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button
        type="button"
        variant="outline"
        className={cn(COMPACT_SECONDARY_BUTTON_CLASS, "w-full")}
        disabled={config.branches.length >= 20}
        onClick={() => updateBranches([
          ...conditionBranches,
          {
            branchKey: crypto.randomUUID(),
            name: `Branch ${conditionBranches.length + 1}`,
            isDefault: false,
            matchMode: "ALL",
            conditions: [defaultBranchCondition(catalog)],
            actions: [],
          },
        ])}
      >
        <Plus className="h-3.5 w-3.5" /> Add branch
      </Button>

      <section className="rounded-xl border border-slate-200 bg-slate-100/80 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline" className="rounded-full border-slate-300 bg-white text-[10px] font-semibold text-slate-600">Default</Badge>
          <p className="text-xs text-slate-500">Always last · no actions</p>
        </div>
        <Input
          aria-label="Default branch name"
          value={defaultBranch.name}
          maxLength={120}
          onChange={(event) => onChange({
            ...action,
            ifElseConfig: {
              ...config,
              branches: [...conditionBranches, { ...defaultBranch, name: event.target.value }],
            },
          })}
        />
      </section>
    </div>
  )
}

function SortableSplitRouteCard({
  route,
  children,
}: {
  route: AutomationSplitRoute
  children: React.ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: route.branchKey })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-3 shadow-sm",
        isDragging && "z-20 opacity-70 shadow-lg",
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          className="cursor-grab touch-none rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing"
          aria-label={`Move ${route.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="text-xs font-semibold text-slate-600">Random route</span>
      </div>
      {children}
    </div>
  )
}

function SplitPercentageInput({
  route,
  onChange,
}: {
  route: AutomationSplitRoute
  onChange: (percentage: number) => void
}) {
  const [draft, setDraft] = useState(route.percentage > 0 ? String(route.percentage) : "")

  return (
    <Input
      aria-label={`${route.name} percentage`}
      inputMode="numeric"
      className="pr-8"
      value={draft}
      placeholder="Percentage"
      onChange={(event) => {
        const next = event.target.value
        if (next !== "" && !/^\d{1,3}$/.test(next)) return
        setDraft(next)
        onChange(next === "" ? 0 : Number(next))
      }}
    />
  )
}

function SplitActionEditor({
  action,
  onChange,
}: {
  action: AutomationAction
  onChange: (action: AutomationAction) => void
}) {
  const config = action.splitConfig!
  const total = config.routes.reduce((sum, route) => sum + route.percentage, 0)
  const normalizedRouteNames = config.routes.map((route) => route.name.trim().toLocaleLowerCase())
  const hasEmptyRouteName = normalizedRouteNames.some((name) => !name)
  const hasDuplicateRouteNames = new Set(normalizedRouteNames).size !== normalizedRouteNames.length
  const hasInvalidPercentage = config.routes.some(
    (route) => !Number.isInteger(route.percentage) || route.percentage < 1 || route.percentage > 99,
  )
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const updateRoutes = (routes: AutomationSplitRoute[]) => onChange({
    ...action,
    splitConfig: { ...config, routes },
  })
  const updateRoute = (branchKey: string, patch: Partial<AutomationSplitRoute>) => {
    updateRoutes(config.routes.map((route) => route.branchKey === branchKey ? { ...route, ...patch } : route))
  }
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const oldIndex = config.routes.findIndex((route) => route.branchKey === active.id)
    const newIndex = config.routes.findIndex((route) => route.branchKey === over.id)
    if (oldIndex >= 0 && newIndex >= 0) updateRoutes(arrayMove(config.routes, oldIndex, newIndex))
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
        <Field className="gap-1.5">
          <FieldLabel htmlFor={`split-name-${action.nodeKey}`}>Action name</FieldLabel>
          <Input
            id={`split-name-${action.nodeKey}`}
            value={config.actionName}
            maxLength={120}
            onChange={(event) => onChange({
              ...action,
              splitConfig: { ...config, actionName: event.target.value },
            })}
            placeholder="Split"
          />
          <p className="text-xs leading-4 text-slate-500">
            Each run follows one route based on the percentages below.
          </p>
        </Field>
      </section>

      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
        <span className="text-xs font-medium text-slate-600">Route distribution</span>
        <Badge
          variant="outline"
          className={cn(
            "rounded-full font-semibold",
            total === 100
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-800",
          )}
        >
          Total: {total}%
        </Badge>
      </div>
      {hasEmptyRouteName || hasDuplicateRouteNames || hasInvalidPercentage ? (
        <p className="text-xs leading-4 text-amber-700">
          {hasEmptyRouteName
            ? "Every route needs a name."
            : hasDuplicateRouteNames
              ? "Route names must be unique."
              : "Each route percentage must be a whole number from 1 to 99."}
        </p>
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={config.routes.map((route) => route.branchKey)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-3">
            {config.routes.map((route, routeIndex) => (
              <SortableSplitRouteCard key={route.branchKey} route={route}>
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] gap-2">
                    <Input
                      aria-label={`Route ${routeIndex + 1} name`}
                      value={route.name}
                      maxLength={120}
                      onChange={(event) => updateRoute(route.branchKey, { name: event.target.value })}
                    />
                    <div className="relative">
                      <SplitPercentageInput
                        route={route}
                        onChange={(percentage) => updateRoute(route.branchKey, { percentage })}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-400">%</span>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="text-rose-600"
                      aria-label={`Delete ${route.name}`}
                      disabled={config.routes.length <= 2}
                      onClick={() => {
                        if (route.actions.length > 0 && !window.confirm(`Delete “${route.name}” and all actions inside it?`)) return
                        updateRoutes(config.routes.filter((candidate) => candidate.branchKey !== route.branchKey))
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
                    {route.actions.length === 0
                      ? "Control route with no actions. Add actions from the canvas when needed."
                      : `${route.actions.length} ${route.actions.length === 1 ? "action" : "actions"} in this route. Add and edit them on the canvas.`}
                  </div>
                </div>
              </SortableSplitRouteCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button
        type="button"
        variant="outline"
        className={cn(COMPACT_SECONDARY_BUTTON_CLASS, "w-full")}
        disabled={config.routes.length >= 20}
        onClick={() => {
          const existingNames = new Set(config.routes.map((route) => route.name.trim().toLocaleLowerCase()))
          let routeNumber = config.routes.length + 1
          while (existingNames.has(`route ${routeNumber}`)) routeNumber += 1
          updateRoutes([
            ...config.routes,
            {
              branchKey: crypto.randomUUID(),
              name: `Route ${routeNumber}`,
              percentage: 0,
              actions: [],
            },
          ])
        }}
      >
        <Plus className="h-3.5 w-3.5" /> Add route
      </Button>
    </div>
  )
}

function BranchConditionEditor({
  condition,
  index,
  catalog,
  automationOutputs,
  timezone,
  onChange,
  onDelete,
}: {
  condition: AutomationBranchCondition
  index: number
  catalog: AutomationCatalog
  automationOutputs: AutomationValueDefinition[]
  timezone?: string | null
  onChange: (condition: AutomationBranchCondition) => void
  onDelete: () => void
}) {
  const operators = branchConditionOperators(condition, catalog, automationOutputs)
  const updateSource = (sourceValue: string) => {
    if (sourceValue.startsWith("OPPORTUNITY_")) {
      onChange({
        conditionKey: condition.conditionKey,
        source: "OPPORTUNITY_FIELD",
        field: sourceValue.replace("OPPORTUNITY_", "") as AutomationBranchCondition["field"],
        operator: sourceValue === "OPPORTUNITY_VALUE" ? "GREATER_THAN_OR_EQUAL" : "EQUALS",
        compareValue: sourceValue === "OPPORTUNITY_VALUE" ? 0 : "",
      })
      return
    }
    const source = sourceValue as AutomationBranchCondition["source"]
    const base = { conditionKey: condition.conditionKey, source, operator: "EQUALS" as AutomationOperator, compareValue: "" }
    if (source === "CONTACT_FIELD") onChange({ ...base, fieldKey: catalog.templateFields.contact[0]?.key ?? "name" })
    else if (source === "CONTACT_CUSTOM_FIELD") {
      const field = catalog.customFields[0]
      onChange({
        ...base,
        customFieldId: field?.id ?? "",
        operator: defaultBranchOperator(field?.fieldType),
        compareValue: field?.fieldType === "CHECKBOX" ? null : field?.fieldType === "MULTI_SELECT" ? [] : "",
      })
    }
    else if (source === "CONTACT_STATUS") onChange({ ...base, statusConfigId: catalog.statuses[0]?.id ?? null })
    else if (source === "CONTACT_ASSIGNEE") onChange({ ...base, assignedUserId: catalog.users[0]?.id ?? null })
    else if (source === "CONTACT_TAGS") onChange({ ...base, operator: "INCLUDES_ANY", tagId: catalog.tags[0]?.id ?? null })
    else if (source === "AUTOMATION_VALUE") onChange({ ...base, key: automationOutputs[0]?.key ?? "" })
    else onChange({ ...base, operator: "EQUALS", compareValue: new Date().toISOString() })
  }
  const sourceValue = condition.source === "OPPORTUNITY_FIELD"
    ? `OPPORTUNITY_${condition.field ?? "VALUE"}`
    : condition.source

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">Condition {index + 1}</span>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-rose-600" onClick={onDelete} aria-label={`Delete condition ${index + 1}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <Select value={sourceValue} onValueChange={updateSource}>
          <SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="CONTACT_FIELD">Contact field</SelectItem>
            <SelectItem value="CONTACT_CUSTOM_FIELD" disabled={catalog.customFields.length === 0}>Custom field</SelectItem>
            <SelectItem value="CONTACT_STATUS">Contact status</SelectItem>
            <SelectItem value="CONTACT_ASSIGNEE">Contact assignee</SelectItem>
            <SelectItem value="CONTACT_TAGS">Contact tags</SelectItem>
            <SelectItem value="AUTOMATION_VALUE" disabled={automationOutputs.length === 0}>Automation value</SelectItem>
            <SelectItem value="CURRENT_DATE_TIME">Current date/time</SelectItem>
            <SelectItem value="OPPORTUNITY_VALUE">Opportunity value</SelectItem>
            <SelectItem value="OPPORTUNITY_PIPELINE">Opportunity pipeline</SelectItem>
            <SelectItem value="OPPORTUNITY_PREVIOUS_STAGE">Previous stage</SelectItem>
            <SelectItem value="OPPORTUNITY_CURRENT_STAGE">Current stage</SelectItem>
          </SelectContent>
        </Select>

        {condition.source === "CONTACT_FIELD" ? (
          <Select value={condition.fieldKey ?? ""} onValueChange={(fieldKey) => {
            const fieldType = catalog.templateFields.contact.find((field) => field.key === fieldKey)?.fieldType
            onChange({ ...condition, fieldKey, operator: defaultBranchOperator(fieldType), compareValue: fieldType === "CHECKBOX" ? null : fieldType === "MULTI_SELECT" ? [] : "" })
          }}>
            <SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue placeholder="Select field" /></SelectTrigger>
            <SelectContent>{catalog.templateFields.contact.map((field) => <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>)}</SelectContent>
          </Select>
        ) : condition.source === "CONTACT_CUSTOM_FIELD" ? (
          <Select value={condition.customFieldId ?? ""} onValueChange={(customFieldId) => {
            const fieldType = catalog.customFields.find((field) => field.id === customFieldId)?.fieldType
            onChange({ ...condition, customFieldId, operator: defaultBranchOperator(fieldType), compareValue: fieldType === "CHECKBOX" ? null : fieldType === "MULTI_SELECT" ? [] : "" })
          }}>
            <SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue placeholder="Select field" /></SelectTrigger>
            <SelectContent>{catalog.customFields.map((field) => <SelectItem key={field.id} value={field.id}>{field.label}</SelectItem>)}</SelectContent>
          </Select>
        ) : condition.source === "AUTOMATION_VALUE" ? (
          <Select value={condition.key ?? ""} onValueChange={(key) => onChange({ ...condition, key, operator: "EQUALS", compareValue: "" })}>
            <SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue placeholder="Select value" /></SelectTrigger>
            <SelectContent>{automationOutputs.map((output) => <SelectItem key={output.key} value={output.key}>{output.label}</SelectItem>)}</SelectContent>
          </Select>
        ) : null}

        <Select value={condition.operator} onValueChange={(operator: AutomationOperator) => onChange({ ...condition, operator, compareValue: VALUELESS_OPERATORS.has(operator) ? null : condition.compareValue })}>
          <SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
          <SelectContent>{operators.map((operator) => <SelectItem key={operator} value={operator}>{OPERATOR_LABELS[operator]}</SelectItem>)}</SelectContent>
        </Select>

        <BranchConditionValueInput condition={condition} catalog={catalog} automationOutputs={automationOutputs} timezone={timezone} onChange={onChange} />
      </div>
    </div>
  )
}

function BranchConditionValueInput({
  condition,
  catalog,
  automationOutputs,
  timezone,
  onChange,
}: {
  condition: AutomationBranchCondition
  catalog: AutomationCatalog
  automationOutputs: AutomationValueDefinition[]
  timezone?: string | null
  onChange: (condition: AutomationBranchCondition) => void
}) {
  if (VALUELESS_OPERATORS.has(condition.operator)) return null
  if (condition.source === "CURRENT_DATE_TIME") {
    const dateTimeDraft = typeof condition.compareValue === "string" && !Number.isNaN(new Date(condition.compareValue).getTime())
      ? formatUtcIsoToDateTimeDraft(condition.compareValue, timezone)
      : { date: "", time: "" }
    return (
      <div className="flex flex-col gap-1">
        <DateTimeInput
          value={dateTimeDraft}
          onValueChange={(value) => onChange({ ...condition, compareValue: dateTimeDraftToUtcIso(value, timezone) ?? "" })}
          timezone={timezone}
          layout="joined"
        />
        <p className="text-xs text-slate-500">{timezone?.trim() || "America/Chicago"}</p>
      </div>
    )
  }
  if (condition.source === "CONTACT_STATUS") {
    return <Select value={condition.statusConfigId ?? ""} onValueChange={(statusConfigId) => onChange({ ...condition, statusConfigId })}><SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue placeholder="Select status" /></SelectTrigger><SelectContent>{catalog.statuses.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
  }
  if (condition.source === "CONTACT_ASSIGNEE") {
    return <Select value={condition.assignedUserId ?? ""} onValueChange={(assignedUserId) => onChange({ ...condition, assignedUserId })}><SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue placeholder="Select teammate" /></SelectTrigger><SelectContent>{catalog.users.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
  }
  if (condition.source === "CONTACT_TAGS") {
    return <Select value={condition.tagId ?? ""} onValueChange={(tagId) => onChange({ ...condition, tagId })}><SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue placeholder="Select tag" /></SelectTrigger><SelectContent>{catalog.tags.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
  }
  if (condition.source === "OPPORTUNITY_FIELD" && condition.field === "PIPELINE") {
    return <Select value={String(condition.compareValue ?? "")} onValueChange={(compareValue) => onChange({ ...condition, compareValue })}><SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue placeholder="Select pipeline" /></SelectTrigger><SelectContent>{catalog.pipelines.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
  }
  if (condition.source === "OPPORTUNITY_FIELD" && (condition.field === "PREVIOUS_STAGE" || condition.field === "CURRENT_STAGE")) {
    const stages = catalog.pipelines.flatMap((pipeline) => pipeline.stages.map((stage) => ({ ...stage, pipelineName: pipeline.name })))
    return <Select value={String(condition.compareValue ?? "")} onValueChange={(compareValue) => onChange({ ...condition, compareValue })}><SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue placeholder="Select stage" /></SelectTrigger><SelectContent>{stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.pipelineName} · {stage.name}</SelectItem>)}</SelectContent></Select>
  }
  const customField = condition.source === "CONTACT_CUSTOM_FIELD"
    ? catalog.customFields.find((field) => field.id === condition.customFieldId)
    : null
  if (customField && (customField.fieldType === "SELECT" || customField.fieldType === "RADIO")) {
    return (
      <Select value={String(condition.compareValue ?? "")} onValueChange={(compareValue) => onChange({ ...condition, compareValue })}>
        <SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue placeholder="Select option" /></SelectTrigger>
        <SelectContent>{customField.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
      </Select>
    )
  }
  if (customField?.fieldType === "MULTI_SELECT") {
    const selected = Array.isArray(condition.compareValue) ? condition.compareValue.map(String) : []
    return (
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
        {customField.options.map((option) => (
          <Label key={option} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs font-normal hover:bg-slate-50">
            <Checkbox
              checked={selected.includes(option)}
              onCheckedChange={(checked) => onChange({
                ...condition,
                compareValue: checked
                  ? [...selected, option]
                  : selected.filter((value) => value !== option),
              })}
            />
            <span>{option}</span>
          </Label>
        ))}
      </div>
    )
  }
  const fieldType = condition.source === "CONTACT_FIELD"
    ? catalog.templateFields.contact.find((field) => field.key === condition.fieldKey)?.fieldType
    : condition.source === "CONTACT_CUSTOM_FIELD"
      ? catalog.customFields.find((field) => field.id === condition.customFieldId)?.fieldType
      : condition.source === "AUTOMATION_VALUE"
        ? automationOutputs.find((output) => output.key === condition.key)?.valueKind === "NUMBER"
          ? "NUMBER"
          : automationOutputs.find((output) => output.key === condition.key)?.valueKind === "DATE"
            ? "DATE"
            : "TEXT"
        : condition.source === "OPPORTUNITY_FIELD" && condition.field === "VALUE" ? "NUMBER" : "TEXT"
  if (condition.operator === "BETWEEN") {
    const range = (condition.compareValue ?? {}) as { min?: unknown; max?: unknown }
    const inputType = fieldType === "DATE" ? "date" : "number"
    return <div className="grid grid-cols-2 gap-2"><Input aria-label="Minimum" type={inputType} value={String(range.min ?? "")} onChange={(event) => onChange({ ...condition, compareValue: { ...range, min: event.target.value } })} /><Input aria-label="Maximum" type={inputType} value={String(range.max ?? "")} onChange={(event) => onChange({ ...condition, compareValue: { ...range, max: event.target.value } })} /></div>
  }
  return (
    <Input
      aria-label="Comparison value"
      type={fieldType === "DATE" ? "date" : fieldType === "NUMBER" || fieldType === "CURRENCY" ? "number" : "text"}
      value={String(condition.compareValue ?? "")}
      onChange={(event) => onChange({ ...condition, compareValue: event.target.value })}
      placeholder="Value"
    />
  )
}

function FormatterIntegerInput({
  id,
  label,
  value,
  invalid = false,
  onChange,
}: {
  id: string
  label: string
  value: number
  invalid?: boolean
  onChange: (value: number) => void
}) {
  const [draftValue, setDraftValue] = useState(Number.isFinite(value) ? String(value) : "")
  const inputInvalid = invalid || !Number.isSafeInteger(value)
  return (
    <Field className="gap-1.5" data-invalid={inputInvalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        value={draftValue}
        className="h-8 rounded-full"
        aria-invalid={inputInvalid}
        onChange={(event) => {
          const next = event.target.value
          if (!/^-?\d*$/.test(next)) return
          setDraftValue(next)
          onChange(/^-?\d+$/.test(next) ? Number(next) : Number.NaN)
        }}
      />
    </Field>
  )
}

function NumberFormatterActionEditor({
  config,
  catalog,
  automationOutputs,
  onChange,
}: {
  config: AutomationNumberFormatterConfig
  catalog: AutomationCatalog
  automationOutputs: AutomationValueDefinition[]
  onChange: (config: AutomationNumberFormatterConfig) => void
}) {
  const outputKeyValid = /^[a-z][a-z0-9_]{0,63}$/.test(config.outputKey)
  const duplicateOutputKey = automationOutputs.some((output) => output.key === config.outputKey)
  const mode = config.mode
  const contactFields = catalog.templateFields.contact
    .filter((field) => numberFormatterAcceptsFieldType(mode, field.fieldType))
    .map((field) => ({
      value: `contact:${field.key}`,
      label: field.label,
      searchText: field.key,
    }))
  const customFields = catalog.customFields
    .filter((field) => numberFormatterAcceptsFieldType(mode, field.fieldType))
    .map((field) => ({
      value: `custom:${field.key}`,
      label: field.label,
      searchText: field.key,
    }))
  const compatibleAutomationOutputs = automationOutputs
    .filter((output) => numberFormatterAcceptsValueKind(mode, output.valueKind))
    .map((output) => ({
      value: `automation:${output.key}`,
      label: output.label,
      searchText: output.key,
    }))

  const defaultSource = (nextMode: AutomationNumberFormatterConfig["mode"]): AutomationNumberSource => {
    const contactCandidates = catalog.templateFields.contact.filter(
      (field) => numberFormatterAcceptsFieldType(nextMode, field.fieldType),
    )
    const customCandidates = catalog.customFields.filter(
      (field) => numberFormatterAcceptsFieldType(nextMode, field.fieldType),
    )
    const contactField = nextMode === "FORMAT_PHONE_NUMBER"
      ? contactCandidates[0]
      : contactCandidates.find((field) => field.key === "weight" || field.key === "height") ??
        contactCandidates[0]
    const customField = nextMode === "FORMAT_PHONE_NUMBER"
      ? customCandidates[0]
      : customCandidates.find((field) => field.fieldType === "NUMBER" || field.fieldType === "CURRENCY") ??
        customCandidates[0]
    const output = automationOutputs.find(
      (candidate) => numberFormatterAcceptsValueKind(nextMode, candidate.valueKind),
    )
    if (customField) return { type: "CUSTOM_FIELD", key: customField.key }
    if (contactField) return { type: "CONTACT_FIELD", key: contactField.key }
    if (output) return { type: "AUTOMATION_VALUE", key: output.key }
    return { type: "CONTACT_FIELD", key: "" }
  }

  const setMode = (nextMode: AutomationNumberFormatterConfig["mode"]) => {
    const outputKey = config.outputKey
    if (nextMode === "RANDOM_NUMBER") {
      onChange({ mode: nextMode, min: 1, max: 100, outputKey })
      return
    }
    const source = defaultSource(nextMode)
    if (nextMode === "FORMAT_PHONE_NUMBER") {
      onChange({
        mode: nextMode,
        source,
        countryCode: "+1",
        phoneFormat: "E164",
        outputKey,
      })
      return
    }
    if (nextMode === "FORMAT_CURRENCY") {
      onChange({
        mode: nextMode,
        source,
        decimalMark: "PERIOD",
        currencyCode: "USD",
        outputKey,
      })
      return
    }
    if (nextMode === "FORMAT_NUMBER") {
      onChange({
        mode: nextMode,
        source,
        decimalMark: "PERIOD",
        groupingStyle: "COMMA_PERIOD",
        outputKey,
      })
      return
    }
    onChange({ mode: nextMode, source, decimalMark: "PERIOD", outputKey })
  }

  const sourceValue = config.mode === "RANDOM_NUMBER"
    ? undefined
    : `${config.source.type === "CONTACT_FIELD" ? "contact" : config.source.type === "CUSTOM_FIELD" ? "custom" : "automation"}:${config.source.key}`

  const changeSource = (value: string) => {
    if (config.mode === "RANDOM_NUMBER") return
    const separator = value.indexOf(":")
    const category = value.slice(0, separator)
    const key = value.slice(separator + 1)
    const source: AutomationNumberSource = category === "contact"
      ? { type: "CONTACT_FIELD", key }
      : category === "custom"
        ? { type: "CUSTOM_FIELD", key }
        : { type: "AUTOMATION_VALUE", key }
    onChange({ ...config, source })
  }

  return (
    <div className="flex flex-col gap-4">
      <Field className="gap-1.5" data-invalid={!outputKeyValid || duplicateOutputKey}>
        <FieldLabel htmlFor="number-formatter-result-name">Result name</FieldLabel>
        <Input
          id="number-formatter-result-name"
          value={config.outputKey}
          maxLength={64}
          className="h-8 rounded-full"
          aria-invalid={!outputKeyValid || duplicateOutputKey}
          onChange={(event) => onChange({ ...config, outputKey: event.target.value.toLowerCase() })}
          placeholder="formatted_number"
        />
        {!outputKeyValid ? (
          <p className="text-xs text-rose-600">Start with a letter and use lowercase letters, numbers, or underscores.</p>
        ) : duplicateOutputKey ? (
          <p className="text-xs text-rose-600">This result name is already used by an earlier formatter.</p>
        ) : null}
      </Field>

      <Field className="gap-1.5">
        <FieldLabel htmlFor="number-formatter-mode">Mode</FieldLabel>
        <Select value={config.mode} onValueChange={(value) => setMode(value as AutomationNumberFormatterConfig["mode"])}>
          <SelectTrigger id="number-formatter-mode" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="TEXT_TO_NUMBER">Text to number</SelectItem>
            <SelectItem value="FORMAT_NUMBER">Format number</SelectItem>
            <SelectItem value="FORMAT_PHONE_NUMBER">Format phone number</SelectItem>
            <SelectItem value="FORMAT_CURRENCY">Format currency</SelectItem>
            <SelectItem value="RANDOM_NUMBER">Random number</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {config.mode === "RANDOM_NUMBER" ? (
        <div className="grid grid-cols-2 gap-2">
          <FormatterIntegerInput
            key={`min-${config.outputKey}`}
            id="number-formatter-min"
            label="Minimum"
            value={config.min}
            onChange={(min) => onChange({ ...config, min })}
          />
          <FormatterIntegerInput
            key={`max-${config.outputKey}`}
            id="number-formatter-max"
            label="Maximum"
            value={config.max}
            onChange={(max) => onChange({ ...config, max })}
          />
        </div>
      ) : (
        <Field className="gap-1.5">
          <FieldLabel>Source</FieldLabel>
          <AutomationFieldPicker
            value={sourceValue}
            contactFields={contactFields}
            customFields={customFields}
            automationValues={compatibleAutomationOutputs}
            onValueChange={changeSource}
            ariaLabel="Number formatter source"
          />
        </Field>
      )}

      {config.mode !== "RANDOM_NUMBER" && config.mode !== "FORMAT_PHONE_NUMBER" ? (
        <Field className="gap-1.5">
          <FieldLabel htmlFor="number-formatter-decimal-mark">Input decimal mark</FieldLabel>
          <Select
            value={config.decimalMark}
            onValueChange={(decimalMark) => onChange({
              ...config,
              decimalMark: decimalMark as "PERIOD" | "COMMA",
            })}
          >
            <SelectTrigger id="number-formatter-decimal-mark" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="PERIOD">Period (.)</SelectItem>
              <SelectItem value="COMMA">Comma (,)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {config.mode === "FORMAT_NUMBER" ? (
        <Field className="gap-1.5">
          <FieldLabel htmlFor="number-formatter-grouping">Output format</FieldLabel>
          <Select
            value={config.groupingStyle}
            onValueChange={(groupingStyle) => onChange({
              ...config,
              groupingStyle: groupingStyle as typeof config.groupingStyle,
            })}
          >
            <SelectTrigger id="number-formatter-grouping" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
            <SelectContent>
              {NUMBER_GROUPING_OPTIONS.map(([value, label, preview]) => (
                <SelectItem key={value} value={value}>{label} · {preview}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {config.mode === "FORMAT_CURRENCY" ? (
        <Field className="gap-1.5">
          <FieldLabel htmlFor="number-formatter-currency">Currency</FieldLabel>
          <Select value={config.currencyCode} onValueChange={(currencyCode) => onChange({ ...config, currencyCode })}>
            <SelectTrigger id="number-formatter-currency" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
            <SelectContent>
              {NUMBER_CURRENCY_OPTIONS.map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {config.mode === "FORMAT_PHONE_NUMBER" ? (
        <>
          <Field className="gap-1.5" data-invalid={!/^\+\d{1,4}$/.test(config.countryCode)}>
            <FieldLabel htmlFor="number-formatter-country-code">Country code</FieldLabel>
            <Input
              id="number-formatter-country-code"
              value={config.countryCode}
              maxLength={5}
              className="h-8 rounded-full"
              aria-invalid={!/^\+\d{1,4}$/.test(config.countryCode)}
              onChange={(event) => onChange({ ...config, countryCode: event.target.value })}
              placeholder="+1"
            />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="number-formatter-phone-format">Output format</FieldLabel>
            <Select
              value={config.phoneFormat}
              onValueChange={(phoneFormat) => onChange({
                ...config,
                phoneFormat: phoneFormat as typeof config.phoneFormat,
              })}
            >
              <SelectTrigger id="number-formatter-phone-format" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent>
                {NUMBER_PHONE_FORMAT_OPTIONS.map(([value, label, preview]) => (
                  <SelectItem key={value} value={value}>{label} · {preview}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </>
      ) : null}
    </div>
  )
}

const TEXT_FORMATTER_MODE_OPTIONS: Array<{
  value: AutomationTextFormatterConfig["mode"]
  label: string
  description: string
}> = [
  { value: "UPPER_CASE", label: "Upper case", description: "Converts all letters to uppercase." },
  { value: "LOWER_CASE", label: "Lower case", description: "Converts all letters to lowercase." },
  { value: "TITLE_CASE", label: "Title case", description: "Lowercases the text, then capitalizes each word." },
  { value: "CAPITALIZE", label: "Capitalize", description: "Lowercases the text, then capitalizes its first letter." },
  { value: "DEFAULT_VALUE", label: "Default value", description: "Uses the fallback when the source is empty or only whitespace." },
  { value: "TRIM", label: "Trim to length", description: "Keeps only the first specified number of characters." },
  { value: "TRIM_WHITESPACE", label: "Trim whitespace", description: "Removes whitespace from the beginning and end." },
  { value: "REPLACE_TEXT", label: "Replace text", description: "Replaces every exact, case-sensitive match." },
  { value: "FIND", label: "Find", description: "Returns the zero-based position of the first exact match, or -1." },
  { value: "WORD_COUNT", label: "Word count", description: "Returns the number of words in the text." },
  { value: "LENGTH", label: "Length", description: "Returns the number of visible characters." },
  { value: "SPLIT_TEXT", label: "Split text", description: "Splits the text by a separator and returns the selected segment." },
  { value: "EXTRACT_EMAIL", label: "Extract email", description: "Returns the first valid email address found." },
  { value: "EXTRACT_URL", label: "Extract URL", description: "Returns the first http, https, or www URL found." },
]

function TextFormatterActionEditor({
  actionKey,
  config,
  catalog,
  automationOutputs,
  onChange,
}: {
  actionKey: string
  config: AutomationTextFormatterConfig
  catalog: AutomationCatalog
  automationOutputs: AutomationValueDefinition[]
  onChange: (config: AutomationTextFormatterConfig) => void
}) {
  const actionNameValid = config.actionName.trim().length > 0 && config.actionName.trim().length <= 120
  const outputKeyValid = /^[a-z][a-z0-9_]{0,63}$/.test(config.outputKey)
  const duplicateOutputKey = automationOutputs.some((output) => output.key === config.outputKey)
  const sourceReady = isTextFormatterSourceReady(config.source, catalog, automationOutputs)
  const contactFields = catalog.templateFields.contact
    .filter((field) => textFormatterAcceptsFieldType(field.fieldType))
    .map((field) => ({ value: `contact:${field.key}`, label: field.label, searchText: field.key }))
  const customFields = catalog.customFields
    .filter((field) => textFormatterAcceptsFieldType(field.fieldType))
    .map((field) => ({ value: `custom:${field.key}`, label: field.label, searchText: field.key }))
  const compatibleAutomationOutputs = automationOutputs
    .filter((output) => textFormatterAcceptsValueKind(output.valueKind))
    .map((output) => ({ value: `automation:${output.key}`, label: output.label, searchText: output.key }))
  const sourceValue = `${config.source.type === "CONTACT_FIELD" ? "contact" : config.source.type === "CUSTOM_FIELD" ? "custom" : "automation"}:${config.source.key}`
  const selectedMode = TEXT_FORMATTER_MODE_OPTIONS.find((option) => option.value === config.mode)

  const changeSource = (value: string) => {
    const separatorIndex = value.indexOf(":")
    const category = value.slice(0, separatorIndex)
    const key = value.slice(separatorIndex + 1)
    const source: AutomationTextSource = category === "contact"
      ? { type: "CONTACT_FIELD", key }
      : category === "custom"
        ? { type: "CUSTOM_FIELD", key }
        : { type: "AUTOMATION_VALUE", key }
    onChange({ ...config, source })
  }

  const setMode = (mode: AutomationTextFormatterConfig["mode"]) => {
    const base = {
      actionName: config.actionName,
      source: config.source,
      outputKey: config.outputKey,
    }
    if (mode === "DEFAULT_VALUE") {
      onChange({ ...base, mode, defaultValue: "Unknown" })
      return
    }
    if (mode === "TRIM") {
      onChange({ ...base, mode, maxLength: 100 })
      return
    }
    if (mode === "REPLACE_TEXT") {
      onChange({ ...base, mode, searchText: "", replacementText: "" })
      return
    }
    if (mode === "FIND") {
      onChange({ ...base, mode, searchText: "" })
      return
    }
    if (mode === "SPLIT_TEXT") {
      onChange({ ...base, mode, separator: " ", segment: 1 })
      return
    }
    onChange({ ...base, mode })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
        <p className="text-sm font-semibold text-slate-800">Action details</p>
        <Field className="gap-1.5" data-invalid={!actionNameValid}>
          <FieldLabel htmlFor="text-formatter-action-name">Action name</FieldLabel>
          <Input
            id="text-formatter-action-name"
            value={config.actionName}
            maxLength={120}
            className="h-8 rounded-full bg-white"
            aria-invalid={!actionNameValid}
            onChange={(event) => onChange({ ...config, actionName: event.target.value })}
            placeholder="Normalize lead name"
          />
          {!actionNameValid ? <p className="text-xs text-rose-600">Enter an action name.</p> : null}
        </Field>
        <Field className="gap-1.5">
          <FieldLabel htmlFor="text-formatter-mode">Action type</FieldLabel>
          <Select value={config.mode} onValueChange={(value) => setMode(value as AutomationTextFormatterConfig["mode"])}>
            <SelectTrigger
              id="text-formatter-mode"
              aria-describedby="text-formatter-mode-description"
              className={cn(COMPACT_SELECT_TRIGGER_CLASS, "bg-white")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEXT_FORMATTER_MODE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id="text-formatter-mode-description" className="text-xs leading-5 text-slate-500">
            {selectedMode?.description}
          </p>
        </Field>
      </div>

      <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/45 p-3">
        <p className="text-sm font-semibold text-slate-800">Input and result</p>
        <Field className="gap-1.5" data-invalid={!sourceReady}>
          <FieldLabel>Source</FieldLabel>
          <AutomationFieldPicker
            value={sourceValue}
            contactFields={contactFields}
            customFields={customFields}
            automationValues={compatibleAutomationOutputs}
            onValueChange={changeSource}
            ariaLabel="Text formatter source"
          />
          {!sourceReady ? <p className="text-xs text-rose-600">Select a compatible text source.</p> : null}
        </Field>
        <Field className="gap-1.5" data-invalid={!outputKeyValid || duplicateOutputKey}>
          <FieldLabel htmlFor="text-formatter-result-name">Result name</FieldLabel>
          <Input
            id="text-formatter-result-name"
            value={config.outputKey}
            maxLength={64}
            className="h-8 rounded-full bg-white"
            aria-invalid={!outputKeyValid || duplicateOutputKey}
            onChange={(event) => onChange({ ...config, outputKey: event.target.value.toLowerCase() })}
            placeholder="formatted_text"
          />
          {!outputKeyValid ? (
            <p className="text-xs text-rose-600">Start with a letter and use lowercase letters, numbers, or underscores.</p>
          ) : duplicateOutputKey ? (
            <p className="text-xs text-rose-600">This result name is already used by an earlier action.</p>
          ) : null}
        </Field>
      </div>

      {config.mode === "DEFAULT_VALUE" ||
      config.mode === "TRIM" ||
      config.mode === "REPLACE_TEXT" ||
      config.mode === "FIND" ||
      config.mode === "SPLIT_TEXT" ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <p className="text-sm font-semibold text-slate-800">Formatter settings</p>
          {config.mode === "DEFAULT_VALUE" ? (
            <Field className="gap-1.5" data-invalid={!config.defaultValue.trim() || config.defaultValue.length > 5_000}>
              <FieldLabel htmlFor="text-formatter-default">Default value</FieldLabel>
              <Textarea
                id="text-formatter-default"
                value={config.defaultValue}
                maxLength={5_000}
                rows={3}
                className="resize-none rounded-xl bg-white"
                aria-invalid={!config.defaultValue.trim() || config.defaultValue.length > 5_000}
                onChange={(event) => onChange({ ...config, defaultValue: event.target.value })}
              />
            </Field>
          ) : null}
          {config.mode === "TRIM" ? (
            <FormatterIntegerInput
              key={`${actionKey}-trim`}
              id="text-formatter-max-length"
              label="Maximum characters"
              value={config.maxLength}
              invalid={!Number.isInteger(config.maxLength) || config.maxLength < 1 || config.maxLength > 10_000}
              onChange={(maxLength) => onChange({ ...config, maxLength })}
            />
          ) : null}
          {config.mode === "REPLACE_TEXT" ? (
            <>
              <Field className="gap-1.5" data-invalid={!config.searchText.length}>
                <FieldLabel htmlFor="text-formatter-search">Find</FieldLabel>
                <Input
                  id="text-formatter-search"
                  value={config.searchText}
                  maxLength={5_000}
                  className="h-8 rounded-full bg-white"
                  aria-invalid={!config.searchText.length}
                  onChange={(event) => onChange({ ...config, searchText: event.target.value })}
                />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="text-formatter-replacement">Replace with</FieldLabel>
                <Input
                  id="text-formatter-replacement"
                  value={config.replacementText}
                  maxLength={5_000}
                  className="h-8 rounded-full bg-white"
                  onChange={(event) => onChange({ ...config, replacementText: event.target.value })}
                />
              </Field>
            </>
          ) : null}
          {config.mode === "FIND" ? (
            <Field className="gap-1.5" data-invalid={!config.searchText.length}>
              <FieldLabel htmlFor="text-formatter-find">Value to find</FieldLabel>
              <Input
                id="text-formatter-find"
                value={config.searchText}
                maxLength={5_000}
                className="h-8 rounded-full bg-white"
                aria-invalid={!config.searchText.length}
                onChange={(event) => onChange({ ...config, searchText: event.target.value })}
              />
            </Field>
          ) : null}
          {config.mode === "SPLIT_TEXT" ? (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)] gap-2">
              <Field className="gap-1.5" data-invalid={!config.separator.length}>
                <FieldLabel htmlFor="text-formatter-separator">Separator</FieldLabel>
                <Input
                  id="text-formatter-separator"
                  value={config.separator}
                  maxLength={100}
                  className="h-8 rounded-full bg-white"
                  aria-invalid={!config.separator.length}
                  onChange={(event) => onChange({ ...config, separator: event.target.value })}
                />
              </Field>
              <FormatterIntegerInput
                key={`${actionKey}-split`}
                id="text-formatter-segment"
                label="Segment"
                value={config.segment}
                invalid={!Number.isInteger(config.segment) || config.segment < 1 || config.segment > 10_000}
                onChange={(segment) => onChange({ ...config, segment })}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function MathAmountInput({
  id,
  value,
  integer,
  invalid,
  onChange,
}: {
  id: string
  value: number
  integer: boolean
  invalid: boolean
  onChange: (value: number) => void
}) {
  const [draftValue, setDraftValue] = useState(Number.isFinite(value) ? String(value) : "")
  return (
    <Input
      id={id}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      value={draftValue}
      className="h-8 rounded-full"
      aria-invalid={invalid}
      onChange={(event) => {
        const next = event.target.value
        const allowed = integer ? /^\d*$/.test(next) : /^-?(?:\d+)?(?:\.\d*)?$/.test(next)
        if (!allowed) return
        setDraftValue(next)
        const complete = integer ? /^\d+$/.test(next) : /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(next)
        onChange(complete ? Number(next) : Number.NaN)
      }}
    />
  )
}

function MathOperationActionEditor({
  actionKey,
  config,
  catalog,
  automationOutputs,
  onChange,
}: {
  actionKey: string
  config: AutomationMathOperationConfig
  catalog: AutomationCatalog
  automationOutputs: AutomationValueDefinition[]
  onChange: (config: AutomationMathOperationConfig) => void
}) {
  const outputKeyValid = /^[a-z][a-z0-9_]{0,63}$/.test(config.outputKey)
  const duplicateOutputKey = automationOutputs.some((output) => output.key === config.outputKey)
  const expectedKind = config.mode === "DATE" ? "DATE" : "NUMBER"
  const compatibleFieldType = (fieldType: string) => config.mode === "DATE"
    ? fieldType === "DATE"
    : fieldType === "NUMBER" || fieldType === "CURRENCY"
  const contactFields = catalog.templateFields.contact
    .filter((field) => compatibleFieldType(field.fieldType))
    .map((field) => ({ value: `contact:${field.key}`, label: field.label, searchText: field.key }))
  const customFields = catalog.customFields
    .filter((field) => compatibleFieldType(field.fieldType))
    .map((field) => ({ value: `custom:${field.key}`, label: field.label, searchText: field.key }))
  const compatibleAutomationOutputs = automationOutputs
    .filter((output) => output.valueKind === expectedKind)
    .map((output) => ({ value: `automation:${output.key}`, label: output.label, searchText: output.key }))
  const sourceValue = `${config.source.type === "CONTACT_FIELD" ? "contact" : config.source.type === "CUSTOM_FIELD" ? "custom" : "automation"}:${config.source.key}`

  const defaultSource = (mode: AutomationMathOperationConfig["mode"]) => {
    const fieldTypeMatches = (fieldType: string) => mode === "DATE"
      ? fieldType === "DATE"
      : fieldType === "NUMBER" || fieldType === "CURRENCY"
    const custom = catalog.customFields.find((field) => fieldTypeMatches(field.fieldType))
    const contact = catalog.templateFields.contact.find((field) => fieldTypeMatches(field.fieldType))
    const output = automationOutputs.find(
      (candidate) => candidate.valueKind === (mode === "DATE" ? "DATE" : "NUMBER"),
    )
    if (custom) return { type: "CUSTOM_FIELD" as const, key: custom.key }
    if (contact) return { type: "CONTACT_FIELD" as const, key: contact.key }
    if (output) return { type: "AUTOMATION_VALUE" as const, key: output.key }
    return { type: "CUSTOM_FIELD" as const, key: "" }
  }

  const setMode = (mode: AutomationMathOperationConfig["mode"]) => {
    const source = defaultSource(mode)
    if (mode === "DATE") {
      onChange({
        mode,
        source,
        operation: "ADD",
        amount: 1,
        unit: "DAYS",
        outputKey: config.outputKey,
      })
      return
    }
    onChange({
      mode,
      source,
      operation: "ADD",
      operand: 1,
      outputKey: config.outputKey,
    })
  }

  const changeSource = (value: string) => {
    const separator = value.indexOf(":")
    const category = value.slice(0, separator)
    const key = value.slice(separator + 1)
    const source = category === "contact"
      ? { type: "CONTACT_FIELD" as const, key }
      : category === "custom"
        ? { type: "CUSTOM_FIELD" as const, key }
        : { type: "AUTOMATION_VALUE" as const, key }
    onChange({ ...config, source })
  }

  const amountInvalid = config.mode === "DATE"
    ? !Number.isInteger(config.amount) || config.amount < 1 || config.amount > 10_000
    : !Number.isFinite(config.operand) || (config.operation === "DIVIDE" && config.operand === 0)

  return (
    <div className="flex flex-col gap-4">
      <Field className="gap-1.5" data-invalid={!outputKeyValid || duplicateOutputKey}>
        <FieldLabel htmlFor="math-result-name">Result name</FieldLabel>
        <Input
          id="math-result-name"
          value={config.outputKey}
          maxLength={64}
          className="h-8 rounded-full"
          aria-invalid={!outputKeyValid || duplicateOutputKey}
          onChange={(event) => onChange({ ...config, outputKey: event.target.value.toLowerCase() })}
          placeholder="calculated_value"
        />
        {!outputKeyValid ? (
          <p className="text-xs text-rose-600">Start with a letter and use lowercase letters, numbers, or underscores.</p>
        ) : duplicateOutputKey ? (
          <p className="text-xs text-rose-600">This result name is already used by an earlier action.</p>
        ) : null}
      </Field>

      <Field className="gap-1.5">
        <FieldLabel htmlFor="math-value-type">Value type</FieldLabel>
        <Select value={config.mode} onValueChange={(value) => setMode(value as AutomationMathOperationConfig["mode"])}>
          <SelectTrigger id="math-value-type" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="NUMBER">Number</SelectItem>
            <SelectItem value="DATE">Date</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field className="gap-1.5">
        <FieldLabel>Source</FieldLabel>
        <AutomationFieldPicker
          value={sourceValue}
          contactFields={contactFields}
          customFields={customFields}
          automationValues={compatibleAutomationOutputs}
          onValueChange={changeSource}
          ariaLabel="Math operation source"
        />
      </Field>

      <Field className="gap-1.5">
        <FieldLabel htmlFor="math-operation">Operation</FieldLabel>
        <Select
          value={config.operation}
          onValueChange={(operation) => {
            if (config.mode === "DATE") {
              onChange({ ...config, operation: operation as "ADD" | "SUBTRACT" })
              return
            }
            onChange({
              ...config,
              operation: operation as "ADD" | "SUBTRACT" | "MULTIPLY" | "DIVIDE",
            })
          }}
        >
          <SelectTrigger id="math-operation" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ADD">Add</SelectItem>
            <SelectItem value="SUBTRACT">Subtract</SelectItem>
            {config.mode === "NUMBER" ? <SelectItem value="MULTIPLY">Multiply</SelectItem> : null}
            {config.mode === "NUMBER" ? <SelectItem value="DIVIDE">Divide</SelectItem> : null}
          </SelectContent>
        </Select>
      </Field>

      <Field className="gap-1.5" data-invalid={amountInvalid}>
        <FieldLabel htmlFor="math-amount">{config.mode === "DATE" ? "Amount" : "Value"}</FieldLabel>
        <div className={config.mode === "DATE" ? "grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2" : undefined}>
          <MathAmountInput
            key={`${actionKey}-${config.mode}`}
            id="math-amount"
            value={config.mode === "DATE" ? config.amount : config.operand}
            integer={config.mode === "DATE"}
            invalid={amountInvalid}
            onChange={(value) => onChange(
              config.mode === "DATE"
                ? { ...config, amount: value }
                : { ...config, operand: value },
            )}
          />
          {config.mode === "DATE" ? (
            <Select
              value={config.unit}
              onValueChange={(unit) => onChange({ ...config, unit: unit as typeof config.unit })}
            >
              <SelectTrigger aria-label="Date Math unit" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DAYS">Days</SelectItem>
                <SelectItem value="MONTHS">Months</SelectItem>
                <SelectItem value="YEARS">Years</SelectItem>
              </SelectContent>
            </Select>
          ) : null}
        </div>
        {config.mode === "NUMBER" && config.operation === "DIVIDE" && config.operand === 0 ? (
          <p className="text-xs text-rose-600">The divisor cannot be zero.</p>
        ) : null}
      </Field>
    </div>
  )
}

function DateTimeFormatterActionEditor({
  config,
  catalog,
  timezone,
  automationOutputs,
  onChange,
}: {
  config: AutomationDateTimeFormatterConfig
  catalog: AutomationCatalog
  timezone?: string | null
  automationOutputs: AutomationValueDefinition[]
  onChange: (config: AutomationDateTimeFormatterConfig) => void
}) {
  const outputKeyValid = /^[a-z][a-z0-9_]{0,63}$/.test(config.outputKey)
  const setMode = (mode: AutomationDateTimeFormatterConfig["mode"]) => {
    if (mode === "COMPARE_DATES") {
      onChange({
        mode,
        from: { type: "CURRENT_DATE" },
        to: { type: "RELATIVE_DATE", amount: 1, unit: "DAYS" },
        unit: "DAYS",
        outputKey: config.outputKey,
      })
      return
    }
    onChange({
      mode,
      source: { type: "CURRENT_DATE" },
      format: mode === "DATE" ? "MMM D, YYYY" : "MMM D, YYYY hh:mm:ss A",
      outputKey: config.outputKey,
    })
  }

  const dateSource = (
    idPrefix: string,
    label: string,
    value: AutomationFormatterDateSource,
    change: (source: AutomationFormatterDateSource) => void,
  ) => (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <p className="text-xs font-semibold text-slate-700">{label}</p>
      <ContactDateValueInput
        idPrefix={idPrefix}
        value={value as ContactDateValue}
        onChange={(source) => change(source as AutomationFormatterDateSource)}
        catalog={catalog}
        timezone={timezone}
        allowRelative
        automationValues={automationOutputs
          .filter((output) => output.valueKind === "DATE")
          .map((output) => ({ key: output.key, label: output.label }))}
      />
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <Field className="gap-1.5" data-invalid={!outputKeyValid}>
        <FieldLabel htmlFor="formatter-result-name">Result name</FieldLabel>
        <Input
          id="formatter-result-name"
          value={config.outputKey}
          maxLength={64}
          className="h-8 rounded-full"
          aria-invalid={!outputKeyValid}
          onChange={(event) => onChange({ ...config, outputKey: event.target.value.toLowerCase() })}
          placeholder="appointment_date"
        />
        {!outputKeyValid ? (
          <p className="text-xs text-rose-600">Start with a letter and use lowercase letters, numbers, or underscores.</p>
        ) : null}
      </Field>

      <Field className="gap-1.5">
        <FieldLabel htmlFor="formatter-mode">Mode</FieldLabel>
        <Select value={config.mode} onValueChange={(mode) => setMode(mode as AutomationDateTimeFormatterConfig["mode"])}>
          <SelectTrigger id="formatter-mode" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="DATE">Date</SelectItem>
            <SelectItem value="DATE_TIME">Date and time</SelectItem>
            <SelectItem value="COMPARE_DATES">Compare dates</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {config.mode === "COMPARE_DATES" ? (
        <>
          {dateSource("formatter-from", "From", config.from, (from) => onChange({ ...config, from }))}
          {dateSource("formatter-to", "To", config.to, (to) => onChange({ ...config, to }))}
          <Field className="gap-1.5">
            <FieldLabel htmlFor="formatter-comparison-unit">Unit</FieldLabel>
            <Select value={config.unit} onValueChange={(unit) => onChange({ ...config, unit: unit as "DAYS" | "MONTHS" | "YEARS" })}>
              <SelectTrigger id="formatter-comparison-unit" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DAYS">Days</SelectItem>
                <SelectItem value="MONTHS">Months</SelectItem>
                <SelectItem value="YEARS">Years</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </>
      ) : (
        <>
          {dateSource("formatter-source", "Date source", config.source, (source) => onChange({
            ...config,
            source,
            ...(config.mode === "DATE_TIME" && formatterSourceNeedsTime(source) && !config.time
              ? { time: "00:00" }
              : {}),
          }))}
          {config.mode === "DATE_TIME" && formatterSourceNeedsTime(config.source) ? (
            <Field className="gap-1.5">
              <FieldLabel htmlFor="formatter-time">Time</FieldLabel>
              <Input
                id="formatter-time"
                type="time"
                value={config.time ?? "00:00"}
                className="h-8 rounded-full"
                onChange={(event) => onChange({ ...config, time: event.target.value })}
              />
            </Field>
          ) : null}
          <Field className="gap-1.5">
            <FieldLabel htmlFor="formatter-format">Format</FieldLabel>
            <Select value={config.format} onValueChange={(format) => onChange({ ...config, format })}>
              <SelectTrigger id="formatter-format" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
              <SelectContent>
                {(config.mode === "DATE" ? DATE_FORMAT_OPTIONS : DATE_TIME_FORMAT_OPTIONS).map(([value, preview]) => (
                  <SelectItem key={value} value={value}>{value === "X" ? "Unix timestamp" : value} · {preview}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </>
      )}
    </div>
  )
}

function TaskDateTimeEditor({
  idPrefix,
  label,
  value,
  catalog,
  timezone,
  onChange,
}: {
  idPrefix: string
  label: string
  value: AutomationTaskDateTime
  catalog: AutomationCatalog
  timezone?: string | null
  onChange: (value: AutomationTaskDateTime) => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <p className="text-xs font-semibold text-slate-700">{label}</p>
      <ContactDateValueInput
        idPrefix={idPrefix}
        value={value.source as ContactDateValue}
        onChange={(source) => onChange({ ...value, source: source as AutomationDateSource })}
        catalog={catalog}
        timezone={timezone}
        allowRelative
      />
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${idPrefix}-time`} className="text-xs">Time</FieldLabel>
        <Input
          id={`${idPrefix}-time`}
          type="time"
          value={value.time}
          onChange={(event) => onChange({ ...value, time: event.target.value })}
          className="h-8 rounded-full"
        />
      </Field>
    </div>
  )
}

function InternalNotificationActionEditor({
  actionKey,
  config,
  catalog,
  timezone,
  automationOutputs,
  onChange,
}: {
  actionKey: string
  config: AutomationInternalNotificationConfig
  catalog: AutomationCatalog
  timezone?: string | null
  automationOutputs: AutomationValueDefinition[]
  onChange: (config: AutomationInternalNotificationConfig) => void
}) {
  const [recipientPickerOpen, setRecipientPickerOpen] = useState(false)
  const specificUserId = config.recipient.mode === "SPECIFIC_USER"
    ? config.recipient.userId
    : null
  const selectedUser = specificUserId
    ? catalog.users.find((user) => user.id === specificUserId)
    : null
  const actionNameValid = config.actionName.trim().length > 0 && config.actionName.trim().length <= 120
  const titleError = noteTemplateError(config.titleTemplate, 160, catalog, automationOutputs)
  const bodyError = optionalTemplateError(config.bodyTemplate, 1_000, catalog, automationOutputs)

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-2.5">
        <BellRing className="mt-0.5 size-4 shrink-0 text-violet-600" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-950">Internal notification</p>
          <p className="text-xs leading-4 text-slate-600">
            Adds a notification to the recipient&apos;s bell and shows it immediately while they are online.
          </p>
        </div>
      </div>

      <Field className="gap-1.5" data-invalid={!actionNameValid}>
        <FieldLabel htmlFor={`${actionKey}-notification-action-name`}>Action name</FieldLabel>
        <Input
          id={`${actionKey}-notification-action-name`}
          value={config.actionName}
          maxLength={120}
          aria-invalid={!actionNameValid}
          onChange={(event) => onChange({ ...config, actionName: event.target.value })}
          placeholder="Internal notification"
        />
        {!actionNameValid ? <p className="text-xs text-rose-600">Enter an action name.</p> : null}
      </Field>

      <Field className="gap-2">
        <FieldLabel htmlFor={`${actionKey}-notification-recipient-mode`}>Recipient</FieldLabel>
        <Select
          value={config.recipient.mode}
          onValueChange={(mode: AutomationInternalNotificationConfig["recipient"]["mode"]) => {
            onChange({
              ...config,
              recipient: mode === "CONTACT_ASSIGNEE"
                ? { mode }
                : { mode, userId: catalog.users[0]?.id ?? "" },
            })
          }}
        >
          <SelectTrigger
            id={`${actionKey}-notification-recipient-mode`}
            className={COMPACT_SELECT_TRIGGER_CLASS}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CONTACT_ASSIGNEE">Contact assignee</SelectItem>
            <SelectItem value="SPECIFIC_USER">Specific teammate</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {config.recipient.mode === "SPECIFIC_USER" ? (
        <Field className="gap-2">
          <FieldLabel>Teammate</FieldLabel>
          <Popover open={recipientPickerOpen} onOpenChange={setRecipientPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={recipientPickerOpen}
                className="h-9 w-full justify-between bg-white px-3 font-normal"
              >
                <span className="truncate">
                  {selectedUser ? `${selectedUser.name} · ${selectedUser.email}` : "Select teammate"}
                </span>
                <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search teammates…" />
                <CommandList>
                  <CommandEmpty>No active teammates found.</CommandEmpty>
                  <CommandGroup>
                    {catalog.users.map((user) => (
                      <CommandItem
                        key={user.id}
                        value={`${user.name} ${user.email} ${user.id}`}
                        onSelect={() => {
                          onChange({ ...config, recipient: { mode: "SPECIFIC_USER", userId: user.id } })
                          setRecipientPickerOpen(false)
                        }}
                      >
                        <Check className={cn(
                          "size-4",
                          user.id === specificUserId ? "opacity-100" : "opacity-0",
                        )} />
                        <span className="min-w-0 flex-1 truncate">{user.name}</span>
                        <span className="truncate text-xs text-slate-500">{user.email}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {!selectedUser ? (
            <p className="text-xs text-rose-600">Select an active teammate.</p>
          ) : null}
        </Field>
      ) : (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-4 text-slate-600">
          The contact must have an active assignee when this action runs.
        </p>
      )}

      <ContactTemplateInput
        id={`${actionKey}-notification-title`}
        label="Title"
        value={config.titleTemplate}
        maxLength={160}
        catalog={catalog}
        timezone={timezone}
        automationOutputs={automationOutputs}
        error={titleError}
        onChange={(titleTemplate) => onChange({ ...config, titleTemplate })}
        placeholder="Policy review needed for {contact.name}"
      />
      <ContactTemplateInput
        id={`${actionKey}-notification-body`}
        label="Message (optional)"
        value={config.bodyTemplate ?? ""}
        maxLength={1_000}
        catalog={catalog}
        timezone={timezone}
        automationOutputs={automationOutputs}
        error={bodyError}
        onChange={(bodyTemplate) => onChange({ ...config, bodyTemplate })}
        multiline
        placeholder="Add context for the teammate"
      />
    </section>
  )
}

function TaskActionEditor({
  config,
  catalog,
  timezone,
  automationOutputs,
  onChange,
}: {
  config: AutomationTaskConfig
  catalog: AutomationCatalog
  timezone?: string | null
  automationOutputs: AutomationValueDefinition[]
  onChange: (config: AutomationTaskConfig) => void
}) {
  const nameError = noteTemplateError(config.nameTemplate, 160, catalog, automationOutputs)
  const descriptionError = optionalTemplateError(config.descriptionTemplate, 4_000, catalog, automationOutputs)
  const reminderMessageError = optionalTemplateError(
    config.reminder?.messageTemplate,
    500,
    catalog,
    automationOutputs,
  )
  const defaultDateTime = (): AutomationTaskDateTime => ({
    source: { type: "CURRENT_DATE" },
    time: "17:00",
  })

  return (
    <div className="flex flex-col gap-4">
      <ContactTemplateInput
        id="action-task-name"
        label="Task name"
        value={config.nameTemplate}
        maxLength={160}
        catalog={catalog}
        timezone={timezone}
        automationOutputs={automationOutputs}
        error={nameError}
        onChange={(nameTemplate) => onChange({ ...config, nameTemplate })}
        placeholder="Follow up with {contact.name}"
      />
      <ContactTemplateInput
        id="action-task-description"
        label="Description"
        value={config.descriptionTemplate ?? ""}
        maxLength={4_000}
        catalog={catalog}
        timezone={timezone}
        automationOutputs={automationOutputs}
        error={descriptionError}
        onChange={(descriptionTemplate) => onChange({ ...config, descriptionTemplate })}
        multiline
        placeholder="Add task details"
      />

      <Field className="gap-2">
        <FieldLabel htmlFor="action-task-status">Status</FieldLabel>
        <Select
          value={config.statusConfigId}
          onValueChange={(statusConfigId) => onChange({ ...config, statusConfigId })}
        >
          <SelectTrigger id="action-task-status" className={COMPACT_SELECT_TRIGGER_CLASS}>
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            {catalog.taskStatuses.map((status) => (
              <SelectItem key={status.id} value={status.id}>{status.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field className="gap-2">
        <FieldLabel htmlFor="action-task-assignee-mode">Assignee</FieldLabel>
        <Select
          value={config.assignee.mode}
          onValueChange={(mode: AutomationTaskConfig["assignee"]["mode"]) => {
            if (mode === "SPECIFIC_USER") {
              onChange({
                ...config,
                assignee: { mode, userId: catalog.users[0]?.id ?? "" },
              })
            } else {
              onChange({
                ...config,
                assignee: { mode },
                reminder: mode === "UNASSIGNED" ? null : config.reminder,
              })
            }
          }}
        >
          <SelectTrigger id="action-task-assignee-mode" className={COMPACT_SELECT_TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CONTACT_ASSIGNEE">Contact assignee</SelectItem>
            <SelectItem value="SPECIFIC_USER">Specific teammate</SelectItem>
            <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {config.assignee.mode === "SPECIFIC_USER" ? (
        <Field className="gap-2">
          <FieldLabel htmlFor="action-task-assignee">Teammate</FieldLabel>
          <Select
            value={config.assignee.userId}
            onValueChange={(userId) => onChange({
              ...config,
              assignee: { mode: "SPECIFIC_USER", userId },
            })}
          >
            <SelectTrigger id="action-task-assignee" className={COMPACT_SELECT_TRIGGER_CLASS}>
              <SelectValue placeholder="Select teammate" />
            </SelectTrigger>
            <SelectContent>
              {catalog.users.map((user) => (
                <SelectItem key={user.id} value={user.id}>{user.name} · {user.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      <Field className="gap-2">
        <FieldLabel htmlFor="action-task-service">Linked service</FieldLabel>
        <Select
          value={config.linkedService?.id ?? "__none__"}
          onValueChange={(serviceId) => {
            const service = catalog.services.find((item) => item.id === serviceId)
            onChange({
              ...config,
              linkedService: service
                ? { id: service.id, nameSnapshot: service.name }
                : null,
            })
          }}
        >
          <SelectTrigger id="action-task-service" className={COMPACT_SELECT_TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No linked service</SelectItem>
            {catalog.services.map((service) => (
              <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Separator />

      <div className="flex items-center gap-2">
        <Checkbox
          id="action-task-due-enabled"
          checked={Boolean(config.dueAt)}
          onCheckedChange={(checked) => onChange({
            ...config,
            dueAt: checked ? config.dueAt ?? defaultDateTime() : null,
            reminder: checked ? config.reminder : null,
          })}
        />
        <Label htmlFor="action-task-due-enabled" className="text-sm font-medium">Set due date</Label>
      </div>
      {config.dueAt ? (
        <TaskDateTimeEditor
          idPrefix="action-task-due"
          label="Due date and time"
          value={config.dueAt}
          catalog={catalog}
          timezone={timezone}
          onChange={(dueAt) => onChange({ ...config, dueAt })}
        />
      ) : null}

      <div className="flex items-center gap-2">
        <Checkbox
          id="action-task-reminder-enabled"
          checked={Boolean(config.reminder)}
          disabled={!config.dueAt || config.assignee.mode === "UNASSIGNED"}
          onCheckedChange={(checked) => onChange({
            ...config,
            reminder: checked
              ? {
                  at: config.dueAt ?? defaultDateTime(),
                  messageTemplate: "",
                }
              : null,
          })}
        />
        <Label htmlFor="action-task-reminder-enabled" className="text-sm font-medium">Set reminder</Label>
      </div>
      {config.reminder ? (
        <>
          <TaskDateTimeEditor
            idPrefix="action-task-reminder"
            label="Reminder date and time"
            value={config.reminder.at}
            catalog={catalog}
            timezone={timezone}
            onChange={(at) => onChange({
              ...config,
              reminder: config.reminder ? { ...config.reminder, at } : null,
            })}
          />
          <ContactTemplateInput
            id="action-task-reminder-message"
            label="Reminder message"
            value={config.reminder.messageTemplate ?? ""}
            maxLength={500}
            catalog={catalog}
            timezone={timezone}
            automationOutputs={automationOutputs}
            error={reminderMessageError}
            onChange={(messageTemplate) => onChange({
              ...config,
              reminder: config.reminder
                ? { ...config.reminder, messageTemplate }
                : null,
            })}
            multiline
            placeholder="Optional reminder message"
          />
        </>
      ) : null}
    </div>
  )
}

function goToDestinationLabel(action: AutomationAction) {
  if (action.type === "CREATE_CONTACT") return action.createContactConfig?.actionName.trim() || "Create contact"
  if (action.type === "SEND_INTERNAL_NOTIFICATION") return action.internalNotificationConfig?.actionName.trim() || "Internal notification"
  if (action.type === "FORMAT_TEXT") return action.textFormatterConfig?.actionName.trim() || "Text formatter"
  if (action.type === "UPDATE_OPPORTUNITY") return action.opportunityConfig?.actionName.trim() || "Update/create opportunity"
  if (action.type === "DELETE_OPPORTUNITY") return action.deleteOpportunityConfig?.actionName.trim() || "Delete opportunity"
  if (action.type === "ADD_TO_WORKFLOW") return action.addToWorkflowConfig?.actionName.trim() || "Add to workflow"
  if (action.type === "REMOVE_FROM_WORKFLOW") return action.removeFromWorkflowConfig?.actionName.trim() || "Remove from workflow"
  if (action.type === "IF_ELSE") return action.ifElseConfig?.actionName.trim() || "If/Else"
  if (action.type === "SPLIT") return action.splitConfig?.actionName.trim() || "Split"
  return ACTION_LABELS[action.type]
}

function workflowTargetCycleReason(
  catalog: AutomationCatalog,
  sourceAutomationId: string | undefined,
  targetAutomationId: string,
) {
  if (!sourceAutomationId) return null
  if (sourceAutomationId === targetAutomationId) return "A workflow cannot start itself."
  const byId = new Map(catalog.workflowAutomations.map((automation) => [automation.id, automation]))
  const visited = new Set<string>()
  const reachesSource = (automationId: string): boolean => {
    if (automationId === sourceAutomationId) return true
    if (visited.has(automationId)) return false
    visited.add(automationId)
    return (byId.get(automationId)?.targetAutomationIds ?? []).some(reachesSource)
  }
  return reachesSource(targetAutomationId)
    ? "This workflow already leads back to the current workflow."
    : null
}

function AddToWorkflowActionEditor({
  config,
  catalog,
  sourceAutomationId,
  onChange,
}: {
  config: NonNullable<AutomationAction["addToWorkflowConfig"]>
  catalog: AutomationCatalog
  sourceAutomationId?: string
  onChange: (config: NonNullable<AutomationAction["addToWorkflowConfig"]>) => void
}) {
  const [open, setOpen] = useState(false)
  const targets = catalog.workflowAutomations.filter((automation) => automation.id !== sourceAutomationId)
  const selected = targets.find((automation) => automation.id === config.targetAutomationId)

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-2.5">
        <Workflow className="mt-0.5 size-4 shrink-0 text-violet-600" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-950">Workflow start</p>
          <p className="text-xs leading-4 text-slate-600">
            Starts the selected workflow at its first action without checking its entry rules.
          </p>
        </div>
      </div>
      <Field>
        <FieldLabel htmlFor="add-to-workflow-action-name">Action name</FieldLabel>
        <Input
          id="add-to-workflow-action-name"
          value={config.actionName}
          maxLength={120}
          onChange={(event) => onChange({ ...config, actionName: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel>Published workflow</FieldLabel>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="h-9 w-full justify-between bg-white px-3 font-normal"
            >
              <span className="truncate">{(selected?.name ?? config.targetAutomationNameSnapshot) || "Select workflow"}</span>
              <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search workflows…" />
              <CommandList>
                <CommandEmpty>No published workflows found.</CommandEmpty>
                <CommandGroup>
                  {targets.map((automation) => {
                    const cycleReason = workflowTargetCycleReason(catalog, sourceAutomationId, automation.id)
                    return (
                      <CommandItem
                        key={automation.id}
                        value={`${automation.name} ${automation.id}`}
                        disabled={Boolean(cycleReason)}
                        onSelect={() => {
                          if (cycleReason) return
                          onChange({
                            ...config,
                            targetAutomationId: automation.id,
                            targetAutomationNameSnapshot: automation.name,
                          })
                          setOpen(false)
                        }}
                      >
                        <Check className={cn("size-4", automation.id === config.targetAutomationId ? "opacity-100" : "opacity-0")} />
                        <span className="min-w-0 flex-1 truncate">{automation.name}</span>
                        {cycleReason ? <span className="text-xs text-rose-600">Creates loop</span> : null}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </Field>
      {targets.length === 0 ? (
        <p className="text-xs leading-4 text-slate-600">Publish another automation before selecting it here.</p>
      ) : null}
    </section>
  )
}

function RemoveFromWorkflowActionEditor({
  config,
  catalog,
  sourceAutomationId,
  onChange,
}: {
  config: NonNullable<AutomationAction["removeFromWorkflowConfig"]>
  catalog: AutomationCatalog
  sourceAutomationId?: string
  onChange: (config: NonNullable<AutomationAction["removeFromWorkflowConfig"]>) => void
}) {
  const [open, setOpen] = useState(false)
  const targets = catalog.workflowAutomations
  const selected = targets.find((automation) => automation.id === config.targetAutomationId)
  const targetsCurrentWorkflow = Boolean(sourceAutomationId && config.targetAutomationId === sourceAutomationId)

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-2.5">
        <Unlink2 className="mt-0.5 size-4 shrink-0 text-rose-600" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-950">Workflow removal</p>
          <p className="text-xs leading-4 text-slate-600">
            Ends every active instance of the selected workflow for this contact. The contact can enter it again later.
          </p>
        </div>
      </div>
      <Field>
        <FieldLabel htmlFor="remove-from-workflow-action-name">Action name</FieldLabel>
        <Input
          id="remove-from-workflow-action-name"
          value={config.actionName}
          maxLength={120}
          onChange={(event) => onChange({ ...config, actionName: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel>Published workflow</FieldLabel>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="h-9 w-full justify-between bg-white px-3 font-normal"
            >
              <span className="truncate">{(selected?.name ?? config.targetAutomationNameSnapshot) || "Select workflow"}</span>
              <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search workflows…" />
              <CommandList>
                <CommandEmpty>No published workflows found.</CommandEmpty>
                <CommandGroup>
                  {targets.map((automation) => (
                    <CommandItem
                      key={automation.id}
                      value={`${automation.name} ${automation.id}`}
                      onSelect={() => {
                        onChange({
                          ...config,
                          targetAutomationId: automation.id,
                          targetAutomationNameSnapshot: automation.name,
                        })
                        setOpen(false)
                      }}
                    >
                      <Check className={cn("size-4", automation.id === config.targetAutomationId ? "opacity-100" : "opacity-0")} />
                      <span className="min-w-0 flex-1 truncate">{automation.name}</span>
                      {automation.id === sourceAutomationId ? <span className="text-xs text-slate-500">Current</span> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </Field>
      {targetsCurrentWorkflow ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-4 text-slate-600">
          This ends the current run at this action and skips every later action on its path.
        </p>
      ) : null}
      {targets.length === 0 ? (
        <p className="text-xs leading-4 text-slate-600">Publish an automation before selecting it here.</p>
      ) : null}
    </section>
  )
}

function GoToActionEditor({
  config,
  destinations,
  issue,
  isPickingOnCanvas,
  onChange,
  onPickOnCanvas,
}: {
  config: NonNullable<AutomationAction["goToConfig"]>
  destinations: ReturnType<typeof automationGoToDestinations>
  issue?: string | null
  isPickingOnCanvas: boolean
  onChange: (config: NonNullable<AutomationAction["goToConfig"]>) => void
  onPickOnCanvas: () => void
}) {
  const [open, setOpen] = useState(false)
  const selectedDestination = destinations.find((destination) => destination.nodeKey === config.targetNodeKey)
  const grouped = destinations.reduce((groups, destination) => {
    const label = destination.breadcrumb.join(" › ")
    const group = groups.get(label) ?? []
    group.push(destination)
    groups.set(label, group)
    return groups
  }, new Map<string, typeof destinations>())

  return (
    <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/70 p-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-950">Destination</p>
        <p className="text-xs leading-4 text-slate-600">
          The run continues at this action and does not return to the current path.
        </p>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-9 w-full justify-between rounded-full border-slate-200 bg-white px-3 text-sm font-normal"
          >
            <span className="min-w-0 truncate">
              {selectedDestination
                ? goToDestinationLabel(selectedDestination.action)
                : "Select destination"}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-72 overflow-hidden rounded-xl p-0">
          <Command>
            <CommandInput placeholder="Search actions" />
            <CommandList className="max-h-72">
              <CommandEmpty>No available actions found.</CommandEmpty>
              {[...grouped.entries()].map(([breadcrumb, options]) => (
                <CommandGroup key={breadcrumb} heading={breadcrumb}>
                  {options.map((destination) => (
                    <CommandItem
                      key={destination.nodeKey}
                      value={`${breadcrumb} ${goToDestinationLabel(destination.action)} ${destination.nodeKey}`}
                      disabled={Boolean(destination.issue)}
                      title={destination.issue ?? undefined}
                      onSelect={() => {
                        if (destination.issue) return
                        onChange({ targetNodeKey: destination.nodeKey })
                        setOpen(false)
                      }}
                    >
                      <RouteIcon className="size-4 text-violet-600" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{goToDestinationLabel(destination.action)}</span>
                      {config.targetNodeKey === destination.nodeKey ? <Check className="size-4" aria-hidden="true" /> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="outline"
        className={cn(COMPACT_SECONDARY_BUTTON_CLASS, "w-full", isPickingOnCanvas && "border-emerald-300 bg-emerald-50 text-emerald-800")}
        onClick={onPickOnCanvas}
      >
        <MousePointerClick data-icon="inline-start" aria-hidden="true" />
        {isPickingOnCanvas ? "Select an action on the canvas" : "Pick on canvas"}
      </Button>
      {destinations.every((destination) => destination.issue) ? (
        <p className="text-xs leading-4 text-amber-700">No cycle-safe destination is available yet.</p>
      ) : issue ? (
        <p className="text-xs leading-4 text-rose-700">{issue}</p>
      ) : null}
    </section>
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
          <Field data-invalid={!Number.isSafeInteger(config.amount) || config.amount <= 0}>
            <WaitIntegerInput
              id="wait-amount"
              value={config.amount}
              ariaLabel="Wait amount"
              onChange={(amount) => onChange({ ...config, amount })}
            />
          </Field>
          <Field>
            <Select value={config.unit} onValueChange={(unit) => onChange({ ...config, unit: unit as AutomationWaitUnit })}>
              <SelectTrigger id="wait-unit" aria-label="Wait unit" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
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
              <Field data-invalid={!Number.isSafeInteger(config.offsetAmount) || (config.offsetAmount ?? 0) <= 0}>
                <WaitIntegerInput
                  id="wait-offset-amount"
                  value={config.offsetAmount ?? 1}
                  ariaLabel="Wait offset amount"
                  onChange={(offsetAmount) => onChange({ ...config, offsetAmount })}
                />
              </Field>
              <Field>
                <Select value={config.offsetUnit ?? "HOURS"} onValueChange={(unit) => onChange({ ...config, offsetUnit: unit as AutomationWaitUnit })}>
                  <SelectTrigger id="wait-offset-unit" aria-label="Wait offset unit" className={COMPACT_SELECT_TRIGGER_CLASS}><SelectValue /></SelectTrigger>
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

function WaitIntegerInput({
  id,
  value,
  ariaLabel,
  onChange,
}: {
  id: string
  value: number
  ariaLabel: string
  onChange: (value: number) => void
}) {
  const [draftValue, setDraftValue] = useState(Number.isFinite(value) ? String(value) : "")
  const invalid = !Number.isSafeInteger(value) || value <= 0

  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      value={draftValue}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      className="h-8 rounded-full"
      onChange={(event) => {
        const parsed = parseAutomationWaitIntegerDraft(event.target.value)
        if (!parsed) return
        setDraftValue(parsed.draft)
        onChange(parsed.value)
      }}
    />
  )
}

function dateOnlyDisplayValue(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ""
  const [year, month, day] = value.split("-")
  return `${month}/${day}/${year}`
}

function serializeLocalDate(value: Date | undefined) {
  if (!value) return ""
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function DateOnlyActionValueInput({
  id,
  value,
  onChange,
  disableFuture = false,
}: {
  id: string
  value: unknown
  onChange: (value: string) => void
  disableFuture?: boolean
}) {
  const displayValue = dateOnlyDisplayValue(value)
  return (
    <DateOnlyActionValueInputDraft
      key={displayValue}
      id={id}
      initialValue={displayValue}
      disableFuture={disableFuture}
      onChange={onChange}
    />
  )
}

function DateOnlyActionValueInputDraft({
  id,
  initialValue,
  onChange,
  disableFuture,
}: {
  id: string
  initialValue: string
  onChange: (value: string) => void
  disableFuture: boolean
}) {
  const [draftValue, setDraftValue] = useState(initialValue)
  return (
    <DateInput
      id={id}
      value={draftValue}
      onValueChange={setDraftValue}
      onDateChange={(date) => onChange(serializeLocalDate(date))}
      disabledDate={disableFuture ? (date) => date > new Date() : () => false}
      className="[&_input]:h-8 [&_input]:rounded-full [&_button]:h-8 [&_button]:rounded-full"
    />
  )
}

function createContactDefaultSource(field: AutomationValueField): AutomationCreateContactValueSource {
  return createContactUsesTemplate(field.fieldType)
    ? { type: "TEMPLATE", template: "" }
    : { type: "FIXED", value: defaultFieldUpdateValue(field) }
}

function CreateContactTypedSourceEditor({
  idPrefix,
  field,
  source,
  catalog,
  automationOutputs,
  customFieldId,
  disableFuture = false,
  onChange,
}: {
  idPrefix: string
  field: AutomationValueField
  source: AutomationCreateContactTypedSource
  catalog: AutomationCatalog
  automationOutputs: AutomationValueDefinition[]
  customFieldId?: string
  disableFuture?: boolean
  onChange: (source: AutomationCreateContactTypedSource) => void
}) {
  const contactFields = catalog.templateFields.contact.filter((candidate) =>
    createContactSourceFieldIsCompatible(field.fieldType, candidate.fieldType),
  )
  const customFields = catalog.customFields.filter((candidate) =>
    createContactSourceFieldIsCompatible(field.fieldType, candidate.fieldType),
  )
  const outputs = automationOutputs.filter((candidate) =>
    createContactAutomationValueIsCompatible(field.fieldType, candidate.valueKind),
  )
  const sourceValue = source.type === "FIXED"
    ? "fixed"
    : source.type === "CONTACT_FIELD"
      ? `contact:${source.key}`
      : source.type === "CUSTOM_FIELD"
        ? `custom:${source.key}`
        : `automation:${source.key}`
  const sourceReady = isCreateContactTypedSourceReady(
    source,
    field,
    catalog,
    automationOutputs,
    customFieldId,
  )

  const selectSource = (value: string) => {
    if (value === "fixed") {
      onChange({ type: "FIXED", value: defaultFieldUpdateValue(field) })
      return
    }
    const [category, key = ""] = value.split(":", 2)
    onChange(category === "contact"
      ? { type: "CONTACT_FIELD", key }
      : category === "custom"
        ? { type: "CUSTOM_FIELD", key }
        : { type: "AUTOMATION_VALUE", key })
  }

  return (
    <div className="flex flex-col gap-2">
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${idPrefix}-source`} className="text-xs">Value source</FieldLabel>
        <Select value={sourceValue} onValueChange={selectSource}>
          <SelectTrigger id={`${idPrefix}-source`} className={COMPACT_SELECT_TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">Fixed value</SelectItem>
            {contactFields.length > 0 ? (
              <SelectGroup>
                <SelectLabel>Current contact</SelectLabel>
                {contactFields.map((candidate) => (
                  <SelectItem key={`contact:${candidate.key}`} value={`contact:${candidate.key}`}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
            {customFields.length > 0 ? (
              <SelectGroup>
                <SelectLabel>Current contact custom fields</SelectLabel>
                {customFields.map((candidate) => (
                  <SelectItem key={`custom:${candidate.key}`} value={`custom:${candidate.key}`}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
            {outputs.length > 0 ? (
              <SelectGroup>
                <SelectLabel>Earlier automation values</SelectLabel>
                {outputs.map((candidate) => (
                  <SelectItem key={`automation:${candidate.key}`} value={`automation:${candidate.key}`}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
          </SelectContent>
        </Select>
      </Field>
      {source.type === "FIXED" ? (
        field.fieldType === "DATE" ? (
          <DateOnlyActionValueInput
            id={`${idPrefix}-value`}
            value={source.value}
            disableFuture={disableFuture}
            onChange={(value) => onChange({ type: "FIXED", value })}
          />
        ) : (
          <ActionValueInput
            id={`${idPrefix}-value`}
            value={source.value}
            field={field}
            onChange={(value) => onChange({ type: "FIXED", value })}
          />
        )
      ) : null}
      {!sourceReady ? (
        <p className="text-xs text-destructive">
          {source.type === "FIXED"
            ? "Enter a valid value."
            : source.type === "AUTOMATION_VALUE"
              ? "Choose a compatible value created earlier on this path."
              : "Choose an available field with a compatible type."}
        </p>
      ) : null}
    </div>
  )
}

function CreateContactActionEditor({
  actionKey,
  config,
  catalog,
  timezone,
  automationOutputs,
  onChange,
}: {
  actionKey: string
  config: AutomationCreateContactConfig
  catalog: AutomationCatalog
  timezone?: string | null
  automationOutputs: AutomationValueDefinition[]
  onChange: (config: AutomationCreateContactConfig) => void
}) {
  const assignments = config.customFieldValues
  const selectedFieldIds = new Set(assignments.map((assignment) => assignment.customFieldId))
  const unusedFields = catalog.customFields.filter((field) => !selectedFieldIds.has(field.id))
  const customFieldOptions = unusedFields.map((field) => ({
    value: `custom:${field.id}`,
    label: field.label,
    searchText: field.key,
  }))
  const firstNameError = createContactNameTemplateError(
    "First name",
    config.firstNameTemplate,
    false,
    catalog,
    automationOutputs,
  )
  const middleNameError = createContactNameTemplateError(
    "Middle name",
    config.middleNameTemplate,
    true,
    catalog,
    automationOutputs,
  )
  const lastNameError = createContactNameTemplateError(
    "Last name",
    config.lastNameTemplate,
    false,
    catalog,
    automationOutputs,
  )
  const emailError = createContactEmailTemplateError(config.emailTemplate, catalog, automationOutputs)
  const phoneError = createContactPhoneTemplateError(config.phoneTemplate, catalog, automationOutputs)
  const duplicateCustomFields = new Set(assignments.map((assignment) => assignment.customFieldId)).size !== assignments.length
  const replaceAssignment = (
    index: number,
    assignment: AutomationCreateContactConfig["customFieldValues"][number],
  ) => onChange({
    ...config,
    customFieldValues: assignments.map((item, itemIndex) => itemIndex === index ? assignment : item),
  })

  return (
    <div className="flex flex-col gap-4">
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${actionKey}-name`}>Action name</FieldLabel>
        <Input
          id={`${actionKey}-name`}
          value={config.actionName}
          maxLength={120}
          onChange={(event) => onChange({ ...config, actionName: event.target.value })}
          className="h-8 rounded-full"
          placeholder="Create contact"
        />
        {!config.actionName.trim() ? (
          <p className="text-xs text-destructive">Enter an action name.</p>
        ) : null}
      </Field>

      <ContactTemplateInput
        id={`${actionKey}-first-name`}
        label="First name"
        value={config.firstNameTemplate}
        maxLength={1_000}
        catalog={catalog}
        timezone={timezone}
        automationOutputs={automationOutputs}
        error={firstNameError}
        onChange={(firstNameTemplate) => onChange({ ...config, firstNameTemplate })}
        placeholder="First name or {contact.first_name}"
      />
      <ContactTemplateInput
        id={`${actionKey}-middle-name`}
        label="Middle name"
        value={config.middleNameTemplate ?? ""}
        maxLength={1_000}
        catalog={catalog}
        timezone={timezone}
        automationOutputs={automationOutputs}
        error={middleNameError}
        onChange={(middleNameTemplate) => onChange({ ...config, middleNameTemplate })}
        placeholder="Optional"
      />
      <ContactTemplateInput
        id={`${actionKey}-last-name`}
        label="Last name"
        value={config.lastNameTemplate}
        maxLength={1_000}
        catalog={catalog}
        timezone={timezone}
        automationOutputs={automationOutputs}
        error={lastNameError}
        onChange={(lastNameTemplate) => onChange({ ...config, lastNameTemplate })}
        placeholder="Last name or {contact.last_name}"
      />
      <ContactTemplateInput
        id={`${actionKey}-email`}
        label="Email"
        value={config.emailTemplate ?? ""}
        maxLength={1_000}
        catalog={catalog}
        timezone={timezone}
        automationOutputs={automationOutputs}
        error={emailError}
        onChange={(emailTemplate) => onChange({ ...config, emailTemplate })}
        placeholder="Optional email or {contact.email}"
      />
      <ContactTemplateInput
        id={`${actionKey}-phone`}
        label="Phone"
        value={config.phoneTemplate ?? ""}
        maxLength={1_000}
        catalog={catalog}
        timezone={timezone}
        automationOutputs={automationOutputs}
        error={phoneError}
        onChange={(phoneTemplate) => onChange({ ...config, phoneTemplate })}
        placeholder="+15551234567 or a phone token"
      />

      <Field className="gap-2">
        <FieldLabel htmlFor={`${actionKey}-status`}>Contact status</FieldLabel>
        <Select
          value={config.statusConfigId}
          onValueChange={(statusConfigId) => onChange({ ...config, statusConfigId })}
        >
          <SelectTrigger id={`${actionKey}-status`} className={COMPACT_SELECT_TRIGGER_CLASS}>
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            {catalog.statuses.map((status) => (
              <SelectItem key={status.id} value={status.id}>{status.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!catalog.statuses.some((status) => status.id === config.statusConfigId) ? (
          <p className="text-xs text-destructive">Choose an active contact status.</p>
        ) : null}
      </Field>

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${actionKey}-birthday-enabled`}
            checked={Boolean(config.dateOfBirth)}
            onCheckedChange={(checked) => onChange({
              ...config,
              dateOfBirth: checked ? config.dateOfBirth ?? { type: "FIXED", value: "" } : null,
            })}
          />
          <Label htmlFor={`${actionKey}-birthday-enabled`} className="text-sm font-medium">
            Set birthday
          </Label>
        </div>
        {config.dateOfBirth ? (
          <div className="mt-3">
            <CreateContactTypedSourceEditor
              idPrefix={`${actionKey}-birthday`}
              field={{ label: "Date of birth", fieldType: "DATE", isRequired: false, options: [] }}
              source={config.dateOfBirth}
              catalog={catalog}
              automationOutputs={automationOutputs}
              disableFuture
              onChange={(dateOfBirth) => onChange({ ...config, dateOfBirth })}
            />
          </div>
        ) : null}
      </div>

      <Separator />
      <div>
        <p className="text-sm font-semibold text-slate-900">Custom fields</p>
        <p className="mt-1 text-xs text-slate-500">
          Optional values are written only to the new contact.
        </p>
        {assignments.length > 20 ? (
          <p className="mt-1 text-xs text-destructive">Use no more than 20 custom fields.</p>
        ) : null}
        {duplicateCustomFields ? (
          <p className="mt-1 text-xs text-destructive">Each custom field can only be added once.</p>
        ) : null}
      </div>
      {assignments.map((assignment, index) => {
        const field = catalog.customFields.find((candidate) => candidate.id === assignment.customFieldId)
        const fieldOptions = catalog.customFields.filter(
          (candidate) => candidate.id === field?.id || !selectedFieldIds.has(candidate.id),
        ).map((candidate) => ({
          value: `custom:${candidate.id}`,
          label: candidate.label,
          searchText: candidate.key,
        }))
        return (
          <div key={`${assignment.customFieldId}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-600">Custom field {index + 1}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                aria-label={`Remove custom field ${index + 1}`}
                onClick={() => onChange({
                  ...config,
                  customFieldValues: assignments.filter((_, itemIndex) => itemIndex !== index),
                })}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <AutomationFieldPicker
              value={`custom:${assignment.customFieldId}`}
              contactFields={[]}
              customFields={fieldOptions}
              ariaLabel={`New contact custom field ${index + 1}`}
              onValueChange={(reference) => {
                const nextField = catalog.customFields.find(
                  (candidate) => candidate.id === reference.replace(/^custom:/, ""),
                )
                if (!nextField) return
                replaceAssignment(index, {
                  customFieldId: nextField.id,
                  source: createContactDefaultSource(nextField),
                })
              }}
            />
            {field ? (
              <div className="mt-3">
                {createContactUsesTemplate(field.fieldType) ? (
                  <ContactTemplateInput
                    id={`${actionKey}-custom-${index}`}
                    label="Value"
                    value={assignment.source.type === "TEMPLATE" ? assignment.source.template : ""}
                    maxLength={1_000}
                    catalog={catalog}
                    timezone={timezone}
                    automationOutputs={automationOutputs}
                    error={assignment.source.type === "TEMPLATE"
                      ? noteTemplateError(assignment.source.template, 1_000, catalog, automationOutputs)
                      : "Choose a template value."}
                    onChange={(template) => replaceAssignment(index, {
                      ...assignment,
                      source: { type: "TEMPLATE", template },
                    })}
                    multiline={field.fieldType === "TEXTAREA"}
                    placeholder={field.fieldType === "PHONE" ? "+15551234567 or a phone token" : "Enter a value or insert data"}
                  />
                ) : assignment.source.type !== "TEMPLATE" ? (
                  <CreateContactTypedSourceEditor
                    idPrefix={`${actionKey}-custom-${index}`}
                    field={field}
                    source={assignment.source}
                    catalog={catalog}
                    automationOutputs={automationOutputs}
                    customFieldId={field.id}
                    onChange={(source) => replaceAssignment(index, { ...assignment, source })}
                  />
                ) : null}
              </div>
            ) : <p className="mt-2 text-xs text-destructive">This custom field is unavailable.</p>}
          </div>
        )
      })}
      <AutomationFieldPicker
        mode="add"
        ariaLabel="Add new contact custom field"
        contactFields={[]}
        customFields={customFieldOptions}
        disabled={assignments.length >= 20 || unusedFields.length === 0}
        onValueChange={(reference) => {
          const field = catalog.customFields.find(
            (candidate) => candidate.id === reference.replace(/^custom:/, ""),
          )
          if (!field) return
          onChange({
            ...config,
            customFieldValues: [
              ...assignments,
              { customFieldId: field.id, source: createContactDefaultSource(field) },
            ],
          })
        }}
      />
      <p className="rounded-xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
        If the rendered email or phone already belongs to a contact, this action is skipped successfully. Later actions continue on the original contact.
      </p>
    </div>
  )
}

function ContactFieldUpdatesEditor({
  action,
  catalog,
  onChange,
}: {
  action: AutomationAction
  catalog: AutomationCatalog
  onChange: (action: AutomationAction) => void
}) {
  const updates = action.customFieldUpdates ?? []
  const selectedIds = new Set(updates.map(updateIdentity))
  const unusedContactFields = catalog.contactUpdateFields.filter(
    (field) => !selectedIds.has(`contact:${field.key}`),
  )
  const unusedCustomFields = catalog.customFields.filter(
    (field) => !selectedIds.has(`custom:${field.id}`),
  )
  const unusedContactFieldOptions = unusedContactFields.map((field) => ({
    value: `contact:${field.key}`,
    label: field.label,
    searchText: field.key,
  }))
  const unusedCustomFieldOptions = unusedCustomFields.map((field) => ({
    value: `custom:${field.id}`,
    label: field.label,
    searchText: field.key,
  }))

  const replaceUpdate = (index: number, update: AutomationFieldUpdate) => {
    onChange({
      ...action,
      customFieldUpdates: updates.map((item, itemIndex) => itemIndex === index ? update : item),
    })
  }

  const removeUpdate = (index: number) => {
    onChange({
      ...action,
      customFieldUpdates: updates.filter((_, itemIndex) => itemIndex !== index),
    })
  }

  const addUpdate = (fieldReference: string) => {
    if (updates.length >= 20) return
    const update = fieldUpdateForReference(fieldReference, "SET", catalog)
    if (!update) return
    onChange({
      ...action,
      customFieldUpdates: [...updates, update],
    })
  }

  return (
    <div className="flex flex-col gap-2.5">
      {updates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
          Add a contact field to update.
        </div>
      ) : null}

      {updates.map((update, index) => {
        const contactField = "contactFieldKey" in update
          ? catalog.contactUpdateFields.find((item) => item.key === update.contactFieldKey)
          : undefined
        const customField = "customFieldId" in update
          ? catalog.customFields.find((item) => item.id === update.customFieldId)
          : undefined
        const field: AutomationValueField | undefined = contactField
          ? contactValueField(contactField)
          : customField
        const contactFieldOptions = catalog.contactUpdateFields.filter(
          (item) => item.key === contactField?.key || !selectedIds.has(`contact:${item.key}`),
        ).map((item) => ({
          value: `contact:${item.key}`,
          label: item.label,
          searchText: item.key,
        }))
        const customFieldOptions = catalog.customFields.filter(
          (item) => item.id === customField?.id || !selectedIds.has(`custom:${item.id}`),
        ).map((item) => ({
          value: `custom:${item.id}`,
          label: item.label,
          searchText: item.key,
        }))
        const inputId = `contact-field-update-${action.nodeKey ?? "new"}-${index}`
        const selectedValue = contactField
          ? `contact:${contactField.key}`
          : customField
            ? `custom:${customField.id}`
            : ""
        return (
          <div key={`${updateIdentity(update)}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-600">Field {index + 1}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                aria-label={`Remove field ${index + 1}`}
                onClick={() => removeUpdate(index)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-[minmax(0,1.45fr)_minmax(0,0.85fr)] gap-2">
              <AutomationFieldPicker
                value={selectedValue}
                contactFields={contactFieldOptions}
                customFields={customFieldOptions}
                ariaLabel={`Contact field ${index + 1}`}
                onValueChange={(fieldReference) => {
                  const nextUpdate = fieldUpdateForReference(fieldReference, update.operation, catalog)
                  if (nextUpdate) replaceUpdate(index, nextUpdate)
                }}
              />
              <Select
                value={update.operation}
                onValueChange={(operation: "SET" | "CLEAR") => {
                  if (!field) return
                  if (contactField) {
                    replaceUpdate(index, operation === "CLEAR"
                      ? { contactFieldKey: contactField.key, operation }
                      : {
                          contactFieldKey: contactField.key,
                          operation,
                          value: defaultFieldUpdateValue(field),
                        })
                    return
                  }
                  if (!customField) return
                  replaceUpdate(index, operation === "CLEAR"
                    ? { customFieldId: customField.id, operation }
                    : {
                        customFieldId: customField.id,
                        operation,
                        value: defaultFieldUpdateValue(field),
                      })
                }}
              >
                <SelectTrigger aria-label={`Update operation ${index + 1}`} className={COMPACT_SELECT_TRIGGER_CLASS}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SET">Set value</SelectItem>
                  <SelectItem value="CLEAR" disabled={field?.isRequired}>Clear value</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {field && update.operation === "SET" ? (
              <div className="mt-2">
                <ActionValueInput
                  id={inputId}
                  value={update.value}
                  field={field}
                  onChange={(value) => replaceUpdate(index, { ...update, value })}
                />
              </div>
            ) : null}
          </div>
        )
      })}

      <AutomationFieldPicker
        mode="add"
        ariaLabel="Add contact field"
        contactFields={unusedContactFieldOptions}
        customFields={unusedCustomFieldOptions}
        disabled={
          updates.length >= 20 ||
          (unusedContactFields.length === 0 && unusedCustomFields.length === 0)
        }
        onValueChange={addUpdate}
      />
    </div>
  )
}

function ActionValueInput({
  id,
  value,
  field,
  onChange,
}: {
  id: string
  value: unknown
  field: AutomationValueField
  onChange: (value: unknown) => void
}) {
  if (field.fieldType === "CHECKBOX") {
    return (
      <label htmlFor={id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5">
        <Checkbox id={id} checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} />
        <span className="text-sm font-medium">Checked</span>
      </label>
    )
  }
  if (field.fieldType === "SELECT" || field.fieldType === "RADIO") {
    return (
      <Select value={String(value ?? "")} onValueChange={onChange}>
        <SelectTrigger aria-label={`${field.label} value`} className={COMPACT_SELECT_TRIGGER_CLASS}>
          <SelectValue placeholder="Select value" />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((option) => (
            <SelectItem key={option} value={option}>
              {field.formatOptionLabels
                ? option.toLocaleLowerCase().replace(/_/g, " ").replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase())
                : option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (field.fieldType === "MULTI_SELECT") {
    return (
      <Input
        id={id}
        aria-label={`${field.label} values`}
        value={Array.isArray(value) ? value.join(", ") : ""}
        onChange={(event) => onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))}
        placeholder="Option A, Option B"
        className="h-8 rounded-full"
      />
    )
  }
  if (field.fieldType === "TEXTAREA") {
    return (
      <Textarea
        id={id}
        aria-label={`${field.label} value`}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-20 resize-y rounded-xl bg-white"
      />
    )
  }
  const type = field.fieldType === "DATE"
    ? "date"
    : field.fieldType === "NUMBER" || field.fieldType === "CURRENCY"
      ? "number"
      : field.fieldType === "EMAIL"
        ? "email"
        : "text"
  const inputValue = type === "number"
    ? typeof value === "number" && Number.isFinite(value) ? value : ""
    : String(value ?? "")
  return (
    <Input
      id={id}
      aria-label={`${field.label} value`}
      type={type}
      value={inputValue}
      maxLength={field.maxLength && field.maxLength > 0 ? field.maxLength : undefined}
      placeholder={field.fieldType === "PHONE" ? "+15551234567" : undefined}
      onChange={(event) => onChange(
        type === "number"
          ? event.target.value === "" ? Number.NaN : event.target.valueAsNumber
          : event.target.value,
      )}
      className="h-8 rounded-full bg-white"
    />
  )
}
