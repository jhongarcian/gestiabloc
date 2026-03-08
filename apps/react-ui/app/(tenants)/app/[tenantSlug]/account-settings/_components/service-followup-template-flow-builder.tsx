"use client"

import "@xyflow/react/dist/style.css"

import Link from "next/link"
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { isAxiosError } from "axios"
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  Handle,
  Node,
  type NodeProps,
  NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react"
import {
  BellRing,
  Calculator,
  CheckSquare,
  Clock3,
  FileEdit,
  FileText,
  GitBranch,
  Hash,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Plus,
  Tags,
  UserRoundCog,
  Upload,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"

type PersistedNodeKind =
  | "start"
  | "step"
  | "wait"
  | "ifElse"
  | "mathOperation"
  | "numberFormatter"
  | "dateTimeFormatter"
  | "goTo"
  | "reminder"
  | "assign"
  | "removeUser"
  | "tagAdd"
  | "tagRemove"
  | "contactFieldUpdate"
  | "statusUpdate"
  | "addNote"
  | "addTask"
type CanvasNodeKind = PersistedNodeKind | "add" | "end" | "ifBranch" | "moveDrop"
type WaitUnit = "days" | "hours" | "minutes"
type ReminderTarget = "all_users" | "specific_user" | "assigned_contact_owner"
type RemoveTarget = "specific_user" | "all_assigned_users"
type FieldSource = "contact" | "custom"
type FieldOperation = "update" | "clear"
type MathOperationType = "add" | "subtract" | "multiply" | "divide"
type MathDateUnit = "days" | "months" | "years"
type DateTimeFormatterMode = "date" | "dateTime" | "compareDates"
type NumberFormatterMode =
  | "textToNumber"
  | "formatNumber"
  | "formatPhoneNumber"
  | "formatCurrency"
  | "randomNumber"
type NumberPhoneFormat =
  | "e164"
  | "international"
  | "internationalNoCountryCode"
  | "internationalNoHyphens"
  | "internationalNoSymbols"
  | "national"
  | "nationalNoParenthesis"
  | "nationalNoSymbols"
  | "rfc3966"
  | "rfc3966NoTel"
type NumberDecimalMark = "period" | "comma"
type NumberGroupingStyle =
  | "commaPeriod"
  | "periodComma"
  | "spaceComma"
  | "spacePeriod"
type NumberCurrencyCode = string
type DateTimeFormatOption = {
  value: string
  label: string
  preview: string
}
type MathFieldValueType = "number" | "dateTime"
type MathFieldKey = `contact:${string}` | `custom:${string}`
type MathFieldOption = {
  key: string
  label: string
  source: FieldSource
  valueType: MathFieldValueType
}
type IfElseBranchSource = "dateTime" | "contactInfo" | "customField"
type IfElseValueType = "string" | "number" | "dateTime"
type IfElseOperator =
  | "includes"
  | "not_includes"
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty"

type IfElseBranch = {
  id: string
  name: string
  source: IfElseBranchSource
  fieldKey: string
  valueType: IfElseValueType
  operator: IfElseOperator
  compareValue: string
  isDefault?: boolean
  targetNodeId?: string | null
}

const WAIT_UNIT_TO_MINUTES: Record<WaitUnit, number> = {
  days: 1440,
  hours: 60,
  minutes: 1,
}

const WAIT_UNITS: WaitUnit[] = ["days", "hours", "minutes"]
const CREATE_NODE_KINDS: Exclude<PersistedNodeKind, "start">[] = [
  "step",
  "wait",
  "ifElse",
  "mathOperation",
  "numberFormatter",
  "dateTimeFormatter",
  "goTo",
  "reminder",
  "assign",
  "removeUser",
  "tagAdd",
  "tagRemove",
  "contactFieldUpdate",
  "statusUpdate",
  "addNote",
  "addTask",
]
const NODE_KIND_LABEL: Record<Exclude<PersistedNodeKind, "start">, string> = {
  step: "Step",
  wait: "Wait",
  ifElse: "If / Else",
  mathOperation: "Math operation",
  numberFormatter: "Number formatter",
  dateTimeFormatter: "Date/Time formatter",
  goTo: "Go to",
  reminder: "Reminder notification",
  assign: "Assign user",
  removeUser: "Remove user",
  tagAdd: "Create tag",
  tagRemove: "Delete tag",
  contactFieldUpdate: "Update contact field",
  statusUpdate: "Update status",
  addNote: "Add note",
  addTask: "Add task",
}
const NODE_KIND_DESCRIPTION: Record<Exclude<PersistedNodeKind, "start">, string> = {
  step: "Standard workflow step for user actions.",
  wait: "Delay the flow by days, hours, or minutes.",
  ifElse: "Branch flow using a condition expression.",
  mathOperation: "Calculate a value using a math expression.",
  numberFormatter: "Format numeric output before next action.",
  dateTimeFormatter: "Format date/time output for later use.",
  goTo: "Jump flow execution to another node.",
  reminder: "Create a reminder notification message.",
  assign: "Assign contact owner.",
  removeUser: "Remove specific user or all assigned users.",
  tagAdd: "Create and apply a tag for contacts.",
  tagRemove: "Remove a tag from contacts.",
  contactFieldUpdate: "Set a value in a contact field.",
  statusUpdate: "Move contact to a new status.",
  addNote: "Add an internal note to the contact.",
  addTask: "Create a follow-up task.",
}

const INTERNAL_NODE_KINDS: Exclude<PersistedNodeKind, "start">[] = [
  "wait",
  "ifElse",
  "mathOperation",
  "numberFormatter",
  "dateTimeFormatter",
  "goTo",
]

const WORKFLOW_NODE_KINDS: Exclude<PersistedNodeKind, "start">[] = ["step"]

const CONTACT_ACTION_NODE_KINDS: Exclude<PersistedNodeKind, "start">[] = CREATE_NODE_KINDS.filter(
  (kind) => !INTERNAL_NODE_KINDS.includes(kind) && !WORKFLOW_NODE_KINDS.includes(kind),
)

const toTagPreviewName = (value: string) => value.trim().replace(/\s+/g, "-")

const MAX_NOTE_ATTACHMENTS = 10
const STEP_NODE_WIDTH = 260
const IF_BRANCH_NODE_WIDTH = 170
const ADD_NODE_WIDTH = 56
const END_NODE_WIDTH = 80
const NODE_VERTICAL_STEP = 130
const BRANCH_HORIZONTAL_GAP = 44
const BRANCH_LANE_HORIZONTAL_GAP = 100
const LANE_SHIFT_TOLERANCE = 120

type NoteAttachmentRef = {
  fileId: string
  key: string
  fileName: string
  contentType: string
  size: number | null
}

const inferContentType = (file: File) => {
  if (file.type) return file.type
  const extension = file.name.split(".").pop()?.toLowerCase()
  if (extension === "png") return "image/png"
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg"
  if (extension === "webp") return "image/webp"
  if (extension === "pdf") return "application/pdf"
  return ""
}

const CONTACT_INFO_FIELDS: Array<{ key: string; label: string }> = [
  { key: "firstName", label: "First name" },
  { key: "middleName", label: "Middle name" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "phoneNumber", label: "Phone number" },
  { key: "secondaryPhoneNumber", label: "Secondary phone number" },
  { key: "dateOfBirth", label: "Date of birth" },
  { key: "gender", label: "Gender" },
  { key: "smokerStatus", label: "Smoker status" },
  { key: "statusConfigId", label: "Status" },
  { key: "addressLine1", label: "Address line 1" },
  { key: "addressLine2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postalCode", label: "Postal code" },
  { key: "country", label: "Country" },
]

const CONTACT_INFO_FIELD_VALUE_TYPE: Record<string, IfElseValueType> = {
  firstName: "string",
  middleName: "string",
  lastName: "string",
  email: "string",
  phoneNumber: "string",
  secondaryPhoneNumber: "string",
  dateOfBirth: "dateTime",
  gender: "string",
  smokerStatus: "string",
  statusConfigId: "string",
  addressLine1: "string",
  addressLine2: "string",
  city: "string",
  state: "string",
  postalCode: "string",
  country: "string",
}

const CONTACT_MATH_FIELDS: Array<{ key: string; label: string; valueType: "number" | "dateTime" }> = [
  { key: "dateOfBirth", label: "Date of Birth", valueType: "dateTime" },
]

const CONTACT_PHONE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "phoneNumber", label: "Phone Number" },
  { key: "secondaryPhoneNumber", label: "Secondary Phone Number" },
]

const MATH_OPERATION_OPTIONS: Array<{ value: MathOperationType; label: string }> = [
  { value: "add", label: "Add" },
  { value: "subtract", label: "Subtract" },
  { value: "multiply", label: "Multiply" },
  { value: "divide", label: "Divide" },
]

const MATH_DATE_OPERATION_OPTIONS: Array<{ value: Extract<MathOperationType, "add" | "subtract">; label: string }> =
  [
    { value: "add", label: "Add" },
    { value: "subtract", label: "Subtract" },
  ]

const MATH_DATE_UNITS: Array<{ value: MathDateUnit; label: string }> = [
  { value: "days", label: "Days" },
  { value: "months", label: "Months" },
  { value: "years", label: "Years" },
]

const NUMBER_FORMATTER_OPTIONS: Array<{ value: NumberFormatterMode; label: string }> = [
  { value: "textToNumber", label: "Text to number" },
  { value: "formatNumber", label: "Format number" },
  { value: "formatPhoneNumber", label: "Format phone number" },
  { value: "formatCurrency", label: "Format currency" },
  { value: "randomNumber", label: "Random number" },
]

const NUMBER_PHONE_FORMAT_OPTIONS: Array<{ value: NumberPhoneFormat; label: string; preview: string }> = [
  { value: "e164", label: "E164", preview: "+15413134664" },
  { value: "international", label: "International", preview: "+1 541-313-4664" },
  {
    value: "internationalNoCountryCode",
    label: "International, no country code",
    preview: "541-313-4664",
  },
  {
    value: "internationalNoHyphens",
    label: "International, no hyphens",
    preview: "+1 541 313 4664",
  },
  {
    value: "internationalNoSymbols",
    label: "International, no symbols",
    preview: "15413134664",
  },
  { value: "national", label: "National", preview: "(541) 313-4664" },
  {
    value: "nationalNoParenthesis",
    label: "National, no parenthesis",
    preview: "541 313-4664",
  },
  {
    value: "nationalNoSymbols",
    label: "National, no symbols",
    preview: "5413134664",
  },
  { value: "rfc3966", label: "RFC3966", preview: "tel:+1-541-313-4664" },
  { value: "rfc3966NoTel", label: "RFC3966, no tel:", preview: "+1-541-313-4664" },
]

const NUMBER_DECIMAL_MARK_OPTIONS: Array<{ value: NumberDecimalMark; label: string }> = [
  { value: "period", label: "Period (.)" },
  { value: "comma", label: "Comma (,)" },
]

const NUMBER_GROUPING_STYLE_OPTIONS: Array<{
  value: NumberGroupingStyle
  label: string
  preview: string
}> = [
  {
    value: "commaPeriod",
    label: "Comma for grouping & period for decimal",
    preview: "1,234,567.89",
  },
  {
    value: "periodComma",
    label: "Period for grouping & comma for decimal",
    preview: "1.234.567,89",
  },
  {
    value: "spaceComma",
    label: "Space for grouping & comma for decimal",
    preview: "1 234 567,89",
  },
  {
    value: "spacePeriod",
    label: "Space for grouping & period for decimal",
    preview: "1 234 567.89",
  },
]

const NUMBER_CURRENCY_OPTIONS: Array<{ value: NumberCurrencyCode; label: string }> = [
  { value: "USD", label: "USD - US Dollar" },
  { value: "EUR", label: "EUR - Euro" },
  { value: "GBP", label: "GBP - British Pound" },
  { value: "CAD", label: "CAD - Canadian Dollar" },
  { value: "AUD", label: "AUD - Australian Dollar" },
  { value: "MXN", label: "MXN - Mexican Peso" },
  { value: "BRL", label: "BRL - Brazilian Real" },
  { value: "COP", label: "COP - Colombian Peso" },
  { value: "ARS", label: "ARS - Argentine Peso" },
  { value: "CLP", label: "CLP - Chilean Peso" },
  { value: "PEN", label: "PEN - Peruvian Sol" },
  { value: "JPY", label: "JPY - Japanese Yen" },
  { value: "CNY", label: "CNY - Chinese Yuan" },
  { value: "INR", label: "INR - Indian Rupee" },
  { value: "KRW", label: "KRW - South Korean Won" },
  { value: "SGD", label: "SGD - Singapore Dollar" },
  { value: "HKD", label: "HKD - Hong Kong Dollar" },
  { value: "NZD", label: "NZD - New Zealand Dollar" },
  { value: "CHF", label: "CHF - Swiss Franc" },
  { value: "SEK", label: "SEK - Swedish Krona" },
  { value: "NOK", label: "NOK - Norwegian Krone" },
  { value: "DKK", label: "DKK - Danish Krone" },
  { value: "PLN", label: "PLN - Polish Zloty" },
  { value: "CZK", label: "CZK - Czech Koruna" },
  { value: "TRY", label: "TRY - Turkish Lira" },
  { value: "ZAR", label: "ZAR - South African Rand" },
  { value: "AED", label: "AED - UAE Dirham" },
  { value: "SAR", label: "SAR - Saudi Riyal" },
  { value: "EGP", label: "EGP - Egyptian Pound" },
  { value: "ILS", label: "ILS - Israeli New Shekel" },
]

const DATE_TIME_FORMATTER_OPTIONS: Array<{ value: DateTimeFormatterMode; label: string }> = [
  { value: "date", label: "Date" },
  { value: "dateTime", label: "Date and time" },
  { value: "compareDates", label: "Compare dates" },
]

const DATE_ONLY_FORMAT_OPTIONS: DateTimeFormatOption[] = [
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD", preview: "2023-12-21" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY", preview: "12/21/2023" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY", preview: "21/12/2023" },
  { value: "MMMM DD YYYY", label: "MMMM DD YYYY", preview: "December 21 2023" },
  { value: "dddd, MMMM D, YYYY", label: "dddd, MMMM D, YYYY", preview: "Saturday, December 21, 2023" },
  { value: "MMM D, YYYY", label: "MMM D, YYYY", preview: "Dec 21, 2023" },
  { value: "MMMM Do YYYY", label: "MMMM Do YYYY", preview: "December 21st 2023" },
  { value: "MM-DD-YYYY", label: "MM-DD-YYYY", preview: "12-21-2023" },
  { value: "DD-MMM-YYYY", label: "DD-MMM-YYYY", preview: "21-Dec-2023" },
  { value: "X", label: "X", preview: "Unix Timestamp: 1703176259" },
]

const DATE_TIME_FORMAT_OPTIONS: DateTimeFormatOption[] = [
  { value: "ddd MMM DD HH:mm:ss YYYY", label: "ddd MMM DD HH:mm:ss YYYY", preview: "Sat Dec 21 13:30:59 2023" },
  { value: "MMMM DD YYYY HH:mm:ss", label: "MMMM DD YYYY HH:mm:ss", preview: "December 21 2023 13:30:59" },
  { value: "YYYY-MM-DD HH:mm:ss", label: "YYYY-MM-DD HH:mm:ss", preview: "2023-12-21 13:30:59" },
  { value: "YYYY-MM-DD hh:mm A", label: "YYYY-MM-DD hh:mm A", preview: "2023-12-21 1:30 PM" },
  { value: "DD/MM/YYYY HH:mm:ss", label: "DD/MM/YYYY HH:mm:ss", preview: "21/12/2023 13:30:59" },
  { value: "MM/DD/YYYY hh:mm A", label: "MM/DD/YYYY hh:mm A", preview: "12/21/2023 1:30 PM" },
  {
    value: "dddd, MMMM D, YYYY hh:mm A",
    label: "dddd, MMMM D, YYYY hh:mm A",
    preview: "Saturday, December 21, 2023 1:30 PM",
  },
  { value: "MMM D, YYYY hh:mm:ss A", label: "MMM D, YYYY hh:mm:ss A", preview: "Dec 21, 2023 1:30:59 PM" },
  { value: "YYYY-MM-DDTHH:mm:ss", label: "YYYY-MM-DDTHH:mm:ss", preview: "2023-12-21T13:30:59" },
  { value: "MMMM Do YYYY hh:mm A", label: "MMMM Do YYYY hh:mm A", preview: "December 21st 2023 1:30 PM" },
  { value: "MM-DD-YYYY hh:mm A", label: "MM-DD-YYYY hh:mm A", preview: "12-21-2023 1:30 PM" },
  { value: "DD-MMM-YYYY hh:mm A", label: "DD-MMM-YYYY hh:mm A", preview: "21-Dec-2023 1:30 PM" },
  { value: "X", label: "X", preview: "Unix Timestamp: 1703176259" },
]

const STRING_OPERATORS: IfElseOperator[] = [
  "includes",
  "not_includes",
  "is_not_empty",
  "is_empty",
]
const NUMBER_OPERATORS: IfElseOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_not_empty",
  "is_empty",
]
const DATE_TIME_OPERATORS: IfElseOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_not_empty",
  "is_empty",
]

const OPERATOR_LABEL: Record<IfElseOperator, string> = {
  includes: "Includes",
  not_includes: "Does not include",
  eq: "Equal to",
  neq: "Not equal to",
  gt: "Greater than",
  gte: "Greater than or equal to",
  lt: "Less than",
  lte: "Less than or equal to",
  is_not_empty: "Is not empty",
  is_empty: "Is empty",
}

const getOperatorsForValueType = (valueType: IfElseValueType): IfElseOperator[] => {
  if (valueType === "number") return NUMBER_OPERATORS
  if (valueType === "dateTime") return DATE_TIME_OPERATORS
  return STRING_OPERATORS
}

const toIfElseValueTypeFromCustomFieldType = (fieldType: string): IfElseValueType => {
  const normalized = fieldType.trim().toUpperCase()
  if (normalized === "NUMBER") return "number"
  if (normalized === "CURRENCY") return "number"
  if (normalized === "DATE") return "dateTime"
  if (normalized === "DATETIME") return "dateTime"
  return "string"
}

const makeIfElseBranch = (index: number): IfElseBranch => ({
  id: `branch-${Date.now()}-${index}-${Math.round(Math.random() * 1000)}`,
  name: `Branch ${index}`,
  source: "contactInfo",
  fieldKey: "firstName",
  valueType: "string",
  operator: "includes",
  compareValue: "",
  targetNodeId: null,
})

const makeDefaultBranch = (): IfElseBranch => ({
  id: `branch-default-${Date.now()}-${Math.round(Math.random() * 1000)}`,
  name: "Default",
  source: "contactInfo",
  fieldKey: "",
  valueType: "string",
  operator: "is_not_empty",
  compareValue: "",
  isDefault: true,
  targetNodeId: null,
})

const formatFieldKeyLabel = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()

type StepNodeData = {
  kind: PersistedNodeKind
  label: string
  waitValue: number
  waitUnit: WaitUnit
  waitDays: number
  notesTemplate: string
  assigneeUserId?: string | null
  tagName?: string | null
  fieldKey?: string | null
  fieldValue?: string | null
  statusValue?: string | null
  taskTitle?: string | null
  reminderTarget?: ReminderTarget | null
  reminderUserId?: string | null
  removeTarget?: RemoveTarget | null
  fieldSource?: FieldSource | null
  fieldOperation?: FieldOperation | null
  noteTitle?: string | null
  noteAttachments?: NoteAttachmentRef[]
  conditionExpression?: string | null
  mathExpression?: string | null
  mathSourceFieldKey?: string | null
  mathSourceFieldSource?: FieldSource | null
  mathResultFieldKey?: string | null
  mathResultFieldSource?: FieldSource | null
  mathValueType?: "number" | "dateTime" | null
  mathOperationType?: MathOperationType | null
  mathOperationValue?: number | null
  mathDateUnit?: MathDateUnit | null
  numberFormatPattern?: string | null
  numberFormatterMode?: NumberFormatterMode | null
  numberFormatterMin?: number | null
  numberFormatterMax?: number | null
  numberFormatterPhoneFormat?: NumberPhoneFormat | null
  numberFormatterCountryCode?: string | null
  numberFormatterFieldSource?: FieldSource | null
  numberFormatterFieldKey?: string | null
  numberFormatterInputFieldSource?: FieldSource | null
  numberFormatterInputFieldKey?: string | null
  numberFormatterInputDecimalMark?: NumberDecimalMark | null
  numberFormatterGroupingStyle?: NumberGroupingStyle | null
  numberFormatterCurrencyCode?: NumberCurrencyCode | null
  dateTimeFormatPattern?: string | null
  dateTimeFormatMode?: DateTimeFormatterMode | null
  dateTimeFormatSourceFieldKey?: string | null
  dateTimeFormatSourceFieldSource?: FieldSource | null
  dateTimeFormatCompareFieldKey?: string | null
  dateTimeFormatCompareFieldSource?: FieldSource | null
  goToNodeId?: string | null
  ifElseBranches?: IfElseBranch[]
}

type CanvasNodeData = {
  kind: CanvasNodeKind
  label: string
  waitValue: number
  waitUnit: WaitUnit
  waitDays: number
  notesTemplate: string
  assigneeUserId?: string | null
  tagName?: string | null
  fieldKey?: string | null
  fieldValue?: string | null
  statusValue?: string | null
  taskTitle?: string | null
  reminderTarget?: ReminderTarget | null
  reminderUserId?: string | null
  removeTarget?: RemoveTarget | null
  fieldSource?: FieldSource | null
  fieldOperation?: FieldOperation | null
  noteTitle?: string | null
  noteAttachments?: NoteAttachmentRef[]
  conditionExpression?: string | null
  mathExpression?: string | null
  mathSourceFieldKey?: string | null
  mathSourceFieldSource?: FieldSource | null
  mathResultFieldKey?: string | null
  mathResultFieldSource?: FieldSource | null
  mathValueType?: "number" | "dateTime" | null
  mathOperationType?: MathOperationType | null
  mathOperationValue?: number | null
  mathDateUnit?: MathDateUnit | null
  numberFormatPattern?: string | null
  numberFormatterMode?: NumberFormatterMode | null
  numberFormatterMin?: number | null
  numberFormatterMax?: number | null
  numberFormatterPhoneFormat?: NumberPhoneFormat | null
  numberFormatterCountryCode?: string | null
  numberFormatterFieldSource?: FieldSource | null
  numberFormatterFieldKey?: string | null
  numberFormatterInputFieldSource?: FieldSource | null
  numberFormatterInputFieldKey?: string | null
  numberFormatterInputDecimalMark?: NumberDecimalMark | null
  numberFormatterGroupingStyle?: NumberGroupingStyle | null
  numberFormatterCurrencyCode?: NumberCurrencyCode | null
  dateTimeFormatPattern?: string | null
  dateTimeFormatMode?: DateTimeFormatterMode | null
  dateTimeFormatSourceFieldKey?: string | null
  dateTimeFormatSourceFieldSource?: FieldSource | null
  dateTimeFormatCompareFieldKey?: string | null
  dateTimeFormatCompareFieldSource?: FieldSource | null
  goToNodeId?: string | null
  ifElseBranches?: IfElseBranch[]
  sourceNodeId?: string
  moveTargetNodeId?: string
  moveLaneSourceNodeId?: string
  insertTargetNodeId?: string
  actionNodeId?: string
  onEditAction?: (actionNodeId: string) => void
  onMoveAction?: (actionNodeId: string) => void
  onDeleteAction?: (actionNodeId: string) => void
}

type StepNode = Node<StepNodeData>
type CanvasNode = Node<CanvasNodeData>

type NewStepDraft = {
  kind: Exclude<PersistedNodeKind, "start">
  label: string
  waitValue: string
  waitUnit: WaitUnit
  notesTemplate: string
  assigneeUserId: string
  tagName: string
  fieldKey: string
  fieldValue: string
  statusValue: string
  taskTitle: string
  reminderTarget: ReminderTarget
  reminderUserId: string
  removeTarget: RemoveTarget
  fieldSource: FieldSource
  fieldOperation: FieldOperation
  noteTitle: string
  noteAttachments: NoteAttachmentRef[]
  conditionExpression: string
  mathExpression: string
  mathSourceFieldKey: string
  mathSourceFieldSource: FieldSource
  mathResultFieldKey: string
  mathResultFieldSource: FieldSource
  mathValueType: "number" | "dateTime"
  mathOperationType: MathOperationType
  mathOperationValue: string
  mathDateUnit: MathDateUnit
  numberFormatPattern: string
  numberFormatterMode: NumberFormatterMode
  numberFormatterMin: string
  numberFormatterMax: string
  numberFormatterPhoneFormat: NumberPhoneFormat
  numberFormatterCountryCode: string
  numberFormatterFieldSource: FieldSource
  numberFormatterFieldKey: string
  numberFormatterInputFieldSource: FieldSource
  numberFormatterInputFieldKey: string
  numberFormatterInputDecimalMark: NumberDecimalMark
  numberFormatterGroupingStyle: NumberGroupingStyle
  numberFormatterCurrencyCode: NumberCurrencyCode
  dateTimeFormatPattern: string
  dateTimeFormatMode: DateTimeFormatterMode
  dateTimeFormatSourceFieldKey: string
  dateTimeFormatSourceFieldSource: FieldSource
  dateTimeFormatCompareFieldKey: string
  dateTimeFormatCompareFieldSource: FieldSource
  goToNodeId: string
  ifElseBranches: IfElseBranch[]
}
const makeDefaultDraft = (
  kind: Exclude<PersistedNodeKind, "start"> = "step",
): NewStepDraft => ({
  kind,
  label: "",
  waitValue: "0",
  waitUnit: "days",
  notesTemplate: "",
  assigneeUserId: "",
  tagName: "",
  fieldKey: "",
  fieldValue: "",
  statusValue: "",
  taskTitle: "",
  reminderTarget: "assigned_contact_owner",
  reminderUserId: "",
  removeTarget: "specific_user",
  fieldSource: "contact",
  fieldOperation: "update",
  noteTitle: "",
  noteAttachments: [],
  conditionExpression: "",
  mathExpression: "",
  mathSourceFieldKey: "",
  mathSourceFieldSource: "contact",
  mathResultFieldKey: "",
  mathResultFieldSource: "contact",
  mathValueType: "number",
  mathOperationType: "add",
  mathOperationValue: "0",
  mathDateUnit: "days",
  numberFormatPattern: "",
  numberFormatterMode: "formatNumber",
  numberFormatterMin: "",
  numberFormatterMax: "",
  numberFormatterPhoneFormat: "e164",
  numberFormatterCountryCode: "+1",
  numberFormatterFieldSource: "contact",
  numberFormatterFieldKey: "phoneNumber",
  numberFormatterInputFieldSource: "contact",
  numberFormatterInputFieldKey: "phoneNumber",
  numberFormatterInputDecimalMark: "period",
  numberFormatterGroupingStyle: "commaPeriod",
  numberFormatterCurrencyCode: "USD",
  dateTimeFormatPattern:
    kind === "dateTimeFormatter" ? DATE_TIME_FORMAT_OPTIONS[0]?.value ?? "YYYY-MM-DD HH:mm:ss" : "",
  dateTimeFormatMode: kind === "dateTimeFormatter" ? "dateTime" : "date",
  dateTimeFormatSourceFieldKey: kind === "dateTimeFormatter" ? "dateOfBirth" : "",
  dateTimeFormatSourceFieldSource: "contact",
  dateTimeFormatCompareFieldKey: "",
  dateTimeFormatCompareFieldSource: "contact",
  goToNodeId: "",
  ifElseBranches: kind === "ifElse" ? [makeIfElseBranch(1), makeDefaultBranch()] : [],
})

