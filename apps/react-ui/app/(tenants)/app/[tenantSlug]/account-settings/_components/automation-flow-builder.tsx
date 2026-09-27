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
import {
  ContactDateValueInput,
  type ContactDateValue,
} from "@/components/contact-date-value-input"
import { ContactTemplateInput } from "@/components/contact-template-input"
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
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/lib/api"
import { validateContactTemplate } from "@/lib/contact-template"
import {
  dateTimeDraftToUtcIso,
  formatUtcIsoToDateTimeDraft,
  type DateTimeDraft,
} from "@/lib/date-time"
import { cn } from "@/lib/utils"

import { AutomationContactsTab } from "./automation-contacts-tab"
import { AutomationExecutionLogsTab } from "./automation-execution-logs-tab"
import { AutomationFieldPicker } from "./automation-field-picker"
import type {
  AutomationAction,
  AutomationCatalog,
  AutomationCondition,
  AutomationDateSource,
  AutomationDateTimeFormatterConfig,
  AutomationFieldUpdate,
  AutomationNumberFormatterConfig,
  AutomationNumberSource,
  AutomationOperator,
  AutomationRecord,
  AutomationTaskConfig,
  AutomationTaskDateTime,
  AutomationTriggerType,
  AutomationValueDefinition,
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
      customFieldUpdates: action.customFieldUpdates,
      statusConfigId: action.statusConfigId,
      assignedUserId: action.assignedUserId,
      tagId: action.tagId,
      waitConfig: action.waitConfig,
      noteTitle: action.noteTitle,
      noteBody: action.noteBody,
      taskConfig: action.taskConfig,
      dateTimeFormatterConfig: action.dateTimeFormatterConfig,
      numberFormatterConfig: action.numberFormatterConfig,
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

type AutomationActionGroupId = "INTERNAL" | "CONTACT" | "COMMUNICATION"

const ACTION_GROUPS: ReadonlyArray<{
  id: AutomationActionGroupId
  label: string
}> = [
  { id: "INTERNAL", label: "Internal actions" },
  { id: "CONTACT", label: "Contact actions" },
  { id: "COMMUNICATION", label: "Communication actions" },
]

const ACTION_DEFINITIONS = {
  WAIT: { label: "Wait", group: "INTERNAL", order: 0 },
  FORMAT_DATE_TIME: { label: "Date/Time formatter", group: "INTERNAL", order: 1 },
  FORMAT_NUMBER: { label: "Number formatter", group: "INTERNAL", order: 2 },
  CREATE_TASK: { label: "Create task", group: "INTERNAL", order: 3 },
  ADD_CONTACT_NOTE: { label: "Add contact note", group: "INTERNAL", order: 4 },
  UPDATE_CONTACT_CUSTOM_FIELDS: { label: "Update contact fields", group: "CONTACT", order: 0 },
  SET_CONTACT_STATUS: { label: "Set contact status", group: "CONTACT", order: 1 },
  SET_CONTACT_ASSIGNEE: { label: "Assign contact", group: "CONTACT", order: 2 },
  CLEAR_CONTACT_ASSIGNEE: { label: "Clear contact assignee", group: "CONTACT", order: 3 },
  ADD_CONTACT_TAG: { label: "Add contact tag", group: "CONTACT", order: 4 },
  REMOVE_CONTACT_TAG: { label: "Remove contact tag", group: "CONTACT", order: 5 },
  DELETE_CONTACT: { label: "Delete contact", group: "CONTACT", order: 6 },
} satisfies Record<AutomationAction["type"], {
  label: string
  group: AutomationActionGroupId
  order: number
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

function actionDefaults(
  type: AutomationAction["type"],
  catalog: AutomationCatalog,
  existingNodeKey?: string,
): AutomationAction {
  const nodeKey = existingNodeKey ?? crypto.randomUUID()
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
  return actions.flatMap((action) => {
    const key = action.type === "FORMAT_DATE_TIME"
      ? action.dateTimeFormatterConfig?.outputKey.trim()
      : action.type === "FORMAT_NUMBER"
        ? action.numberFormatterConfig?.outputKey.trim()
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
        : "TEXT"
    return key && /^[a-z][a-z0-9_]{0,63}$/.test(key)
      ? [{ key, label: key, valueKind }]
      : []
  })
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

function isFormatterSourceReady(source: AutomationDateSource, catalog: AutomationCatalog) {
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
  return catalog.customFields.some(
    (field) => field.key === source.key && field.fieldType === "DATE",
  )
}

function formatterSourceNeedsTime(source: AutomationDateSource) {
  return source.type === "CUSTOM_FIELD" ||
    source.type === "SPECIFIC_DATE" ||
    (source.type === "CONTACT_FIELD" && source.key !== "created_at" && source.key !== "updated_at")
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

function isActionReady(
  action: AutomationAction | null,
  catalog: AutomationCatalog,
  targetActions: AutomationAction[] = [],
  previousActions: AutomationAction[] = [],
) {
  if (!action) return false
  const availableOutputs = formatterOutputs(previousActions)
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
  if (action.type === "FORMAT_DATE_TIME") {
    const config = action.dateTimeFormatterConfig
    if (!config || !/^[a-z][a-z0-9_]{0,63}$/.test(config.outputKey)) return false
    if (availableOutputs.some((output) => output.key === config.outputKey)) return false
    if (config.mode === "COMPARE_DATES") {
      return isFormatterSourceReady(config.from, catalog) &&
        isFormatterSourceReady(config.to, catalog)
    }
    if (!isFormatterSourceReady(config.source, catalog)) return false
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
  const nodeKeys = draft.actions.map((action) => action.nodeKey).filter(Boolean)
  if (nodeKeys.length !== draft.actions.length || new Set(nodeKeys).size !== nodeKeys.length) {
    return "Every action needs a unique step identifier."
  }
  const deleteContactIndex = draft.actions.findIndex((action) => action.type === "DELETE_CONTACT")
  if (deleteContactIndex >= 0 && deleteContactIndex !== draft.actions.length - 1) {
    return "Delete contact can only be the last action in the automation."
  }
  for (let index = 0; index < draft.actions.length; index += 1) {
    if (!isActionReady(
      draft.actions[index] ?? null,
      catalog,
      draft.actions.slice(index + 1),
      draft.actions.slice(0, index),
    )) {
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
      customFieldUpdates: action.customFieldUpdates,
      statusConfigId: action.statusConfigId,
      assignedUserId: action.assignedUserId,
      tagId: action.tagId,
      waitConfig: action.waitConfig,
      noteTitle: action.noteTitle,
      noteBody: action.noteBody,
      taskConfig: action.taskConfig,
      dateTimeFormatterConfig: action.dateTimeFormatterConfig,
      numberFormatterConfig: action.numberFormatterConfig,
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
    const nextActions = [...draft.actions]
    ;[nextActions[index], nextActions[target]] = [nextActions[target]!, nextActions[index]!]
    if (nextActions.some((action, actionIndex) =>
      action.type === "DELETE_CONTACT" && actionIndex !== nextActions.length - 1
    )) return
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
            <aside className="flex h-full max-h-full min-h-0 w-full max-w-md shrink-0 flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
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
              <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]">
                {selected.kind === "action" && editingAction ? (
                  <ActionEditor
                    action={editingAction}
                    catalog={catalog}
                    onChange={setEditingAction}
                    targetActions={draft.actions.slice(selected.index + 1)}
                    previousActions={draft.actions.slice(0, selected.index)}
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
                    previousActions={draft.actions.slice(0, selected.insertionIndex)}
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
                  <div className="flex shrink-0 items-center justify-end gap-2 p-3">
                    <Button type="button" variant="outline" className={COMPACT_SECONDARY_BUTTON_CLASS} onClick={cancelPanelChanges}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className={COMPACT_PRIMARY_BUTTON_CLASS}
                      disabled={!isActionReady(
                        editingAction,
                        catalog,
                        draft.actions.slice(selected.index + 1),
                        draft.actions.slice(0, selected.index),
                      ) || !actionPanelHasChanges}
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
                      disabled={!isActionReady(
                        pendingAction,
                        catalog,
                        draft.actions.slice(selected.insertionIndex),
                        draft.actions.slice(0, selected.insertionIndex),
                      )}
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
  previousActions,
  actionIndex,
  timezone,
}: {
  action: AutomationAction | null
  catalog: AutomationCatalog
  onChange: (action: AutomationAction | null) => void
  targetActions: AutomationAction[]
  previousActions: AutomationAction[]
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
          previousActions={previousActions}
          actionIndex={actionIndex}
          timezone={timezone}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-slate-950">Choose an action</p>
      <div className="flex flex-col gap-4">
        {ACTION_GROUPS.map((group) => {
          const actions = actionsForGroup(group.id)
          if (actions.length === 0) return null
          return (
            <section key={group.id} className="space-y-2">
              <p className="px-1 text-xs font-semibold text-slate-500">{group.label}</p>
              <div className="flex flex-col gap-2">
                {actions.map(([value, definition]) => (
                  <Button
                    key={value}
                    type="button"
                    variant="outline"
                    className={cn(COMPACT_SECONDARY_BUTTON_CLASS, "w-full justify-start")}
                    disabled={
                      (value === "UPDATE_CONTACT_CUSTOM_FIELDS" &&
                        catalog.contactUpdateFields.length === 0 &&
                        catalog.customFields.length === 0) ||
                      (value === "DELETE_CONTACT" && targetActions.length > 0)
                    }
                    onClick={() => onChange(actionDefaults(value, catalog))}
                  >
                    {definition.label}
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
}: {
  action: AutomationAction
  catalog: AutomationCatalog
  onChange: (action: AutomationAction) => void
  showTypePicker?: boolean
  targetActions?: AutomationAction[]
  previousActions?: AutomationAction[]
  actionIndex?: number
  timezone?: string | null
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
              onValueChange={(type: AutomationAction["type"]) => onChange(actionDefaults(type, catalog, action.nodeKey))}
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
                          disabled={value === "DELETE_CONTACT" && targetActions.length > 0}
                        >
                          {definition.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )
                })}
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        {action.type === "UPDATE_CONTACT_CUSTOM_FIELDS" ? (
          <ContactFieldUpdatesEditor action={action} catalog={catalog} onChange={onChange} />
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

        {action.type === "FORMAT_DATE_TIME" && action.dateTimeFormatterConfig ? (
          <DateTimeFormatterActionEditor
            config={action.dateTimeFormatterConfig}
            catalog={catalog}
            timezone={timezone}
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
            <Button type="button" size="icon" variant="outline" disabled={management.index === 0 || action.type === "DELETE_CONTACT"} onClick={() => management.onMove(-1)} aria-label="Move action up">
              <ArrowUp data-icon="inline-start" />
            </Button>
            <Button type="button" size="icon" variant="outline" disabled={management.index === management.total - 1 || targetActions[0]?.type === "DELETE_CONTACT"} onClick={() => management.onMove(1)} aria-label="Move action down">
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

function FormatterIntegerInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
}) {
  const [draftValue, setDraftValue] = useState(Number.isFinite(value) ? String(value) : "")
  return (
    <Field className="gap-1.5" data-invalid={!Number.isSafeInteger(value)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        value={draftValue}
        className="h-8 rounded-full"
        aria-invalid={!Number.isSafeInteger(value)}
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

function DateTimeFormatterActionEditor({
  config,
  catalog,
  timezone,
  onChange,
}: {
  config: AutomationDateTimeFormatterConfig
  catalog: AutomationCatalog
  timezone?: string | null
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
    value: AutomationDateSource,
    change: (source: AutomationDateSource) => void,
  ) => (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <p className="text-xs font-semibold text-slate-700">{label}</p>
      <ContactDateValueInput
        idPrefix={idPrefix}
        value={value as ContactDateValue}
        onChange={(source) => change(source)}
        catalog={catalog}
        timezone={timezone}
        allowRelative
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
        onChange={(source) => onChange({ ...value, source })}
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