type SidebarMode = "hidden" | "create" | "edit"
type CreatePanelView = "options" | "form"
type NoteAttachmentTarget = "create" | "edit"

type FollowUpTemplateFlowBuilderProps = {
  tenantId: string
  tenantSlug: string
  serviceId: string
  template: {
    id: string
    name: string
    isPublished: boolean
    flowNodes: unknown[]
    flowEdges: unknown[]
  }
}

type TenantUsersResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    email: string
  }>
}

type TenantTagsResponse = {
  ok: boolean
  tags: Array<{
    id: string
    name: string
    bgColor: string
    textColor: string
  }>
}

type TenantCustomFieldsResponse = {
  ok: boolean
  customFields: Array<{
    id: string
    key: string
    label: string
    fieldType: string
    isActive: boolean
  }>
}

type ContactStatusesResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    bgColor: string
    textColor: string
  }>
}

function StepFlowNode({ data, selected }: NodeProps<CanvasNode>) {
  const hiddenHandleClass = "!h-0 !w-0 !border-0 !bg-transparent !opacity-0 !pointer-events-none"
  const isStart = data.kind === "start"
  const isWait = data.kind === "wait"
  const isIfElse = data.kind === "ifElse"
  const isMathOperation = data.kind === "mathOperation"
  const isNumberFormatter = data.kind === "numberFormatter"
  const isDateTimeFormatter = data.kind === "dateTimeFormatter"
  const isGoTo = data.kind === "goTo"
  const isReminder = data.kind === "reminder"
  const isAssign = data.kind === "assign"
  const isRemoveUser = data.kind === "removeUser"
  const isTagAdd = data.kind === "tagAdd"
  const isTagRemove = data.kind === "tagRemove"
  const isContactFieldUpdate = data.kind === "contactFieldUpdate"
  const isStatusUpdate = data.kind === "statusUpdate"
  const isAddNote = data.kind === "addNote"
  const isAddTask = data.kind === "addTask"
  const isIfBranch = data.kind === "ifBranch"
  const isMoveDrop = data.kind === "moveDrop"
  const isAdd = data.kind === "add"
  const isEnd = data.kind === "end"

  const renderActionIcon = (kind: CanvasNodeKind) => {
    if (kind === "wait") return <Clock3 className="h-5 w-5" />
    if (kind === "ifElse") return <GitBranch className="h-5 w-5" />
    if (kind === "mathOperation") return <Calculator className="h-5 w-5" />
    if (kind === "numberFormatter") return <Hash className="h-5 w-5" />
    if (kind === "dateTimeFormatter") return <Clock3 className="h-5 w-5" />
    if (kind === "goTo") return <GitBranch className="h-5 w-5" />
    if (kind === "reminder") return <BellRing className="h-5 w-5" />
    if (kind === "assign" || kind === "removeUser") return <UserRoundCog className="h-5 w-5" />
    if (kind === "tagAdd" || kind === "tagRemove") return <Tags className="h-5 w-5" />
    if (kind === "contactFieldUpdate" || kind === "statusUpdate") return <FileEdit className="h-5 w-5" />
    if (kind === "addNote" || kind === "addTask") return <FileText className="h-5 w-5" />
    return <CheckSquare className="h-5 w-5" />
  }

  if (isAdd) {
    return (
      <div className="flex w-14 flex-col items-center">
        <Handle type="target" position={Position.Top} className={hiddenHandleClass} />
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-blue-300 bg-white text-blue-600 shadow-sm">
          <Plus className="h-3.5 w-3.5" />
        </div>
        <Handle type="source" position={Position.Bottom} className={hiddenHandleClass} />
      </div>
    )
  }

  if (isEnd) {
    return (
      <div className="flex w-20 flex-col items-center gap-1">
        <Handle type="target" position={Position.Top} className={hiddenHandleClass} />
        <div className="w-20 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-center text-xs font-semibold tracking-wide text-slate-600">
          END
        </div>
      </div>
    )
  }

  if (isIfBranch) {
    return (
      <div className="flex min-w-[170px] cursor-pointer flex-col items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-center shadow-sm">
        <Handle type="target" position={Position.Top} className={hiddenHandleClass} />
        <p className="w-full truncate text-xs font-semibold text-orange-900">{data.label || "Branch"}</p>
        <p className="text-[11px] text-orange-700">Branch path</p>
        <Handle type="source" position={Position.Bottom} className={hiddenHandleClass} />
      </div>
    )
  }

  if (isMoveDrop) {
    return (
      <div className="flex w-14 cursor-pointer flex-col items-center" title="Drop here">
        <Handle type="target" position={Position.Top} className={hiddenHandleClass} />
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-blue-300 bg-white text-blue-600 shadow-sm">
          <Plus className="h-3.5 w-3.5" />
        </div>
        <Handle type="source" position={Position.Bottom} className={hiddenHandleClass} />
      </div>
    )
  }

  return (
    <div
      className={`relative flex min-w-[260px] flex-col items-center rounded-xl border bg-white px-4 py-3 text-center shadow-sm transition ${
        selected
          ? "border-blue-500"
          : isStart
            ? "border-blue-300"
            : isWait
              ? "border-amber-300"
            : isIfElse || isMathOperation || isNumberFormatter || isDateTimeFormatter || isGoTo
              ? "border-orange-300"
              : isReminder
                ? "border-violet-300"
                : isAssign
                  ? "border-cyan-300"
                  : isRemoveUser
                    ? "border-cyan-300"
                    : isTagAdd || isTagRemove
                      ? "border-emerald-300"
                      : isContactFieldUpdate || isStatusUpdate
                        ? "border-indigo-300"
                        : isAddNote
                          ? "border-rose-300"
                          : isAddTask
                            ? "border-fuchsia-300"
              : "border-slate-300"
      }`}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandleClass} />
      {(() => {
        const actionLabel = isStart
          ? data.label || "Template"
          : isWait
            ? data.label || "Wait"
            : isIfElse
              ? data.label || "If / Else"
              : isMathOperation
                ? data.label || "Math operation"
                : isNumberFormatter
                  ? data.label || "Number formatter"
                  : isDateTimeFormatter
                    ? data.label || "Date/Time formatter"
                    : isGoTo
                      ? data.label || "Go to"
                      : isReminder
                        ? data.label || "Reminder"
                        : isAssign
                          ? data.label || "Assign user"
                          : isRemoveUser
                            ? data.label || "Remove user"
                            : isTagAdd
                              ? data.label || "Create tag"
                              : isTagRemove
                                ? data.label || "Delete tag"
                                : isContactFieldUpdate
                                  ? data.label || "Update contact field"
                                  : isStatusUpdate
                                    ? data.label || "Update status"
                                    : isAddNote
                                      ? data.label || "Add note"
                                      : isAddTask
                                        ? data.label || "Add task"
                                        : data.label || "Action"
        return (
          <div className="flex w-full items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              {renderActionIcon(data.kind)}
            </div>
            <p className="flex-1 truncate text-left text-sm font-semibold text-slate-900">
              {actionLabel}
            </p>
            {!isStart && data.actionNodeId && data.onEditAction && data.onMoveAction && data.onDeleteAction ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 cursor-pointer rounded-lg border-blue-300 text-blue-600"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={(event) => {
                      event.stopPropagation()
                      data.onEditAction?.(data.actionNodeId!)
                    }}
                  >
                    Edit action
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={(event) => {
                      event.stopPropagation()
                      data.onMoveAction?.(data.actionNodeId!)
                    }}
                  >
                    Move action
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer text-red-600 focus:text-red-700"
                    onClick={(event) => {
                      event.stopPropagation()
                      data.onDeleteAction?.(data.actionNodeId!)
                    }}
                  >
                    Delete action
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        )
      })()}
      <Handle type="source" position={Position.Bottom} className={hiddenHandleClass} />
    </div>
  )
}

const NODE_TYPES: NodeTypes = {
  stepNode: StepFlowNode,
}

function toSafeNodes(raw: unknown[], templateId: string, templateName: string): StepNode[] {
  const safe = raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item, index) => {
      const data = (item.data ?? {}) as Record<string, unknown>
      const kind: PersistedNodeKind =
        typeof data.kind === "string" &&
        (["start", ...CREATE_NODE_KINDS] as string[]).includes(data.kind)
          ? (data.kind as PersistedNodeKind)
          : "step"
      const waitUnit: WaitUnit = WAIT_UNITS.includes(data.waitUnit as WaitUnit)
        ? (data.waitUnit as WaitUnit)
        : "days"
      const fallbackWaitValue =
        typeof data.waitDays === "number"
          ? data.waitDays
          : Number.parseInt(String(data.waitDays ?? data.dueDaysFromStart ?? 0), 10) || 0
      const waitValue =
        typeof data.waitValue === "number"
          ? Math.max(0, Math.round(data.waitValue))
          : Math.max(0, Math.round(fallbackWaitValue))
      const reminderTarget: ReminderTarget =
        data.reminderTarget === "all_users" ||
        data.reminderTarget === "specific_user" ||
        data.reminderTarget === "assigned_contact_owner"
          ? data.reminderTarget
          : "assigned_contact_owner"
      const removeTarget: RemoveTarget =
        data.removeTarget === "all_assigned_users" || data.removeTarget === "specific_user"
          ? data.removeTarget
          : "specific_user"
      const fieldSource: FieldSource =
        data.fieldSource === "custom" || data.fieldSource === "contact"
          ? data.fieldSource
          : "contact"
      const fieldOperation: FieldOperation =
        data.fieldOperation === "clear" || data.fieldOperation === "update"
          ? data.fieldOperation
          : "update"

      return {
      ...item,
      type: "stepNode",
      data: {
        kind,
        label:
          typeof data.label === "string" && data.label.trim()
            ? data.label
            : "New step",
        waitValue,
        waitUnit,
        waitDays: waitUnit === "days" ? waitValue : 0,
        notesTemplate: typeof data.notesTemplate === "string" ? data.notesTemplate : "",
        assigneeUserId:
          typeof data.assigneeUserId === "string" ? data.assigneeUserId : null,
        tagName: typeof data.tagName === "string" ? data.tagName : null,
        fieldKey: typeof data.fieldKey === "string" ? data.fieldKey : null,
        fieldValue: typeof data.fieldValue === "string" ? data.fieldValue : null,
        statusValue: typeof data.statusValue === "string" ? data.statusValue : null,
        taskTitle: typeof data.taskTitle === "string" ? data.taskTitle : null,
        reminderTarget,
        reminderUserId:
          typeof data.reminderUserId === "string" ? data.reminderUserId : null,
        removeTarget,
        fieldSource,
        fieldOperation,
        noteTitle: typeof data.noteTitle === "string" ? data.noteTitle : null,
        conditionExpression:
          typeof data.conditionExpression === "string" ? data.conditionExpression : null,
        mathExpression: typeof data.mathExpression === "string" ? data.mathExpression : null,
        mathSourceFieldKey:
          typeof data.mathSourceFieldKey === "string" ? data.mathSourceFieldKey : null,
        mathSourceFieldSource:
          data.mathSourceFieldSource === "custom" || data.mathSourceFieldSource === "contact"
            ? data.mathSourceFieldSource
            : null,
        mathResultFieldKey:
          typeof data.mathResultFieldKey === "string" ? data.mathResultFieldKey : null,
        mathResultFieldSource:
          data.mathResultFieldSource === "custom" || data.mathResultFieldSource === "contact"
            ? data.mathResultFieldSource
            : null,
        mathValueType:
          data.mathValueType === "number" || data.mathValueType === "dateTime"
            ? data.mathValueType
            : null,
        mathOperationType:
          data.mathOperationType === "add" ||
          data.mathOperationType === "subtract" ||
          data.mathOperationType === "multiply" ||
          data.mathOperationType === "divide"
            ? data.mathOperationType
            : null,
        mathOperationValue:
          typeof data.mathOperationValue === "number" ? data.mathOperationValue : null,
        mathDateUnit:
          data.mathDateUnit === "days" ||
          data.mathDateUnit === "months" ||
          data.mathDateUnit === "years"
            ? data.mathDateUnit
            : null,
        numberFormatPattern:
          typeof data.numberFormatPattern === "string" ? data.numberFormatPattern : null,
        numberFormatterMode:
          data.numberFormatterMode === "textToNumber" ||
          data.numberFormatterMode === "formatNumber" ||
          data.numberFormatterMode === "formatPhoneNumber" ||
          data.numberFormatterMode === "formatCurrency" ||
          data.numberFormatterMode === "randomNumber"
            ? data.numberFormatterMode
            : null,
        numberFormatterMin:
          typeof data.numberFormatterMin === "number" ? data.numberFormatterMin : null,
        numberFormatterMax:
          typeof data.numberFormatterMax === "number" ? data.numberFormatterMax : null,
        numberFormatterPhoneFormat:
          data.numberFormatterPhoneFormat === "e164" ||
          data.numberFormatterPhoneFormat === "international" ||
          data.numberFormatterPhoneFormat === "internationalNoCountryCode" ||
          data.numberFormatterPhoneFormat === "internationalNoHyphens" ||
          data.numberFormatterPhoneFormat === "internationalNoSymbols" ||
          data.numberFormatterPhoneFormat === "national" ||
          data.numberFormatterPhoneFormat === "nationalNoParenthesis" ||
          data.numberFormatterPhoneFormat === "nationalNoSymbols" ||
          data.numberFormatterPhoneFormat === "rfc3966" ||
          data.numberFormatterPhoneFormat === "rfc3966NoTel"
            ? data.numberFormatterPhoneFormat
            : null,
        numberFormatterCountryCode:
          typeof data.numberFormatterCountryCode === "string" ? data.numberFormatterCountryCode : null,
        numberFormatterFieldSource:
          data.numberFormatterFieldSource === "custom" || data.numberFormatterFieldSource === "contact"
            ? data.numberFormatterFieldSource
            : null,
        numberFormatterFieldKey:
          typeof data.numberFormatterFieldKey === "string" ? data.numberFormatterFieldKey : null,
        numberFormatterInputFieldSource:
          data.numberFormatterInputFieldSource === "custom" ||
          data.numberFormatterInputFieldSource === "contact"
            ? data.numberFormatterInputFieldSource
            : null,
        numberFormatterInputFieldKey:
          typeof data.numberFormatterInputFieldKey === "string"
            ? data.numberFormatterInputFieldKey
            : null,
        numberFormatterInputDecimalMark:
          data.numberFormatterInputDecimalMark === "period" ||
          data.numberFormatterInputDecimalMark === "comma"
            ? data.numberFormatterInputDecimalMark
            : null,
        numberFormatterGroupingStyle:
          data.numberFormatterGroupingStyle === "commaPeriod" ||
          data.numberFormatterGroupingStyle === "periodComma" ||
          data.numberFormatterGroupingStyle === "spaceComma" ||
          data.numberFormatterGroupingStyle === "spacePeriod"
            ? data.numberFormatterGroupingStyle
            : null,
        numberFormatterCurrencyCode:
          typeof data.numberFormatterCurrencyCode === "string"
            ? data.numberFormatterCurrencyCode
            : null,
        dateTimeFormatPattern:
          typeof data.dateTimeFormatPattern === "string" ? data.dateTimeFormatPattern : null,
        dateTimeFormatMode:
          data.dateTimeFormatMode === "date" ||
          data.dateTimeFormatMode === "dateTime" ||
          data.dateTimeFormatMode === "compareDates"
            ? data.dateTimeFormatMode
            : data.dateTimeFormatPattern === "date" ||
                data.dateTimeFormatPattern === "dateTime" ||
                data.dateTimeFormatPattern === "compareDates"
              ? data.dateTimeFormatPattern
            : null,
        dateTimeFormatSourceFieldKey:
          typeof data.dateTimeFormatSourceFieldKey === "string"
            ? data.dateTimeFormatSourceFieldKey
            : kind === "dateTimeFormatter"
              ? "dateOfBirth"
            : null,
        dateTimeFormatSourceFieldSource:
          data.dateTimeFormatSourceFieldSource === "custom" ||
          data.dateTimeFormatSourceFieldSource === "contact"
            ? data.dateTimeFormatSourceFieldSource
            : kind === "dateTimeFormatter"
              ? "contact"
            : null,
        dateTimeFormatCompareFieldKey:
          typeof data.dateTimeFormatCompareFieldKey === "string"
            ? data.dateTimeFormatCompareFieldKey
            : null,
        dateTimeFormatCompareFieldSource:
          data.dateTimeFormatCompareFieldSource === "custom" ||
          data.dateTimeFormatCompareFieldSource === "contact"
            ? data.dateTimeFormatCompareFieldSource
            : null,
        goToNodeId: typeof data.goToNodeId === "string" ? data.goToNodeId : null,
        ifElseBranches: Array.isArray(data.ifElseBranches)
          ? data.ifElseBranches
              .filter((item): item is IfElseBranch => {
                if (!item || typeof item !== "object") return false
                const maybe = item as Record<string, unknown>
                return (
                  typeof maybe.id === "string" &&
                  typeof maybe.name === "string" &&
                  typeof maybe.source === "string" &&
                  typeof maybe.valueType === "string" &&
                  typeof maybe.operator === "string"
                )
              })
              .map((branch) => ({
                id: branch.id,
                name: branch.name,
                source:
                  branch.source === "dateTime" ||
                  branch.source === "contactInfo" ||
                  branch.source === "customField"
                    ? branch.source
                    : "contactInfo",
                fieldKey: typeof branch.fieldKey === "string" ? branch.fieldKey : "",
                valueType:
                  branch.valueType === "string" ||
                  branch.valueType === "number" ||
                  branch.valueType === "dateTime"
                    ? branch.valueType
                    : "string",
                operator:
                  typeof branch.operator === "string" &&
                  ([
                    "includes",
                    "not_includes",
                    "eq",
                    "neq",
                    "gt",
                    "gte",
                    "lt",
                    "lte",
                    "is_empty",
                    "is_not_empty",
                  ] as string[]).includes(branch.operator)
                    ? (branch.operator as IfElseOperator)
                    : "includes",
                compareValue: typeof branch.compareValue === "string" ? branch.compareValue : "",
                isDefault: Boolean(branch.isDefault),
                targetNodeId:
                  typeof branch.targetNodeId === "string" ? branch.targetNodeId : null,
              }))
          : null,
        noteAttachments: Array.isArray(data.noteAttachments)
          ? (data.noteAttachments
              .filter((item): item is NoteAttachmentRef => {
                if (!item || typeof item !== "object") return false
                const maybe = item as Record<string, unknown>
                return (
                  typeof maybe.fileId === "string" &&
                  typeof maybe.key === "string" &&
                  typeof maybe.fileName === "string" &&
                  typeof maybe.contentType === "string"
                )
              })
              .map((item) => ({
                fileId: item.fileId,
                key: item.key,
                fileName: item.fileName,
                contentType: item.contentType,
                size: typeof item.size === "number" ? item.size : null,
              })) as NoteAttachmentRef[])
          : [],
      },
      position:
        item.position && typeof item.position === "object"
          ? (item.position as { x: number; y: number })
          : { x: 0, y: 0 },
      id: typeof item.id === "string" ? item.id : `node-${templateId}-${index + 1}`,
    } as StepNode
  })

  if (safe.length) {
    return safe
  }

  return [
    {
      id: `start-${templateId}`,
      type: "stepNode",
      position: { x: 440, y: 80 },
      data: {
        kind: "start",
        label: templateName || "Template",
        waitValue: 0,
        waitUnit: "days",
        waitDays: 0,
        notesTemplate: "",
        assigneeUserId: null,
        tagName: null,
        fieldKey: null,
        fieldValue: null,
        statusValue: null,
        taskTitle: null,
        reminderTarget: "assigned_contact_owner",
        reminderUserId: null,
        removeTarget: "specific_user",
        fieldSource: "contact",
        fieldOperation: "update",
        noteTitle: null,
        conditionExpression: null,
        mathExpression: null,
        mathSourceFieldKey: null,
        mathSourceFieldSource: null,
        mathResultFieldKey: null,
        mathResultFieldSource: null,
        mathValueType: null,
        mathOperationType: null,
        mathOperationValue: null,
        mathDateUnit: null,
        numberFormatPattern: null,
        numberFormatterMode: null,
        numberFormatterMin: null,
        numberFormatterMax: null,
        numberFormatterPhoneFormat: null,
        numberFormatterCountryCode: null,
        numberFormatterFieldSource: null,
        numberFormatterFieldKey: null,
        numberFormatterInputFieldSource: null,
        numberFormatterInputFieldKey: null,
        numberFormatterInputDecimalMark: null,
        numberFormatterGroupingStyle: null,
        numberFormatterCurrencyCode: null,
        dateTimeFormatPattern: null,
        dateTimeFormatMode: null,
        dateTimeFormatSourceFieldKey: null,
        dateTimeFormatSourceFieldSource: null,
        dateTimeFormatCompareFieldKey: null,
        dateTimeFormatCompareFieldSource: null,
        goToNodeId: null,
        ifElseBranches: [],
        noteAttachments: [],
      },
    },
  ]
}

function toSafeEdges(raw: unknown[]): Edge[] {
  return raw
    .filter((item): item is Edge => Boolean(item && typeof item === "object"))
    .map((item) => ({ ...item, type: "smoothstep" }))
}

export function ServiceFollowUpTemplateFlowBuilder({
  tenantId,
  tenantSlug,
  serviceId,
  template,
}: FollowUpTemplateFlowBuilderProps) {
  const router = useRouter()

  const initialNodes = useMemo(
    () => toSafeNodes(template.flowNodes, template.id, template.name),
    [template.flowNodes, template.id, template.name],
  )

  const [name, setName] = useState(template.name)
  const [nodes, setNodes] = useState<StepNode[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(toSafeEdges(template.flowEdges))
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialNodes[0]?.id ?? null)
  const [hasRenamedTemplate, setHasRenamedTemplate] = useState(false)
  const [isPublished, setIsPublished] = useState(Boolean(template.isPublished))
  const [newStepDraft, setNewStepDraft] = useState<NewStepDraft>(makeDefaultDraft())
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("hidden")
  const [pendingMoveNodeId, setPendingMoveNodeId] = useState<string | null>(null)
  const [createPanelView, setCreatePanelView] = useState<CreatePanelView>("options")
  const [createSourceNodeId, setCreateSourceNodeId] = useState<string | null>(null)
  const [tenantUsers, setTenantUsers] = useState<Array<{ id: string; name: string }>>([])
  const [tenantTags, setTenantTags] = useState<
    Array<{ id: string; name: string; bgColor: string; textColor: string }>
  >([])
  const [tenantContactStatuses, setTenantContactStatuses] = useState<
    Array<{ id: string; name: string; bgColor: string; textColor: string }>
  >([])
  const [customFieldOptions, setCustomFieldOptions] = useState<
    Array<{ key: string; label: string; fieldType: string }>
  >([])
  const [isCustomFieldsLoading, setIsCustomFieldsLoading] = useState(false)
  const [hasLoadedCustomFields, setHasLoadedCustomFields] = useState(false)
  const [isContactInfoSectionOpen, setIsContactInfoSectionOpen] = useState(false)
  const [isCustomFieldsSectionOpen, setIsCustomFieldsSectionOpen] = useState(false)
  const [isCreatingTag, setIsCreatingTag] = useState(false)
  const [isTagsLoading, setIsTagsLoading] = useState(false)
  const [isUploadingNoteAttachment, setIsUploadingNoteAttachment] = useState(false)
  const [noteAttachmentTarget, setNoteAttachmentTarget] =
    useState<NoteAttachmentTarget>("create")
  const noteAttachmentInputRef = useRef<HTMLInputElement | null>(null)
  const canEditTemplateName = !hasRenamedTemplate && template.name.startsWith("Template ")

  useEffect(() => {
    setIsPublished(Boolean(template.isPublished))
  }, [template.id, template.isPublished])

  const orderedNodes = useMemo(
    () => [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x),
    [nodes],
  )

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  const customFieldByKey = useMemo(
    () => new Map(customFieldOptions.map((field) => [field.key, field])),
    [customFieldOptions],
  )

  const customMathFields = useMemo<MathFieldOption[]>(
    () =>
      customFieldOptions.flatMap((field) => {
        const valueType = toIfElseValueTypeFromCustomFieldType(field.fieldType)
        if (valueType !== "number" && valueType !== "dateTime") return []
        return [
          {
            key: field.key,
            label: field.label,
            source: "custom" as const,
            valueType,
          },
        ]
      }),
    [customFieldOptions],
  )

  const contactMathFields = useMemo<MathFieldOption[]>(
    () =>
      CONTACT_MATH_FIELDS.map((field) => ({
        key: field.key,
        label: field.label,
        source: "contact" as const,
        valueType: field.valueType,
      })),
    [],
  )

  const allMathFields = useMemo<MathFieldOption[]>(
    () => [...contactMathFields, ...customMathFields],
    [contactMathFields, customMathFields],
  )

  const allDateFields = useMemo<MathFieldOption[]>(
    () => allMathFields.filter((field) => field.valueType === "dateTime"),
    [allMathFields],
  )

  const phoneFormatterFields = useMemo<Array<{ source: FieldSource; key: string; label: string }>>(
    () => [
      ...CONTACT_PHONE_FIELDS.map((field) => ({
        source: "contact" as const,
        key: field.key,
        label: field.label,
      })),
      ...customFieldOptions
        .filter((field) => field.fieldType.trim().toUpperCase() === "PHONE")
        .map((field) => ({
          source: "custom" as const,
          key: field.key,
          label: field.label,
        })),
    ],
    [customFieldOptions],
  )

  const numberFormatterInputFields = useMemo<Array<{ source: FieldSource; key: string; label: string }>>(
    () => [
      ...CONTACT_INFO_FIELDS.map((field) => ({
        source: "contact" as const,
        key: field.key,
        label: field.label
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .replace(/\b\w/g, (char) => char.toUpperCase()),
      })),
      ...customFieldOptions.map((field) => ({
        source: "custom" as const,
        key: field.key,
        label: field.label,
      })),
    ],
    [customFieldOptions],
  )

  const getDateTimeFormatOptions = useCallback(
    (mode: DateTimeFormatterMode) =>
      mode === "date" ? DATE_ONLY_FORMAT_OPTIONS : DATE_TIME_FORMAT_OPTIONS,
    [],
  )

  const upsertDraftIfElseBranch = (
    branchId: string,
    updater: (branch: IfElseBranch) => IfElseBranch,
  ) => {
    setNewStepDraft((prev) => ({
      ...prev,
      ifElseBranches: prev.ifElseBranches.map((branch) =>
        branch.id === branchId ? updater(branch) : branch,
      ),
    }))
  }

  const openCreateStepPanel = (sourceNodeId?: string) => {
    const fallbackSource = orderedNodes[orderedNodes.length - 1]?.id ?? null
    setPendingMoveNodeId(null)
    setCreateSourceNodeId(sourceNodeId ?? fallbackSource)
    setSidebarMode("create")
    setCreatePanelView("options")
    setNewStepDraft(makeDefaultDraft())
    setIsContactInfoSectionOpen(false)
    setIsCustomFieldsSectionOpen(false)
  }

  const parseIfBranchSource = (value: string | null) => {
    if (!value || !value.startsWith("ifbranch:")) return null
    const [, ifElseNodeId, branchId] = value.split(":")
    if (!ifElseNodeId || !branchId) return null
    return { ifElseNodeId, branchId }
  }

  const parseEdgeInsertSource = (value: string | null) => {
    if (!value || !value.startsWith("edge:")) return null
    const [, sourceId, targetId] = value.split(":")
    if (!sourceId || !targetId) return null
    return { sourceId, targetId }
  }

  const parseIfBranchEdgeInsertSource = (value: string | null) => {
    if (!value || !value.startsWith("ifedge:")) return null
    const [, ifElseNodeId, branchId, targetId] = value.split(":")
    if (!ifElseNodeId || !branchId || !targetId) return null
    return { ifElseNodeId, branchId, targetId }
  }

  const getIfBranchCanvasPosition = (ifElseNode: StepNode, branchId: string) => {
    const branches = (ifElseNode.data.ifElseBranches ?? []).filter((branch) =>
      branch.isDefault ? true : branch.name.trim().length > 0,
    )
    const branchIndex = branches.findIndex((branch) => branch.id === branchId)
    const ifElseCenterX = ifElseNode.position.x + STEP_NODE_WIDTH / 2
    if (branchIndex === -1) {
      return {
        x: ifElseCenterX - IF_BRANCH_NODE_WIDTH / 2,
        y: ifElseNode.position.y + 130,
      }
    }
    const laneStep = Math.max(
      IF_BRANCH_NODE_WIDTH + BRANCH_HORIZONTAL_GAP,
      STEP_NODE_WIDTH + BRANCH_LANE_HORIZONTAL_GAP,
    )
    const startCenterX = ifElseCenterX - ((branches.length - 1) * laneStep) / 2
    const branchCenterX = startCenterX + branchIndex * laneStep
    return {
      x: branchCenterX - IF_BRANCH_NODE_WIDTH / 2,
      y: ifElseNode.position.y + 130,
    }
  }

  const getIfBranchCanvasNodeId = (ifElseNodeId: string, branchId: string) =>
    `if-branch-${ifElseNodeId}-${branchId}`

  const addStepNode = () => {
    const stepCount = nodes.filter((node) => node.data.kind === "step").length
    const nextIndex = stepCount + 1
    const nodeId = `${newStepDraft.kind}-${Date.now()}-${Math.round(Math.random() * 1000)}`
    const sourceNodeId = createSourceNodeId ?? orderedNodes[orderedNodes.length - 1]?.id ?? null
    const parsedIfBranchSource = parseIfBranchSource(sourceNodeId)
    const parsedEdgeInsertSource = parseEdgeInsertSource(sourceNodeId)
    const parsedIfBranchEdgeInsertSource = parseIfBranchEdgeInsertSource(sourceNodeId)

    if (!sourceNodeId) {
      toast.error("Could not determine where to insert the action.")
      return
    }

    const sourceNode = parsedIfBranchSource
      ? nodes.find((node) => node.id === parsedIfBranchSource.ifElseNodeId)
      : parsedIfBranchEdgeInsertSource
        ? nodes.find((node) => node.id === parsedIfBranchEdgeInsertSource.ifElseNodeId)
        : parsedEdgeInsertSource
          ? nodes.find((node) => node.id === parsedEdgeInsertSource.sourceId)
      : nodes.find((node) => node.id === sourceNodeId)
    if (!sourceNode) {
      toast.error("Could not find the source action.")
      return
    }

    const waitValue = Math.max(0, Number.parseInt(newStepDraft.waitValue, 10) || 0)
    if (newStepDraft.kind === "assign" && !newStepDraft.assigneeUserId) {
      toast.error("Select a user for assignment.")
      return
    }
    if (
      newStepDraft.kind === "removeUser" &&
      newStepDraft.removeTarget === "specific_user" &&
      !newStepDraft.assigneeUserId
    ) {
      toast.error("Select a user to remove.")
      return
    }
    if (newStepDraft.kind === "reminder" && newStepDraft.reminderTarget === "specific_user" && !newStepDraft.reminderUserId) {
      toast.error("Select a user for reminder notification.")
      return
    }
    if ((newStepDraft.kind === "tagAdd" || newStepDraft.kind === "tagRemove") && !newStepDraft.tagName.trim()) {
      toast.error("Tag name is required.")
      return
    }
    if (newStepDraft.kind === "contactFieldUpdate" && !newStepDraft.fieldKey.trim()) {
      toast.error("Select a field.")
      return
    }
    if (
      newStepDraft.kind === "contactFieldUpdate" &&
      newStepDraft.fieldOperation === "update" &&
      !newStepDraft.fieldValue.trim()
    ) {
      toast.error("Field value is required for update.")
      return
    }
    if (newStepDraft.kind === "statusUpdate" && !newStepDraft.statusValue.trim()) {
      toast.error("Status value is required.")
      return
    }
    if (newStepDraft.kind === "ifElse") {
      const nonDefaultBranches = newStepDraft.ifElseBranches.filter((branch) => !branch.isDefault)
      if (!nonDefaultBranches.length) {
        toast.error("Add at least one branch.")
        return
      }
      const invalidBranch = nonDefaultBranches.find((branch) => {
        if (!branch.name.trim()) return true
        if (!branch.fieldKey.trim()) return true
        const isValueOptional = branch.operator === "is_empty" || branch.operator === "is_not_empty"
        if (!isValueOptional && !branch.compareValue.trim()) return true
        return false
      })
      if (invalidBranch) {
        toast.error("Complete all branch fields before creating the action.")
        return
      }
    }
    if (newStepDraft.kind === "mathOperation") {
      if (!newStepDraft.mathSourceFieldKey.trim() || !newStepDraft.mathResultFieldKey.trim()) {
        toast.error("Select source and update fields.")
        return
      }
      const amount = Number.parseFloat(newStepDraft.mathOperationValue)
      if (!Number.isFinite(amount)) {
        toast.error("Math value must be a valid number.")
        return
      }
      if (newStepDraft.mathValueType === "dateTime") {
        if (newStepDraft.mathOperationType !== "add" && newStepDraft.mathOperationType !== "subtract") {
          toast.error("Date fields only support add or subtract.")
          return
        }
      }
    }
    if (newStepDraft.kind === "numberFormatter") {
      if (!newStepDraft.numberFormatterMode) {
        toast.error("Select number formatter action.")
        return
      }
      if (
        newStepDraft.numberFormatterMode === "textToNumber" ||
        newStepDraft.numberFormatterMode === "formatNumber" ||
        newStepDraft.numberFormatterMode === "formatCurrency"
      ) {
        if (!newStepDraft.numberFormatterInputFieldKey.trim()) {
          toast.error("Select the input field to format.")
          return
        }
        if (
          newStepDraft.numberFormatterInputDecimalMark !== "period" &&
          newStepDraft.numberFormatterInputDecimalMark !== "comma"
        ) {
          toast.error("Select input decimal mark.")
          return
        }
      }
      if (newStepDraft.numberFormatterMode === "formatNumber") {
        if (
          !NUMBER_GROUPING_STYLE_OPTIONS.some(
            (option) => option.value === newStepDraft.numberFormatterGroupingStyle,
          )
        ) {
          toast.error("Select output number format.")
          return
        }
      }
      if (newStepDraft.numberFormatterMode === "formatCurrency") {
        if (
          !NUMBER_CURRENCY_OPTIONS.some(
            (option) => option.value === newStepDraft.numberFormatterCurrencyCode,
          )
        ) {
          toast.error("Select currency format option.")
          return
        }
      }
      if (newStepDraft.numberFormatterMode === "formatPhoneNumber") {
        if (!newStepDraft.numberFormatterFieldKey.trim()) {
          toast.error("Select the phone input field to format.")
          return
        }
        if (!newStepDraft.numberFormatterPhoneFormat) {
          toast.error("Select phone number format option.")
          return
        }
        if (!/^\+\d{1,4}$/.test(newStepDraft.numberFormatterCountryCode.trim())) {
          toast.error("Enter a valid country code, for example +1.")
          return
        }
      }
      if (newStepDraft.numberFormatterMode === "randomNumber") {
        const min = Number.parseFloat(newStepDraft.numberFormatterMin)
        const max = Number.parseFloat(newStepDraft.numberFormatterMax)
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          toast.error("Enter valid minimum and maximum numbers.")
          return
        }
        if (min > max) {
          toast.error("Minimum cannot be greater than maximum.")
          return
        }
      }
    }
    if (newStepDraft.kind === "dateTimeFormatter") {
      if (!newStepDraft.dateTimeFormatSourceFieldKey.trim()) {
        toast.error("Select a date field.")
        return
      }
      if (
        newStepDraft.dateTimeFormatMode !== "compareDates" &&
        !newStepDraft.dateTimeFormatPattern.trim()
      ) {
        toast.error("Select a date format.")
        return
      }
      if (
        newStepDraft.dateTimeFormatMode === "compareDates" &&
        !newStepDraft.dateTimeFormatCompareFieldKey.trim()
      ) {
        toast.error("Select a compare date field.")
        return
      }
      if (
        newStepDraft.dateTimeFormatMode === "compareDates" &&
        newStepDraft.dateTimeFormatSourceFieldSource === newStepDraft.dateTimeFormatCompareFieldSource &&
        newStepDraft.dateTimeFormatSourceFieldKey === newStepDraft.dateTimeFormatCompareFieldKey
      ) {
        toast.error("Compare date must be different from the source date.")
        return
      }
    }
    if (newStepDraft.kind === "goTo" && !newStepDraft.goToNodeId.trim()) {
      toast.error("Select an action to go to.")
      return
    }
    if (newStepDraft.kind === "addTask" && !newStepDraft.taskTitle.trim()) {
      toast.error("Task title is required.")
      return
    }
    if (newStepDraft.kind === "addNote" && !newStepDraft.noteTitle.trim()) {
      toast.error("Note title is required.")
      return
    }
    if (newStepDraft.kind === "addNote" && !newStepDraft.notesTemplate.trim()) {
      toast.error("Note body is required.")
      return
    }
    const createdNode: StepNode = {
      id: nodeId,
      type: "stepNode",
      position: parsedIfBranchSource
        ? (() => {
            const branchPosition = getIfBranchCanvasPosition(
              sourceNode,
              parsedIfBranchSource.branchId,
            )
            return {
              x: branchPosition.x - (STEP_NODE_WIDTH - IF_BRANCH_NODE_WIDTH) / 2,
              y: branchPosition.y + NODE_VERTICAL_STEP,
            }
          })()
        : { x: sourceNode.position.x, y: sourceNode.position.y + NODE_VERTICAL_STEP },
      data: {
        kind: newStepDraft.kind,
        label:
          newStepDraft.label.trim() ||
          (newStepDraft.kind === "step"
            ? `Step ${nextIndex}`
            : newStepDraft.kind === "wait"
              ? "Wait"
            : newStepDraft.kind === "reminder"
              ? "Reminder"
                : newStepDraft.kind === "assign"
                  ? "Assign user"
                  : newStepDraft.kind === "removeUser"
                    ? "Remove user"
                    : newStepDraft.kind === "tagAdd"
                      ? "Create tag"
                      : newStepDraft.kind === "tagRemove"
                        ? "Delete tag"
                        : newStepDraft.kind === "contactFieldUpdate"
                          ? "Update field"
                          : newStepDraft.kind === "statusUpdate"
                            ? "Update status"
                            : newStepDraft.kind === "ifElse"
                              ? "If / Else"
                              : newStepDraft.kind === "mathOperation"
                                ? "Math operation"
                                : newStepDraft.kind === "numberFormatter"
                                  ? "Number formatter"
                                  : newStepDraft.kind === "dateTimeFormatter"
                                    ? "Date/Time formatter"
                                    : newStepDraft.kind === "goTo"
                                      ? "Go to"
                            : newStepDraft.kind === "addNote"
                              ? "Add note"
                              : "Add task"),
        waitValue: newStepDraft.kind === "wait" ? waitValue : 0,
        waitUnit: newStepDraft.kind === "wait" ? newStepDraft.waitUnit : "days",
        waitDays: newStepDraft.kind === "wait" && newStepDraft.waitUnit === "days" ? waitValue : 0,
        notesTemplate: newStepDraft.notesTemplate.trim(),
        assigneeUserId:
          (newStepDraft.kind === "assign" ||
            (newStepDraft.kind === "removeUser" &&
              newStepDraft.removeTarget === "specific_user")) &&
          newStepDraft.assigneeUserId
            ? newStepDraft.assigneeUserId
            : null,
        tagName:
          newStepDraft.kind === "tagAdd" || newStepDraft.kind === "tagRemove"
            ? newStepDraft.tagName.trim()
            : null,
        fieldKey: newStepDraft.kind === "contactFieldUpdate" ? newStepDraft.fieldKey.trim() : null,
        fieldValue:
          newStepDraft.kind === "contactFieldUpdate" && newStepDraft.fieldOperation === "update"
            ? newStepDraft.fieldValue.trim()
            : null,
        statusValue: newStepDraft.kind === "statusUpdate" ? newStepDraft.statusValue.trim() : null,
        taskTitle: newStepDraft.kind === "addTask" ? newStepDraft.taskTitle.trim() : null,
        reminderTarget: newStepDraft.kind === "reminder" ? newStepDraft.reminderTarget : null,
        reminderUserId:
          newStepDraft.kind === "reminder" && newStepDraft.reminderTarget === "specific_user"
            ? newStepDraft.reminderUserId || null
            : null,
        removeTarget: newStepDraft.kind === "removeUser" ? newStepDraft.removeTarget : null,
        fieldSource: newStepDraft.kind === "contactFieldUpdate" ? newStepDraft.fieldSource : null,
        fieldOperation:
          newStepDraft.kind === "contactFieldUpdate" ? newStepDraft.fieldOperation : null,
        noteTitle: newStepDraft.kind === "addNote" ? newStepDraft.noteTitle.trim() : null,
        noteAttachments:
          newStepDraft.kind === "addNote" ? [...newStepDraft.noteAttachments] : [],
        conditionExpression:
          newStepDraft.kind === "ifElse" ? newStepDraft.conditionExpression.trim() : null,
        mathExpression:
          newStepDraft.kind === "mathOperation" ? newStepDraft.mathExpression.trim() : null,
        mathSourceFieldKey:
          newStepDraft.kind === "mathOperation" ? newStepDraft.mathSourceFieldKey.trim() : null,
        mathSourceFieldSource:
          newStepDraft.kind === "mathOperation" ? newStepDraft.mathSourceFieldSource : null,
        mathResultFieldKey:
          newStepDraft.kind === "mathOperation" ? newStepDraft.mathResultFieldKey.trim() : null,
        mathResultFieldSource:
          newStepDraft.kind === "mathOperation" ? newStepDraft.mathResultFieldSource : null,
        mathValueType:
          newStepDraft.kind === "mathOperation" ? newStepDraft.mathValueType : null,
        mathOperationType:
          newStepDraft.kind === "mathOperation" ? newStepDraft.mathOperationType : null,
        mathOperationValue:
          newStepDraft.kind === "mathOperation"
            ? Number.parseFloat(newStepDraft.mathOperationValue) || 0
            : null,
        mathDateUnit:
          newStepDraft.kind === "mathOperation" && newStepDraft.mathValueType === "dateTime"
            ? newStepDraft.mathDateUnit
            : null,
        numberFormatPattern:
          newStepDraft.kind === "numberFormatter" ? newStepDraft.numberFormatPattern.trim() : null,
        numberFormatterMode:
          newStepDraft.kind === "numberFormatter" ? newStepDraft.numberFormatterMode : null,
        numberFormatterMin:
          newStepDraft.kind === "numberFormatter" && newStepDraft.numberFormatterMode === "randomNumber"
            ? Number.parseFloat(newStepDraft.numberFormatterMin) || 0
            : null,
        numberFormatterMax:
          newStepDraft.kind === "numberFormatter" && newStepDraft.numberFormatterMode === "randomNumber"
            ? Number.parseFloat(newStepDraft.numberFormatterMax) || 0
            : null,
        numberFormatterPhoneFormat:
          newStepDraft.kind === "numberFormatter" &&
          newStepDraft.numberFormatterMode === "formatPhoneNumber"
            ? newStepDraft.numberFormatterPhoneFormat
            : null,
        numberFormatterCountryCode:
          newStepDraft.kind === "numberFormatter" &&
          newStepDraft.numberFormatterMode === "formatPhoneNumber"
            ? newStepDraft.numberFormatterCountryCode.trim()
            : null,
        numberFormatterFieldSource:
          newStepDraft.kind === "numberFormatter" &&
          newStepDraft.numberFormatterMode === "formatPhoneNumber"
            ? newStepDraft.numberFormatterFieldSource
            : null,
        numberFormatterFieldKey:
          newStepDraft.kind === "numberFormatter" &&
          newStepDraft.numberFormatterMode === "formatPhoneNumber"
            ? newStepDraft.numberFormatterFieldKey.trim()
            : null,
        numberFormatterInputFieldSource:
          newStepDraft.kind === "numberFormatter" &&
          (newStepDraft.numberFormatterMode === "textToNumber" ||
            newStepDraft.numberFormatterMode === "formatNumber" ||
            newStepDraft.numberFormatterMode === "formatCurrency")
            ? newStepDraft.numberFormatterInputFieldSource
            : null,
        numberFormatterInputFieldKey:
          newStepDraft.kind === "numberFormatter" &&
          (newStepDraft.numberFormatterMode === "textToNumber" ||
            newStepDraft.numberFormatterMode === "formatNumber" ||
            newStepDraft.numberFormatterMode === "formatCurrency")
            ? newStepDraft.numberFormatterInputFieldKey.trim()
            : null,
        numberFormatterInputDecimalMark:
          newStepDraft.kind === "numberFormatter" &&
          (newStepDraft.numberFormatterMode === "textToNumber" ||
            newStepDraft.numberFormatterMode === "formatNumber" ||
            newStepDraft.numberFormatterMode === "formatCurrency")
            ? newStepDraft.numberFormatterInputDecimalMark
            : null,
        numberFormatterGroupingStyle:
          newStepDraft.kind === "numberFormatter" && newStepDraft.numberFormatterMode === "formatNumber"
            ? newStepDraft.numberFormatterGroupingStyle
            : null,
        numberFormatterCurrencyCode:
          newStepDraft.kind === "numberFormatter" && newStepDraft.numberFormatterMode === "formatCurrency"
            ? newStepDraft.numberFormatterCurrencyCode
            : null,
        dateTimeFormatPattern:
          newStepDraft.kind === "dateTimeFormatter"
            ? newStepDraft.dateTimeFormatMode === "compareDates"
              ? null
              : newStepDraft.dateTimeFormatPattern.trim()
            : null,
        dateTimeFormatMode:
          newStepDraft.kind === "dateTimeFormatter" ? newStepDraft.dateTimeFormatMode : null,
        dateTimeFormatSourceFieldKey:
          newStepDraft.kind === "dateTimeFormatter"
            ? newStepDraft.dateTimeFormatSourceFieldKey.trim()
            : null,
        dateTimeFormatSourceFieldSource:
          newStepDraft.kind === "dateTimeFormatter"
            ? newStepDraft.dateTimeFormatSourceFieldSource
            : null,
        dateTimeFormatCompareFieldKey:
          newStepDraft.kind === "dateTimeFormatter" &&
          newStepDraft.dateTimeFormatMode === "compareDates"
            ? newStepDraft.dateTimeFormatCompareFieldKey.trim()
            : null,
        dateTimeFormatCompareFieldSource:
          newStepDraft.kind === "dateTimeFormatter" &&
          newStepDraft.dateTimeFormatMode === "compareDates"
            ? newStepDraft.dateTimeFormatCompareFieldSource
            : null,
        goToNodeId: newStepDraft.kind === "goTo" ? newStepDraft.goToNodeId.trim() : null,
        ifElseBranches:
          newStepDraft.kind === "ifElse"
            ? newStepDraft.ifElseBranches.map((branch) => ({
                ...branch,
                name: branch.name.trim(),
                compareValue: branch.compareValue.trim(),
              }))
            : [],
      },
    }

    const oldOutgoing = parsedIfBranchSource || parsedIfBranchEdgeInsertSource
      ? []
      : parsedEdgeInsertSource
        ? edges.filter(
            (edge) =>
              edge.source === parsedEdgeInsertSource.sourceId &&
              edge.target === parsedEdgeInsertSource.targetId,
          )
        : edges.filter((edge) => edge.source === sourceNodeId)
    const outgoingTargetIds = oldOutgoing.map((edge) => edge.target)
    const branch = parsedIfBranchSource
      ? (sourceNode.data.ifElseBranches ?? []).find(
          (item) => item.id === parsedIfBranchSource.branchId,
        ) ?? null
      : parsedIfBranchEdgeInsertSource
        ? (sourceNode.data.ifElseBranches ?? []).find(
            (item) => item.id === parsedIfBranchEdgeInsertSource.branchId,
          ) ?? null
      : null
    const branchTargetId = parsedIfBranchEdgeInsertSource
      ? parsedIfBranchEdgeInsertSource.targetId
      : branch?.targetNodeId ?? null

    setNodes((prev) => {
      const shifted = prev.map((node) =>
        node.position.y > sourceNode.position.y &&
        Math.abs(node.position.x - createdNode.position.x) <= LANE_SHIFT_TOLERANCE
          ? { ...node, position: { ...node.position, y: node.position.y + NODE_VERTICAL_STEP } }
          : node,
      )
      const withCreated = [...shifted, createdNode]
      if (!parsedIfBranchSource && !parsedIfBranchEdgeInsertSource) return withCreated
      return withCreated.map((node) => {
        const ifElseNodeId = parsedIfBranchSource
          ? parsedIfBranchSource.ifElseNodeId
          : parsedIfBranchEdgeInsertSource?.ifElseNodeId
        const branchId = parsedIfBranchSource
          ? parsedIfBranchSource.branchId
          : parsedIfBranchEdgeInsertSource?.branchId
        if (!ifElseNodeId || !branchId || node.id !== ifElseNodeId) return node
        return {
          ...node,
          data: {
            ...node.data,
            ifElseBranches: (node.data.ifElseBranches ?? []).map((item) =>
              item.id === branchId
                ? { ...item, targetNodeId: createdNode.id }
                : item,
            ),
          },
        }
      })
    })

    setEdges((prev) => {
      if (parsedIfBranchSource || parsedIfBranchEdgeInsertSource) {
        let next = [...prev]
        if (branchTargetId) {
          next = addEdge(
            {
              id: `edge-${createdNode.id}-${branchTargetId}`,
              source: createdNode.id,
              target: branchTargetId,
              type: "smoothstep",
            },
            next,
          )
        }
        return next
      }

      const withoutOutgoing = parsedEdgeInsertSource
        ? prev.filter(
            (edge) =>
              !(
                edge.source === parsedEdgeInsertSource.sourceId &&
                edge.target === parsedEdgeInsertSource.targetId
              ),
          )
        : prev.filter((edge) => edge.source !== sourceNodeId)
      let next = addEdge(
        {
          id: `edge-${
            parsedEdgeInsertSource ? parsedEdgeInsertSource.sourceId : sourceNodeId
          }-${nodeId}`,
          source: parsedEdgeInsertSource ? parsedEdgeInsertSource.sourceId : sourceNodeId,
          target: nodeId,
          type: "smoothstep",
        },
        withoutOutgoing,
      )

      outgoingTargetIds.forEach((targetId) => {
        next = addEdge(
          {
            id: `edge-${nodeId}-${targetId}`,
            source: nodeId,
            target: targetId,
            type: "smoothstep",
          },
          next,
        )
      })

      return next
    })

    setSelectedNodeId(nodeId)
    setSidebarMode("edit")
    setCreateSourceNodeId(null)
    setCreatePanelView("options")
    setNewStepDraft(makeDefaultDraft())
  }

  const removeNodeById = useCallback((nodeId: string) => {
    const nodeToRemove = nodes.find((node) => node.id === nodeId)
    if (!nodeToRemove) return
    if (nodeToRemove.data.kind === "start") {
      toast.error("Start step cannot be removed.")
      return
    }

    const linkedNodeIds = new Set<string>([nodeToRemove.id])

    const incomingSources = edges
      .filter((edge) => linkedNodeIds.has(edge.target) && !linkedNodeIds.has(edge.source))
      .map((edge) => edge.source)

    const outgoingTargets = edges
      .filter((edge) => linkedNodeIds.has(edge.source) && !linkedNodeIds.has(edge.target))
      .map((edge) => edge.target)
    const deletedNode = nodeToRemove

    setNodes((prev) => {
      const filtered = prev.filter((node) => !linkedNodeIds.has(node.id))
      const withBranchUpdates = filtered.map((node) => {
        if (node.data.kind !== "ifElse") return node
        const fallbackTarget = outgoingTargets[0] ?? null
        return {
          ...node,
          data: {
            ...node.data,
            ifElseBranches: (node.data.ifElseBranches ?? []).map((branch) => ({
              ...branch,
              targetNodeId:
                branch.targetNodeId && linkedNodeIds.has(branch.targetNodeId)
                  ? fallbackTarget
                  : branch.targetNodeId ?? null,
            })),
          },
        }
      })

      if (!deletedNode) return withBranchUpdates

      const LANE_TOLERANCE = 120
      return withBranchUpdates.map((node) => {
        if (node.data.kind === "start") return node
        if (Math.abs(node.position.x - deletedNode.position.x) > LANE_TOLERANCE) return node
        if (node.position.y <= deletedNode.position.y) return node
        return {
          ...node,
          position: {
            ...node.position,
            y: node.position.y - NODE_VERTICAL_STEP,
          },
        }
      })
    })

    setEdges((prev) => {
      let next = prev.filter(
        (edge) => !linkedNodeIds.has(edge.source) && !linkedNodeIds.has(edge.target),
      )

      incomingSources.forEach((sourceId) => {
        outgoingTargets.forEach((targetId) => {
          if (sourceId === targetId) return
          const exists = next.some(
            (edge) => edge.source === sourceId && edge.target === targetId,
          )
          if (exists) return

          next = addEdge(
            {
              id: `edge-${sourceId}-${targetId}`,
              source: sourceId,
              target: targetId,
              type: "smoothstep",
            },
            next,
          )
        })
      })

      return next
    })
    setSelectedNodeId((prev) => (prev === nodeId ? null : prev))
  }, [edges, nodes])

  const updateSelectedNode = (updater: (data: StepNodeData) => StepNodeData) => {
    if (!selectedNode) return
    setNodes((prev) =>
      prev.map((node) =>
        node.id === selectedNode.id ? { ...node, data: updater(node.data) } : node,
      ),
    )
  }

  const moveNodeBeforeTarget = (movingNodeId: string, targetNodeId: string) => {
    if (movingNodeId === targetNodeId) return

    const movingNode = nodes.find((node) => node.id === movingNodeId)
    const targetNode = nodes.find((node) => node.id === targetNodeId)
    if (!movingNode || !targetNode) return
    if (targetNode.data.kind === "start") {
      toast.error("Cannot move before the start action.")
      return
    }

    type BranchEntryRef = { ifElseNodeId: string; branchId: string }
    const branchEntriesToMoving: BranchEntryRef[] = []
    const branchEntriesToTarget: BranchEntryRef[] = []
    nodes.forEach((node) => {
      if (node.data.kind !== "ifElse") return
      ;(node.data.ifElseBranches ?? []).forEach((branch) => {
        if (branch.targetNodeId === movingNodeId) {
          branchEntriesToMoving.push({ ifElseNodeId: node.id, branchId: branch.id })
        }
        if (branch.targetNodeId === targetNodeId) {
          branchEntriesToTarget.push({ ifElseNodeId: node.id, branchId: branch.id })
        }
      })
    })

    const incomingToMoving = edges
      .filter((edge) => edge.target === movingNodeId)
      .map((edge) => edge.source)
    const outgoingFromMoving = edges
      .filter((edge) => edge.source === movingNodeId)
      .map((edge) => edge.target)
    const incomingToTarget = edges
      .filter((edge) => edge.target === targetNodeId && edge.source !== movingNodeId)
      .map((edge) => edge.source)

    if (
      outgoingFromMoving.includes(targetNodeId) &&
      incomingToTarget.length === 0 &&
      branchEntriesToTarget.length === 0
    ) {
      toast.error("Action is already before the selected destination.")
      return
    }

    const fallbackTarget = outgoingFromMoving.find((target) => target !== targetNodeId) ?? null

    setEdges((prev) => {
      let next = prev.filter(
        (edge) =>
          edge.source !== movingNodeId &&
          edge.target !== movingNodeId &&
          !(edge.target === targetNodeId && edge.source !== movingNodeId),
      )

      const safeAdd = (source: string, target: string) => {
        if (source === target) return
        if (next.some((edge) => edge.source === source && edge.target === target)) return
        next = addEdge(
          {
            id: `edge-${source}-${target}`,
            source,
            target,
            type: "smoothstep",
          },
          next,
        )
      }

      // Detach moving node from old place: connect old prev -> old next.
      incomingToMoving.forEach((source) => {
        outgoingFromMoving.forEach((target) => {
          if (target === targetNodeId) return
          safeAdd(source, target)
        })
      })

      // Insert moving node before target.
      incomingToTarget.forEach((source) => safeAdd(source, movingNodeId))
      safeAdd(movingNodeId, targetNodeId)

      return next
    })

    setNodes((prev) => {
      const movingPrev = prev.find((node) => node.id === movingNodeId)
      const targetPrev = prev.find((node) => node.id === targetNodeId)
      if (!movingPrev || !targetPrev) return prev

      const LANE_TOLERANCE = 120
      const sameLane = Math.abs(movingPrev.position.x - targetPrev.position.x) <= LANE_TOLERANCE

      const next = prev.map((node) => {
        if (node.data.kind !== "ifElse") return node
        return {
          ...node,
          data: {
            ...node.data,
            ifElseBranches: (node.data.ifElseBranches ?? []).map((branch) => {
              const isEntryToMoving = branchEntriesToMoving.some(
                (entry) => entry.ifElseNodeId === node.id && entry.branchId === branch.id,
              )
              if (isEntryToMoving) {
                return { ...branch, targetNodeId: fallbackTarget }
              }
              const isEntryToTarget = branchEntriesToTarget.some(
                (entry) => entry.ifElseNodeId === node.id && entry.branchId === branch.id,
              )
              if (isEntryToTarget) {
                return { ...branch, targetNodeId: movingNodeId }
              }
              return branch
            }),
          },
        }
      })

      const repositioned = next.map((node) => {
        if (node.data.kind === "start") return node
        if (node.id === movingNodeId) {
          if (sameLane) {
            if (movingPrev.position.y < targetPrev.position.y) {
              return {
                ...node,
                position: {
                  ...node.position,
                  y: targetPrev.position.y - NODE_VERTICAL_STEP,
                },
              }
            }
            return {
              ...node,
              position: {
                ...node.position,
                y: targetPrev.position.y,
              },
            }
          }
          return {
            ...node,
            position: {
              ...node.position,
              x: targetPrev.position.x,
              y: targetPrev.position.y,
            },
          }
        }

        if (sameLane) {
          if (Math.abs(node.position.x - targetPrev.position.x) > LANE_TOLERANCE) return node

          if (movingPrev.position.y < targetPrev.position.y) {
            if (node.position.y > movingPrev.position.y && node.position.y < targetPrev.position.y) {
              return {
                ...node,
                position: { ...node.position, y: node.position.y - NODE_VERTICAL_STEP },
              }
            }
            return node
          }

          if (node.position.y >= targetPrev.position.y && node.position.y < movingPrev.position.y) {
            return {
              ...node,
              position: { ...node.position, y: node.position.y + NODE_VERTICAL_STEP },
            }
          }
          return node
        }

        if (
          Math.abs(node.position.x - movingPrev.position.x) <= LANE_TOLERANCE &&
          node.position.y > movingPrev.position.y
        ) {
          return {
            ...node,
            position: { ...node.position, y: node.position.y - NODE_VERTICAL_STEP },
          }
        }

        if (
          Math.abs(node.position.x - targetPrev.position.x) <= LANE_TOLERANCE &&
          node.position.y >= targetPrev.position.y
        ) {
          return {
            ...node,
            position: { ...node.position, y: node.position.y + NODE_VERTICAL_STEP },
          }
        }

        return node
      })

      const normalized = [...repositioned]
      const branchLanes = normalized.flatMap((node) => {
        if (node.data.kind !== "ifElse") return []
        return (node.data.ifElseBranches ?? []).map((branch) => {
          const branchPosition = getIfBranchCanvasPosition(node, branch.id)
          return {
            laneX: branchPosition.x - (STEP_NODE_WIDTH - IF_BRANCH_NODE_WIDTH) / 2,
            minY: branchPosition.y + NODE_VERTICAL_STEP,
          }
        })
      })

      branchLanes.forEach(({ laneX, minY }) => {
        const laneNodes = normalized
          .filter((node) => node.data.kind !== "start" && node.data.kind !== "ifElse")
          .filter((node) => Math.abs(node.position.x - laneX) <= LANE_TOLERANCE)
          .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
        laneNodes.forEach((laneNode, index) => {
          const desiredY = minY + index * NODE_VERTICAL_STEP
          const nodeIndex = normalized.findIndex((node) => node.id === laneNode.id)
          if (nodeIndex === -1) return
          normalized[nodeIndex] = {
            ...normalized[nodeIndex],
            position: {
              ...normalized[nodeIndex].position,
              x: laneX,
              y: desiredY,
            },
          }
        })
      })

      return normalized
    })

    setSelectedNodeId(movingNodeId)
    setSidebarMode("edit")
    toast.success("Action moved.")
  }

  const moveNodeToLaneEnd = (movingNodeId: string, laneSourceNodeId: string) => {
    const movingNode = nodes.find((node) => node.id === movingNodeId)
    if (!movingNode) return

    const parsedBranchSource = parseIfBranchSource(laneSourceNodeId)
    const laneTailNode = parsedBranchSource
      ? null
      : nodes.find((node) => node.id === laneSourceNodeId) ?? null

    if (!parsedBranchSource && !laneTailNode) return
    if (laneTailNode && laneTailNode.id === movingNodeId) {
      toast.error("Action is already at the end of this lane.")
      return
    }

    type BranchEntryRef = { ifElseNodeId: string; branchId: string }
    const branchEntriesToMoving: BranchEntryRef[] = []
    nodes.forEach((node) => {
      if (node.data.kind !== "ifElse") return
      ;(node.data.ifElseBranches ?? []).forEach((branch) => {
        if (branch.targetNodeId === movingNodeId) {
          branchEntriesToMoving.push({ ifElseNodeId: node.id, branchId: branch.id })
        }
      })
    })

    const incomingToMoving = edges
      .filter((edge) => edge.target === movingNodeId)
      .map((edge) => edge.source)
    const outgoingFromMoving = edges
      .filter((edge) => edge.source === movingNodeId)
      .map((edge) => edge.target)
    const fallbackTarget = outgoingFromMoving[0] ?? null

    setEdges((prev) => {
      let next = prev.filter((edge) => edge.source !== movingNodeId && edge.target !== movingNodeId)

      const safeAdd = (source: string, target: string) => {
        if (source === target) return
        if (next.some((edge) => edge.source === source && edge.target === target)) return
        next = addEdge(
          {
            id: `edge-${source}-${target}`,
            source,
            target,
            type: "smoothstep",
          },
          next,
        )
      }

      // Detach moving action from old place: connect old prev -> old next.
      incomingToMoving.forEach((source) => {
        outgoingFromMoving.forEach((target) => safeAdd(source, target))
      })

      // Attach moving action to end of selected lane.
      if (laneTailNode) {
        safeAdd(laneTailNode.id, movingNodeId)
      }

      return next
    })

    setNodes((prev) => {
      const LANE_TOLERANCE = 120

      const next = prev.map((node) => {
        if (node.data.kind !== "ifElse") return node
        return {
          ...node,
          data: {
            ...node.data,
            ifElseBranches: (node.data.ifElseBranches ?? []).map((branch) => {
              const isEntryToMoving = branchEntriesToMoving.some(
                (entry) => entry.ifElseNodeId === node.id && entry.branchId === branch.id,
              )
              if (isEntryToMoving) {
                return { ...branch, targetNodeId: fallbackTarget }
              }
              if (
                parsedBranchSource &&
                node.id === parsedBranchSource.ifElseNodeId &&
                branch.id === parsedBranchSource.branchId
              ) {
                return { ...branch, targetNodeId: movingNodeId }
              }
              return branch
            }),
          },
        }
      })

      let repositioned: StepNode[]
      if (parsedBranchSource) {
        const ifElseNode = next.find((node) => node.id === parsedBranchSource.ifElseNodeId)
        if (!ifElseNode) return next
        const branchPosition = getIfBranchCanvasPosition(ifElseNode, parsedBranchSource.branchId)
        const laneX = branchPosition.x - (STEP_NODE_WIDTH - IF_BRANCH_NODE_WIDTH) / 2
        const laneNodes = next
          .filter((node) => node.data.kind !== "start")
          .filter((node) => Math.abs(node.position.x - laneX) <= LANE_TOLERANCE)
          .filter((node) => node.id !== movingNodeId)
        const laneEndY = laneNodes.length
          ? Math.max(...laneNodes.map((node) => node.position.y)) + NODE_VERTICAL_STEP
          : branchPosition.y + NODE_VERTICAL_STEP
        repositioned = next.map((node) => {
          if (node.id === movingNodeId) {
            return {
              ...node,
              position: {
                ...node.position,
                x: laneX,
                y: laneEndY,
              },
            }
          }
          if (
            Math.abs(node.position.x - movingNode.position.x) <= LANE_TOLERANCE &&
            node.position.y > movingNode.position.y
          ) {
            return {
              ...node,
              position: {
                ...node.position,
                y: node.position.y - NODE_VERTICAL_STEP,
              },
            }
          }
          if (Math.abs(node.position.x - laneX) <= LANE_TOLERANCE && node.position.y >= laneEndY) {
            return {
              ...node,
              position: {
                ...node.position,
                y: node.position.y + NODE_VERTICAL_STEP,
              },
            }
          }
          return node
        })
      } else {
        if (!laneTailNode) return next
        const laneX = laneTailNode.position.x
        const laneEndY = laneTailNode.position.y + NODE_VERTICAL_STEP

        repositioned = next.map((node) => {
          if (node.id === movingNodeId) {
            return {
              ...node,
              position: {
                ...node.position,
                x: laneX,
                y: laneEndY,
              },
            }
          }
          if (
            Math.abs(node.position.x - movingNode.position.x) <= LANE_TOLERANCE &&
            node.position.y > movingNode.position.y
          ) {
            return {
              ...node,
              position: { ...node.position, y: node.position.y - NODE_VERTICAL_STEP },
            }
          }
          return node
        })
      }

      const normalized = [...repositioned]
      const branchLanes = normalized.flatMap((node) => {
        if (node.data.kind !== "ifElse") return []
        return (node.data.ifElseBranches ?? []).map((branch) => {
          const branchPosition = getIfBranchCanvasPosition(node, branch.id)
          return {
            laneX: branchPosition.x - (STEP_NODE_WIDTH - IF_BRANCH_NODE_WIDTH) / 2,
            minY: branchPosition.y + NODE_VERTICAL_STEP,
          }
        })
      })

      branchLanes.forEach(({ laneX, minY }) => {
        const laneNodes = normalized
          .filter((node) => node.data.kind !== "start" && node.data.kind !== "ifElse")
          .filter((node) => Math.abs(node.position.x - laneX) <= LANE_TOLERANCE)
          .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
        laneNodes.forEach((laneNode, index) => {
          const desiredY = minY + index * NODE_VERTICAL_STEP
          const nodeIndex = normalized.findIndex((node) => node.id === laneNode.id)
          if (nodeIndex === -1) return
          normalized[nodeIndex] = {
            ...normalized[nodeIndex],
            position: {
              ...normalized[nodeIndex].position,
              x: laneX,
              y: desiredY,
            },
          }
        })
      })

      return normalized
    })

    setSelectedNodeId(movingNodeId)
    setSidebarMode("edit")
    toast.success("Action moved.")
  }

  const openActionEditor = useCallback((actionNodeId: string) => {
    setPendingMoveNodeId(null)
    setSelectedNodeId(actionNodeId)
    setSidebarMode("edit")
  }, [])

  const startMoveAction = useCallback((actionNodeId: string) => {
    setSelectedNodeId(actionNodeId)
    setPendingMoveNodeId(actionNodeId)
    setSidebarMode("hidden")
  }, [])

  const deleteAction = useCallback((actionNodeId: string) => {
    removeNodeById(actionNodeId)
  }, [removeNodeById])

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const { data } = await api.get<TenantUsersResponse>(
          `/api/account-settings/${tenantId}/users`,
          {
            params: { page: 1, pageSize: 25 },
          },
        )
        setTenantUsers(data.items.map((user) => ({ id: user.id, name: user.name })))
      } catch {
        setTenantUsers([])
      }
    }

    void loadUsers()
  }, [tenantId])

  useEffect(() => {
    const loadTags = async () => {
      setIsTagsLoading(true)
      try {
        const { data } = await api.get<TenantTagsResponse>(`/api/account-settings/${tenantId}/tags`)
        setTenantTags(
          data.tags.map((tag) => ({
            id: tag.id,
            name: tag.name,
            bgColor: tag.bgColor,
            textColor: tag.textColor,
          })),
        )
      } catch {
        setTenantTags([])
      } finally {
        setIsTagsLoading(false)
      }
    }

    void loadTags()
  }, [tenantId])

  useEffect(() => {
    const loadContactStatuses = async () => {
      try {
        const { data } = await api.get<ContactStatusesResponse>(`/api/contacts/${tenantId}/statuses`)
        setTenantContactStatuses(
          data.items.map((status) => ({
            id: status.id,
            name: status.name,
            bgColor: status.bgColor,
            textColor: status.textColor,
          })),
        )
      } catch {
        setTenantContactStatuses([])
      }
    }

    void loadContactStatuses()
  }, [tenantId])

  useEffect(() => {
    if (!isCustomFieldsSectionOpen || hasLoadedCustomFields) return

    const loadCustomFields = async () => {
      setIsCustomFieldsLoading(true)
      try {
        const { data } = await api.get<TenantCustomFieldsResponse>(
          `/api/account-settings/${tenantId}/custom-fields`,
        )
        setCustomFieldOptions(
          data.customFields
            .filter((field) => field.isActive)
            .map((field) => ({ key: field.key, label: field.label, fieldType: field.fieldType })),
        )
      } catch {
        setCustomFieldOptions([])
      } finally {
        setIsCustomFieldsLoading(false)
        setHasLoadedCustomFields(true)
      }
    }

    void loadCustomFields()
  }, [isCustomFieldsSectionOpen, hasLoadedCustomFields, tenantId])

  useEffect(() => {
    if (newStepDraft.kind !== "ifElse" || hasLoadedCustomFields) return

    const loadCustomFields = async () => {
      setIsCustomFieldsLoading(true)
      try {
        const { data } = await api.get<TenantCustomFieldsResponse>(
          `/api/account-settings/${tenantId}/custom-fields`,
        )
        setCustomFieldOptions(
          data.customFields
            .filter((field) => field.isActive)
            .map((field) => ({ key: field.key, label: field.label, fieldType: field.fieldType })),
        )
      } catch {
        setCustomFieldOptions([])
      } finally {
        setIsCustomFieldsLoading(false)
        setHasLoadedCustomFields(true)
      }
    }

    void loadCustomFields()
  }, [newStepDraft.kind, hasLoadedCustomFields, tenantId])

  useEffect(() => {
    const startNode = nodes.find((node) => node.data.kind === "start")
    if (!startNode) return

    const nextLabel = name || "Template"
    if (startNode.data.label === nextLabel) return

    setNodes((prev) =>
      prev.map((node) =>
        node.id === startNode.id ? { ...node, data: { ...node.data, label: nextLabel } } : node,
      ),
    )
  }, [name, nodes])

  const canvasNodes = useMemo<CanvasNode[]>(() => {
    const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    if (!sorted.length) return []

    const ifBranchNodes: CanvasNode[] = sorted.flatMap((node) => {
      if (node.data.kind !== "ifElse") return []
      const branches = (node.data.ifElseBranches ?? []).filter((branch) =>
        branch.isDefault ? true : branch.name.trim().length > 0,
      )
      if (!branches.length) return []
      return branches.map((branch) => {
        const branchPosition = getIfBranchCanvasPosition(node, branch.id)
        return {
        id: getIfBranchCanvasNodeId(node.id, branch.id),
        type: "stepNode",
        position: { x: branchPosition.x, y: branchPosition.y },
        data: {
          kind: "ifBranch",
          label: branch.name || "Branch",
          waitValue: 0,
          waitUnit: "days",
          waitDays: 0,
          notesTemplate: "",
          assigneeUserId: null,
          tagName: null,
          fieldKey: null,
          fieldValue: null,
          statusValue: null,
          taskTitle: null,
          sourceNodeId: `ifbranch:${node.id}:${branch.id}`,
        },
        selectable: false,
        draggable: false,
      }})
    })

    const baseNodes = [...sorted, ...ifBranchNodes]
    const nodeById = new Map(baseNodes.map((node) => [node.id, node]))
    const branchConnections: Array<{ sourceId: string; targetId: string }> = sorted.flatMap((node) => {
      if (node.data.kind !== "ifElse") return []
      return (node.data.ifElseBranches ?? [])
        .filter((branch) => Boolean(branch.targetNodeId))
        .map((branch) => ({
          sourceId: getIfBranchCanvasNodeId(node.id, branch.id),
          targetId: branch.targetNodeId as string,
        }))
    })

    const betweenConnections = [
      ...edges.map((edge) => ({ sourceId: edge.source, targetId: edge.target })),
      ...branchConnections,
    ].filter(({ sourceId, targetId }) => sourceId !== targetId)

    const betweenActionNodes: CanvasNode[] = betweenConnections
      .map(({ sourceId, targetId }, index) => {
        const sourceNode = nodeById.get(sourceId)
        const targetNode = nodeById.get(targetId)
        if (!sourceNode || !targetNode) return null
        const sourceWidth = sourceNode.data.kind === "ifBranch" ? IF_BRANCH_NODE_WIDTH : STEP_NODE_WIDTH
        const targetWidth = targetNode.data.kind === "ifBranch" ? IF_BRANCH_NODE_WIDTH : STEP_NODE_WIDTH
        const sourceCenterX = sourceNode.position.x + sourceWidth / 2
        const targetCenterX = targetNode.position.x + targetWidth / 2
        const sourceBottomY = sourceNode.position.y + 84
        const targetTopY = targetNode.position.y
        return {
          id: `node-insert-${sourceId}-${targetId}-${index + 1}`,
          type: "stepNode",
          position: {
            x: (sourceCenterX + targetCenterX) / 2 - ADD_NODE_WIDTH / 2,
            y: (sourceBottomY + targetTopY) / 2 - 18,
          },
          data: {
            kind: pendingMoveNodeId ? "moveDrop" : "add",
            label: pendingMoveNodeId ? "Drop" : "Add",
            waitValue: 0,
            waitUnit: "days",
            waitDays: 0,
            notesTemplate: "",
            assigneeUserId: null,
            tagName: null,
            fieldKey: null,
            fieldValue: null,
            statusValue: null,
            taskTitle: null,
            sourceNodeId: pendingMoveNodeId
              ? null
              : sourceNode.data.kind === "ifBranch" && sourceNode.data.sourceNodeId
                ? sourceNode.data.sourceNodeId.replace("ifbranch:", "ifedge:") + `:${targetId}`
                : `edge:${sourceId}:${targetId}`,
            insertTargetNodeId: targetId,
            moveTargetNodeId: pendingMoveNodeId ? targetId : undefined,
          },
          selectable: pendingMoveNodeId ? false : true,
          draggable: false,
        } as CanvasNode
      })
      .filter((node): node is CanvasNode => Boolean(node))

    const outgoingCount = new Map<string, number>()
    edges.forEach((edge) => {
      outgoingCount.set(edge.source, (outgoingCount.get(edge.source) ?? 0) + 1)
    })

    type LeafSource = { sourceNodeId: string; addX: number; addY: number }
    const leafSources: LeafSource[] = []

    sorted.forEach((node) => {
      if (node.data.kind === "ifElse") {
        ;(node.data.ifElseBranches ?? []).forEach((branch) => {
          if (branch.targetNodeId) return
          const branchPosition = getIfBranchCanvasPosition(node, branch.id)
          leafSources.push({
            sourceNodeId: `ifbranch:${node.id}:${branch.id}`,
            addX: branchPosition.x + (IF_BRANCH_NODE_WIDTH - ADD_NODE_WIDTH) / 2,
            addY: branchPosition.y + NODE_VERTICAL_STEP,
          })
        })
        return
      }
      if (node.data.kind === "goTo") return
      if ((outgoingCount.get(node.id) ?? 0) > 0) return
      leafSources.push({
        sourceNodeId: node.id,
        addX: node.position.x + (STEP_NODE_WIDTH - ADD_NODE_WIDTH) / 2,
        addY: node.position.y + NODE_VERTICAL_STEP,
      })
    })

    const addNodes: CanvasNode[] = leafSources.map((leaf, index) => ({
          id: `node-add-${index + 1}`,
          type: "stepNode",
          position: { x: leaf.addX, y: leaf.addY },
          data: {
            kind: pendingMoveNodeId ? "moveDrop" : "add",
            label: pendingMoveNodeId ? "Drop" : "Add",
            waitValue: 0,
            waitUnit: "days",
            waitDays: 0,
            notesTemplate: "",
            assigneeUserId: null,
            tagName: null,
            fieldKey: null,
            fieldValue: null,
            statusValue: null,
            taskTitle: null,
            sourceNodeId: pendingMoveNodeId ? undefined : leaf.sourceNodeId,
            moveLaneSourceNodeId: pendingMoveNodeId ? leaf.sourceNodeId : undefined,
          },
          selectable: !pendingMoveNodeId,
          draggable: false,
        }))

    const endNodes: CanvasNode[] = addNodes.map((addNode, index) => ({
          id: `node-end-${index + 1}`,
          type: "stepNode",
          position: {
            x: addNode.position.x + (ADD_NODE_WIDTH - END_NODE_WIDTH) / 2,
            y: addNode.position.y + 52,
          },
          data: {
            kind: "end",
            label: "END",
            waitValue: 0,
            waitUnit: "days",
            waitDays: 0,
            notesTemplate: "",
            assigneeUserId: null,
            tagName: null,
            fieldKey: null,
            fieldValue: null,
            statusValue: null,
            taskTitle: null,
          },
          selectable: false,
          draggable: false,
        }))

    return [...sorted, ...ifBranchNodes, ...betweenActionNodes, ...addNodes, ...endNodes].map((node) => {
      const allowMenu =
        node.data.kind !== "start" &&
        node.data.kind !== "add" &&
        node.data.kind !== "end" &&
        node.data.kind !== "ifBranch" &&
        node.data.kind !== "moveDrop"

      return {
        ...node,
        type: "stepNode",
        data: allowMenu
          ? {
              ...node.data,
              actionNodeId: node.id,
              onEditAction: openActionEditor,
              onMoveAction: startMoveAction,
              onDeleteAction: deleteAction,
            }
          : node.data,
      }
    })
  }, [deleteAction, edges, nodes, openActionEditor, pendingMoveNodeId, startMoveAction])

  const canvasEdges = useMemo(() => {
    const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    if (!sorted.length) return []

    const baseEdges = edges.map((edge) => ({ ...edge, type: "smoothstep" as const }))
    const branchEdges: Edge[] = []
    const goToEdges: Edge[] = []

    sorted.forEach((node) => {
      if (node.data.kind !== "ifElse") return
      const branches = (node.data.ifElseBranches ?? []).filter((branch) =>
        branch.isDefault ? true : branch.name.trim().length > 0,
      )
      if (!branches.length) return

      branches.forEach((branch) => {
        const branchNodeId = getIfBranchCanvasNodeId(node.id, branch.id)
        branchEdges.push({
          id: `edge-${node.id}-${branchNodeId}`,
          source: node.id,
          target: branchNodeId,
          type: "smoothstep",
          label: branch.name || "Branch",
        })
        if (branch.targetNodeId) {
          branchEdges.push({
            id: `edge-${branchNodeId}-${branch.targetNodeId}`,
            source: branchNodeId,
            target: branch.targetNodeId,
            type: "smoothstep",
          })
        }
      })
    })

    const nodeIds = new Set(sorted.map((node) => node.id))
    sorted.forEach((node) => {
      if (node.data.kind !== "goTo") return
      const targetId = node.data.goToNodeId?.trim()
      if (!targetId || targetId === node.id || !nodeIds.has(targetId)) return
      goToEdges.push({
        id: `edge-goto-${node.id}-${targetId}`,
        source: node.id,
        target: targetId,
        type: "smoothstep",
      })
    })

    const outgoingCount = new Map<string, number>()
    edges.forEach((edge) => {
      outgoingCount.set(edge.source, (outgoingCount.get(edge.source) ?? 0) + 1)
    })

    const leafEdgeSources: string[] = []
    sorted.forEach((node) => {
      if (node.data.kind === "ifElse") {
        ;(node.data.ifElseBranches ?? []).forEach((branch) => {
          if (branch.targetNodeId) return
          leafEdgeSources.push(getIfBranchCanvasNodeId(node.id, branch.id))
        })
        return
      }
      if (node.data.kind === "goTo") return
      if ((outgoingCount.get(node.id) ?? 0) > 0) return
      leafEdgeSources.push(node.id)
    })

    const addEdges = leafEdgeSources.flatMap((sourceId, index) => [
      {
        id: `edge-${sourceId}-node-add-${index + 1}`,
        source: sourceId,
        target: `node-add-${index + 1}`,
        type: "smoothstep" as const,
      },
      {
        id: `edge-node-add-${index + 1}-node-end-${index + 1}`,
        source: `node-add-${index + 1}`,
        target: `node-end-${index + 1}`,
        type: "smoothstep" as const,
      },
    ])

    return [...baseEdges, ...branchEdges, ...goToEdges, ...addEdges]
  }, [edges, nodes, pendingMoveNodeId])

  const onSave = async () => {
    if (!name.trim()) {
      toast.error("Template name is required.")
      return
    }

    if (!canEditTemplateName && name.trim() !== template.name) {
      toast.error("Template name can only be edited once.")
      return
    }

    const mathFieldValueTypeById = new Map<MathFieldKey, MathFieldValueType>(
      allMathFields.map(
        (field) => [`${field.source}:${field.key}` as MathFieldKey, field.valueType] as const,
      ),
    )
    const dateFieldKeySet = new Set(
      allDateFields.map((field) => `${field.source}:${field.key}` as MathFieldKey),
    )
    for (const node of nodes) {
      if (node.data.kind !== "mathOperation") continue

      const sourceId: MathFieldKey | null = node.data.mathSourceFieldKey
        ? (`${
            node.data.mathSourceFieldSource ?? "contact"
          }:${node.data.mathSourceFieldKey}` as MathFieldKey)
        : null
      const targetId: MathFieldKey | null = node.data.mathResultFieldKey
        ? (`${
            node.data.mathResultFieldSource ?? "contact"
          }:${node.data.mathResultFieldKey}` as MathFieldKey)
        : null
      const sourceValueType = sourceId ? mathFieldValueTypeById.get(sourceId) : undefined
      const targetValueType = targetId ? mathFieldValueTypeById.get(targetId) : undefined

      if (!sourceValueType || !targetValueType) {
        toast.error("Math operation must include valid source and update fields.")
        return
      }

      if (sourceValueType !== targetValueType) {
        toast.error("Math operation source and update fields must use the same value type.")
        return
      }

      const op = node.data.mathOperationType ?? "add"
      if (sourceValueType === "dateTime" && op !== "add" && op !== "subtract") {
        toast.error("Date math operations only support add or subtract.")
        return
      }

      if (!Number.isFinite(Number(node.data.mathOperationValue))) {
        toast.error("Math operation value must be a valid number.")
        return
      }
    }
    for (const node of nodes) {
      if (node.data.kind !== "dateTimeFormatter") continue

      const sourceId: MathFieldKey | null = node.data.dateTimeFormatSourceFieldKey
        ? (`${
            node.data.dateTimeFormatSourceFieldSource ?? "contact"
          }:${node.data.dateTimeFormatSourceFieldKey}` as MathFieldKey)
        : null
      if (!sourceId || !dateFieldKeySet.has(sourceId)) {
        toast.error("Date/Time formatter must use a valid date field.")
        return
      }

      const mode = node.data.dateTimeFormatMode ?? "dateTime"
      if (mode !== "compareDates") {
        const allowedFormatValues = new Set(getDateTimeFormatOptions(mode).map((option) => option.value))
        if (!node.data.dateTimeFormatPattern || !allowedFormatValues.has(node.data.dateTimeFormatPattern)) {
          toast.error("Date/Time formatter must include a valid format option.")
          return
        }
      }
      if (mode === "compareDates") {
        const compareId: MathFieldKey | null = node.data.dateTimeFormatCompareFieldKey
          ? (`${
              node.data.dateTimeFormatCompareFieldSource ?? "contact"
            }:${node.data.dateTimeFormatCompareFieldKey}` as MathFieldKey)
          : null
        if (!compareId || !dateFieldKeySet.has(compareId)) {
          toast.error("Compare dates requires a valid compare date field.")
          return
        }
        if (compareId === sourceId) {
          toast.error("Compare date must be different from the source date.")
          return
        }
      }
    }
    for (const node of nodes) {
      if (node.data.kind !== "numberFormatter") continue
      const mode = node.data.numberFormatterMode ?? "formatNumber"
      if (mode === "formatPhoneNumber") {
        const sourceKey = node.data.numberFormatterFieldKey?.trim()
        const sourceFieldId = sourceKey
          ? `${node.data.numberFormatterFieldSource ?? "contact"}:${sourceKey}`
          : null
        const hasValidSource = sourceFieldId
          ? phoneFormatterFields.some(
              (field) => `${field.source}:${field.key}` === sourceFieldId,
            )
          : false
        if (!hasValidSource) {
          toast.error("Format phone number action requires selecting a valid phone input field.")
          return
        }
        const hasValidStyle = NUMBER_PHONE_FORMAT_OPTIONS.some(
          (option) => option.value === node.data.numberFormatterPhoneFormat,
        )
        if (!hasValidStyle) {
          toast.error("Format phone number action requires a valid phone format option.")
          return
        }
        if (!node.data.numberFormatterCountryCode || !/^\+\d{1,4}$/.test(node.data.numberFormatterCountryCode.trim())) {
          toast.error("Format phone number action requires a valid country code, for example +1.")
          return
        }
      }
      if (mode === "textToNumber" || mode === "formatNumber" || mode === "formatCurrency") {
        const sourceKey = node.data.numberFormatterInputFieldKey?.trim()
        const sourceFieldId = sourceKey
          ? `${node.data.numberFormatterInputFieldSource ?? "contact"}:${sourceKey}`
          : null
        const hasValidSource = sourceFieldId
          ? numberFormatterInputFields.some(
              (field) => `${field.source}:${field.key}` === sourceFieldId,
            )
          : false
        if (!hasValidSource) {
          toast.error("Number formatter requires selecting a valid input field.")
          return
        }
        if (
          node.data.numberFormatterInputDecimalMark !== "period" &&
          node.data.numberFormatterInputDecimalMark !== "comma"
        ) {
          toast.error("Number formatter requires selecting input decimal mark.")
          return
        }
      }
      if (mode === "formatNumber") {
        const hasValidGrouping = NUMBER_GROUPING_STYLE_OPTIONS.some(
          (option) => option.value === node.data.numberFormatterGroupingStyle,
        )
        if (!hasValidGrouping) {
          toast.error("Format number action requires selecting output number format.")
          return
        }
      }
      if (mode === "formatCurrency") {
        const hasValidCurrency = NUMBER_CURRENCY_OPTIONS.some(
          (option) => option.value === node.data.numberFormatterCurrencyCode,
        )
        if (!hasValidCurrency) {
          toast.error("Format currency action requires selecting a currency.")
          return
        }
      }
      if (mode === "randomNumber") {
        const min = Number(node.data.numberFormatterMin)
        const max = Number(node.data.numberFormatterMax)
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          toast.error("Random number action requires valid minimum and maximum values.")
          return
        }
        if (min > max) {
          toast.error("Random number minimum cannot be greater than maximum.")
          return
        }
      }
    }

    setIsSaving(true)
    try {
      const edgesByTarget = new Map<string, string[]>()
      edges.forEach((edge) => {
        const arr = edgesByTarget.get(edge.target) ?? []
        arr.push(edge.source)
        edgesByTarget.set(edge.target, arr)
      })

      const nodesById = new Map(nodes.map((node) => [node.id, node]))
      const dueCache = new Map<string, number>()

      const calcDueMinutes = (nodeId: string, seen = new Set<string>()): number => {
        if (dueCache.has(nodeId)) return dueCache.get(nodeId) ?? 0
        if (seen.has(nodeId)) return 0

        seen.add(nodeId)
        const sourceIds = edgesByTarget.get(nodeId) ?? []

        if (!sourceIds.length) {
          dueCache.set(nodeId, 0)
          return 0
        }

        const maxDue = Math.max(
          ...sourceIds.map((sourceId) => {
            const sourceNode = nodesById.get(sourceId)
            const base = calcDueMinutes(sourceId, new Set(seen))
            if (sourceNode?.data.kind === "wait") {
              const safeWaitValue = Math.max(0, Number(sourceNode.data.waitValue) || 0)
              const unit = WAIT_UNITS.includes(sourceNode.data.waitUnit)
                ? sourceNode.data.waitUnit
                : "days"
              return base + safeWaitValue * WAIT_UNIT_TO_MINUTES[unit]
            }
            return base
          }),
        )

        dueCache.set(nodeId, maxDue)
        return maxDue
      }

      const ordered = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)

      const steps = ordered
        .filter((node) => node.data.kind === "step")
        .map((node, index) => ({
          title: node.data.label.trim() || `Step ${index + 1}`,
          notesTemplate: node.data.notesTemplate.trim() || null,
          dueDaysFromStart: Math.floor(calcDueMinutes(node.id) / WAIT_UNIT_TO_MINUTES.days),
          sortOrder: (index + 1) * 10,
        }))

      await api.patch(
        `/api/account-settings/${tenantId}/services/${serviceId}/follow-up-templates/${template.id}`,
        {
          name: name.trim(),
          isPublished,
          flowNodes: nodes,
          flowEdges: edges,
          steps,
        },
      )

      if (canEditTemplateName && name.trim() !== template.name) {
        setHasRenamedTemplate(true)
      }

      toast.success("Template saved.")
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not save template.",
        )
      } else {
        toast.error("Could not save template.")
      }
    } finally {
      setIsSaving(false)
    }
  }

  const onDelete = async () => {
    const confirmed = window.confirm("Delete this follow-up template?")
    if (!confirmed) return

    setIsDeleting(true)
    try {
      await api.delete(
        `/api/account-settings/${tenantId}/services/${serviceId}/follow-up-templates/${template.id}`,
      )
      toast.success("Template deleted.")
      router.push(`/app/${tenantSlug}/account-settings/services/${serviceId}`)
      router.refresh()
    } catch {
      toast.error("Could not delete template.")
    } finally {
      setIsDeleting(false)
    }
  }

  const tagPreviewName = toTagPreviewName(newStepDraft.tagName)
  const tagQuery = tagPreviewName.toLowerCase()
  const matchingTags = useMemo(() => {
    if (!tagQuery) return tenantTags
    return tenantTags.filter((tag) => tag.name.toLowerCase().includes(tagQuery))
  }, [tenantTags, tagQuery])
  const visibleTags = useMemo(() => matchingTags.slice(0, 6), [matchingTags])
  const exactTagExists = tenantTags.some(
    (tag) => tag.name.toLowerCase() === tagQuery && tagQuery.length > 0,
  )
  const canCreateTagFromQuery =
    newStepDraft.kind === "tagAdd" &&
    Boolean(tagPreviewName) &&
    !exactTagExists

  const createTagFromQuery = async () => {
    const name = tagPreviewName
    if (!name) {
      toast.error("Tag name is required.")
      return
    }
    if (exactTagExists) {
      return
    }

    setIsCreatingTag(true)
    try {
      const { data } = await api.post<{ ok: boolean; tag: { id: string; name: string } }>(
        `/api/account-settings/${tenantId}/tags`,
        {
          name,
          bgColor: "#DBEAFE",
          textColor: "#1E3A8A",
        },
      )
      setTenantTags((prev) => [
        ...prev,
        { id: data.tag.id, name: data.tag.name, bgColor: "#DBEAFE", textColor: "#1E3A8A" },
      ])
      setNewStepDraft((prev) => ({ ...prev, tagName: data.tag.name }))
      toast.success("Tag created.")
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (backendError === "TAG_NAME_ALREADY_EXISTS") {
          toast.error("Tag already exists.")
          return
        }
      }
      toast.error("Could not create tag.")
    } finally {
      setIsCreatingTag(false)
    }
  }

  const uploadNoteAttachment = async (file: File): Promise<NoteAttachmentRef> => {
    const contentType = inferContentType(file)
    if (!contentType) {
      throw new Error("UNSUPPORTED_CONTENT_TYPE")
    }

    const { data } = await api.post<{
      url: string
      fields: Record<string, string>
      key: string
      fileId: string
    }>("/api/files/presign-upload", {
      tenantId,
      filename: file.name,
      contentType,
    })

    const formData = new FormData()
    for (const [key, value] of Object.entries(data.fields)) {
      formData.append(key, value)
    }
    formData.append("file", file)

    const uploadResponse = await fetch(data.url, {
      method: "POST",
      body: formData,
    })

    if (!uploadResponse.ok) {
      throw new Error("UPLOAD_FAILED")
    }

    return {
      fileId: data.fileId,
      key: data.key,
      fileName: file.name,
      contentType,
      size: file.size,
    }
  }

  const openNoteAttachmentPicker = (target: NoteAttachmentTarget) => {
    setNoteAttachmentTarget(target)
    noteAttachmentInputRef.current?.click()
  }

  const handleSelectNoteAttachments = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (!files.length) return

    if (noteAttachmentTarget === "create") {
      const totalCount = newStepDraft.noteAttachments.length + files.length
      if (totalCount > MAX_NOTE_ATTACHMENTS) {
        toast.error(`You can attach up to ${MAX_NOTE_ATTACHMENTS} files.`)
        return
      }
    } else {
      const existingCount = selectedNode?.data.noteAttachments?.length ?? 0
      if (existingCount + files.length > MAX_NOTE_ATTACHMENTS) {
        toast.error(`You can attach up to ${MAX_NOTE_ATTACHMENTS} files.`)
        return
      }
    }

    setIsUploadingNoteAttachment(true)
    try {
      const uploaded: NoteAttachmentRef[] = []
      for (const file of files) {
        uploaded.push(await uploadNoteAttachment(file))
      }

      if (noteAttachmentTarget === "create") {
        setNewStepDraft((prev) => ({
          ...prev,
          noteAttachments: [...prev.noteAttachments, ...uploaded],
        }))
      } else if (selectedNode?.data.kind === "addNote") {
        updateSelectedNode((data) => ({
          ...data,
          noteAttachments: [...(data.noteAttachments ?? []), ...uploaded],
        }))
      }
      toast.success("Document(s) attached.")
    } catch (error) {
      if (error instanceof Error && error.message === "UNSUPPORTED_CONTENT_TYPE") {
        toast.error("Only PNG, JPG, WEBP, and PDF files are supported.")
      } else {
        toast.error("Could not upload documents.")
      }
    } finally {
      setIsUploadingNoteAttachment(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 md:p-4">
      <section className="shrink-0 rounded-[20px] border border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Follow-Up Builder</p>
            <div className="flex items-center gap-2">
              <Input
                value={name}
                disabled={!canEditTemplateName}
                onChange={(event) => setName(event.target.value)}
                className="h-9 max-w-md"
              />
              <button
                type="button"
                role="switch"
                aria-checked={isPublished}
                onClick={() => setIsPublished((prev) => !prev)}
                className="inline-flex h-9 items-center rounded-full border border-slate-300 bg-white px-1 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <span
                  className={`rounded-full px-3 py-1 transition ${
                    !isPublished ? "bg-slate-900 text-white" : "text-slate-600"
                  }`}
                >
                  Draft
                </span>
                <span
                  className={`rounded-full px-3 py-1 transition ${
                    isPublished ? "bg-emerald-600 text-white" : "text-slate-600"
                  }`}
                >
                  Publish
                </span>
              </button>
            </div>
            <p className="text-xs text-slate-500">
              {canEditTemplateName
                ? "Template name can be edited once."
                : "Template name is locked after the first rename."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" asChild>
              <Link href={`/app/${tenantSlug}/account-settings/services/${serviceId}`}>Back to service</Link>
            </Button>
            <Button type="button" variant="destructive" onClick={onDelete} disabled={isDeleting}>
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
            <Button type="button" onClick={onSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </section>

      <section className="flex min-h-0 flex-1 gap-3">
        <div className="relative h-full min-h-0 flex-1 overflow-hidden rounded-[20px] border border-slate-200 bg-white">
          {pendingMoveNodeId ? (
            <div className="absolute left-4 top-4 z-20 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
              Move mode active. Click a destination action to place before it, or a plus at the end
              of a lane to move it to the end.
            </div>
          ) : null}
          {sidebarMode === "hidden" && !pendingMoveNodeId ? (
            <div className="absolute right-4 top-4 z-20">
              <Button type="button" size="sm" variant="outline" onClick={() => openCreateStepPanel()}>
                <Plus className="h-4 w-4" />
                Add action
              </Button>
            </div>
          ) : null}
          <ReactFlowProvider>
            <ReactFlow<CanvasNode, Edge>
              nodes={canvasNodes}
              edges={canvasEdges}
              nodeTypes={NODE_TYPES}
              fitView
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              onNodeClick={(_, node) => {
                if (pendingMoveNodeId) {
                  if (node.data.kind === "moveDrop" && node.data.moveTargetNodeId) {
                    moveNodeBeforeTarget(pendingMoveNodeId, node.data.moveTargetNodeId)
                    setPendingMoveNodeId(null)
                    return
                  }
                  if (node.data.kind === "moveDrop" && node.data.moveLaneSourceNodeId) {
                    moveNodeToLaneEnd(pendingMoveNodeId, node.data.moveLaneSourceNodeId)
                    setPendingMoveNodeId(null)
                    return
                  }
                  if (node.data.kind === "add" || node.data.kind === "ifBranch" || node.data.kind === "end") {
                    return
                  }
                  moveNodeBeforeTarget(pendingMoveNodeId, node.id)
                  setPendingMoveNodeId(null)
                  return
                }
                if (node.data.kind === "add") {
                  openCreateStepPanel(node.data.sourceNodeId)
                  return
                }
                if (node.data.kind === "ifBranch") {
                  openCreateStepPanel(node.data.sourceNodeId)
                  return
                }
                if (node.data.kind === "end") return
                setSelectedNodeId(node.id)
                setSidebarMode("edit")
              }}
              onPaneClick={() => {
                if (pendingMoveNodeId) {
                  setPendingMoveNodeId(null)
                }
                setSidebarMode("hidden")
              }}
            >
              <Controls position="bottom-left" />
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
            </ReactFlow>
          </ReactFlowProvider>
        </div>

        {sidebarMode !== "hidden" ? (
          <aside className="flex h-full min-h-0 w-full max-w-md shrink-0 overflow-hidden rounded-[20px] border border-slate-200 bg-white/95 shadow-sm backdrop-blur">
            <div className="h-full w-full space-y-4 overflow-y-auto p-4">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3">
                <p className="text-sm font-semibold text-slate-900">
                  {sidebarMode === "create" ? "Choose action" : "Edit action"}
                </p>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 cursor-pointer"
                  onClick={() => setSidebarMode("hidden")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {sidebarMode === "create" ? (
                createPanelView === "options" ? (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-slate-900">Choose Action</h4>
                    <p className="text-xs text-slate-500">Select what you want to add between nodes.</p>
                    <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Workflow
                        </p>
                        <div className="h-px bg-slate-200" />
                        {WORKFLOW_NODE_KINDS.map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            className="w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
                            onClick={() => {
                              setNewStepDraft(makeDefaultDraft(kind))
                              setIsContactInfoSectionOpen(false)
                              setIsCustomFieldsSectionOpen(false)
                              setCreatePanelView("form")
                            }}
                          >
                            <p className="text-sm font-medium text-slate-900">{NODE_KIND_LABEL[kind]}</p>
                            <p className="text-xs text-slate-500">{NODE_KIND_DESCRIPTION[kind]}</p>
                          </button>
                        ))}
                      </div>
                      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Internal Actions
                        </p>
                        <div className="h-px bg-slate-200" />
                        {INTERNAL_NODE_KINDS.map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            className="w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
                            onClick={() => {
                              setNewStepDraft(makeDefaultDraft(kind))
                              setIsContactInfoSectionOpen(false)
                              setIsCustomFieldsSectionOpen(false)
                              setCreatePanelView("form")
                            }}
                          >
                            <p className="text-sm font-medium text-slate-900">{NODE_KIND_LABEL[kind]}</p>
                            <p className="text-xs text-slate-500">{NODE_KIND_DESCRIPTION[kind]}</p>
                          </button>
                        ))}
                      </div>
                      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Contact Actions
                        </p>
                        <div className="h-px bg-slate-200" />
                        {CONTACT_ACTION_NODE_KINDS.map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            className="w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
                            onClick={() => {
                              setNewStepDraft(makeDefaultDraft(kind))
                              setIsContactInfoSectionOpen(false)
                              setIsCustomFieldsSectionOpen(false)
                              setCreatePanelView("form")
                            }}
                          >
                            <p className="text-sm font-medium text-slate-900">{NODE_KIND_LABEL[kind]}</p>
                            <p className="text-xs text-slate-500">{NODE_KIND_DESCRIPTION[kind]}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-slate-900">{NODE_KIND_LABEL[newStepDraft.kind]}</h4>
                      <Button type="button" size="sm" variant="outline" onClick={() => setCreatePanelView("options")}>
                        Back to options
                      </Button>
                    </div>
                    <div className="grid gap-2">
                      <Label>Action name</Label>
                      <Input
                        placeholder={NODE_KIND_LABEL[newStepDraft.kind]}
                        value={newStepDraft.label}
                        onChange={(event) =>
                          setNewStepDraft((prev) => ({ ...prev, label: event.target.value }))
                        }
                      />
                    </div>
                    {newStepDraft.kind === "wait" ? (
                      <div className="grid gap-2">
                        <Label>Wait time</Label>
                        <div className="grid grid-cols-[1fr_120px] gap-2">
                          <Input
                            type="number"
                            min={0}
                            value={newStepDraft.waitValue}
                            onChange={(event) =>
                              setNewStepDraft((prev) => ({
                                ...prev,
                                waitValue: event.target.value,
                              }))
                            }
                          />
                          <select
                            value={newStepDraft.waitUnit}
                            onChange={(event) =>
                              setNewStepDraft((prev) => ({
                                ...prev,
                                waitUnit: event.target.value as WaitUnit,
                              }))
                            }
                            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-slate-400"
                          >
                            <option value="days">Days</option>
                            <option value="hours">Hours</option>
                            <option value="minutes">Minutes</option>
                          </select>
                        </div>
                      </div>
                    ) : null}
                    {newStepDraft.kind === "ifElse" ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label>Branches</Label>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="cursor-pointer"
                            onClick={() =>
                              setNewStepDraft((prev) => {
                                const nextIndex =
                                  prev.ifElseBranches.filter((branch) => !branch.isDefault).length + 1
                                const defaultBranch = prev.ifElseBranches.find((branch) => branch.isDefault)
                                const regularBranches = prev.ifElseBranches.filter(
                                  (branch) => !branch.isDefault,
                                )
                                return {
                                  ...prev,
                                  ifElseBranches: [
                                    ...regularBranches,
                                    makeIfElseBranch(nextIndex),
                                    ...(defaultBranch ? [defaultBranch] : [makeDefaultBranch()]),
                                  ],
                                }
                              })
                            }
                          >
                            Add branch
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {newStepDraft.ifElseBranches.map((branch) =>
                            branch.isDefault ? (
                              <div
                                key={branch.id}
                                className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                              >
                                <p className="text-sm font-medium text-slate-900">
                                  {branch.name || "Default"}
                                </p>
                                <p className="text-xs text-slate-500">
                                  Fallback when no branch criteria is met.
                                </p>
                              </div>
                            ) : (
                              <div
                                key={branch.id}
                                className="space-y-2 rounded-lg border border-slate-200 bg-white p-3"
                              >
                                <div className="flex items-center gap-2">
                                  <Input
                                    placeholder="Branch name"
                                    value={branch.name}
                                    onChange={(event) =>
                                      upsertDraftIfElseBranch(branch.id, (current) => ({
                                        ...current,
                                        name: event.target.value,
                                      }))
                                    }
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="cursor-pointer text-red-600 hover:text-red-700"
                                    onClick={() =>
                                      setNewStepDraft((prev) => ({
                                        ...prev,
                                        ifElseBranches: prev.ifElseBranches.filter(
                                          (item) => item.id !== branch.id,
                                        ),
                                      }))
                                    }
                                  >
                                    Remove
                                  </Button>
                                </div>
                                <div className="grid grid-cols-1 gap-2">
                                  <Select
                                    value={branch.source}
                                    onValueChange={(value) =>
                                      upsertDraftIfElseBranch(branch.id, (current) => {
                                        const nextSource = value as IfElseBranchSource
                                        const nextValueType =
                                          nextSource === "dateTime"
                                            ? "dateTime"
                                            : nextSource === "contactInfo"
                                              ? CONTACT_INFO_FIELD_VALUE_TYPE[current.fieldKey] ?? "string"
                                              : toIfElseValueTypeFromCustomFieldType(
                                                  customFieldByKey.get(current.fieldKey)?.fieldType ?? "",
                                                )
                                        const nextOperators = getOperatorsForValueType(nextValueType)
                                        return {
                                          ...current,
                                          source: nextSource,
                                          fieldKey: nextSource === "dateTime" ? "currentDateTime" : "",
                                          valueType: nextValueType,
                                          operator: nextOperators[0],
                                          compareValue: "",
                                        }
                                      })
                                    }
                                  >
                                    <SelectTrigger className="h-9 bg-white">
                                      <SelectValue placeholder="Select source" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="dateTime" className="cursor-pointer">
                                        Date/Time
                                      </SelectItem>
                                      <SelectItem value="contactInfo" className="cursor-pointer">
                                        Contact information
                                      </SelectItem>
                                      <SelectItem value="customField" className="cursor-pointer">
                                        Contact custom field
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {branch.source === "dateTime" ? (
                                    <Input value="Current Date/Time" disabled />
                                  ) : branch.source === "contactInfo" ? (
                                    <Select
                                      value={branch.fieldKey}
                                      onValueChange={(value) =>
                                        upsertDraftIfElseBranch(branch.id, (current) => {
                                          const nextValueType =
                                            CONTACT_INFO_FIELD_VALUE_TYPE[value] ?? "string"
                                          const nextOperators =
                                            getOperatorsForValueType(nextValueType)
                                          return {
                                            ...current,
                                            fieldKey: value,
                                            valueType: nextValueType,
                                            operator: nextOperators[0],
                                            compareValue: "",
                                          }
                                        })
                                      }
                                    >
                                      <SelectTrigger className="h-9 bg-white">
                                        <SelectValue placeholder="Select contact field" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {CONTACT_INFO_FIELDS.map((field) => (
                                          <SelectItem
                                            key={field.key}
                                            value={field.key}
                                            className="cursor-pointer"
                                          >
                                            {field.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <Select
                                      value={branch.fieldKey}
                                      onValueChange={(value) =>
                                        upsertDraftIfElseBranch(branch.id, (current) => {
                                          const nextValueType =
                                            toIfElseValueTypeFromCustomFieldType(
                                              customFieldByKey.get(value)?.fieldType ?? "",
                                            )
                                          const nextOperators =
                                            getOperatorsForValueType(nextValueType)
                                          return {
                                            ...current,
                                            fieldKey: value,
                                            valueType: nextValueType,
                                            operator: nextOperators[0],
                                            compareValue: "",
                                          }
                                        })
                                      }
                                    >
                                      <SelectTrigger className="h-9 bg-white">
                                        <SelectValue placeholder="Select custom field" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {customFieldOptions.map((field) => (
                                          <SelectItem
                                            key={field.key}
                                            value={field.key}
                                            className="cursor-pointer"
                                          >
                                            {field.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}
                                  <Select
                                    value={branch.operator}
                                    onValueChange={(value) =>
                                      upsertDraftIfElseBranch(branch.id, (current) => ({
                                        ...current,
                                        operator: value as IfElseOperator,
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="h-9 bg-white">
                                      <SelectValue placeholder="Select operator" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {getOperatorsForValueType(branch.valueType).map((operator) => (
                                        <SelectItem
                                          key={operator}
                                          value={operator}
                                          className="cursor-pointer"
                                        >
                                          {OPERATOR_LABEL[operator]}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {branch.operator !== "is_empty" &&
                                  branch.operator !== "is_not_empty" ? (
                                    <Input
                                      placeholder="Value"
                                      value={branch.compareValue}
                                      onChange={(event) =>
                                        upsertDraftIfElseBranch(branch.id, (current) => ({
                                          ...current,
                                          compareValue: event.target.value,
                                        }))
                                      }
                                    />
                                  ) : null}
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    ) : null}
                    {newStepDraft.kind === "mathOperation" ? (
                      <>
                        <div className="grid gap-2">
                          <Label>Source field</Label>
                          <Select
                            value={
                              newStepDraft.mathSourceFieldKey
                                ? `${newStepDraft.mathSourceFieldSource}:${newStepDraft.mathSourceFieldKey}`
                                : ""
                            }
                            onValueChange={(value) => {
                              const [source, key] = value.split(":")
                              const selectedField = allMathFields.find(
                                (field) => field.source === source && field.key === key,
                              )
                              if (!selectedField) return
                              setNewStepDraft((prev) => ({
                                ...prev,
                                mathSourceFieldSource: selectedField.source,
                                mathSourceFieldKey: selectedField.key,
                                mathValueType: selectedField.valueType,
                                mathOperationType:
                                  selectedField.valueType === "dateTime" ? "add" : prev.mathOperationType,
                                mathResultFieldSource: selectedField.source,
                                mathResultFieldKey: "",
                                mathDateUnit:
                                  selectedField.valueType === "dateTime" ? prev.mathDateUnit : "days",
                              }))
                            }}
                          >
                            <SelectTrigger className="h-9 bg-white">
                              <SelectValue placeholder="Select source field" />
                            </SelectTrigger>
                            <SelectContent>
                              {allMathFields.map((field) => (
                                <SelectItem
                                  key={`${field.source}:${field.key}`}
                                  value={`${field.source}:${field.key}`}
                                  className="cursor-pointer"
                                >
                                  {field.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label>Operation</Label>
                          <Select
                            value={newStepDraft.mathOperationType}
                            onValueChange={(value) =>
                              setNewStepDraft((prev) => ({
                                ...prev,
                                mathOperationType: value as MathOperationType,
                              }))
                            }
                          >
                            <SelectTrigger className="h-9 bg-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(newStepDraft.mathValueType === "dateTime"
                                ? MATH_DATE_OPERATION_OPTIONS
                                : MATH_OPERATION_OPTIONS
                              ).map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                  className="cursor-pointer"
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label>Value</Label>
                          <div className="grid grid-cols-[1fr_140px] gap-2">
                            <Input
                              type="number"
                              value={newStepDraft.mathOperationValue}
                              onChange={(event) =>
                                setNewStepDraft((prev) => ({
                                  ...prev,
                                  mathOperationValue: event.target.value,
                                }))
                              }
                            />
                            {newStepDraft.mathValueType === "dateTime" ? (
                              <Select
                                value={newStepDraft.mathDateUnit}
                                onValueChange={(value) =>
                                  setNewStepDraft((prev) => ({
                                    ...prev,
                                    mathDateUnit: value as MathDateUnit,
                                  }))
                                }
                              >
                                <SelectTrigger className="h-9 bg-white">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {MATH_DATE_UNITS.map((unit) => (
                                    <SelectItem
                                      key={unit.value}
                                      value={unit.value}
                                      className="cursor-pointer"
                                    >
                                      {unit.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input value="Number" disabled />
                            )}
                          </div>
                        </div>
                        <div className="grid gap-2">
                          <Label>Update field</Label>
                          <Select
                            value={
                              newStepDraft.mathResultFieldKey
                                ? `${newStepDraft.mathResultFieldSource}:${newStepDraft.mathResultFieldKey}`
                                : ""
                            }
                            onValueChange={(value) => {
                              const [source, key] = value.split(":")
                              setNewStepDraft((prev) => ({
                                ...prev,
                                mathResultFieldSource: source as FieldSource,
                                mathResultFieldKey: key,
                              }))
                            }}
                          >
                            <SelectTrigger className="h-9 bg-white">
                              <SelectValue placeholder="Select update field" />
                            </SelectTrigger>
                            <SelectContent>
                              {allMathFields
                                .filter((field) => field.valueType === newStepDraft.mathValueType)
                                .map((field) => (
                                  <SelectItem
                                    key={`target-${field.source}:${field.key}`}
                                    value={`${field.source}:${field.key}`}
                                    className="cursor-pointer"
                                  >
                                    {field.label}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    ) : null}
                    {newStepDraft.kind === "numberFormatter" ? (
                      <>
                        <div className="grid gap-2">
                          <Label>Action type</Label>
                          <Select
                            value={newStepDraft.numberFormatterMode}
                            onValueChange={(value) =>
                              setNewStepDraft((prev) => ({
                                ...prev,
                                numberFormatterMode: value as NumberFormatterMode,
                                numberFormatterPhoneFormat:
                                  value === "formatPhoneNumber" ? prev.numberFormatterPhoneFormat : "e164",
                                numberFormatterCountryCode:
                                  value === "formatPhoneNumber" ? prev.numberFormatterCountryCode : "+1",
                                numberFormatterInputFieldSource:
                                  value === "textToNumber" ||
                                  value === "formatNumber" ||
                                  value === "formatCurrency"
                                    ? prev.numberFormatterInputFieldSource
                                    : "contact",
                                numberFormatterInputFieldKey:
                                  value === "textToNumber" ||
                                  value === "formatNumber" ||
                                  value === "formatCurrency"
                                    ? prev.numberFormatterInputFieldKey
                                    : "phoneNumber",
                                numberFormatterInputDecimalMark:
                                  value === "textToNumber" ||
                                  value === "formatNumber" ||
                                  value === "formatCurrency"
                                    ? prev.numberFormatterInputDecimalMark
                                    : "period",
                                numberFormatterGroupingStyle:
                                  value === "formatNumber" ? prev.numberFormatterGroupingStyle : "commaPeriod",
                                numberFormatterCurrencyCode:
                                  value === "formatCurrency" ? prev.numberFormatterCurrencyCode : "USD",
                              }))
                            }
                          >
                            <SelectTrigger className="h-9 bg-white">
                              <SelectValue placeholder="Select action type" />
                            </SelectTrigger>
                            <SelectContent>
                              {NUMBER_FORMATTER_OPTIONS.map((option) => (
                                <SelectItem
                                  key={`number-formatter-${option.value}`}
                                  value={option.value}
                                  className="cursor-pointer"
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {(newStepDraft.numberFormatterMode === "textToNumber" ||
                          newStepDraft.numberFormatterMode === "formatNumber" ||
                          newStepDraft.numberFormatterMode === "formatCurrency") ? (
                          <>
                            <div className="grid gap-2">
                              <Label>Input field</Label>
                              <Select
                                value={
                                  newStepDraft.numberFormatterInputFieldKey
                                    ? `${newStepDraft.numberFormatterInputFieldSource}:${newStepDraft.numberFormatterInputFieldKey}`
                                    : ""
                                }
                                onValueChange={(value) => {
                                  const [source, key] = value.split(":")
                                  setNewStepDraft((prev) => ({
                                    ...prev,
                                    numberFormatterInputFieldSource: source as FieldSource,
                                    numberFormatterInputFieldKey: key,
                                  }))
                                }}
                              >
                                <SelectTrigger className="h-9 bg-white">
                                  <SelectValue placeholder="Select input field" />
                                </SelectTrigger>
                                <SelectContent>
                                  {numberFormatterInputFields.map((field) => (
                                    <SelectItem
                                      key={`num-input-${field.source}:${field.key}`}
                                      value={`${field.source}:${field.key}`}
                                      className="cursor-pointer"
                                    >
                                      {field.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid gap-2">
                              <Label>Input decimal mark</Label>
                              <Select
                                value={newStepDraft.numberFormatterInputDecimalMark}
                                onValueChange={(value) =>
                                  setNewStepDraft((prev) => ({
                                    ...prev,
                                    numberFormatterInputDecimalMark: value as NumberDecimalMark,
                                  }))
                                }
                              >
                                <SelectTrigger className="h-9 bg-white">
                                  <SelectValue placeholder="Select input decimal mark" />
                                </SelectTrigger>
                                <SelectContent>
                                  {NUMBER_DECIMAL_MARK_OPTIONS.map((option) => (
                                    <SelectItem
                                      key={`num-decimal-${option.value}`}
                                      value={option.value}
                                      className="cursor-pointer"
                                    >
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </>
                        ) : null}
                        {newStepDraft.numberFormatterMode === "formatNumber" ? (
                          <div className="grid gap-2">
                            <Label>Output format</Label>
                            <Select
                              value={newStepDraft.numberFormatterGroupingStyle}
                              onValueChange={(value) =>
                                setNewStepDraft((prev) => ({
                                  ...prev,
                                  numberFormatterGroupingStyle: value as NumberGroupingStyle,
                                }))
                              }
                            >
                              <SelectTrigger className="h-9 bg-white">
                                <SelectValue placeholder="Select output format" />
                              </SelectTrigger>
                              <SelectContent>
                                {NUMBER_GROUPING_STYLE_OPTIONS.map((option) => (
                                  <SelectItem
                                    key={`num-grouping-${option.value}`}
                                    value={option.value}
                                    className="cursor-pointer"
                                  >
                                    {option.label} ({option.preview})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}
                        {newStepDraft.numberFormatterMode === "formatCurrency" ? (
                          <div className="grid gap-2">
                            <Label>Currency</Label>
                            <Select
                              value={newStepDraft.numberFormatterCurrencyCode}
                              onValueChange={(value) =>
                                setNewStepDraft((prev) => ({
                                  ...prev,
                                  numberFormatterCurrencyCode: value,
                                }))
                              }
                            >
                              <SelectTrigger className="h-9 bg-white">
                                <SelectValue placeholder="Select currency" />
                              </SelectTrigger>
                              <SelectContent>
                                {NUMBER_CURRENCY_OPTIONS.map((option) => (
                                  <SelectItem
                                    key={`num-currency-${option.value}`}
                                    value={option.value}
                                    className="cursor-pointer"
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}
                        {newStepDraft.numberFormatterMode === "formatPhoneNumber" ? (
                          <>
                            <div className="grid gap-2">
                              <Label>Phone input</Label>
                              <Select
                                value={
                                  newStepDraft.numberFormatterFieldKey
                                    ? `${newStepDraft.numberFormatterFieldSource}:${newStepDraft.numberFormatterFieldKey}`
                                    : ""
                                }
                                onValueChange={(value) => {
                                  const [source, key] = value.split(":")
                                  setNewStepDraft((prev) => ({
                                    ...prev,
                                    numberFormatterFieldSource: source as FieldSource,
                                    numberFormatterFieldKey: key,
                                  }))
                                }}
                              >
                                <SelectTrigger className="h-9 bg-white">
                                  <SelectValue placeholder="Select phone input field" />
                                </SelectTrigger>
                                <SelectContent>
                                  {phoneFormatterFields.map((field) => (
                                    <SelectItem
                                      key={`phone-field-${field.source}:${field.key}`}
                                      value={`${field.source}:${field.key}`}
                                      className="cursor-pointer"
                                    >
                                      {field.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid gap-2">
                              <Label>Phone format</Label>
                              <Select
                                value={newStepDraft.numberFormatterPhoneFormat}
                                onValueChange={(value) =>
                                  setNewStepDraft((prev) => ({
                                    ...prev,
                                    numberFormatterPhoneFormat: value as NumberPhoneFormat,
                                  }))
                                }
                              >
                                <SelectTrigger className="h-9 bg-white">
                                  <SelectValue placeholder="Select phone format" />
                                </SelectTrigger>
                                <SelectContent>
                                  {NUMBER_PHONE_FORMAT_OPTIONS.map((option) => (
                                    <SelectItem
                                      key={`phone-style-${option.value}`}
                                      value={option.value}
                                      className="cursor-pointer"
                                    >
                                      {option.label} ({option.preview})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid gap-2">
                              <Label>Country code</Label>
                              <Input
                                placeholder="+1"
                                value={newStepDraft.numberFormatterCountryCode}
                                onChange={(event) =>
                                  setNewStepDraft((prev) => ({
                                    ...prev,
                                    numberFormatterCountryCode: event.target.value,
                                  }))
                                }
                              />
                            </div>
                          </>
                        ) : null}
                        {newStepDraft.numberFormatterMode === "randomNumber" ? (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="grid gap-2">
                              <Label>Minimum</Label>
                              <Input
                                type="number"
                                value={newStepDraft.numberFormatterMin}
                                onChange={(event) =>
                                  setNewStepDraft((prev) => ({
                                    ...prev,
                                    numberFormatterMin: event.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label>Maximum</Label>
                              <Input
                                type="number"
                                value={newStepDraft.numberFormatterMax}
                                onChange={(event) =>
                                  setNewStepDraft((prev) => ({
                                    ...prev,
                                    numberFormatterMax: event.target.value,
                                  }))
                                }
                              />
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {newStepDraft.kind === "dateTimeFormatter" ? (
                      <>
                        <div className="grid gap-2">
                          <Label>Date field</Label>
                          <Select
                            value={
                              newStepDraft.dateTimeFormatSourceFieldKey
                                ? `${newStepDraft.dateTimeFormatSourceFieldSource}:${newStepDraft.dateTimeFormatSourceFieldKey}`
                                : ""
                            }
                            onValueChange={(value) => {
                              const [source, key] = value.split(":")
                              setNewStepDraft((prev) => ({
                                ...prev,
                                dateTimeFormatSourceFieldSource: source as FieldSource,
                                dateTimeFormatSourceFieldKey: key,
                              }))
                            }}
                          >
                            <SelectTrigger className="h-9 bg-white">
                              <SelectValue placeholder="Select date field" />
                            </SelectTrigger>
                            <SelectContent>
                              {allDateFields.map((field) => (
                                <SelectItem
                                  key={`dtf-source-${field.source}:${field.key}`}
                                  value={`${field.source}:${field.key}`}
                                  className="cursor-pointer"
                                >
                                  {field.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label>Format option</Label>
                          <Select
                            value={newStepDraft.dateTimeFormatMode}
                            onValueChange={(value) =>
                              setNewStepDraft((prev) => ({
                                ...prev,
                                dateTimeFormatMode: value as DateTimeFormatterMode,
                                dateTimeFormatPattern:
                                  value === "compareDates"
                                    ? ""
                                    : getDateTimeFormatOptions(value as DateTimeFormatterMode)[0]?.value ?? "",
                                dateTimeFormatCompareFieldKey:
                                  value === "compareDates" ? prev.dateTimeFormatCompareFieldKey : "",
                              }))
                            }
                          >
                            <SelectTrigger className="h-9 bg-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DATE_TIME_FORMATTER_OPTIONS.map((option) => (
                                <SelectItem
                                  key={`dtf-mode-${option.value}`}
                                  value={option.value}
                                  className="cursor-pointer"
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {newStepDraft.dateTimeFormatMode !== "compareDates" ? (
                          <div className="grid gap-2">
                            <Label>Display format</Label>
                            <Select
                              value={newStepDraft.dateTimeFormatPattern}
                              onValueChange={(value) =>
                                setNewStepDraft((prev) => ({
                                  ...prev,
                                  dateTimeFormatPattern: value,
                                }))
                              }
                            >
                              <SelectTrigger className="h-9 bg-white">
                                <SelectValue placeholder="Select date format" />
                              </SelectTrigger>
                              <SelectContent>
                                {getDateTimeFormatOptions(newStepDraft.dateTimeFormatMode).map((option) => (
                                  <SelectItem
                                    key={`dtf-pattern-${option.value}`}
                                    value={option.value}
                                    className="cursor-pointer"
                                  >
                                    {option.label} ({option.preview})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-slate-500">
                              This only formats how the date is displayed. It does not modify the source field value.
                            </p>
                          </div>
                        ) : null}
                        {newStepDraft.dateTimeFormatMode === "compareDates" ? (
                          <div className="grid gap-2">
                            <Label>Compare with</Label>
                            <Select
                              value={
                                newStepDraft.dateTimeFormatCompareFieldKey
                                  ? `${newStepDraft.dateTimeFormatCompareFieldSource}:${newStepDraft.dateTimeFormatCompareFieldKey}`
                                  : ""
                              }
                              onValueChange={(value) => {
                                const [source, key] = value.split(":")
                                setNewStepDraft((prev) => ({
                                  ...prev,
                                  dateTimeFormatCompareFieldSource: source as FieldSource,
                                  dateTimeFormatCompareFieldKey: key,
                                }))
                              }}
                            >
                              <SelectTrigger className="h-9 bg-white">
                                <SelectValue placeholder="Select compare date field" />
                              </SelectTrigger>
                              <SelectContent>
                                {allDateFields
                                  .filter(
                                    (field) =>
                                      !(
                                        field.source === newStepDraft.dateTimeFormatSourceFieldSource &&
                                        field.key === newStepDraft.dateTimeFormatSourceFieldKey
                                      ),
                                  )
                                  .map((field) => (
                                    <SelectItem
                                      key={`dtf-compare-${field.source}:${field.key}`}
                                      value={`${field.source}:${field.key}`}
                                      className="cursor-pointer"
                                    >
                                      {field.label}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {newStepDraft.kind === "goTo" ? (
                      <div className="grid gap-2">
                        <Label>Go to action</Label>
                        <Select
                          value={newStepDraft.goToNodeId}
                          onValueChange={(value) =>
                            setNewStepDraft((prev) => ({
                              ...prev,
                              goToNodeId: value,
                            }))
                          }
                        >
                          <SelectTrigger className="h-9 bg-white">
                            <SelectValue placeholder="Select destination action" />
                          </SelectTrigger>
                          <SelectContent>
                            {orderedNodes
                              .filter((node) => node.data.kind !== "start")
                              .map((node, index) => (
                                <SelectItem key={node.id} value={node.id} className="cursor-pointer">
                                  {node.data.label?.trim() || `Step ${index + 1}`}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                    {newStepDraft.kind === "assign" ? (
                      <div className="grid gap-2">
                        <Label>Assign to user</Label>
                        <select
                          value={newStepDraft.assigneeUserId}
                          onChange={(event) =>
                            setNewStepDraft((prev) => ({
                              ...prev,
                              assigneeUserId: event.target.value,
                            }))
                          }
                          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-slate-400"
                        >
                          <option value="">Select user</option>
                          {tenantUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    {newStepDraft.kind === "removeUser" ? (
                      <>
                        <div className="grid gap-2">
                          <Label>Remove target</Label>
                          <select
                            value={newStepDraft.removeTarget}
                            onChange={(event) =>
                              setNewStepDraft((prev) => ({
                                ...prev,
                                removeTarget: event.target.value as RemoveTarget,
                                assigneeUserId:
                                  event.target.value === "specific_user" ? prev.assigneeUserId : "",
                              }))
                            }
                            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-slate-400"
                          >
                            <option value="specific_user">Specific user</option>
                            <option value="all_assigned_users">All assigned users</option>
                          </select>
                        </div>
                        {newStepDraft.removeTarget === "specific_user" ? (
                          <div className="grid gap-2">
                            <Label>User to remove</Label>
                            <select
                              value={newStepDraft.assigneeUserId}
                              onChange={(event) =>
                                setNewStepDraft((prev) => ({
                                  ...prev,
                                  assigneeUserId: event.target.value,
                                }))
                              }
                              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-slate-400"
                            >
                              <option value="">Select user</option>
                              {tenantUsers.map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {newStepDraft.kind === "reminder" ? (
                      <>
                        <div className="grid gap-2">
                          <Label>Notify</Label>
                          <select
                            value={newStepDraft.reminderTarget}
                            onChange={(event) =>
                              setNewStepDraft((prev) => ({
                                ...prev,
                                reminderTarget: event.target.value as ReminderTarget,
                                reminderUserId:
                                  event.target.value === "specific_user" ? prev.reminderUserId : "",
                              }))
                            }
                            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-slate-400"
                          >
                            <option value="assigned_contact_owner">Assigned contact owner</option>
                            <option value="all_users">All users</option>
                            <option value="specific_user">Specific user</option>
                          </select>
                        </div>
                        {newStepDraft.reminderTarget === "specific_user" ? (
                          <div className="grid gap-2">
                            <Label>User</Label>
                            <select
                              value={newStepDraft.reminderUserId}
                              onChange={(event) =>
                                setNewStepDraft((prev) => ({
                                  ...prev,
                                  reminderUserId: event.target.value,
                                }))
                              }
                              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-slate-400"
                            >
                              <option value="">Select user</option>
                              {tenantUsers.map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {newStepDraft.kind === "tagAdd" || newStepDraft.kind === "tagRemove" ? (
                      <div className="grid gap-2">
                        <Label>{NODE_KIND_LABEL[newStepDraft.kind]}</Label>
                        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                          <div className="border-b border-slate-200 p-2">
                            <Command shouldFilter={false}>
                              <CommandInput
                                value={newStepDraft.tagName}
                                onValueChange={(value) =>
                                  setNewStepDraft((prev) => ({
                                    ...prev,
                                    tagName: value,
                                  }))
                                }
                                placeholder="Search tags"
                              />
                            </Command>
                          </div>
                          <Command shouldFilter={false}>
                            <CommandList>
                              {isTagsLoading ? (
                                <div className="px-3 py-3 text-xs text-slate-500">Loading tags...</div>
                              ) : visibleTags.length ? (
                                <CommandGroup>
                                  {visibleTags.map((tag) => (
                                    <CommandItem
                                      key={tag.id}
                                      value={tag.id}
                                      className="cursor-pointer"
                                      onSelect={() =>
                                        setNewStepDraft((prev) => ({
                                          ...prev,
                                          tagName: tag.name,
                                        }))
                                      }
                                    >
                                      <span
                                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                                        style={{ backgroundColor: tag.bgColor, color: tag.textColor }}
                                      >
                                        {tag.name}
                                      </span>
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              ) : (
                                <div className="px-3 py-3 text-xs text-slate-500">No matching tags.</div>
                              )}
                              {canCreateTagFromQuery && !visibleTags.length ? (
                                <div className="border-t border-slate-200 p-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full cursor-pointer"
                                    onClick={() => void createTagFromQuery()}
                                    disabled={isCreatingTag}
                                  >
                                    {isCreatingTag
                                      ? "Creating..."
                                      : `Create "${tagPreviewName}"`}
                                  </Button>
                                </div>
                              ) : null}
                            </CommandList>
                          </Command>
                        </div>
                      </div>
                    ) : null}
                    {newStepDraft.kind === "contactFieldUpdate" ? (
                      <>
                        <div className="grid gap-2">
                          <Label>Action type</Label>
                          <Select
                            value={newStepDraft.fieldOperation}
                            onValueChange={(value) =>
                              setNewStepDraft((prev) => ({
                                ...prev,
                                fieldOperation: value as FieldOperation,
                                fieldValue: value === "clear" ? "" : prev.fieldValue,
                              }))
                            }
                          >
                            <SelectTrigger className="h-9 bg-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="update">Update field data</SelectItem>
                              <SelectItem value="clear">Clear field data</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <button
                            type="button"
                            className="flex w-full cursor-pointer items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-900"
                            onClick={() => setIsContactInfoSectionOpen((prev) => !prev)}
                          >
                            <span>Contact information</span>
                            <span className="text-xs text-slate-500">
                              {isContactInfoSectionOpen ? "Hide" : "Show"}
                            </span>
                          </button>
                          {isContactInfoSectionOpen ? (
                            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                              {CONTACT_INFO_FIELDS.map((field) => (
                                <button
                                  key={field.key}
                                  type="button"
                                  className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                                    newStepDraft.fieldSource === "contact" &&
                                    newStepDraft.fieldKey === field.key
                                      ? "border border-blue-200 bg-blue-50 text-blue-900"
                                      : "text-slate-700 hover:bg-slate-50"
                                  }`}
                                  onClick={() => {
                                    setNewStepDraft((prev) => ({
                                      ...prev,
                                      fieldSource: "contact",
                                      fieldKey: field.key,
                                    }))
                                    setIsContactInfoSectionOpen(false)
                                  }}
                                >
                                  <span>{field.label}</span>
                                  <span className="text-[11px] text-slate-400 capitalize">
                                    {formatFieldKeyLabel(field.key)}
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="grid gap-2">
                          <button
                            type="button"
                            className="flex w-full cursor-pointer items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-900"
                            onClick={() => setIsCustomFieldsSectionOpen((prev) => !prev)}
                          >
                            <span>Custom fields</span>
                            <span className="text-xs text-slate-500">
                              {isCustomFieldsSectionOpen ? "Hide" : "Show"}
                            </span>
                          </button>
                          {isCustomFieldsSectionOpen ? (
                            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                              {isCustomFieldsLoading ? (
                                <p className="text-xs text-slate-500">Loading fields...</p>
                              ) : customFieldOptions.length ? (
                                customFieldOptions.map((field) => (
                                  <button
                                    key={field.key}
                                    type="button"
                                    className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                                      newStepDraft.fieldSource === "custom" &&
                                      newStepDraft.fieldKey === field.key
                                        ? "border border-blue-200 bg-blue-50 text-blue-900"
                                        : "text-slate-700 hover:bg-slate-50"
                                    }`}
                                    onClick={() => {
                                      setNewStepDraft((prev) => ({
                                        ...prev,
                                        fieldSource: "custom",
                                        fieldKey: field.key,
                                      }))
                                      setIsCustomFieldsSectionOpen(false)
                                    }}
                                  >
                                    <span>{field.label}</span>
                                    <span className="text-[11px] text-slate-400 capitalize">
                                      {formatFieldKeyLabel(field.key)}
                                    </span>
                                  </button>
                                ))
                              ) : (
                                <p className="text-xs text-slate-500">No custom fields available.</p>
                              )}
                            </div>
                          ) : null}
                        </div>
                        {newStepDraft.fieldKey ? (
                          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                            Selected field:{" "}
                            <span className="font-semibold capitalize">
                              {newStepDraft.fieldSource === "custom" ? "Custom" : "Contact"} /{" "}
                              {formatFieldKeyLabel(newStepDraft.fieldKey)}
                            </span>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">
                            Select a field from either section to continue.
                          </p>
                        )}
                        {newStepDraft.fieldOperation === "update" ? (
                          <div className="grid gap-2">
                            <Label>New value</Label>
                            <Input
                              placeholder="Enter value"
                              value={newStepDraft.fieldValue}
                              onChange={(event) =>
                                setNewStepDraft((prev) => ({
                                  ...prev,
                                  fieldValue: event.target.value,
                                }))
                              }
                            />
                          </div>
                        ) : null}
                        {newStepDraft.fieldOperation === "clear" ? (
                          <p className="text-xs text-amber-700">
                            This action will clear existing data in the selected field.
                          </p>
                        ) : null}
                      </>
                    ) : null}
                    {newStepDraft.kind === "statusUpdate" ? (
                      <div className="grid gap-2">
                        <Label>Status</Label>
                        <Select
                          value={newStepDraft.statusValue}
                          onValueChange={(value) =>
                            setNewStepDraft((prev) => ({
                              ...prev,
                              statusValue: value,
                            }))
                          }
                        >
                          <SelectTrigger className="h-9 bg-white">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                          <SelectContent>
                            {tenantContactStatuses.map((status) => (
                              <SelectItem
                                key={status.id}
                                value={status.id}
                                className="cursor-pointer"
                              >
                                <span
                                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                                  style={{
                                    backgroundColor: status.bgColor,
                                    color: status.textColor,
                                  }}
                                >
                                  {status.name}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                    {newStepDraft.kind === "addTask" ? (
                      <div className="grid gap-2">
                        <Label>Task title</Label>
                        <Input
                          placeholder="Call contact"
                          value={newStepDraft.taskTitle}
                          onChange={(event) =>
                            setNewStepDraft((prev) => ({
                              ...prev,
                              taskTitle: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ) : null}
                    {newStepDraft.kind === "addNote" ? (
                      <>
                        <div className="grid gap-2">
                          <Label>Note title</Label>
                          <Input
                            placeholder="Required documents pending"
                            value={newStepDraft.noteTitle}
                            onChange={(event) =>
                              setNewStepDraft((prev) => ({
                                ...prev,
                                noteTitle: event.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="grid gap-2">
                          <div className="flex items-center justify-between">
                            <Label>Documents (optional)</Label>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="cursor-pointer"
                              onClick={() => openNoteAttachmentPicker("create")}
                              disabled={
                                isUploadingNoteAttachment ||
                                newStepDraft.noteAttachments.length >= MAX_NOTE_ATTACHMENTS
                              }
                            >
                              {isUploadingNoteAttachment ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Upload className="h-4 w-4" />
                              )}
                              Add files
                            </Button>
                          </div>
                          {newStepDraft.noteAttachments.length ? (
                            <div className="flex flex-wrap gap-2 rounded-md border border-slate-200 p-2">
                              {newStepDraft.noteAttachments.map((attachment) => (
                                <span
                                  key={attachment.fileId}
                                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                                >
                                  <Paperclip className="h-3 w-3" />
                                  <span className="max-w-[160px] truncate">{attachment.fileName}</span>
                                  <button
                                    type="button"
                                    className="cursor-pointer text-slate-500 hover:text-slate-700"
                                    onClick={() =>
                                      setNewStepDraft((prev) => ({
                                        ...prev,
                                        noteAttachments: prev.noteAttachments.filter(
                                          (item) => item.fileId !== attachment.fileId,
                                        ),
                                      }))
                                    }
                                    aria-label={`Remove ${attachment.fileName}`}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500">
                              Attach PNG, JPG, WEBP, or PDF files.
                            </p>
                          )}
                        </div>
                      </>
                    ) : null}
                    <div className="grid gap-2">
                      <Label>
                        {newStepDraft.kind === "reminder"
                          ? "Reminder message"
                          : newStepDraft.kind === "addNote"
                            ? "Note body"
                            : newStepDraft.kind === "addTask"
                              ? "Task description"
                              : "Description"}
                      </Label>
                      <Textarea
                        rows={3}
                        value={newStepDraft.notesTemplate}
                        onChange={(event) =>
                          setNewStepDraft((prev) => ({
                            ...prev,
                            notesTemplate: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <Button type="button" className="w-full" onClick={addStepNode}>
                      Create action
                    </Button>
                  </div>
                )
              ) : null}

              {sidebarMode === "edit" ? (
                <div className="border-t border-slate-200 pt-4">
                  {selectedNode ? (
                    <div className="grid gap-3">
                      <p className="text-sm font-semibold text-slate-900">Selected Action</p>
                      {selectedNode.data.kind === "start" ? (
                        <p className="text-sm text-slate-600">
                          Start step uses the template name and cannot be deleted.
                        </p>
                      ) : selectedNode.data.kind === "wait" ? (
                        <>
                          <div className="grid gap-2">
                            <Label>Wait time</Label>
                            <div className="grid grid-cols-[1fr_120px] gap-2">
                              <Input
                                type="number"
                                min={0}
                                value={selectedNode.data.waitValue}
                                onChange={(event) =>
                                  updateSelectedNode((data) => ({
                                    ...data,
                                    waitValue: Math.max(0, Number.parseInt(event.target.value, 10) || 0),
                                    waitDays:
                                      data.waitUnit === "days"
                                        ? Math.max(0, Number.parseInt(event.target.value, 10) || 0)
                                        : 0,
                                  }))
                                }
                              />
                              <select
                                value={selectedNode.data.waitUnit}
                                onChange={(event) =>
                                  updateSelectedNode((data) => {
                                    const nextUnit = event.target.value as WaitUnit
                                    return {
                                      ...data,
                                      waitUnit: nextUnit,
                                      waitDays: nextUnit === "days" ? data.waitValue : 0,
                                    }
                                  })
                                }
                                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-slate-400"
                              >
                                <option value="days">Days</option>
                                <option value="hours">Hours</option>
                                <option value="minutes">Minutes</option>
                              </select>
                            </div>
                          </div>
                        </>
                      ) : selectedNode.data.kind === "ifElse" ? (
                        <>
                          <div className="grid gap-2">
                            <Label>Action name</Label>
                            <Input
                              value={selectedNode.data.label}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <Label>Branches</Label>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="cursor-pointer"
                                onClick={() =>
                                  updateSelectedNode((data) => {
                                    const currentBranches = data.ifElseBranches ?? [
                                      makeIfElseBranch(1),
                                      makeDefaultBranch(),
                                    ]
                                    const regularBranches = currentBranches.filter(
                                      (branch) => !branch.isDefault,
                                    )
                                    const defaultBranch = currentBranches.find(
                                      (branch) => branch.isDefault,
                                    )
                                    return {
                                      ...data,
                                      ifElseBranches: [
                                        ...regularBranches,
                                        makeIfElseBranch(regularBranches.length + 1),
                                        ...(defaultBranch ? [defaultBranch] : [makeDefaultBranch()]),
                                      ],
                                    }
                                  })
                                }
                              >
                                Add branch
                              </Button>
                            </div>
                            <div className="space-y-2">
                              {(selectedNode.data.ifElseBranches ?? [
                                {
                                  id: "preview-branch",
                                  name: "Branch 1",
                                  source: "contactInfo",
                                  fieldKey: "firstName",
                                  valueType: "string",
                                  operator: "includes",
                                  compareValue: "",
                                } as IfElseBranch,
                                {
                                  id: "preview-default",
                                  name: "Default",
                                  source: "contactInfo",
                                  fieldKey: "",
                                  valueType: "string",
                                  operator: "is_not_empty",
                                  compareValue: "",
                                  isDefault: true,
                                } as IfElseBranch,
                              ]).map((branch) =>
                                branch.isDefault ? (
                                  <div
                                    key={branch.id}
                                    className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                                  >
                                    <p className="text-sm font-medium text-slate-900">
                                      {branch.name || "Default"}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                      Fallback when no branch criteria is met.
                                    </p>
                                  </div>
                                ) : (
                                  <div
                                    key={branch.id}
                                    className="space-y-2 rounded-lg border border-slate-200 bg-white p-3"
                                  >
                                    <div className="flex items-center gap-2">
                                      <Input
                                        placeholder="Branch name"
                                        value={branch.name}
                                        onChange={(event) =>
                                          updateSelectedNode((data) => ({
                                            ...data,
                                            ifElseBranches: (data.ifElseBranches ?? []).map((item) =>
                                              item.id === branch.id
                                                ? { ...item, name: event.target.value }
                                                : item,
                                            ),
                                          }))
                                        }
                                      />
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="cursor-pointer text-red-600 hover:text-red-700"
                                        onClick={() =>
                                          updateSelectedNode((data) => ({
                                            ...data,
                                            ifElseBranches: (data.ifElseBranches ?? []).filter(
                                              (item) => item.id !== branch.id,
                                            ),
                                          }))
                                        }
                                      >
                                        Remove
                                      </Button>
                                    </div>
                                    <Select
                                      value={branch.source}
                                      onValueChange={(value) =>
                                        updateSelectedNode((data) => ({
                                          ...data,
                                          ifElseBranches: (data.ifElseBranches ?? []).map((item) => {
                                            if (item.id !== branch.id) return item
                                            const nextSource = value as IfElseBranchSource
                                            const nextValueType =
                                              nextSource === "dateTime"
                                                ? "dateTime"
                                                : nextSource === "contactInfo"
                                                  ? CONTACT_INFO_FIELD_VALUE_TYPE[item.fieldKey] ?? "string"
                                                  : toIfElseValueTypeFromCustomFieldType(
                                                      customFieldByKey.get(item.fieldKey)?.fieldType ?? "",
                                                    )
                                            return {
                                              ...item,
                                              source: nextSource,
                                              fieldKey: nextSource === "dateTime" ? "currentDateTime" : "",
                                              valueType: nextValueType,
                                              operator: getOperatorsForValueType(nextValueType)[0],
                                              compareValue: "",
                                            }
                                          }),
                                        }))
                                      }
                                    >
                                      <SelectTrigger className="h-9 bg-white">
                                        <SelectValue placeholder="Select source" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="dateTime" className="cursor-pointer">
                                          Date/Time
                                        </SelectItem>
                                        <SelectItem value="contactInfo" className="cursor-pointer">
                                          Contact information
                                        </SelectItem>
                                        <SelectItem value="customField" className="cursor-pointer">
                                          Contact custom field
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                    {branch.source === "dateTime" ? (
                                      <Input value="Current Date/Time" disabled />
                                    ) : branch.source === "contactInfo" ? (
                                      <Select
                                        value={branch.fieldKey}
                                        onValueChange={(value) =>
                                          updateSelectedNode((data) => ({
                                            ...data,
                                            ifElseBranches: (data.ifElseBranches ?? []).map((item) =>
                                              item.id === branch.id
                                                ? {
                                                    ...item,
                                                    fieldKey: value,
                                                    valueType:
                                                      CONTACT_INFO_FIELD_VALUE_TYPE[value] ?? "string",
                                                    operator:
                                                      getOperatorsForValueType(
                                                        CONTACT_INFO_FIELD_VALUE_TYPE[value] ?? "string",
                                                      )[0],
                                                    compareValue: "",
                                                  }
                                                : item,
                                            ),
                                          }))
                                        }
                                      >
                                        <SelectTrigger className="h-9 bg-white">
                                          <SelectValue placeholder="Select contact field" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {CONTACT_INFO_FIELDS.map((field) => (
                                            <SelectItem
                                              key={field.key}
                                              value={field.key}
                                              className="cursor-pointer"
                                            >
                                              {field.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    ) : (
                                      <Select
                                        value={branch.fieldKey}
                                        onValueChange={(value) =>
                                          updateSelectedNode((data) => ({
                                            ...data,
                                            ifElseBranches: (data.ifElseBranches ?? []).map((item) => {
                                              if (item.id !== branch.id) return item
                                              const valueType = toIfElseValueTypeFromCustomFieldType(
                                                customFieldByKey.get(value)?.fieldType ?? "",
                                              )
                                              return {
                                                ...item,
                                                fieldKey: value,
                                                valueType,
                                                operator: getOperatorsForValueType(valueType)[0],
                                                compareValue: "",
                                              }
                                            }),
                                          }))
                                        }
                                      >
                                        <SelectTrigger className="h-9 bg-white">
                                          <SelectValue placeholder="Select custom field" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {customFieldOptions.map((field) => (
                                            <SelectItem
                                              key={field.key}
                                              value={field.key}
                                              className="cursor-pointer"
                                            >
                                              {field.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    )}
                                    <Select
                                      value={branch.operator}
                                      onValueChange={(value) =>
                                        updateSelectedNode((data) => ({
                                          ...data,
                                          ifElseBranches: (data.ifElseBranches ?? []).map((item) =>
                                            item.id === branch.id
                                              ? { ...item, operator: value as IfElseOperator }
                                              : item,
                                          ),
                                        }))
                                      }
                                    >
                                      <SelectTrigger className="h-9 bg-white">
                                        <SelectValue placeholder="Select operator" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {getOperatorsForValueType(branch.valueType).map((operator) => (
                                          <SelectItem
                                            key={operator}
                                            value={operator}
                                            className="cursor-pointer"
                                          >
                                            {OPERATOR_LABEL[operator]}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    {branch.operator !== "is_empty" &&
                                    branch.operator !== "is_not_empty" ? (
                                      <Input
                                        placeholder="Value"
                                        value={branch.compareValue}
                                        onChange={(event) =>
                                          updateSelectedNode((data) => ({
                                            ...data,
                                            ifElseBranches: (data.ifElseBranches ?? []).map((item) =>
                                              item.id === branch.id
                                                ? { ...item, compareValue: event.target.value }
                                                : item,
                                            ),
                                          }))
                                        }
                                      />
                                    ) : null}
                                  </div>
                                ),
                              )}
                            </div>
                          </div>
                        </>
                      ) : selectedNode.data.kind === "mathOperation" ? (
                        <>
                          <div className="grid gap-2">
                            <Label>Action name</Label>
                            <Input
                              value={selectedNode.data.label}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Source field</Label>
                            <Select
                              value={
                                selectedNode.data.mathSourceFieldKey
                                  ? `${selectedNode.data.mathSourceFieldSource ?? "contact"}:${selectedNode.data.mathSourceFieldKey}`
                                  : ""
                              }
                              onValueChange={(value) => {
                                const [source, key] = value.split(":")
                                const selectedField = allMathFields.find(
                                  (field) => field.source === source && field.key === key,
                                )
                                if (!selectedField) return
                                updateSelectedNode((data) => ({
                                  ...data,
                                  mathSourceFieldSource: selectedField.source,
                                  mathSourceFieldKey: selectedField.key,
                                  mathValueType: selectedField.valueType,
                                  mathOperationType:
                                    selectedField.valueType === "dateTime"
                                      ? "add"
                                      : data.mathOperationType ?? "add",
                                  mathDateUnit:
                                    selectedField.valueType === "dateTime"
                                      ? data.mathDateUnit ?? "days"
                                      : null,
                                  mathResultFieldSource: selectedField.source,
                                  mathResultFieldKey: null,
                                }))
                              }}
                            >
                              <SelectTrigger className="h-9 bg-white">
                                <SelectValue placeholder="Select source field" />
                              </SelectTrigger>
                              <SelectContent>
                                {allMathFields.map((field) => (
                                  <SelectItem
                                    key={`edit-source-${field.source}:${field.key}`}
                                    value={`${field.source}:${field.key}`}
                                    className="cursor-pointer"
                                  >
                                    {field.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-2">
                            <Label>Operation</Label>
                            <Select
                              value={selectedNode.data.mathOperationType ?? "add"}
                              onValueChange={(value) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  mathOperationType: value as MathOperationType,
                                }))
                              }
                            >
                              <SelectTrigger className="h-9 bg-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {((selectedNode.data.mathValueType ?? "number") === "dateTime"
                                  ? MATH_DATE_OPERATION_OPTIONS
                                  : MATH_OPERATION_OPTIONS
                                ).map((option) => (
                                  <SelectItem
                                    key={`edit-op-${option.value}`}
                                    value={option.value}
                                    className="cursor-pointer"
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-2">
                            <Label>Value</Label>
                            <div className="grid grid-cols-[1fr_140px] gap-2">
                              <Input
                                type="number"
                                value={String(selectedNode.data.mathOperationValue ?? 0)}
                                onChange={(event) =>
                                  updateSelectedNode((data) => ({
                                    ...data,
                                    mathOperationValue: Number.parseFloat(event.target.value) || 0,
                                  }))
                                }
                              />
                              {(selectedNode.data.mathValueType ?? "number") === "dateTime" ? (
                                <Select
                                  value={selectedNode.data.mathDateUnit ?? "days"}
                                  onValueChange={(value) =>
                                    updateSelectedNode((data) => ({
                                      ...data,
                                      mathDateUnit: value as MathDateUnit,
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-9 bg-white">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {MATH_DATE_UNITS.map((unit) => (
                                      <SelectItem
                                        key={`edit-unit-${unit.value}`}
                                        value={unit.value}
                                        className="cursor-pointer"
                                      >
                                        {unit.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Input value="Number" disabled />
                              )}
                            </div>
                          </div>
                          <div className="grid gap-2">
                            <Label>Update field</Label>
                            <Select
                              value={
                                selectedNode.data.mathResultFieldKey
                                  ? `${selectedNode.data.mathResultFieldSource ?? "contact"}:${selectedNode.data.mathResultFieldKey}`
                                  : ""
                              }
                              onValueChange={(value) => {
                                const [source, key] = value.split(":")
                                updateSelectedNode((data) => ({
                                  ...data,
                                  mathResultFieldSource: source as FieldSource,
                                  mathResultFieldKey: key,
                                }))
                              }}
                            >
                              <SelectTrigger className="h-9 bg-white">
                                <SelectValue placeholder="Select update field" />
                              </SelectTrigger>
                              <SelectContent>
                                {allMathFields
                                  .filter(
                                    (field) =>
                                      field.valueType === (selectedNode.data.mathValueType ?? "number"),
                                  )
                                  .map((field) => (
                                    <SelectItem
                                      key={`edit-target-${field.source}:${field.key}`}
                                      value={`${field.source}:${field.key}`}
                                      className="cursor-pointer"
                                    >
                                      {field.label}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      ) : selectedNode.data.kind === "numberFormatter" ? (
                        <>
                          <div className="grid gap-2">
                            <Label>Action name</Label>
                            <Input
                              value={selectedNode.data.label}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Action type</Label>
                            <Select
                              value={selectedNode.data.numberFormatterMode ?? "formatNumber"}
                              onValueChange={(value) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  numberFormatterMode: value as NumberFormatterMode,
                                  numberFormatterMin:
                                    value === "randomNumber" ? data.numberFormatterMin : null,
                                  numberFormatterMax:
                                    value === "randomNumber" ? data.numberFormatterMax : null,
                                  numberFormatterPhoneFormat:
                                    value === "formatPhoneNumber"
                                      ? data.numberFormatterPhoneFormat ?? "e164"
                                      : null,
                                  numberFormatterCountryCode:
                                    value === "formatPhoneNumber"
                                      ? data.numberFormatterCountryCode ?? "+1"
                                      : null,
                                  numberFormatterFieldSource:
                                    value === "formatPhoneNumber"
                                      ? data.numberFormatterFieldSource ?? "contact"
                                      : null,
                                  numberFormatterFieldKey:
                                    value === "formatPhoneNumber"
                                      ? data.numberFormatterFieldKey ?? "phoneNumber"
                                      : null,
                                  numberFormatterInputFieldSource:
                                    value === "textToNumber" ||
                                    value === "formatNumber" ||
                                    value === "formatCurrency"
                                      ? data.numberFormatterInputFieldSource ?? "contact"
                                      : null,
                                  numberFormatterInputFieldKey:
                                    value === "textToNumber" ||
                                    value === "formatNumber" ||
                                    value === "formatCurrency"
                                      ? data.numberFormatterInputFieldKey ?? "phoneNumber"
                                      : null,
                                  numberFormatterInputDecimalMark:
                                    value === "textToNumber" ||
                                    value === "formatNumber" ||
                                    value === "formatCurrency"
                                      ? data.numberFormatterInputDecimalMark ?? "period"
                                      : null,
                                  numberFormatterGroupingStyle:
                                    value === "formatNumber"
                                      ? data.numberFormatterGroupingStyle ?? "commaPeriod"
                                      : null,
                                  numberFormatterCurrencyCode:
                                    value === "formatCurrency"
                                      ? data.numberFormatterCurrencyCode ?? "USD"
                                      : null,
                                }))
                              }
                            >
                              <SelectTrigger className="h-9 bg-white">
                                <SelectValue placeholder="Select action type" />
                              </SelectTrigger>
                              <SelectContent>
                                {NUMBER_FORMATTER_OPTIONS.map((option) => (
                                  <SelectItem
                                    key={`edit-number-formatter-${option.value}`}
                                    value={option.value}
                                    className="cursor-pointer"
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {(selectedNode.data.numberFormatterMode ?? "formatNumber") === "textToNumber" ||
                          (selectedNode.data.numberFormatterMode ?? "formatNumber") === "formatNumber" ||
                          (selectedNode.data.numberFormatterMode ?? "formatNumber") === "formatCurrency" ? (
                            <>
                              <div className="grid gap-2">
                                <Label>Input field</Label>
                                <Select
                                  value={
                                    selectedNode.data.numberFormatterInputFieldKey
                                      ? `${selectedNode.data.numberFormatterInputFieldSource ?? "contact"}:${selectedNode.data.numberFormatterInputFieldKey}`
                                      : ""
                                  }
                                  onValueChange={(value) => {
                                    const [source, key] = value.split(":")
                                    updateSelectedNode((data) => ({
                                      ...data,
                                      numberFormatterInputFieldSource: source as FieldSource,
                                      numberFormatterInputFieldKey: key,
                                    }))
                                  }}
                                >
                                  <SelectTrigger className="h-9 bg-white">
                                    <SelectValue placeholder="Select input field" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {numberFormatterInputFields.map((field) => (
                                      <SelectItem
                                        key={`edit-num-input-${field.source}:${field.key}`}
                                        value={`${field.source}:${field.key}`}
                                        className="cursor-pointer"
                                      >
                                        {field.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="grid gap-2">
                                <Label>Input decimal mark</Label>
                                <Select
                                  value={selectedNode.data.numberFormatterInputDecimalMark ?? "period"}
                                  onValueChange={(value) =>
                                    updateSelectedNode((data) => ({
                                      ...data,
                                      numberFormatterInputDecimalMark: value as NumberDecimalMark,
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-9 bg-white">
                                    <SelectValue placeholder="Select input decimal mark" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {NUMBER_DECIMAL_MARK_OPTIONS.map((option) => (
                                      <SelectItem
                                        key={`edit-num-decimal-${option.value}`}
                                        value={option.value}
                                        className="cursor-pointer"
                                      >
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </>
                          ) : null}
                          {(selectedNode.data.numberFormatterMode ?? "formatNumber") === "formatNumber" ? (
                            <div className="grid gap-2">
                              <Label>Output format</Label>
                              <Select
                                value={selectedNode.data.numberFormatterGroupingStyle ?? "commaPeriod"}
                                onValueChange={(value) =>
                                  updateSelectedNode((data) => ({
                                    ...data,
                                    numberFormatterGroupingStyle: value as NumberGroupingStyle,
                                  }))
                                }
                              >
                                <SelectTrigger className="h-9 bg-white">
                                  <SelectValue placeholder="Select output format" />
                                </SelectTrigger>
                                <SelectContent>
                                  {NUMBER_GROUPING_STYLE_OPTIONS.map((option) => (
                                    <SelectItem
                                      key={`edit-num-grouping-${option.value}`}
                                      value={option.value}
                                      className="cursor-pointer"
                                    >
                                      {option.label} ({option.preview})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}
                          {(selectedNode.data.numberFormatterMode ?? "formatNumber") === "formatCurrency" ? (
                            <div className="grid gap-2">
                              <Label>Currency</Label>
                              <Select
                                value={selectedNode.data.numberFormatterCurrencyCode ?? "USD"}
                                onValueChange={(value) =>
                                  updateSelectedNode((data) => ({
                                    ...data,
                                    numberFormatterCurrencyCode: value,
                                  }))
                                }
                              >
                                <SelectTrigger className="h-9 bg-white">
                                  <SelectValue placeholder="Select currency" />
                                </SelectTrigger>
                                <SelectContent>
                                  {NUMBER_CURRENCY_OPTIONS.map((option) => (
                                    <SelectItem
                                      key={`edit-num-currency-${option.value}`}
                                      value={option.value}
                                      className="cursor-pointer"
                                    >
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}
                          {(selectedNode.data.numberFormatterMode ?? "formatNumber") === "formatPhoneNumber" ? (
                            <>
                              <div className="grid gap-2">
                                <Label>Phone input</Label>
                                <Select
                                  value={
                                    selectedNode.data.numberFormatterFieldKey
                                      ? `${selectedNode.data.numberFormatterFieldSource ?? "contact"}:${selectedNode.data.numberFormatterFieldKey}`
                                      : ""
                                  }
                                  onValueChange={(value) => {
                                    const [source, key] = value.split(":")
                                    updateSelectedNode((data) => ({
                                      ...data,
                                      numberFormatterFieldSource: source as FieldSource,
                                      numberFormatterFieldKey: key,
                                    }))
                                  }}
                                >
                                  <SelectTrigger className="h-9 bg-white">
                                    <SelectValue placeholder="Select phone input field" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {phoneFormatterFields.map((field) => (
                                      <SelectItem
                                        key={`edit-phone-field-${field.source}:${field.key}`}
                                        value={`${field.source}:${field.key}`}
                                        className="cursor-pointer"
                                      >
                                        {field.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="grid gap-2">
                                <Label>Phone format</Label>
                                <Select
                                  value={selectedNode.data.numberFormatterPhoneFormat ?? "e164"}
                                  onValueChange={(value) =>
                                    updateSelectedNode((data) => ({
                                      ...data,
                                      numberFormatterPhoneFormat: value as NumberPhoneFormat,
                                    }))
                                  }
                                >
                                  <SelectTrigger className="h-9 bg-white">
                                    <SelectValue placeholder="Select phone format" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {NUMBER_PHONE_FORMAT_OPTIONS.map((option) => (
                                      <SelectItem
                                        key={`edit-phone-style-${option.value}`}
                                        value={option.value}
                                        className="cursor-pointer"
                                      >
                                        {option.label} ({option.preview})
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="grid gap-2">
                                <Label>Country code</Label>
                                <Input
                                  placeholder="+1"
                                  value={selectedNode.data.numberFormatterCountryCode ?? ""}
                                  onChange={(event) =>
                                    updateSelectedNode((data) => ({
                                      ...data,
                                      numberFormatterCountryCode: event.target.value,
                                    }))
                                  }
                                />
                              </div>
                            </>
                          ) : null}
                          {(selectedNode.data.numberFormatterMode ?? "formatNumber") === "randomNumber" ? (
                            <div className="grid grid-cols-2 gap-2">
                              <div className="grid gap-2">
                                <Label>Minimum</Label>
                                <Input
                                  type="number"
                                  value={String(selectedNode.data.numberFormatterMin ?? "")}
                                  onChange={(event) =>
                                    updateSelectedNode((data) => ({
                                      ...data,
                                      numberFormatterMin:
                                        event.target.value.trim() === ""
                                          ? null
                                          : Number.parseFloat(event.target.value),
                                    }))
                                  }
                                />
                              </div>
                              <div className="grid gap-2">
                                <Label>Maximum</Label>
                                <Input
                                  type="number"
                                  value={String(selectedNode.data.numberFormatterMax ?? "")}
                                  onChange={(event) =>
                                    updateSelectedNode((data) => ({
                                      ...data,
                                      numberFormatterMax:
                                        event.target.value.trim() === ""
                                          ? null
                                          : Number.parseFloat(event.target.value),
                                    }))
                                  }
                                />
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : selectedNode.data.kind === "dateTimeFormatter" ? (
                        <>
                          <div className="grid gap-2">
                            <Label>Action name</Label>
                            <Input
                              value={selectedNode.data.label}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Date field</Label>
                            <Select
                              value={
                                selectedNode.data.dateTimeFormatSourceFieldKey
                                  ? `${selectedNode.data.dateTimeFormatSourceFieldSource ?? "contact"}:${selectedNode.data.dateTimeFormatSourceFieldKey}`
                                  : ""
                              }
                              onValueChange={(value) => {
                                const [source, key] = value.split(":")
                                updateSelectedNode((data) => ({
                                  ...data,
                                  dateTimeFormatSourceFieldSource: source as FieldSource,
                                  dateTimeFormatSourceFieldKey: key,
                                }))
                              }}
                            >
                              <SelectTrigger className="h-9 bg-white">
                                <SelectValue placeholder="Select date field" />
                              </SelectTrigger>
                              <SelectContent>
                                {allDateFields.map((field) => (
                                  <SelectItem
                                    key={`edit-dtf-source-${field.source}:${field.key}`}
                                    value={`${field.source}:${field.key}`}
                                    className="cursor-pointer"
                                  >
                                    {field.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-2">
                            <Label>Format option</Label>
                            <Select
                              value={selectedNode.data.dateTimeFormatMode ?? "dateTime"}
                              onValueChange={(value) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  dateTimeFormatMode: value as DateTimeFormatterMode,
                                  dateTimeFormatPattern:
                                    value === "compareDates"
                                      ? null
                                      : getDateTimeFormatOptions(value as DateTimeFormatterMode)[0]?.value ?? null,
                                  dateTimeFormatCompareFieldKey:
                                    value === "compareDates" ? data.dateTimeFormatCompareFieldKey : null,
                                  dateTimeFormatCompareFieldSource:
                                    value === "compareDates" ? data.dateTimeFormatCompareFieldSource : null,
                                }))
                              }
                            >
                              <SelectTrigger className="h-9 bg-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {DATE_TIME_FORMATTER_OPTIONS.map((option) => (
                                  <SelectItem
                                    key={`edit-dtf-mode-${option.value}`}
                                    value={option.value}
                                    className="cursor-pointer"
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {(selectedNode.data.dateTimeFormatMode ?? "dateTime") !== "compareDates" ? (
                            <div className="grid gap-2">
                              <Label>Display format</Label>
                              <Select
                                value={selectedNode.data.dateTimeFormatPattern ?? ""}
                                onValueChange={(value) =>
                                  updateSelectedNode((data) => ({
                                    ...data,
                                    dateTimeFormatPattern: value,
                                  }))
                                }
                              >
                                <SelectTrigger className="h-9 bg-white">
                                  <SelectValue placeholder="Select date format" />
                                </SelectTrigger>
                                <SelectContent>
                                  {getDateTimeFormatOptions(
                                    selectedNode.data.dateTimeFormatMode ?? "dateTime",
                                  ).map((option) => (
                                    <SelectItem
                                      key={`edit-dtf-pattern-${option.value}`}
                                      value={option.value}
                                      className="cursor-pointer"
                                    >
                                      {option.label} ({option.preview})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-slate-500">
                                This only formats how the date is displayed. It does not modify the source field value.
                              </p>
                            </div>
                          ) : null}
                          {(selectedNode.data.dateTimeFormatMode ?? "dateTime") === "compareDates" ? (
                            <div className="grid gap-2">
                              <Label>Compare with</Label>
                              <Select
                                value={
                                  selectedNode.data.dateTimeFormatCompareFieldKey
                                    ? `${selectedNode.data.dateTimeFormatCompareFieldSource ?? "contact"}:${selectedNode.data.dateTimeFormatCompareFieldKey}`
                                    : ""
                                }
                                onValueChange={(value) => {
                                  const [source, key] = value.split(":")
                                  updateSelectedNode((data) => ({
                                    ...data,
                                    dateTimeFormatCompareFieldSource: source as FieldSource,
                                    dateTimeFormatCompareFieldKey: key,
                                  }))
                                }}
                              >
                                <SelectTrigger className="h-9 bg-white">
                                  <SelectValue placeholder="Select compare date field" />
                                </SelectTrigger>
                                <SelectContent>
                                  {allDateFields
                                    .filter(
                                      (field) =>
                                        !(
                                          field.source ===
                                            (selectedNode.data.dateTimeFormatSourceFieldSource ?? "contact") &&
                                          field.key === selectedNode.data.dateTimeFormatSourceFieldKey
                                        ),
                                    )
                                    .map((field) => (
                                      <SelectItem
                                        key={`edit-dtf-compare-${field.source}:${field.key}`}
                                        value={`${field.source}:${field.key}`}
                                        className="cursor-pointer"
                                      >
                                        {field.label}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}
                        </>
                      ) : selectedNode.data.kind === "goTo" ? (
                        <>
                          <div className="grid gap-2">
                            <Label>Action name</Label>
                            <Input
                              value={selectedNode.data.label}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Go to action</Label>
                            <Select
                              value={selectedNode.data.goToNodeId ?? ""}
                              onValueChange={(value) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  goToNodeId: value,
                                }))
                              }
                            >
                              <SelectTrigger className="h-9 bg-white">
                                <SelectValue placeholder="Select destination action" />
                              </SelectTrigger>
                              <SelectContent>
                                {orderedNodes
                                  .filter(
                                    (node) =>
                                      node.id !== selectedNode.id &&
                                      node.data.kind !== "start",
                                  )
                                  .map((node, index) => (
                                    <SelectItem
                                      key={node.id}
                                      value={node.id}
                                      className="cursor-pointer"
                                    >
                                      {node.data.label?.trim() || `Node ${index + 1}`}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      ) : selectedNode.data.kind === "assign" ? (
                        <>
                          <div className="grid gap-2">
                            <Label>Action name</Label>
                            <Input
                              value={selectedNode.data.label}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Assigned user</Label>
                            <select
                              value={selectedNode.data.assigneeUserId ?? ""}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  assigneeUserId: event.target.value || null,
                                }))
                              }
                              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-slate-400"
                            >
                              <option value="">Select user</option>
                              {tenantUsers.map((user) => (
                                <option key={user.id} value={user.id}>
                                  {user.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid gap-2">
                            <Label>Description</Label>
                            <Textarea
                              rows={4}
                              value={selectedNode.data.notesTemplate}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  notesTemplate: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </>
                      ) : selectedNode.data.kind === "removeUser" ? (
                        <>
                          <div className="grid gap-2">
                            <Label>Action name</Label>
                            <Input
                              value={selectedNode.data.label}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Remove target</Label>
                            <select
                              value={selectedNode.data.removeTarget ?? "specific_user"}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  removeTarget: event.target.value as RemoveTarget,
                                  assigneeUserId:
                                    event.target.value === "specific_user" ? data.assigneeUserId : null,
                                }))
                              }
                              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-slate-400"
                            >
                              <option value="specific_user">Specific user</option>
                              <option value="all_assigned_users">All assigned users</option>
                            </select>
                          </div>
                          {(selectedNode.data.removeTarget ?? "specific_user") === "specific_user" ? (
                            <div className="grid gap-2">
                              <Label>User to remove</Label>
                              <select
                                value={selectedNode.data.assigneeUserId ?? ""}
                                onChange={(event) =>
                                  updateSelectedNode((data) => ({
                                    ...data,
                                    assigneeUserId: event.target.value || null,
                                  }))
                                }
                                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-slate-400"
                              >
                                <option value="">Select user</option>
                                {tenantUsers.map((user) => (
                                  <option key={user.id} value={user.id}>
                                    {user.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}
                          <div className="grid gap-2">
                            <Label>Description</Label>
                            <Textarea
                              rows={4}
                              value={selectedNode.data.notesTemplate}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  notesTemplate: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </>
                      ) : selectedNode.data.kind === "tagAdd" || selectedNode.data.kind === "tagRemove" ? (
                        <>
                          <div className="grid gap-2">
                            <Label>Action name</Label>
                            <Input
                              value={selectedNode.data.label}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Tag name</Label>
                            <Input
                              value={selectedNode.data.tagName ?? ""}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, tagName: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Description</Label>
                            <Textarea
                              rows={3}
                              value={selectedNode.data.notesTemplate}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  notesTemplate: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </>
                      ) : selectedNode.data.kind === "contactFieldUpdate" ? (
                        <>
                          <div className="grid gap-2">
                            <Label>Action name</Label>
                            <Input
                              value={selectedNode.data.label}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Action type</Label>
                            <Select
                              value={selectedNode.data.fieldOperation ?? "update"}
                              onValueChange={(value) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  fieldOperation: value as FieldOperation,
                                  fieldValue: value === "clear" ? "" : data.fieldValue,
                                }))
                              }
                            >
                              <SelectTrigger className="h-9 bg-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="update">Update field data</SelectItem>
                                <SelectItem value="clear">Clear field data</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-2">
                            <button
                              type="button"
                              className="flex w-full cursor-pointer items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-900"
                              onClick={() => setIsContactInfoSectionOpen((prev) => !prev)}
                            >
                              <span>Contact information</span>
                              <span className="text-xs text-slate-500">
                                {isContactInfoSectionOpen ? "Hide" : "Show"}
                              </span>
                            </button>
                            {isContactInfoSectionOpen ? (
                              <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                                {CONTACT_INFO_FIELDS.map((field) => (
                                  <button
                                    key={field.key}
                                    type="button"
                                    className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                                      (selectedNode.data.fieldSource ?? "contact") === "contact" &&
                                      selectedNode.data.fieldKey === field.key
                                        ? "border border-blue-200 bg-blue-50 text-blue-900"
                                        : "text-slate-700 hover:bg-slate-50"
                                    }`}
                                    onClick={() => {
                                      updateSelectedNode((data) => ({
                                        ...data,
                                        fieldSource: "contact",
                                        fieldKey: field.key,
                                      }))
                                      setIsContactInfoSectionOpen(false)
                                    }}
                                  >
                                    <span>{field.label}</span>
                                    <span className="text-[11px] text-slate-400 capitalize">
                                      {formatFieldKeyLabel(field.key)}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <div className="grid gap-2">
                            <button
                              type="button"
                              className="flex w-full cursor-pointer items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-900"
                              onClick={() => setIsCustomFieldsSectionOpen((prev) => !prev)}
                            >
                              <span>Custom fields</span>
                              <span className="text-xs text-slate-500">
                                {isCustomFieldsSectionOpen ? "Hide" : "Show"}
                              </span>
                            </button>
                            {isCustomFieldsSectionOpen ? (
                              <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                                {isCustomFieldsLoading ? (
                                  <p className="text-xs text-slate-500">Loading fields...</p>
                                ) : customFieldOptions.length ? (
                                  customFieldOptions.map((field) => (
                                    <button
                                      key={field.key}
                                      type="button"
                                      className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                                        selectedNode.data.fieldSource === "custom" &&
                                        selectedNode.data.fieldKey === field.key
                                          ? "border border-blue-200 bg-blue-50 text-blue-900"
                                          : "text-slate-700 hover:bg-slate-50"
                                      }`}
                                      onClick={() => {
                                        updateSelectedNode((data) => ({
                                          ...data,
                                          fieldSource: "custom",
                                          fieldKey: field.key,
                                        }))
                                        setIsCustomFieldsSectionOpen(false)
                                      }}
                                    >
                                      <span>{field.label}</span>
                                      <span className="text-[11px] text-slate-400 capitalize">
                                        {formatFieldKeyLabel(field.key)}
                                      </span>
                                    </button>
                                  ))
                                ) : (
                                  <p className="text-xs text-slate-500">No custom fields available.</p>
                                )}
                              </div>
                            ) : null}
                          </div>
                          {selectedNode.data.fieldKey ? (
                            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                              Selected field:{" "}
                              <span className="font-semibold capitalize">
                                {(selectedNode.data.fieldSource ?? "contact") === "custom"
                                  ? "Custom"
                                  : "Contact"}{" "}
                                / {formatFieldKeyLabel(selectedNode.data.fieldKey)}
                              </span>
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500">
                              Select a field from either section to continue.
                            </p>
                          )}
                          {(selectedNode.data.fieldOperation ?? "update") === "update" ? (
                            <div className="grid gap-2">
                              <Label>New value</Label>
                              <Input
                                value={selectedNode.data.fieldValue ?? ""}
                                onChange={(event) =>
                                  updateSelectedNode((data) => ({
                                    ...data,
                                    fieldValue: event.target.value,
                                  }))
                                }
                              />
                            </div>
                          ) : null}
                          {(selectedNode.data.fieldOperation ?? "update") === "clear" ? (
                            <p className="text-xs text-amber-700">
                              This action will clear existing data in the selected field.
                            </p>
                          ) : null}
                        </>
                      ) : selectedNode.data.kind === "statusUpdate" ? (
                        <>
                          <div className="grid gap-2">
                            <Label>Action name</Label>
                            <Input
                              value={selectedNode.data.label}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Status</Label>
                            <Select
                              value={selectedNode.data.statusValue ?? ""}
                              onValueChange={(value) =>
                                updateSelectedNode((data) => ({ ...data, statusValue: value }))
                              }
                            >
                              <SelectTrigger className="h-9 bg-white">
                                <SelectValue placeholder="Select status" />
                              </SelectTrigger>
                              <SelectContent>
                                {tenantContactStatuses.map((status) => (
                                  <SelectItem
                                    key={status.id}
                                    value={status.id}
                                    className="cursor-pointer"
                                  >
                                    <span
                                      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                                      style={{
                                        backgroundColor: status.bgColor,
                                        color: status.textColor,
                                      }}
                                    >
                                      {status.name}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      ) : selectedNode.data.kind === "reminder" ? (
                        <>
                          <div className="grid gap-2">
                            <Label>Action name</Label>
                            <Input
                              value={selectedNode.data.label}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Notify</Label>
                            <select
                              value={selectedNode.data.reminderTarget ?? "assigned_contact_owner"}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  reminderTarget: event.target.value as ReminderTarget,
                                  reminderUserId:
                                    event.target.value === "specific_user" ? data.reminderUserId : null,
                                }))
                              }
                              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-slate-400"
                            >
                              <option value="assigned_contact_owner">Assigned contact owner</option>
                              <option value="all_users">All users</option>
                              <option value="specific_user">Specific user</option>
                            </select>
                          </div>
                          {(selectedNode.data.reminderTarget ?? "assigned_contact_owner") === "specific_user" ? (
                            <div className="grid gap-2">
                              <Label>User</Label>
                              <select
                                value={selectedNode.data.reminderUserId ?? ""}
                                onChange={(event) =>
                                  updateSelectedNode((data) => ({
                                    ...data,
                                    reminderUserId: event.target.value || null,
                                  }))
                                }
                                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-slate-400"
                              >
                                <option value="">Select user</option>
                                {tenantUsers.map((user) => (
                                  <option key={user.id} value={user.id}>
                                    {user.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}
                          <div className="grid gap-2">
                            <Label>Reminder message</Label>
                            <Textarea
                              rows={4}
                              value={selectedNode.data.notesTemplate}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  notesTemplate: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </>
                      ) : selectedNode.data.kind === "addTask" ? (
                        <>
                          <div className="grid gap-2">
                            <Label>Action name</Label>
                            <Input
                              value={selectedNode.data.label}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Task title</Label>
                            <Input
                              value={selectedNode.data.taskTitle ?? ""}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, taskTitle: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Task description</Label>
                            <Textarea
                              rows={4}
                              value={selectedNode.data.notesTemplate}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  notesTemplate: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </>
                      ) : selectedNode.data.kind === "addNote" ? (
                        <>
                          <div className="grid gap-2">
                            <Label>Action name</Label>
                            <Input
                              value={selectedNode.data.label}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Note title</Label>
                            <Input
                              value={selectedNode.data.noteTitle ?? ""}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, noteTitle: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <div className="flex items-center justify-between">
                              <Label>Documents (optional)</Label>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="cursor-pointer"
                                onClick={() => openNoteAttachmentPicker("edit")}
                                disabled={
                                  isUploadingNoteAttachment ||
                                  (selectedNode.data.noteAttachments?.length ?? 0) >=
                                    MAX_NOTE_ATTACHMENTS
                                }
                              >
                                {isUploadingNoteAttachment ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Upload className="h-4 w-4" />
                                )}
                                Add files
                              </Button>
                            </div>
                            {selectedNode.data.noteAttachments?.length ? (
                              <div className="flex flex-wrap gap-2 rounded-md border border-slate-200 p-2">
                                {selectedNode.data.noteAttachments.map((attachment) => (
                                  <span
                                    key={attachment.fileId}
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                                  >
                                    <Paperclip className="h-3 w-3" />
                                    <span className="max-w-[160px] truncate">{attachment.fileName}</span>
                                    <button
                                      type="button"
                                      className="cursor-pointer text-slate-500 hover:text-slate-700"
                                      onClick={() =>
                                        updateSelectedNode((data) => ({
                                          ...data,
                                          noteAttachments: (data.noteAttachments ?? []).filter(
                                            (item) => item.fileId !== attachment.fileId,
                                          ),
                                        }))
                                      }
                                      aria-label={`Remove ${attachment.fileName}`}
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-500">
                                Attach PNG, JPG, WEBP, or PDF files.
                              </p>
                            )}
                          </div>
                          <div className="grid gap-2">
                            <Label>Note body</Label>
                            <Textarea
                              rows={4}
                              value={selectedNode.data.notesTemplate}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  notesTemplate: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="grid gap-2">
                            <Label>Action name</Label>
                            <Input
                              value={selectedNode.data.label}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({ ...data, label: event.target.value }))
                              }
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label>Description</Label>
                            <Textarea
                              rows={4}
                              value={selectedNode.data.notesTemplate}
                              onChange={(event) =>
                                updateSelectedNode((data) => ({
                                  ...data,
                                  notesTemplate: event.target.value,
                                }))
                              }
                            />
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Select an action to edit details.</p>
                  )}
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}
      </section>
      <input
        ref={noteAttachmentInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="hidden"
        onChange={(event) => {
          void handleSelectNoteAttachments(event)
        }}
      />
    </div>
  )
}
