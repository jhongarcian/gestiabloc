import { createHash, randomUUID } from "node:crypto"

import { z } from "zod"

import {
  getAutomationActionNodeLabel,
  getAutomationTriggerLabel,
  getContactDisplayName,
  type AutomationNodeEventSource,
  type AutomationNodeLogData,
} from "./automation-node-executions.js"
import { AutomationNodeKeySchema } from "./automation-node-key.js"
import { normalizeCustomFieldValue } from "./contact-custom-field-values.js"
import {
  parseContactTemplate,
  renderContactNoteTemplates,
  renderContactTemplates,
  CONTACT_TEMPLATE_REGULAR_FIELDS,
  isValidTemplateDate,
  validateContactTemplate,
  createContactTemplateExecutionContext,
  resolveSafeContactTemplateFieldValue,
  type ContactTemplateExecutionContext,
} from "./contact-templates.js"
import {
  AutomationTaskConfigSchema,
  resolveAutomationTaskDateTime,
  sanitizeTaskMultiline,
  sanitizeTaskSingleLine,
  type AutomationTaskConfig,
} from "./automation-task.js"
import {
  AutomationDateTimeFormatterConfigSchema,
  resolveAutomationDateTimeFormatter,
  type AutomationFormatterDateSource,
} from "./automation-date-time-formatter.js"
import {
  AutomationMathOperationConfigSchema,
  mathOperationAcceptsFieldType,
  resolveAutomationMathOperation,
  type AutomationMathOperationConfig,
} from "./automation-math-operation.js"
import {
  AutomationNumberFormatterConfigSchema,
  numberFormatterAcceptsFieldType,
  numberFormatterAcceptsValueKind,
  numberFormatterOutputKind,
  resolveAutomationNumberFormatter,
  type AutomationNumberSource,
  type AutomationValueKind,
} from "./automation-number-formatter.js"
import {
  AutomationTextFormatterConfigSchema,
  resolveAutomationTextFormatter,
  textFormatterAcceptsFieldType,
  textFormatterAcceptsValueKind,
  textFormatterOutputKind,
  type AutomationTextSource,
} from "./automation-text-formatter.js"
import { NoteBodyInputSchema, NoteTitleInputSchema } from "./note-inputs.js"
import { deletePrivateObject } from "./private-storage.js"
import { emitNotificationCreated, type RealtimeNotificationPayload } from "./realtime.js"
import { getTaskPriorityFromDueDate, isCompletedStatusName } from "./task-priority-values.js"
import { evaluateWorkflowOperator } from "./service-followup-runtime.js"

export const AUTOMATION_TRIGGER_TYPES = [
  "OPPORTUNITY_CREATED",
  "OPPORTUNITY_STAGE_CHANGED",
] as const

export const AUTOMATION_OPERATORS = [
  "EQUALS",
  "NOT_EQUALS",
  "CONTAINS",
  "NOT_CONTAINS",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "BETWEEN",
  "INCLUDES_ANY",
  "INCLUDES_ALL",
  "EXCLUDES_ALL",
  "IS_TRUE",
  "IS_FALSE",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
] as const

export const AUTOMATION_ACTION_TYPES = [
  "UPDATE_CONTACT_CUSTOM_FIELDS",
  "SET_CONTACT_CUSTOM_FIELD",
  "CLEAR_CONTACT_CUSTOM_FIELD",
  "SET_CONTACT_STATUS",
  "SET_CONTACT_ASSIGNEE",
  "CLEAR_CONTACT_ASSIGNEE",
  "ADD_CONTACT_TAG",
  "REMOVE_CONTACT_TAG",
  "ADD_CONTACT_NOTE",
  "CREATE_TASK",
  "FORMAT_DATE_TIME",
  "FORMAT_NUMBER",
  "FORMAT_TEXT",
  "MATH_OPERATION",
  "IF_ELSE",
  "SPLIT",
  "WAIT",
  "DELETE_CONTACT",
] as const

export const MAX_AUTOMATION_ACTION_NODES = 100

export const AUTOMATION_WAIT_UNITS = ["SECONDS", "MINUTES", "HOURS", "DAYS"] as const

export const AUTOMATION_CONTACT_UPDATE_FIELDS = [
  { key: "firstName", label: "First name", fieldType: "TEXT", isRequired: true, maxLength: 120, options: [] },
  { key: "middleName", label: "Middle name", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "lastName", label: "Last name", fieldType: "TEXT", isRequired: true, maxLength: 120, options: [] },
  { key: "phone", label: "Phone", fieldType: "PHONE", isRequired: false, maxLength: 60, options: [] },
  { key: "secondaryPhone", label: "Secondary phone", fieldType: "PHONE", isRequired: false, maxLength: 60, options: [] },
  { key: "email", label: "Email", fieldType: "EMAIL", isRequired: false, maxLength: 320, options: [] },
  { key: "dateOfBirth", label: "Date of birth", fieldType: "DATE", isRequired: false, maxLength: 10, options: [] },
  { key: "gender", label: "Gender", fieldType: "SELECT", isRequired: false, maxLength: 20, options: ["FEMALE", "MALE", "NON_BINARY", "OTHER", "UNKNOWN"] },
  { key: "height", label: "Height", fieldType: "TEXT", isRequired: false, maxLength: 60, options: [] },
  { key: "weight", label: "Weight", fieldType: "TEXT", isRequired: false, maxLength: 60, options: [] },
  { key: "deceasedAt", label: "Deceased date", fieldType: "DATE", isRequired: false, maxLength: 10, options: [] },
  { key: "medicarePartA", label: "Medicare Part A", fieldType: "CHECKBOX", isRequired: false, maxLength: 0, options: [] },
  { key: "medicarePartB", label: "Medicare Part B", fieldType: "CHECKBOX", isRequired: false, maxLength: 0, options: [] },
  { key: "smokerStatus", label: "Smoker status", fieldType: "SELECT", isRequired: false, maxLength: 20, options: ["UNKNOWN", "NEVER", "CURRENT", "FORMER"] },
  { key: "addressLine1", label: "Address line 1", fieldType: "TEXT", isRequired: false, maxLength: 255, options: [] },
  { key: "addressLine2", label: "Address line 2", fieldType: "TEXT", isRequired: false, maxLength: 255, options: [] },
  { key: "city", label: "City", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "state", label: "State", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "postalCode", label: "Postal code", fieldType: "TEXT", isRequired: false, maxLength: 40, options: [] },
  { key: "country", label: "Country", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "mailingAddressLine1", label: "Mailing address line 1", fieldType: "TEXT", isRequired: false, maxLength: 255, options: [] },
  { key: "mailingAddressLine2", label: "Mailing address line 2", fieldType: "TEXT", isRequired: false, maxLength: 255, options: [] },
  { key: "mailingCity", label: "Mailing city", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "mailingState", label: "Mailing state", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "mailingPostalCode", label: "Mailing postal code", fieldType: "TEXT", isRequired: false, maxLength: 40, options: [] },
  { key: "mailingCountry", label: "Mailing country", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "emergencyContactName", label: "Emergency contact name", fieldType: "TEXT", isRequired: false, maxLength: 160, options: [] },
  { key: "emergencyContactPhone", label: "Emergency contact phone", fieldType: "PHONE", isRequired: false, maxLength: 60, options: [] },
  { key: "emergencyContactRelationship", label: "Emergency contact relationship", fieldType: "TEXT", isRequired: false, maxLength: 120, options: [] },
  { key: "leadDate", label: "Lead date", fieldType: "DATE", isRequired: false, maxLength: 10, options: [] },
  { key: "leadSource", label: "Lead source", fieldType: "TEXT", isRequired: false, maxLength: 160, options: [] },
  { key: "leadOtherSource", label: "Other lead source", fieldType: "TEXT", isRequired: false, maxLength: 160, options: [] },
] as const

const AUTOMATION_CONTACT_UPDATE_FIELD_KEYS = AUTOMATION_CONTACT_UPDATE_FIELDS.map(
  (field) => field.key,
) as [
  (typeof AUTOMATION_CONTACT_UPDATE_FIELDS)[number]["key"],
  ...(typeof AUTOMATION_CONTACT_UPDATE_FIELDS)[number]["key"][],
]
const AutomationContactUpdateFieldKeySchema = z.enum(AUTOMATION_CONTACT_UPDATE_FIELD_KEYS)
const AUTOMATION_CONTACT_UPDATE_FIELD_MAP = new Map(
  AUTOMATION_CONTACT_UPDATE_FIELDS.map((field) => [field.key, field]),
)

const waitDurationConfigSchema = z.object({
  mode: z.literal("DURATION"),
  amount: z.number().int().positive(),
  unit: z.enum(AUTOMATION_WAIT_UNITS),
})

const waitFixedDateConfigSchema = z.object({
  mode: z.literal("FIXED_DATE"),
  dateTime: z.string().datetime(),
  timing: z.enum(["ON", "BEFORE", "AFTER"]),
  offsetAmount: z.number().int().positive().optional(),
  offsetUnit: z.enum(AUTOMATION_WAIT_UNITS).optional(),
  pastBehavior: z.enum(["CONTINUE", "EXIT", "GO_TO_STEP"]),
  targetNodeKey: AutomationNodeKeySchema.optional(),
})

export const AutomationWaitConfigSchema = z
  .discriminatedUnion("mode", [waitDurationConfigSchema, waitFixedDateConfigSchema])
  .superRefine((config, context) => {
    if (config.mode !== "FIXED_DATE") return
    if (config.timing !== "ON" && (!config.offsetAmount || !config.offsetUnit)) {
      context.addIssue({
        code: "custom",
        message: "Before and after waits require an offset amount and unit.",
        path: ["offsetAmount"],
      })
    }
    if (config.pastBehavior === "GO_TO_STEP" && !config.targetNodeKey) {
      context.addIssue({
        code: "custom",
        message: "Select a later action for the go-to behavior.",
        path: ["targetNodeKey"],
      })
    }
  })

export type AutomationWaitConfig = z.infer<typeof AutomationWaitConfigSchema>

const idSchema = z.string().trim().min(1).max(100)
const actionNodeKeySchema = AutomationNodeKeySchema.optional()
const operatorSchema = z.enum(AUTOMATION_OPERATORS)

const AutomationNoteTitleSchema = NoteTitleInputSchema.superRefine((value, context) => {
  for (const issue of parseContactTemplate(value).issues) {
    context.addIssue({ code: "custom", message: issue.message })
  }
})

const AutomationNoteBodySchema = NoteBodyInputSchema.superRefine((value, context) => {
  for (const issue of parseContactTemplate(value).issues) {
    context.addIssue({ code: "custom", message: issue.message })
  }
})

const opportunityValueConditionSchema = z.object({
  source: z.literal("OPPORTUNITY_VALUE"),
  operator: operatorSchema,
  compareValue: z.unknown().nullable().optional(),
})

const contactStatusConditionSchema = z.object({
  source: z.literal("CONTACT_STATUS"),
  operator: operatorSchema,
  statusConfigId: idSchema.nullable().optional(),
  compareValue: z.unknown().nullable().optional(),
})

const customFieldConditionSchema = z.object({
  source: z.literal("CONTACT_CUSTOM_FIELD"),
  operator: operatorSchema,
  customFieldId: idSchema,
  compareValue: z.unknown().nullable().optional(),
})

const contactAssigneeConditionSchema = z.object({
  source: z.literal("CONTACT_ASSIGNEE"),
  operator: operatorSchema,
  assignedUserId: idSchema.nullable().optional(),
})

const contactTagsConditionSchema = z.object({
  source: z.literal("CONTACT_TAGS"),
  operator: operatorSchema,
  tagId: idSchema.nullable().optional(),
})

const setContactCustomFieldUpdateSchema = z.object({
  customFieldId: idSchema,
  operation: z.literal("SET"),
  value: z.unknown(),
}).strict()

const clearContactCustomFieldUpdateSchema = z.object({
  customFieldId: idSchema,
  operation: z.literal("CLEAR"),
}).strict()

const setContactFieldUpdateSchema = z.object({
  contactFieldKey: AutomationContactUpdateFieldKeySchema,
  operation: z.literal("SET"),
  value: z.unknown(),
}).strict()

const clearContactFieldUpdateSchema = z.object({
  contactFieldKey: AutomationContactUpdateFieldKeySchema,
  operation: z.literal("CLEAR"),
}).strict()

export const AutomationCustomFieldUpdatesSchema = z
  .array(z.union([
    setContactCustomFieldUpdateSchema,
    clearContactCustomFieldUpdateSchema,
    setContactFieldUpdateSchema,
    clearContactFieldUpdateSchema,
  ]))
  .min(1, "Add at least one contact field update.")
  .max(20, "A contact-field action can update at most 20 fields.")
  .superRefine((updates, context) => {
    const seen = new Set<string>()
    updates.forEach((update, index) => {
      const fieldIdentity = "contactFieldKey" in update
        ? `contact:${update.contactFieldKey}`
        : `custom:${update.customFieldId}`
      if (seen.has(fieldIdentity)) {
        context.addIssue({
          code: "custom",
          path: [index, "contactFieldKey" in update ? "contactFieldKey" : "customFieldId"],
          message: "Each contact field can only be updated once per action.",
        })
      }
      seen.add(fieldIdentity)
    })
  })

export const AutomationConditionInputSchema = z.discriminatedUnion("source", [
  opportunityValueConditionSchema,
  contactStatusConditionSchema,
  customFieldConditionSchema,
  contactAssigneeConditionSchema,
  contactTagsConditionSchema,
])

const NonBranchAutomationActionInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("UPDATE_CONTACT_CUSTOM_FIELDS"),
    nodeKey: actionNodeKeySchema,
    customFieldUpdates: AutomationCustomFieldUpdatesSchema,
  }),
  z.object({
    type: z.literal("SET_CONTACT_CUSTOM_FIELD"),
    nodeKey: actionNodeKeySchema,
    customFieldId: idSchema,
    value: z.unknown(),
  }),
  z.object({ type: z.literal("CLEAR_CONTACT_CUSTOM_FIELD"), nodeKey: actionNodeKeySchema, customFieldId: idSchema }),
  z.object({ type: z.literal("SET_CONTACT_STATUS"), nodeKey: actionNodeKeySchema, statusConfigId: idSchema }),
  z.object({ type: z.literal("SET_CONTACT_ASSIGNEE"), nodeKey: actionNodeKeySchema, assignedUserId: idSchema }),
  z.object({ type: z.literal("CLEAR_CONTACT_ASSIGNEE"), nodeKey: actionNodeKeySchema }),
  z.object({ type: z.literal("ADD_CONTACT_TAG"), nodeKey: actionNodeKeySchema, tagId: idSchema }),
  z.object({ type: z.literal("REMOVE_CONTACT_TAG"), nodeKey: actionNodeKeySchema, tagId: idSchema }),
  z.object({
    type: z.literal("ADD_CONTACT_NOTE"),
    nodeKey: actionNodeKeySchema,
    noteTitle: AutomationNoteTitleSchema,
    noteBody: AutomationNoteBodySchema,
  }),
  z.object({
    type: z.literal("CREATE_TASK"),
    nodeKey: actionNodeKeySchema,
    taskConfig: AutomationTaskConfigSchema,
  }),
  z.object({
    type: z.literal("FORMAT_DATE_TIME"),
    nodeKey: actionNodeKeySchema,
    dateTimeFormatterConfig: AutomationDateTimeFormatterConfigSchema,
  }),
  z.object({
    type: z.literal("FORMAT_NUMBER"),
    nodeKey: actionNodeKeySchema,
    numberFormatterConfig: AutomationNumberFormatterConfigSchema,
  }),
  z.object({
    type: z.literal("FORMAT_TEXT"),
    nodeKey: actionNodeKeySchema,
    textFormatterConfig: AutomationTextFormatterConfigSchema,
  }),
  z.object({
    type: z.literal("MATH_OPERATION"),
    nodeKey: actionNodeKeySchema,
    mathOperationConfig: AutomationMathOperationConfigSchema,
  }),
  z.object({ type: z.literal("WAIT"), nodeKey: actionNodeKeySchema, waitConfig: AutomationWaitConfigSchema }),
  z.object({ type: z.literal("DELETE_CONTACT"), nodeKey: actionNodeKeySchema }),
])

const automationBranchConditionBase = {
  conditionKey: z.string().uuid().optional(),
  operator: operatorSchema,
  compareValue: z.unknown().nullable().optional(),
}

export const AutomationBranchConditionSchema = z.discriminatedUnion("source", [
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("CONTACT_FIELD"),
    fieldKey: z.string().trim().min(1).max(100),
  }).strict(),
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("CONTACT_CUSTOM_FIELD"),
    customFieldId: idSchema,
  }).strict(),
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("CONTACT_STATUS"),
    statusConfigId: idSchema.nullable().optional(),
  }).strict(),
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("CONTACT_ASSIGNEE"),
    assignedUserId: idSchema.nullable().optional(),
  }).strict(),
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("CONTACT_TAGS"),
    tagId: idSchema.nullable().optional(),
  }).strict(),
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("AUTOMATION_VALUE"),
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/),
  }).strict(),
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("CURRENT_DATE_TIME"),
  }).strict(),
  z.object({
    ...automationBranchConditionBase,
    source: z.literal("OPPORTUNITY_FIELD"),
    field: z.enum(["VALUE", "PIPELINE", "PREVIOUS_STAGE", "CURRENT_STAGE"]),
  }).strict(),
])

type NonBranchAutomationActionInput = z.infer<typeof NonBranchAutomationActionInputSchema>
export type AutomationBranchConditionInput = z.infer<typeof AutomationBranchConditionSchema>

export type AutomationIfElseBranchInput = {
  branchKey?: string
  name: string
  isDefault: boolean
  matchMode: "ALL" | "ANY"
  conditions: AutomationBranchConditionInput[]
  actions: AutomationActionInput[]
}

export type AutomationIfElseConfigInput = {
  actionName: string
  branches: AutomationIfElseBranchInput[]
}

export type AutomationIfElseActionInput = {
  type: "IF_ELSE"
  nodeKey?: string
  ifElseConfig: AutomationIfElseConfigInput
}

export type AutomationSplitRouteInput = {
  branchKey?: string
  name: string
  percentage: number
  actions: AutomationActionInput[]
}

export type AutomationSplitConfigInput = {
  actionName: string
  routes: AutomationSplitRouteInput[]
}

export type AutomationSplitActionInput = {
  type: "SPLIT"
  nodeKey?: string
  splitConfig: AutomationSplitConfigInput
}

export type AutomationActionInput =
  | NonBranchAutomationActionInput
  | AutomationIfElseActionInput
  | AutomationSplitActionInput

const AutomationIfElseBranchSchema: z.ZodType<AutomationIfElseBranchInput> = z.lazy(() => z.object({
  branchKey: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  isDefault: z.boolean(),
  matchMode: z.enum(["ALL", "ANY"]),
  conditions: z.array(AutomationBranchConditionSchema).max(20),
  actions: z.array(AutomationActionInputSchema).max(MAX_AUTOMATION_ACTION_NODES),
}).strict())

const AutomationSplitRouteSchema: z.ZodType<AutomationSplitRouteInput> = z.lazy(() => z.object({
  branchKey: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  percentage: z.number().int().min(1).max(99),
  actions: z.array(AutomationActionInputSchema).max(MAX_AUTOMATION_ACTION_NODES),
}).strict())

export const AutomationActionInputSchema: z.ZodType<AutomationActionInput> = z.lazy(() => z.union([
  NonBranchAutomationActionInputSchema,
  z.object({
    type: z.literal("IF_ELSE"),
    nodeKey: actionNodeKeySchema,
    ifElseConfig: z.object({
      actionName: z.string().trim().min(1).max(120),
      branches: z.array(AutomationIfElseBranchSchema).min(2).max(20),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("SPLIT"),
    nodeKey: actionNodeKeySchema,
    splitConfig: z.object({
      actionName: z.string().trim().min(1).max(120),
      routes: z.array(AutomationSplitRouteSchema).min(2).max(20),
    }).strict(),
  }).strict(),
]))

export const AutomationUpsertSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    isEnabled: z.boolean().default(false),
    trigger: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("OPPORTUNITY_CREATED"),
        pipelineId: idSchema,
      }),
      z.object({
        type: z.literal("OPPORTUNITY_STAGE_CHANGED"),
        pipelineId: idSchema,
        targetStageId: idSchema,
      }),
    ]),
    conditions: z.array(AutomationConditionInputSchema).max(20).default([]),
    actions: z.array(AutomationActionInputSchema).min(1).max(MAX_AUTOMATION_ACTION_NODES),
  })
  .strict()

export type AutomationInput = z.infer<typeof AutomationUpsertSchema>
export type AutomationOperator = (typeof AUTOMATION_OPERATORS)[number]
export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number]

type CustomFieldType =
  | "TEXT"
  | "NUMBER"
  | "PHONE"
  | "CURRENCY"
  | "DATE"
  | "SELECT"
  | "MULTI_SELECT"
  | "RADIO"
  | "TEXTAREA"
  | "CHECKBOX"

type ValueType = "string" | "number" | "date" | "boolean" | "stringArray"

type CustomFieldRecord = {
  id: string
  key: string
  label: string
  fieldType: CustomFieldType
  isRequired: boolean
  isActive: boolean
  isEncrypted: boolean
  isSensitive: boolean
  options: unknown
}

const EMPTY_OPERATORS = new Set<AutomationOperator>(["IS_EMPTY", "IS_NOT_EMPTY"])
const NUMBER_OPERATORS = new Set<AutomationOperator>([
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "GREATER_THAN_OR_EQUAL",
  "LESS_THAN",
  "LESS_THAN_OR_EQUAL",
  "BETWEEN",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
])
const STRING_OPERATORS = new Set<AutomationOperator>([
  "EQUALS",
  "NOT_EQUALS",
  "CONTAINS",
  "NOT_CONTAINS",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
])
const ARRAY_OPERATORS = new Set<AutomationOperator>([
  "INCLUDES_ANY",
  "INCLUDES_ALL",
  "EXCLUDES_ALL",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
])
const BOOLEAN_OPERATORS = new Set<AutomationOperator>([
  "IS_TRUE",
  "IS_FALSE",
  "IS_EMPTY",
  "IS_NOT_EMPTY",
])

export class AutomationConfigurationError extends Error {
  status = 400
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "AutomationConfigurationError"
    this.code = code
  }
}

export class AutomationExecutionError extends Error {
  status = 409
  code = "AUTOMATION_EXECUTION_FAILED"
  automationId: string | null
  automationName: string
  actionIndex: number
  contactId: string | null
  nodeExecutions: AutomationNodeLogData[]
  actionSnapshot: unknown[]
  attemptId: string | null
  eventSource: AutomationNodeEventSource | null
  contactName: string | null
  branchDecisions: AutomationBranchDecisions | null
  cursorPath: { nextNodeKey: string | null } | null

  constructor(params: {
    automationId: string | null
    automationName: string
    actionIndex: number
    contactId?: string | null
    message: string
  }) {
    super(params.message)
    this.name = "AutomationExecutionError"
    this.automationId = params.automationId
    this.automationName = params.automationName
    this.actionIndex = params.actionIndex
    this.contactId = params.contactId ?? null
    this.nodeExecutions = []
    this.actionSnapshot = []
    this.attemptId = null
    this.eventSource = null
    this.contactName = null
    this.branchDecisions = null
    this.cursorPath = null
  }
}

function valueTypeForCustomField(fieldType: CustomFieldType): ValueType {
  if (fieldType === "NUMBER" || fieldType === "CURRENCY") return "number"
  if (fieldType === "DATE") return "date"
  if (fieldType === "CHECKBOX") return "boolean"
  if (fieldType === "MULTI_SELECT") return "stringArray"
  return "string"
}

export function getAutomationOperatorsForFieldType(fieldType: CustomFieldType) {
  const valueType = valueTypeForCustomField(fieldType)
  if (valueType === "number" || valueType === "date") return [...NUMBER_OPERATORS]
  if (valueType === "boolean") return [...BOOLEAN_OPERATORS]
  if (valueType === "stringArray") return [...ARRAY_OPERATORS]
  return [...STRING_OPERATORS]
}

function isEmptyValue(value: unknown, valueType: ValueType) {
  if (valueType === "stringArray") return !Array.isArray(value) || value.length === 0
  if (valueType === "number") return value === null || value === undefined || !Number.isFinite(Number(value))
  if (valueType === "date") return !value || Number.isNaN(new Date(String(value)).getTime())
  if (valueType === "boolean") return value === null || value === undefined
  return typeof value !== "string" || value.trim().length === 0
}

export function evaluateAutomationOperator(
  operator: AutomationOperator,
  currentValue: unknown,
  compareValue: unknown,
  valueType: ValueType,
) {
  if (operator === "IS_EMPTY") return isEmptyValue(currentValue, valueType)
  if (operator === "IS_NOT_EMPTY") return !isEmptyValue(currentValue, valueType)
  if (operator === "IS_TRUE") return currentValue === true
  if (operator === "IS_FALSE") return currentValue === false

  if (valueType === "stringArray") {
    const current = Array.isArray(currentValue) ? currentValue.map(String) : []
    const expected = Array.isArray(compareValue) ? compareValue.map(String) : []
    if (operator === "INCLUDES_ANY") return expected.some((item) => current.includes(item))
    if (operator === "INCLUDES_ALL") return expected.every((item) => current.includes(item))
    if (operator === "EXCLUDES_ALL") return expected.every((item) => !current.includes(item))
    return false
  }

  if (valueType === "number") {
    const current = Number(currentValue)
    if (!Number.isFinite(current)) return false
    if (operator === "BETWEEN") {
      const range = compareValue as { min?: unknown; max?: unknown } | null
      const min = Number(range?.min)
      const max = Number(range?.max)
      return Number.isFinite(min) && Number.isFinite(max) && current >= min && current <= max
    }
    const expected = Number(compareValue)
    if (!Number.isFinite(expected)) return false
    if (operator === "EQUALS") return current === expected
    if (operator === "NOT_EQUALS") return current !== expected
    if (operator === "GREATER_THAN") return current > expected
    if (operator === "GREATER_THAN_OR_EQUAL") return current >= expected
    if (operator === "LESS_THAN") return current < expected
    if (operator === "LESS_THAN_OR_EQUAL") return current <= expected
    return false
  }

  if (valueType === "date") {
    const current = new Date(String(currentValue)).getTime()
    if (Number.isNaN(current)) return false
    if (operator === "BETWEEN") {
      const range = compareValue as { min?: unknown; max?: unknown } | null
      const min = new Date(String(range?.min ?? "")).getTime()
      const max = new Date(String(range?.max ?? "")).getTime()
      return !Number.isNaN(min) && !Number.isNaN(max) && current >= min && current <= max
    }
    const expected = new Date(String(compareValue)).getTime()
    if (Number.isNaN(expected)) return false
    if (operator === "EQUALS") return current === expected
    if (operator === "NOT_EQUALS") return current !== expected
    if (operator === "GREATER_THAN") return current > expected
    if (operator === "GREATER_THAN_OR_EQUAL") return current >= expected
    if (operator === "LESS_THAN") return current < expected
    if (operator === "LESS_THAN_OR_EQUAL") return current <= expected
    return false
  }

  const current = String(currentValue ?? "")
  const expected = String(compareValue ?? "")
  if (operator === "EQUALS") return current === expected
  if (operator === "NOT_EQUALS") return current !== expected
  if (operator === "CONTAINS") return current.toLocaleLowerCase().includes(expected.toLocaleLowerCase())
  if (operator === "NOT_CONTAINS") return !current.toLocaleLowerCase().includes(expected.toLocaleLowerCase())
  return false
}

function normalizeCompareValue(
  operator: AutomationOperator,
  rawValue: unknown,
  valueType: ValueType,
) {
  if (EMPTY_OPERATORS.has(operator) || valueType === "boolean") return null
  if (valueType === "stringArray") {
    const value = Array.isArray(rawValue)
      ? [...new Set(rawValue.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
      : []
    if (value.length === 0) throw new AutomationConfigurationError("INVALID_CONDITION_VALUE", "Select at least one comparison value.")
    return value
  }
  if (valueType === "number") {
    if (operator === "BETWEEN") {
      const range = rawValue as { min?: unknown; max?: unknown } | null
      const min = Number(range?.min)
      const max = Number(range?.max)
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
        throw new AutomationConfigurationError("INVALID_CONDITION_VALUE", "Enter a valid minimum and maximum.")
      }
      return { min, max }
    }
    const value = Number(rawValue)
    if (!Number.isFinite(value)) throw new AutomationConfigurationError("INVALID_CONDITION_VALUE", "Enter a valid number.")
    return value
  }
  if (valueType === "date") {
    if (operator === "BETWEEN") {
      const range = rawValue as { min?: unknown; max?: unknown } | null
      const min = String(range?.min ?? "")
      const max = String(range?.max ?? "")
      if (Number.isNaN(new Date(min).getTime()) || Number.isNaN(new Date(max).getTime())) {
        throw new AutomationConfigurationError("INVALID_CONDITION_VALUE", "Enter a valid date range.")
      }
      return { min, max }
    }
    const value = String(rawValue ?? "")
    if (Number.isNaN(new Date(value).getTime())) throw new AutomationConfigurationError("INVALID_CONDITION_VALUE", "Enter a valid date.")
    return value
  }
  const value = typeof rawValue === "string" ? rawValue.trim() : ""
  if (!value) throw new AutomationConfigurationError("INVALID_CONDITION_VALUE", "Enter a comparison value.")
  return value
}

function fieldOptions(field: CustomFieldRecord) {
  return Array.isArray(field.options)
    ? field.options.filter((item): item is string => typeof item === "string")
    : []
}

type AutomationContactUpdateField = (typeof AUTOMATION_CONTACT_UPDATE_FIELDS)[number]

function normalizeAutomationContactFieldValue(
  field: AutomationContactUpdateField,
  rawValue: unknown,
) {
  if (field.fieldType === "CHECKBOX") {
    return typeof rawValue === "boolean"
      ? { ok: true as const, value: rawValue }
      : { ok: false as const, message: `${field.label} must be checked or unchecked.` }
  }
  if (field.fieldType === "DATE") {
    const value = typeof rawValue === "string" ? rawValue.trim() : ""
    return isValidTemplateDate(value)
      ? { ok: true as const, value }
      : { ok: false as const, message: `${field.label} must use a valid date.` }
  }
  const value = typeof rawValue === "string" ? rawValue.trim() : ""
  if (!value) return { ok: false as const, message: `${field.label} requires a value.` }
  if (value.length > field.maxLength) {
    return {
      ok: false as const,
      message: `${field.label} cannot exceed ${field.maxLength} characters.`,
    }
  }
  if (field.fieldType === "PHONE" && !/^\+[1-9]\d{7,14}$/.test(value)) {
    return { ok: false as const, message: `${field.label} must be a valid phone number.` }
  }
  if (field.fieldType === "EMAIL" && !z.email().safeParse(value).success) {
    return { ok: false as const, message: `${field.label} must be a valid email address.` }
  }
  if (field.fieldType === "SELECT" && !(field.options as readonly string[]).includes(value)) {
    return { ok: false as const, message: `${field.label} has an invalid option.` }
  }
  return { ok: true as const, value }
}

function contactFieldPersistenceValue(field: AutomationContactUpdateField, value: unknown) {
  return field.fieldType === "DATE"
    ? new Date(`${String(value)}T00:00:00.000Z`)
    : value
}

export async function validateAutomationConfiguration(
  prismaClient: any,
  tenantId: string,
  input: AutomationInput,
) {
  const [pipeline, fields, statuses, taskStatuses, memberships, tags, services] = await Promise.all([
    prismaClient.opportunityPipeline.findUnique({
      where: { tenantId_id: { tenantId, id: input.trigger.pipelineId } },
      select: { id: true, stages: { select: { id: true } } },
    }),
    prismaClient.contactCustomField.findMany({
      where: { tenantId },
      select: {
        id: true,
        key: true,
        label: true,
        fieldType: true,
        isRequired: true,
        isActive: true,
        isEncrypted: true,
        isSensitive: true,
        options: true,
      },
    }),
    prismaClient.contactStatusConfig.findMany({
      where: { tenantId },
      select: { id: true, isActive: true },
    }),
    prismaClient.taskStatusConfig?.findMany
      ? prismaClient.taskStatusConfig.findMany({
          where: { tenantId },
          select: { id: true, name: true, isActive: true },
        })
      : Promise.resolve([]),
    prismaClient.membership.findMany({
      where: { tenantId },
      select: { userId: true, status: true },
    }),
    prismaClient.tenantTag.findMany({ where: { tenantId }, select: { id: true } }),
    prismaClient.service?.findMany
      ? prismaClient.service.findMany({
          where: { tenantId, isActive: true },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ])

  if (!pipeline) throw new AutomationConfigurationError("PIPELINE_NOT_FOUND", "The selected pipeline no longer exists.")
  const stageIds = new Set(pipeline.stages.map((stage: { id: string }) => stage.id))
  if (input.trigger.type === "OPPORTUNITY_STAGE_CHANGED") {
    if (!stageIds.has(input.trigger.targetStageId)) {
      throw new AutomationConfigurationError("PIPELINE_STAGE_NOT_FOUND", "The selected stage does not belong to the selected pipeline.")
    }
  }

  const fieldMap = new Map<string, CustomFieldRecord>(fields.map((field: CustomFieldRecord) => [field.id, field]))
  const fieldKeyMap = new Map<string, CustomFieldRecord>(fields.map((field: CustomFieldRecord) => [field.key, field]))
  const activeStatusIds = new Set(statuses.filter((item: any) => item.isActive).map((item: any) => item.id))
  const activeTaskStatusIds = new Set(taskStatuses.filter((item: any) => item.isActive).map((item: any) => item.id))
  const activeUserIds = new Set(memberships.filter((item: any) => item.status === "ACTIVE").map((item: any) => item.userId))
  const tagIds = new Set(tags.map((item: any) => item.id))
  const serviceMap = new Map<string, string>(services.map((item: any) => [item.id, item.name]))

  const conditions = input.conditions.map((condition, index) => {
    if (condition.source === "OPPORTUNITY_VALUE") {
      if (!NUMBER_OPERATORS.has(condition.operator) || EMPTY_OPERATORS.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_CONDITION_OPERATOR", "The selected operator is not available for opportunity value.")
      }
      return {
        tenantId,
        source: condition.source,
        operator: condition.operator,
        compareValue: normalizeCompareValue(condition.operator, condition.compareValue, "number"),
        sortOrder: (index + 1) * 10,
      }
    }
    if (condition.source === "CONTACT_STATUS") {
      const allowed = new Set<AutomationOperator>(["EQUALS", "NOT_EQUALS", "IS_EMPTY", "IS_NOT_EMPTY"])
      if (!allowed.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_CONDITION_OPERATOR", "The selected operator is not available for contact status.")
      }
      const needsStatus = condition.operator === "EQUALS" || condition.operator === "NOT_EQUALS"
      if (needsStatus && (!condition.statusConfigId || !activeStatusIds.has(condition.statusConfigId))) {
        throw new AutomationConfigurationError("INVALID_STATUS_CONFIG", "Select an active contact status.")
      }
      return {
        tenantId,
        source: condition.source,
        operator: condition.operator,
        statusConfigId: needsStatus ? condition.statusConfigId : null,
        compareValue: null,
        sortOrder: (index + 1) * 10,
      }
    }
    if (condition.source === "CONTACT_ASSIGNEE") {
      const allowed = new Set<AutomationOperator>(["EQUALS", "NOT_EQUALS", "IS_EMPTY", "IS_NOT_EMPTY"])
      if (!allowed.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_CONDITION_OPERATOR", "The selected operator is not available for contact assignee.")
      }
      const needsAssignee = condition.operator === "EQUALS" || condition.operator === "NOT_EQUALS"
      if (needsAssignee && (!condition.assignedUserId || !activeUserIds.has(condition.assignedUserId))) {
        throw new AutomationConfigurationError("INVALID_ASSIGNEE", "Select an active tenant member.")
      }
      return {
        tenantId,
        source: condition.source,
        operator: condition.operator,
        assignedUserId: needsAssignee ? condition.assignedUserId : null,
        compareValue: null,
        sortOrder: (index + 1) * 10,
      }
    }
    if (condition.source === "CONTACT_TAGS") {
      const allowed = new Set<AutomationOperator>(["EQUALS", "NOT_EQUALS", "IS_EMPTY", "IS_NOT_EMPTY"])
      if (!allowed.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_CONDITION_OPERATOR", "The selected operator is not available for contact tags.")
      }
      const needsTag = condition.operator === "EQUALS" || condition.operator === "NOT_EQUALS"
      if (needsTag && (!condition.tagId || !tagIds.has(condition.tagId))) {
        throw new AutomationConfigurationError("INVALID_TAG", "Select a tenant tag.")
      }
      return {
        tenantId,
        source: condition.source,
        operator: condition.operator,
        tagId: needsTag ? condition.tagId : null,
        compareValue: null,
        sortOrder: (index + 1) * 10,
      }
    }

    const field = fieldMap.get(condition.customFieldId)
    if (!field || !field.isActive || field.isEncrypted || field.isSensitive) {
      throw new AutomationConfigurationError("INVALID_CUSTOM_FIELD", "Select an active, non-sensitive custom field.")
    }
    const allowed = new Set(getAutomationOperatorsForFieldType(field.fieldType))
    if (!allowed.has(condition.operator)) {
      throw new AutomationConfigurationError("INVALID_CONDITION_OPERATOR", `The selected operator is not available for ${field.label}.`)
    }
    const compareValue = normalizeCompareValue(
      condition.operator,
      condition.compareValue,
      valueTypeForCustomField(field.fieldType),
    )
    const options = fieldOptions(field)
    const comparisonValues = Array.isArray(compareValue) ? compareValue : [compareValue]
    if (
      options.length > 0 &&
      !EMPTY_OPERATORS.has(condition.operator) &&
      comparisonValues.some((value) => typeof value === "string" && !options.includes(value))
    ) {
      throw new AutomationConfigurationError("INVALID_CONDITION_VALUE", `${field.label} has an invalid option.`)
    }
    return {
      tenantId,
      source: condition.source,
      operator: condition.operator,
      customFieldId: field.id,
      compareValue,
      sortOrder: (index + 1) * 10,
    }
  })

  const actionNodeKeys = new Set<string>()
  let totalActionCount = 0
  let automationOutputs = new Map<string, AutomationValueKind>()
  const validateFormatterSource = (source: AutomationFormatterDateSource, label: string) => {
    if (source.type === "CONTACT_FIELD") {
      const regularField = CONTACT_TEMPLATE_REGULAR_FIELDS.find((field) => field.key === source.key)
      if (!regularField || regularField.fieldType !== "DATE") {
        throw new AutomationConfigurationError("INVALID_FORMATTER_DATE_FIELD", `${label} must use a date field.`)
      }
    } else if (source.type === "CUSTOM_FIELD") {
      const field = fieldKeyMap.get(source.key)
      if (!field || field.fieldType !== "DATE" || !field.isActive || field.isEncrypted || field.isSensitive) {
        throw new AutomationConfigurationError(
          "INVALID_FORMATTER_DATE_FIELD",
          `${label} must use an active, non-sensitive date field.`,
        )
      }
    } else if (source.type === "SPECIFIC_DATE") {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: source.timezone }).format(new Date())
      } catch {
        throw new AutomationConfigurationError("INVALID_FORMATTER_TIMEZONE", `${label} uses an invalid timezone.`)
      }
    } else if (source.type === "AUTOMATION_VALUE") {
      const outputKind = automationOutputs.get(source.key)
      if (!outputKind) {
        throw new AutomationConfigurationError(
          "UNKNOWN_AUTOMATION_VALUE",
          `The automation value “${source.key}” is not available before this action.`,
        )
      }
      if (outputKind !== "DATE") {
        throw new AutomationConfigurationError(
          "INCOMPATIBLE_AUTOMATION_VALUE",
          `The automation value “${source.key}” is not a date.`,
        )
      }
    }
  }
  const validateNumberFormatterSource = (
    source: AutomationNumberSource,
    mode: "TEXT_TO_NUMBER" | "FORMAT_NUMBER" | "FORMAT_CURRENCY" | "FORMAT_PHONE_NUMBER",
  ) => {
    if (source.type === "CONTACT_FIELD") {
      const regularField = CONTACT_TEMPLATE_REGULAR_FIELDS.find((field) => field.key === source.key)
      if (!regularField || !numberFormatterAcceptsFieldType(mode, regularField.fieldType)) {
        throw new AutomationConfigurationError(
          "INVALID_NUMBER_FORMATTER_FIELD",
          "Select a compatible contact field for this number formatter.",
        )
      }
      return
    }
    if (source.type === "CUSTOM_FIELD") {
      const field = fieldKeyMap.get(source.key)
      if (
        !field ||
        !field.isActive ||
        field.isEncrypted ||
        field.isSensitive ||
        !numberFormatterAcceptsFieldType(mode, field.fieldType)
      ) {
        throw new AutomationConfigurationError(
          "INVALID_NUMBER_FORMATTER_FIELD",
          "Select an active, non-sensitive field compatible with this number formatter.",
        )
      }
      return
    }
    const outputKind = automationOutputs.get(source.key)
    if (!outputKind) {
      throw new AutomationConfigurationError(
        "UNKNOWN_AUTOMATION_VALUE",
        `The automation value “${source.key}” is not available before this action.`,
      )
    }
    if (!numberFormatterAcceptsValueKind(mode, outputKind)) {
      throw new AutomationConfigurationError(
        "INCOMPATIBLE_AUTOMATION_VALUE",
        `The automation value “${source.key}” is not compatible with this number formatter.`,
      )
    }
  }
  const validateTextFormatterSource = (source: AutomationTextSource) => {
    if (source.type === "CONTACT_FIELD") {
      const regularField = CONTACT_TEMPLATE_REGULAR_FIELDS.find((field) => field.key === source.key)
      if (!regularField || !textFormatterAcceptsFieldType(regularField.fieldType)) {
        throw new AutomationConfigurationError(
          "INVALID_TEXT_FORMATTER_FIELD",
          "Select a compatible contact field for this text formatter.",
        )
      }
      return
    }
    if (source.type === "CUSTOM_FIELD") {
      const field = fieldKeyMap.get(source.key)
      if (
        !field ||
        !field.isActive ||
        field.isEncrypted ||
        field.isSensitive ||
        !textFormatterAcceptsFieldType(field.fieldType)
      ) {
        throw new AutomationConfigurationError(
          "INVALID_TEXT_FORMATTER_FIELD",
          "Select an active, non-sensitive field compatible with this text formatter.",
        )
      }
      return
    }
    const outputKind = automationOutputs.get(source.key)
    if (!outputKind) {
      throw new AutomationConfigurationError(
        "UNKNOWN_AUTOMATION_VALUE",
        `The automation value “${source.key}” is not available before this action.`,
      )
    }
    if (!textFormatterAcceptsValueKind(outputKind)) {
      throw new AutomationConfigurationError(
        "INCOMPATIBLE_AUTOMATION_VALUE",
        `The automation value “${source.key}” is not compatible with this text formatter.`,
      )
    }
  }
  const validateMathSource = (
    config: AutomationMathOperationConfig,
  ) => {
    const { source } = config
    if (source.type === "CONTACT_FIELD") {
      const field = CONTACT_TEMPLATE_REGULAR_FIELDS.find((candidate) => candidate.key === source.key)
      if (!field || !mathOperationAcceptsFieldType(config.mode, field.fieldType)) {
        throw new AutomationConfigurationError(
          "INVALID_MATH_FIELD",
          `Select a compatible contact ${config.mode === "DATE" ? "date" : "number"} field.`,
        )
      }
      return
    }
    if (source.type === "CUSTOM_FIELD") {
      const field = fieldKeyMap.get(source.key)
      if (
        !field ||
        !field.isActive ||
        field.isEncrypted ||
        field.isSensitive ||
        !mathOperationAcceptsFieldType(config.mode, field.fieldType)
      ) {
        throw new AutomationConfigurationError(
          "INVALID_MATH_FIELD",
          `Select an active, non-sensitive ${config.mode === "DATE" ? "date" : "number"} field.`,
        )
      }
      return
    }
    const outputKind = automationOutputs.get(source.key)
    if (!outputKind) {
      throw new AutomationConfigurationError(
        "UNKNOWN_AUTOMATION_VALUE",
        `The automation value “${source.key}” is not available before this action.`,
      )
    }
    const expectedKind: AutomationValueKind = config.mode === "DATE" ? "DATE" : "NUMBER"
    if (outputKind !== expectedKind) {
      throw new AutomationConfigurationError(
        "INCOMPATIBLE_AUTOMATION_VALUE",
        `The automation value “${source.key}” is not a ${config.mode === "DATE" ? "date" : "number"}.`,
      )
    }
  }

  const normalizeBranchCondition = (
    condition: AutomationBranchConditionInput,
    branchOutputs: Map<string, AutomationValueKind>,
  ) => {
    const conditionKey = condition.conditionKey ?? randomUUID()
    let valueType: ValueType
    let compareValue = condition.compareValue
    let allowedOptions: string[] | null = null

    if (condition.source === "CONTACT_FIELD") {
      const field = CONTACT_TEMPLATE_REGULAR_FIELDS.find((candidate) => candidate.key === condition.fieldKey)
      if (!field) {
        throw new AutomationConfigurationError("INVALID_BRANCH_FIELD", "Select an available contact field.")
      }
      valueType = valueTypeForCustomField(field.fieldType as CustomFieldType)
      if (!new Set(getAutomationOperatorsForFieldType(field.fieldType as CustomFieldType)).has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_BRANCH_OPERATOR", `The selected operator is not available for ${field.label}.`)
      }
    } else if (condition.source === "CONTACT_CUSTOM_FIELD") {
      const field = fieldMap.get(condition.customFieldId)
      if (!field || !field.isActive || field.isEncrypted || field.isSensitive) {
        throw new AutomationConfigurationError("INVALID_BRANCH_FIELD", "Select an active, non-sensitive custom field.")
      }
      valueType = valueTypeForCustomField(field.fieldType)
      if (["SELECT", "RADIO", "MULTI_SELECT"].includes(field.fieldType)) {
        allowedOptions = fieldOptions(field)
      }
      if (!new Set(getAutomationOperatorsForFieldType(field.fieldType)).has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_BRANCH_OPERATOR", `The selected operator is not available for ${field.label}.`)
      }
    } else if (condition.source === "AUTOMATION_VALUE") {
      const kind = branchOutputs.get(condition.key)
      if (!kind) {
        throw new AutomationConfigurationError(
          "UNKNOWN_AUTOMATION_VALUE",
          `The automation value “${condition.key}” is not available before this branch.`,
        )
      }
      valueType = kind === "NUMBER" ? "number" : kind === "DATE" ? "date" : "string"
      const allowed = valueType === "number" || valueType === "date" ? NUMBER_OPERATORS : STRING_OPERATORS
      if (!allowed.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_BRANCH_OPERATOR", "The selected operator is not compatible with this automation value.")
      }
    } else if (condition.source === "CURRENT_DATE_TIME") {
      valueType = "date"
      if (!NUMBER_OPERATORS.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_BRANCH_OPERATOR", "The selected operator is not available for the current date and time.")
      }
    } else if (condition.source === "OPPORTUNITY_FIELD") {
      valueType = condition.field === "VALUE" ? "number" : "string"
      const allowed = valueType === "number" ? NUMBER_OPERATORS : STRING_OPERATORS
      if (!allowed.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_BRANCH_OPERATOR", "The selected operator is not available for this opportunity field.")
      }
    } else if (condition.source === "CONTACT_TAGS") {
      valueType = "stringArray"
      const allowed = new Set<AutomationOperator>(["INCLUDES_ANY", "INCLUDES_ALL", "EXCLUDES_ALL", "IS_EMPTY", "IS_NOT_EMPTY"])
      if (!allowed.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_BRANCH_OPERATOR", "The selected operator is not available for contact tags.")
      }
      if (!EMPTY_OPERATORS.has(condition.operator)) {
        if (!condition.tagId || !tagIds.has(condition.tagId)) {
          throw new AutomationConfigurationError("INVALID_TAG", "Select a tenant tag.")
        }
        compareValue = [condition.tagId]
      }
    } else {
      valueType = "string"
      const allowed = new Set<AutomationOperator>(["EQUALS", "NOT_EQUALS", "IS_EMPTY", "IS_NOT_EMPTY"])
      if (!allowed.has(condition.operator)) {
        throw new AutomationConfigurationError("INVALID_BRANCH_OPERATOR", "The selected operator is not available for this condition.")
      }
      if (!EMPTY_OPERATORS.has(condition.operator)) {
        const referenceId = condition.source === "CONTACT_STATUS"
          ? condition.statusConfigId
          : condition.assignedUserId
        const exists = condition.source === "CONTACT_STATUS"
          ? Boolean(referenceId && activeStatusIds.has(referenceId))
          : Boolean(referenceId && activeUserIds.has(referenceId))
        if (!exists) {
          throw new AutomationConfigurationError(
            condition.source === "CONTACT_STATUS" ? "INVALID_STATUS_CONFIG" : "INVALID_ASSIGNEE",
            condition.source === "CONTACT_STATUS" ? "Select an active contact status." : "Select an active tenant member.",
          )
        }
        compareValue = referenceId
      }
    }

    if (condition.source !== "CONTACT_TAGS" || EMPTY_OPERATORS.has(condition.operator)) {
      compareValue = normalizeCompareValue(condition.operator, compareValue, valueType)
    }
    if (allowedOptions && !EMPTY_OPERATORS.has(condition.operator)) {
      const selectedValues = Array.isArray(compareValue) ? compareValue.map(String) : [String(compareValue)]
      if (selectedValues.some((value) => !allowedOptions!.includes(value))) {
        throw new AutomationConfigurationError("INVALID_BRANCH_VALUE", "Select an available custom-field option.")
      }
    }
    return { ...condition, conditionKey, compareValue }
  }

  const normalizeActionPath = (
    actionInputs: AutomationActionInput[],
    inheritedOutputs: Map<string, AutomationValueKind>,
    depth: number,
  ): any[] => {
    const previousOutputs = automationOutputs
    automationOutputs = new Map(inheritedOutputs)
    const pathNodeKeys = actionInputs.map((action) => action.nodeKey ?? randomUUID())

    for (const nodeKey of pathNodeKeys) {
      if (actionNodeKeys.has(nodeKey)) {
        throw new AutomationConfigurationError("DUPLICATE_ACTION_NODE_KEY", "Every automation action must have a unique node key.")
      }
      actionNodeKeys.add(nodeKey)
      totalActionCount += 1
      if (totalActionCount > MAX_AUTOMATION_ACTION_NODES) {
        throw new AutomationConfigurationError(
          "TOO_MANY_ACTIONS",
          `An automation can contain at most ${MAX_AUTOMATION_ACTION_NODES} action nodes across all branches.`,
        )
      }
    }

    const normalizedActions = actionInputs.map((action, index) => {
    const nodeKey = pathNodeKeys[index]!
    const base = depth === 0
      ? { tenantId, nodeKey, type: action.type, sortOrder: (index + 1) * 10 }
      : { nodeKey, type: action.type }
    if (action.type === "IF_ELSE") {
      if (index !== actionInputs.length - 1) {
        throw new AutomationConfigurationError("IF_ELSE_MUST_BE_LAST", "If/Else can only be the final action in its path.")
      }
      if (depth >= 3) {
        throw new AutomationConfigurationError("IF_ELSE_MAX_DEPTH", "If/Else can be nested up to three levels.")
      }
      const branchNames = new Set<string>()
      const branchKeys = new Set<string>()
      const defaultIndexes = action.ifElseConfig.branches
        .map((branch, branchIndex) => branch.isDefault ? branchIndex : -1)
        .filter((branchIndex) => branchIndex >= 0)
      if (defaultIndexes.length !== 1 || defaultIndexes[0] !== action.ifElseConfig.branches.length - 1) {
        throw new AutomationConfigurationError("INVALID_DEFAULT_BRANCH", "If/Else requires one Default branch in the last position.")
      }
      const branches = action.ifElseConfig.branches.map((branch) => {
        const branchKey = branch.branchKey ?? randomUUID()
        const normalizedName = branch.name.trim().toLocaleLowerCase()
        if (branchKeys.has(branchKey)) {
          throw new AutomationConfigurationError("DUPLICATE_BRANCH_KEY", "Every branch in an If/Else action must have a unique key.")
        }
        if (branchNames.has(normalizedName)) {
          throw new AutomationConfigurationError("DUPLICATE_BRANCH_NAME", "Branch names must be unique within an If/Else action.")
        }
        branchKeys.add(branchKey)
        branchNames.add(normalizedName)
        if (branch.isDefault) {
          if (branch.conditions.length > 0 || branch.actions.length > 0) {
            throw new AutomationConfigurationError("INVALID_DEFAULT_BRANCH", "The Default branch cannot contain conditions or actions.")
          }
          return { ...branch, branchKey, matchMode: "ALL" as const, conditions: [], actions: [] }
        }
        if (branch.conditions.length === 0) {
          throw new AutomationConfigurationError("EMPTY_IF_ELSE_BRANCH", `Add at least one condition to “${branch.name}”.`)
        }
        if (branch.actions.length === 0) {
          throw new AutomationConfigurationError("EMPTY_IF_ELSE_BRANCH", `Add at least one action to “${branch.name}”.`)
        }
        const branchOutputs = new Map(automationOutputs)
        const normalizedConditions = branch.conditions.map((condition) => normalizeBranchCondition(condition, branchOutputs))
        const branchActions = normalizeActionPath(branch.actions, branchOutputs, depth + 1)
        return { ...branch, branchKey, conditions: normalizedConditions, actions: branchActions }
      })
      return {
        ...base,
        ifElseConfig: {
          actionName: action.ifElseConfig.actionName.trim(),
          branches,
        },
      }
    }
    if (action.type === "SPLIT") {
      if (index !== actionInputs.length - 1) {
        throw new AutomationConfigurationError("SPLIT_MUST_BE_LAST", "Split can only be the final action in its path.")
      }
      if (depth >= 3) {
        throw new AutomationConfigurationError(
          "SPLIT_MAX_DEPTH",
          "Split and If/Else can be nested up to three levels.",
        )
      }
      const routeNames = new Set<string>()
      const routeKeys = new Set<string>()
      const routes = action.splitConfig.routes.map((route) => {
        const branchKey = route.branchKey ?? randomUUID()
        const normalizedName = route.name.trim().toLocaleLowerCase()
        if (routeKeys.has(branchKey)) {
          throw new AutomationConfigurationError("DUPLICATE_SPLIT_ROUTE_KEY", "Every Split route must have a unique key.")
        }
        if (routeNames.has(normalizedName)) {
          throw new AutomationConfigurationError("DUPLICATE_SPLIT_ROUTE_NAME", "Split route names must be unique.")
        }
        routeKeys.add(branchKey)
        routeNames.add(normalizedName)
        return {
          ...route,
          branchKey,
          name: route.name.trim(),
          actions: normalizeActionPath(route.actions, new Map(automationOutputs), depth + 1),
        }
      })
      if (routes.reduce((total, route) => total + route.percentage, 0) !== 100) {
        throw new AutomationConfigurationError("INVALID_SPLIT_PERCENTAGE", "Split route percentages must total 100%.")
      }
      return {
        ...base,
        splitConfig: {
          actionName: action.splitConfig.actionName.trim(),
          routes,
        },
      }
    }
    if (action.type === "DELETE_CONTACT") {
      if (index !== actionInputs.length - 1) {
        throw new AutomationConfigurationError(
          "DELETE_CONTACT_MUST_BE_LAST",
          "Delete contact can only be the last action in an automation.",
        )
      }
      return base
    }
    if (action.type === "WAIT") {
      const waitConfig = action.waitConfig.mode === "FIXED_DATE"
        ? (() => {
            const dateTime = new Date(action.waitConfig.dateTime)
            dateTime.setUTCSeconds(0, 0)
            return { ...action.waitConfig, dateTime: dateTime.toISOString() }
          })()
        : action.waitConfig
      if (waitConfig.mode === "FIXED_DATE" && waitConfig.pastBehavior === "GO_TO_STEP") {
        const targetIndex = pathNodeKeys.indexOf(waitConfig.targetNodeKey ?? "")
        if (targetIndex <= index) {
          throw new AutomationConfigurationError(
            "INVALID_WAIT_TARGET",
            "The wait action can only go to an action that appears later in the automation.",
          )
        }
      }
      return { ...base, waitConfig }
    }
    if (action.type === "MATH_OPERATION") {
      const config = action.mathOperationConfig
      if (automationOutputs.has(config.outputKey)) {
        throw new AutomationConfigurationError(
          "DUPLICATE_AUTOMATION_VALUE",
          `The automation value “${config.outputKey}” is already created by an earlier action.`,
        )
      }
      validateMathSource(config)
      automationOutputs.set(config.outputKey, config.mode === "DATE" ? "DATE" : "NUMBER")
      return { ...base, mathOperationConfig: config }
    }
    if (action.type === "FORMAT_DATE_TIME") {
      const config = action.dateTimeFormatterConfig
      if (automationOutputs.has(config.outputKey)) {
        throw new AutomationConfigurationError(
          "DUPLICATE_AUTOMATION_VALUE",
          `The automation value “${config.outputKey}” is already created by an earlier formatter.`,
        )
      }
      if (config.mode === "COMPARE_DATES") {
        validateFormatterSource(config.from, "From date")
        validateFormatterSource(config.to, "To date")
      } else {
        validateFormatterSource(config.source, "Formatter source")
      }
      automationOutputs.set(
        config.outputKey,
        config.mode === "COMPARE_DATES"
          ? "NUMBER"
          : config.format === "X"
            ? "NUMERIC_TEXT"
            : "TEXT",
      )
      return { ...base, dateTimeFormatterConfig: config }
    }
    if (action.type === "FORMAT_NUMBER") {
      const config = action.numberFormatterConfig
      if (automationOutputs.has(config.outputKey)) {
        throw new AutomationConfigurationError(
          "DUPLICATE_AUTOMATION_VALUE",
          `The automation value “${config.outputKey}” is already created by an earlier formatter.`,
        )
      }
      if (config.mode !== "RANDOM_NUMBER") {
        validateNumberFormatterSource(config.source, config.mode)
      }
      automationOutputs.set(config.outputKey, numberFormatterOutputKind(config))
      return { ...base, numberFormatterConfig: config }
    }
    if (action.type === "FORMAT_TEXT") {
      const config = action.textFormatterConfig
      if (automationOutputs.has(config.outputKey)) {
        throw new AutomationConfigurationError(
          "DUPLICATE_AUTOMATION_VALUE",
          `The automation value “${config.outputKey}” is already created by an earlier formatter.`,
        )
      }
      validateTextFormatterSource(config.source)
      automationOutputs.set(config.outputKey, textFormatterOutputKind(config))
      return { ...base, textFormatterConfig: config }
    }
    if (action.type === "ADD_CONTACT_NOTE") {
      const availableOutputs = [...automationOutputs.keys()]
      const titleValidation = validateContactTemplate(action.noteTitle, fields, availableOutputs)
      const bodyValidation = validateContactTemplate(action.noteBody, fields, availableOutputs)
      const issue = titleValidation.issues[0] ?? bodyValidation.issues[0]
      if (issue) {
        throw new AutomationConfigurationError("INVALID_NOTE_TEMPLATE", issue.message)
      }
      return {
        ...base,
        noteTitle: action.noteTitle,
        noteBody: action.noteBody,
      }
    }
    if (action.type === "CREATE_TASK") {
      const config = action.taskConfig
      const templates = [
        config.nameTemplate,
        config.descriptionTemplate ?? "",
        config.reminder?.messageTemplate ?? "",
      ]
      for (const template of templates) {
        const issue = validateContactTemplate(template, fields, [...automationOutputs.keys()]).issues[0]
        if (issue) {
          throw new AutomationConfigurationError("INVALID_TASK_TEMPLATE", issue.message)
        }
      }
      if (!activeTaskStatusIds.has(config.statusConfigId)) {
        throw new AutomationConfigurationError("INVALID_TASK_STATUS", "Select an active task status.")
      }
      if (
        config.assignee.mode === "SPECIFIC_USER" &&
        !activeUserIds.has(config.assignee.userId)
      ) {
        throw new AutomationConfigurationError("INVALID_TASK_ASSIGNEE", "Select an active task assignee.")
      }
      for (const [label, dateTime] of [
        ["Due date", config.dueAt],
        ["Reminder date", config.reminder?.at],
      ] as const) {
        if (!dateTime) continue
        const source = dateTime.source
        if (source.type === "CONTACT_FIELD") {
          const regularField = CONTACT_TEMPLATE_REGULAR_FIELDS.find((field) => field.key === source.key)
          if (!regularField || regularField.fieldType !== "DATE") {
            throw new AutomationConfigurationError("INVALID_TASK_DATE_FIELD", `${label} must use a date field.`)
          }
        } else if (source.type === "CUSTOM_FIELD") {
          const field = fieldKeyMap.get(source.key)
          if (!field || field.fieldType !== "DATE" || !field.isActive || field.isEncrypted || field.isSensitive) {
            throw new AutomationConfigurationError("INVALID_TASK_DATE_FIELD", `${label} must use an active, non-sensitive date field.`)
          }
        } else if (source.type === "SPECIFIC_DATE") {
          try {
            new Intl.DateTimeFormat("en-US", { timeZone: source.timezone }).format(new Date())
          } catch {
            throw new AutomationConfigurationError("INVALID_TASK_TIMEZONE", `${label} uses an invalid timezone.`)
          }
        }
      }
      if (config.linkedService && !serviceMap.has(config.linkedService.id)) {
        throw new AutomationConfigurationError(
          "INVALID_TASK_SERVICE",
          "Select an active linked service.",
        )
      }
      const linkedService = config.linkedService
        ? {
            id: config.linkedService.id,
            nameSnapshot: serviceMap.get(config.linkedService.id)!,
          }
        : null
      return {
        ...base,
        taskConfig: {
          ...config,
          linkedService,
        },
      }
    }
    if (action.type === "UPDATE_CONTACT_CUSTOM_FIELDS") {
      const customFieldUpdates = action.customFieldUpdates.map((update) => {
        if ("contactFieldKey" in update) {
          const field = AUTOMATION_CONTACT_UPDATE_FIELD_MAP.get(update.contactFieldKey)
          if (!field) {
            throw new AutomationConfigurationError(
              "INVALID_CONTACT_FIELD",
              "Select an available contact field.",
            )
          }
          if (update.operation === "CLEAR") {
            if (field.isRequired) {
              throw new AutomationConfigurationError(
                "REQUIRED_CONTACT_FIELD",
                `${field.label} cannot be cleared.`,
              )
            }
            return { contactFieldKey: field.key, operation: update.operation }
          }
          const normalized = normalizeAutomationContactFieldValue(field, update.value)
          if (!normalized.ok) {
            throw new AutomationConfigurationError(
              "INVALID_CONTACT_FIELD_VALUE",
              normalized.message,
            )
          }
          return {
            contactFieldKey: field.key,
            operation: update.operation,
            value: normalized.value,
          }
        }
        const field = fieldMap.get(update.customFieldId)
        if (!field || !field.isActive || field.isEncrypted || field.isSensitive) {
          throw new AutomationConfigurationError(
            "INVALID_CUSTOM_FIELD",
            "Select an active, non-sensitive custom field.",
          )
        }
        if (update.operation === "CLEAR") {
          if (field.isRequired) {
            throw new AutomationConfigurationError(
              "REQUIRED_CUSTOM_FIELD",
              `${field.label} cannot be cleared.`,
            )
          }
          return { customFieldId: field.id, operation: update.operation }
        }
        const normalized = normalizeCustomFieldValue(
          { ...field, options: fieldOptions(field) },
          update.value,
        )
        if (!normalized.ok || normalized.value === null) {
          throw new AutomationConfigurationError(
            "INVALID_CUSTOM_FIELD_VALUE",
            normalized.ok ? `${field.label} requires a value.` : normalized.message,
          )
        }
        return {
          customFieldId: field.id,
          operation: update.operation,
          value: normalized.value,
        }
      })
      return { ...base, customFieldUpdates }
    }
    if (action.type === "SET_CONTACT_CUSTOM_FIELD" || action.type === "CLEAR_CONTACT_CUSTOM_FIELD") {
      const field = fieldMap.get(action.customFieldId)
      if (!field || !field.isActive || field.isEncrypted || field.isSensitive) {
        throw new AutomationConfigurationError("INVALID_CUSTOM_FIELD", "Select an active, non-sensitive custom field.")
      }
      if (action.type === "CLEAR_CONTACT_CUSTOM_FIELD") {
        if (field.isRequired) throw new AutomationConfigurationError("REQUIRED_CUSTOM_FIELD", `${field.label} cannot be cleared.`)
        return { ...base, customFieldId: field.id }
      }
      const normalized = normalizeCustomFieldValue(
        { ...field, options: fieldOptions(field) },
        action.value,
      )
      if (!normalized.ok || normalized.value === null) {
        throw new AutomationConfigurationError("INVALID_CUSTOM_FIELD_VALUE", normalized.ok ? `${field.label} requires a value.` : normalized.message)
      }
      return { ...base, customFieldId: field.id, value: normalized.value }
    }
    if (action.type === "SET_CONTACT_STATUS") {
      if (!activeStatusIds.has(action.statusConfigId)) throw new AutomationConfigurationError("INVALID_STATUS_CONFIG", "Select an active contact status.")
      return { ...base, statusConfigId: action.statusConfigId }
    }
    if (action.type === "SET_CONTACT_ASSIGNEE") {
      if (!activeUserIds.has(action.assignedUserId)) throw new AutomationConfigurationError("INVALID_ASSIGNEE", "Select an active tenant member.")
      return { ...base, assignedUserId: action.assignedUserId }
    }
    if (action.type === "ADD_CONTACT_TAG" || action.type === "REMOVE_CONTACT_TAG") {
      if (!tagIds.has(action.tagId)) throw new AutomationConfigurationError("INVALID_TAG", "Select a tenant tag.")
      return { ...base, tagId: action.tagId }
    }
    return base
    })
    automationOutputs = previousOutputs
    return normalizedActions
  }

  const actions = normalizeActionPath(input.actions, new Map(), 0)

  return {
    name: input.name,
    isEnabled: input.isEnabled,
    triggerType: input.trigger.type,
    pipelineId: input.trigger.pipelineId,
    sourceStageId: null,
    targetStageId:
      input.trigger.type === "OPPORTUNITY_STAGE_CHANGED"
        ? input.trigger.targetStageId
        : null,
    conditions,
    actions,
  }
}

export type OpportunityAutomationEvent = {
  tenantId: string
  actorUserId: string
  triggerType: AutomationTriggerType
  opportunityId: string
  contactId: string
  pipelineId: string
  valueCents: number
  sourceStageId: string | null
  targetStageId: string | null
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "empty"
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join(", ") : "empty"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function operatorExpectation(operator: AutomationOperator, expected: unknown, found: unknown) {
  const expectedLabel = displayValue(expected)
  const foundLabel = displayValue(found)
  if (operator === "EQUALS") return `expected ${expectedLabel}, found ${foundLabel}`
  if (operator === "NOT_EQUALS") return `expected anything except ${expectedLabel}, found ${foundLabel}`
  if (operator === "IS_EMPTY") return `expected empty, found ${foundLabel}`
  if (operator === "IS_NOT_EMPTY") return "expected a value, found empty"
  const descriptions: Partial<Record<AutomationOperator, string>> = {
    CONTAINS: "to contain",
    NOT_CONTAINS: "not to contain",
    GREATER_THAN: "to be greater than",
    GREATER_THAN_OR_EQUAL: "to be at least",
    LESS_THAN: "to be less than",
    LESS_THAN_OR_EQUAL: "to be at most",
    BETWEEN: "to be between",
    INCLUDES_ANY: "to include any of",
    INCLUDES_ALL: "to include all of",
    EXCLUDES_ALL: "to exclude all of",
    IS_TRUE: "to be Yes",
    IS_FALSE: "to be No",
  }
  return `expected ${descriptions[operator] ?? operator.toLocaleLowerCase()} ${expectedLabel}, found ${foundLabel}`
}

export function evaluateAutomationConditions(
  automation: any,
  event: OpportunityAutomationEvent,
  contact: {
    statusConfigId: string | null
    assignedToUserId: string | null
    tags: Array<{ tagId: string }>
    customFieldValues: Array<{ fieldId: string; value: unknown }>
  },
  catalog: AutomationRuntimeCatalog,
) {
  const values = new Map(contact.customFieldValues.map((item) => [item.fieldId, item.value]))
  const contactTagIds = contact.tags.map((item) => item.tagId)
  const failures: string[] = []

  for (const condition of automation.conditions) {
    let matches = false
    let label = "Automation filter"
    let currentValue: unknown = null
    let expectedValue: unknown = condition.compareValue

    if (condition.source === "OPPORTUNITY_VALUE") {
      label = "Opportunity value"
      currentValue = event.valueCents
      matches = evaluateAutomationOperator(condition.operator, currentValue, condition.compareValue, "number")
    } else if (condition.source === "CONTACT_STATUS") {
      label = "Contact status"
      currentValue = contact.statusConfigId
        ? catalog.statusMap.get(contact.statusConfigId) ?? contact.statusConfigId
        : null
      expectedValue = condition.statusConfigId
        ? catalog.statusMap.get(condition.statusConfigId) ?? condition.statusConfigId
        : null
      matches = evaluateAutomationOperator(
        condition.operator,
        contact.statusConfigId,
        condition.statusConfigId,
        "string",
      )
    } else if (condition.source === "CONTACT_ASSIGNEE") {
      label = "Assigned to"
      currentValue = contact.assignedToUserId
        ? catalog.userMap.get(contact.assignedToUserId) ?? contact.assignedToUserId
        : null
      expectedValue = condition.assignedUserId
        ? catalog.userMap.get(condition.assignedUserId) ?? condition.assignedUserId
        : null
      matches = evaluateAutomationOperator(
        condition.operator,
        contact.assignedToUserId,
        condition.assignedUserId,
        "string",
      )
    } else if (condition.source === "CONTACT_TAGS") {
      label = "Contact tag"
      currentValue = contactTagIds.map((tagId) => catalog.tagMap.get(tagId) ?? tagId)
      expectedValue = condition.tagId
        ? catalog.tagMap.get(condition.tagId) ?? condition.tagId
        : null
      if (condition.operator === "IS_EMPTY") matches = contactTagIds.length === 0
      else if (condition.operator === "IS_NOT_EMPTY") matches = contactTagIds.length > 0
      else if (condition.operator === "EQUALS") matches = contactTagIds.includes(condition.tagId)
      else if (condition.operator === "NOT_EQUALS") matches = !contactTagIds.includes(condition.tagId)
    } else {
      const field = condition.customFieldId ? catalog.fieldMap.get(condition.customFieldId) : null
      label = field?.label ?? "Custom field"
      currentValue = field ? values.get(field.id) ?? null : null
      matches = Boolean(field) && evaluateAutomationOperator(
        condition.operator,
        currentValue,
        condition.compareValue,
        valueTypeForCustomField(field!.fieldType),
      )
    }

    if (!matches) {
      failures.push(`${label}: ${operatorExpectation(condition.operator, expectedValue, currentValue)}.`)
    }
  }

  return { matches: failures.length === 0, failures }
}

export type AutomationRuntimeCatalog = {
  fieldMap: Map<string, CustomFieldRecord>
  fieldKeyMap: Map<string, CustomFieldRecord>
  activeStatusIds: Set<string>
  activeTaskStatusIds: Set<string>
  taskStatusMap: Map<string, string>
  activeUserIds: Set<string>
  tagIds: Set<string>
  statusMap: Map<string, string>
  userMap: Map<string, string>
  tagMap: Map<string, string>
  pipelineMap: Map<string, string>
  stageMap: Map<string, string>
  timezone: string
}

export async function getAutomationRuntimeCatalog(
  prismaTx: any,
  tenantId: string,
): Promise<AutomationRuntimeCatalog> {
  const [fields, statuses, taskStatuses, memberships, tags, pipelines, tenant] = await Promise.all([
    prismaTx.contactCustomField.findMany({
      where: { tenantId, isActive: true, isEncrypted: false, isSensitive: false },
      select: {
        id: true,
        key: true,
        label: true,
        fieldType: true,
        isRequired: true,
        isActive: true,
        isEncrypted: true,
        isSensitive: true,
        options: true,
      },
    }),
    prismaTx.contactStatusConfig.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true },
    }),
    prismaTx.taskStatusConfig?.findMany
      ? prismaTx.taskStatusConfig.findMany({
          where: { tenantId, isActive: true },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    prismaTx.membership.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { userId: true, user: { select: { name: true, email: true } } },
    }),
    prismaTx.tenantTag.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    }),
    prismaTx.opportunityPipeline.findMany({
      where: { tenantId },
      select: { id: true, name: true, stages: { select: { id: true, name: true } } },
    }),
    prismaTx.tenant?.findUnique
      ? prismaTx.tenant.findUnique({
          where: { id: tenantId },
          select: { timezone: true },
        })
      : Promise.resolve(null),
  ])

  return {
    fieldMap: new Map<string, CustomFieldRecord>(
      fields.map((field: CustomFieldRecord) => [field.id, field]),
    ),
    fieldKeyMap: new Map<string, CustomFieldRecord>(
      fields.map((field: CustomFieldRecord) => [field.key, field]),
    ),
    activeStatusIds: new Set(statuses.map((item: any) => item.id)),
    activeTaskStatusIds: new Set(taskStatuses.map((item: any) => item.id)),
    taskStatusMap: new Map(taskStatuses.map((item: any) => [item.id, item.name])),
    activeUserIds: new Set(memberships.map((item: any) => item.userId)),
    tagIds: new Set(tags.map((item: any) => item.id)),
    statusMap: new Map(statuses.map((item: any) => [item.id, item.name])),
    userMap: new Map(memberships.map((item: any) => [
      item.userId,
      item.user?.name?.trim() || item.user?.email || item.userId,
    ])),
    tagMap: new Map(tags.map((item: any) => [item.id, item.name])),
    pipelineMap: new Map(pipelines.map((item: any) => [item.id, item.name])),
    stageMap: new Map(pipelines.flatMap((pipeline: any) =>
      pipeline.stages.map((stage: any) => [stage.id, stage.name] as const),
    )),
    timezone: tenant?.timezone?.trim() || "America/Chicago",
  }
}

type WithRequiredNodeKey<T> = T extends { nodeKey?: string }
  ? Omit<T, "nodeKey"> & { nodeKey: string }
  : T

export type RuntimeAutomationIfElseBranch = Omit<AutomationIfElseBranchInput, "branchKey" | "actions"> & {
  branchKey: string
  actions: RuntimeAutomationAction[]
}

export type RuntimeAutomationSplitRoute = Omit<AutomationSplitRouteInput, "branchKey" | "actions"> & {
  branchKey: string
  actions: RuntimeAutomationAction[]
}

export type RuntimeAutomationAction =
  | WithRequiredNodeKey<NonBranchAutomationActionInput>
  | {
      type: "IF_ELSE"
      nodeKey: string
      ifElseConfig: {
        actionName: string
        branches: RuntimeAutomationIfElseBranch[]
      }
    }
  | {
      type: "SPLIT"
      nodeKey: string
      splitConfig: {
        actionName: string
        routes: RuntimeAutomationSplitRoute[]
      }
    }

export type AutomationBranchPathEntry = {
  nodeKey: string
  branchKey: string
  branchName: string
}

export type FlattenedAutomationAction = {
  action: RuntimeAutomationAction
  nodeOrder: number
  branchPath: AutomationBranchPathEntry[]
}

export function flattenAutomationActionTree(actions: RuntimeAutomationAction[]) {
  const flattened: FlattenedAutomationAction[] = []
  const visit = (pathActions: RuntimeAutomationAction[], branchPath: AutomationBranchPathEntry[]) => {
    for (const action of pathActions) {
      flattened.push({ action, nodeOrder: flattened.length + 1, branchPath })
      if (action.type === "IF_ELSE") {
        for (const branch of action.ifElseConfig.branches) {
          if (branch.isDefault) continue
          visit(branch.actions, [
            ...branchPath,
            { nodeKey: action.nodeKey, branchKey: branch.branchKey, branchName: branch.name },
          ])
        }
      } else if (action.type === "SPLIT") {
        for (const route of action.splitConfig.routes) {
          visit(route.actions, [
            ...branchPath,
            { nodeKey: action.nodeKey, branchKey: route.branchKey, branchName: route.name },
          ])
        }
      }
    }
  }
  visit(actions, [])
  return flattened
}

function ensureRuntimeAutomationAction(action: AutomationActionInput): RuntimeAutomationAction {
  const nodeKey = action.nodeKey ?? randomUUID()
  if (action.type !== "IF_ELSE" && action.type !== "SPLIT") {
    return { ...action, nodeKey } as RuntimeAutomationAction
  }
  if (action.type === "SPLIT") {
    return {
      ...action,
      nodeKey,
      splitConfig: {
        ...action.splitConfig,
        routes: action.splitConfig.routes.map((route) => ({
          ...route,
          branchKey: route.branchKey ?? randomUUID(),
          actions: route.actions.map(ensureRuntimeAutomationAction),
        })),
      },
    }
  }
  return {
    ...action,
    nodeKey,
    ifElseConfig: {
      ...action.ifElseConfig,
      branches: action.ifElseConfig.branches.map((branch) => {
        return {
          ...branch,
          branchKey: branch.branchKey ?? randomUUID(),
          actions: branch.actions.map(ensureRuntimeAutomationAction),
        }
      }),
    },
  }
}

const CONTACT_CONTEXT_MUTATING_ACTIONS = new Set<RuntimeAutomationAction["type"]>([
  "UPDATE_CONTACT_CUSTOM_FIELDS",
  "SET_CONTACT_CUSTOM_FIELD",
  "CLEAR_CONTACT_CUSTOM_FIELD",
  "SET_CONTACT_STATUS",
  "SET_CONTACT_ASSIGNEE",
  "CLEAR_CONTACT_ASSIGNEE",
  "ADD_CONTACT_TAG",
  "REMOVE_CONTACT_TAG",
])

export type AutomationFileCleanupCandidate = {
  id: string
  tenantId: string
  key: string
}

export async function deleteAutomationContactFileObjects(
  candidates: AutomationFileCleanupCandidate[],
  deleteObject: (params: { path: string }) => Promise<void> = deletePrivateObject,
) {
  const uniqueCandidates = [...new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  ).values()]
  if (uniqueCandidates.length === 0) return

  await Promise.all(uniqueCandidates.map(async (file) => {
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await deleteObject({ path: file.key })
        return
      } catch (error) {
        lastError = error
      }
    }
    console.error(`Could not delete automation contact file ${file.id}`, lastError)
  }))
}

export function automationActionSnapshot(action: any): RuntimeAutomationAction {
  const nodeKey = action.nodeKey ?? action.id ?? randomUUID()
  const snapshot = action.type === "IF_ELSE"
    ? {
        nodeKey,
        type: action.type,
        ifElseConfig: action.ifElseConfig,
      }
    : action.type === "SPLIT"
      ? {
          nodeKey,
          type: action.type,
          splitConfig: action.splitConfig,
        }
    : {
        nodeKey,
        type: action.type,
        customFieldId: action.customFieldId,
        statusConfigId: action.statusConfigId,
        assignedUserId: action.assignedUserId,
        tagId: action.tagId,
        value: action.value,
        customFieldUpdates: action.customFieldUpdates,
        waitConfig: action.waitConfig,
        noteTitle: action.noteTitle,
        noteBody: action.noteBody,
        taskConfig: action.taskConfig,
        dateTimeFormatterConfig: action.dateTimeFormatterConfig,
        numberFormatterConfig: action.numberFormatterConfig,
        textFormatterConfig: action.textFormatterConfig,
        mathOperationConfig: action.mathOperationConfig,
      }
  const parsed = AutomationActionInputSchema.parse(snapshot)
  return ensureRuntimeAutomationAction(parsed)
}

export function parseActionSnapshot(value: unknown): RuntimeAutomationAction[] {
  const parsed = AutomationActionInputSchema.array().max(MAX_AUTOMATION_ACTION_NODES).parse(value)
  const runtimeActions = parsed.map(ensureRuntimeAutomationAction)
  const flattened = flattenAutomationActionTree(runtimeActions)
  if (flattened.length > MAX_AUTOMATION_ACTION_NODES) {
    throw new Error(`Automation run contains more than ${MAX_AUTOMATION_ACTION_NODES} action nodes.`)
  }
  if (new Set(flattened.map((item) => item.action.nodeKey)).size !== flattened.length) {
    throw new Error("Automation run contains duplicate action node keys.")
  }
  const validatePaths = (pathActions: RuntimeAutomationAction[], depth: number) => {
    for (const [index, action] of pathActions.entries()) {
      if ((action.type === "IF_ELSE" || action.type === "SPLIT") && index !== pathActions.length - 1) {
        throw new Error(`${action.type === "SPLIT" ? "Split" : "If/Else"} must be the final action in its saved path.`)
      }
      if (action.type !== "IF_ELSE" && action.type !== "SPLIT") continue
      if (depth >= 3) throw new Error("Split and If/Else can be nested up to three levels.")
      const paths = action.type === "IF_ELSE" ? action.ifElseConfig.branches : action.splitConfig.routes
      const routeKeys = paths.map((path) => path.branchKey)
      const routeNames = paths.map((path) => path.name.trim().toLocaleLowerCase())
      if (new Set(routeKeys).size !== routeKeys.length || new Set(routeNames).size !== routeNames.length) {
        throw new Error("Saved automation routes must have unique keys and names.")
      }
      if (action.type === "SPLIT") {
        const total = action.splitConfig.routes.reduce((sum, route) => sum + route.percentage, 0)
        if (total !== 100) throw new Error("Saved Split route percentages must total 100%.")
      }
      for (const path of paths) validatePaths(path.actions, depth + 1)
    }
  }
  validatePaths(runtimeActions, 0)
  return runtimeActions
}

async function applyAutomationAction(
  prismaTx: any,
  params: {
    action: RuntimeAutomationAction
    actionIndex: number
    automationId: string | null
    automationName: string
    tenantId: string
    contactId: string
    catalog: AutomationRuntimeCatalog
    occurredAt: Date
    runId?: string | null
    automationValues: Record<string, unknown>
    templateContext?: ContactTemplateExecutionContext
  },
) {
  const {
    action,
    actionIndex,
    automationId,
    automationName,
    tenantId,
    contactId,
    catalog,
    occurredAt,
    runId,
    automationValues,
    templateContext,
  } = params
  try {
    if (action.type === "UPDATE_CONTACT_CUSTOM_FIELDS") {
      const preparedUpdates = action.customFieldUpdates.map((update) => {
        if ("contactFieldKey" in update) {
          const field = AUTOMATION_CONTACT_UPDATE_FIELD_MAP.get(update.contactFieldKey)
          if (!field) {
            throw new Error("A configured contact field is unavailable.")
          }
          if (update.operation === "CLEAR") {
            if (field.isRequired) {
              throw new Error(`${field.label} cannot be cleared.`)
            }
            return { source: "CONTACT" as const, field, operation: update.operation }
          }
          const normalized = normalizeAutomationContactFieldValue(field, update.value)
          if (!normalized.ok) throw new Error(normalized.message)
          return {
            source: "CONTACT" as const,
            field,
            operation: update.operation,
            value: normalized.value,
          }
        }
        const field = catalog.fieldMap.get(update.customFieldId)
        if (!field) {
          throw new Error("A configured custom field is unavailable.")
        }
        if (update.operation === "CLEAR") {
          if (field.isRequired) {
            throw new Error(`${field.label} cannot be cleared.`)
          }
          return { source: "CUSTOM_FIELD" as const, field, operation: update.operation }
        }
        const normalized = normalizeCustomFieldValue(
          { ...field, options: fieldOptions(field) },
          update.value,
        )
        if (!normalized.ok || normalized.value === null) {
          throw new Error(normalized.ok ? `${field.label} requires a value.` : normalized.message)
        }
        return {
          source: "CUSTOM_FIELD" as const,
          field,
          operation: update.operation,
          value: normalized.value,
        }
      })

      const contactData: Record<string, unknown> = {}
      for (const update of preparedUpdates) {
        if (update.source === "CONTACT") {
          contactData[update.field.key] = update.operation === "CLEAR"
            ? null
            : contactFieldPersistenceValue(update.field, update.value)
          continue
        }
        if (update.operation === "CLEAR") {
          await prismaTx.contactCustomFieldValue.deleteMany({
            where: { tenantId, contactId, fieldId: update.field.id },
          })
          continue
        }
        await prismaTx.contactCustomFieldValue.upsert({
          where: { tenantId_contactId_fieldId: { tenantId, contactId, fieldId: update.field.id } },
          create: { tenantId, contactId, fieldId: update.field.id, value: update.value },
          update: {
            value: update.value,
            valueCiphertext: null,
            valueIv: null,
            valueAuthTag: null,
            valueKeyVersion: null,
          },
        })
      }
      if (Object.keys(contactData).length > 0) {
        await prismaTx.contact.update({ where: { id: contactId }, data: contactData })
      }
      const count = action.customFieldUpdates.length
      return `Updated ${count} contact field${count === 1 ? "" : "s"}.`
    } else if (action.type === "SET_CONTACT_CUSTOM_FIELD") {
      const field = catalog.fieldMap.get(action.customFieldId)
      if (!field) throw new Error("The configured custom field is unavailable.")
      const normalized = normalizeCustomFieldValue(
        { ...field, options: fieldOptions(field) },
        action.value,
      )
      if (!normalized.ok || normalized.value === null) {
        throw new Error(normalized.ok ? `${field.label} requires a value.` : normalized.message)
      }
      await prismaTx.contactCustomFieldValue.upsert({
        where: { tenantId_contactId_fieldId: { tenantId, contactId, fieldId: field.id } },
        create: { tenantId, contactId, fieldId: field.id, value: normalized.value },
        update: {
          value: normalized.value,
          valueCiphertext: null,
          valueIv: null,
          valueAuthTag: null,
          valueKeyVersion: null,
        },
      })
    } else if (action.type === "CLEAR_CONTACT_CUSTOM_FIELD") {
      const field = catalog.fieldMap.get(action.customFieldId)
      if (!field || field.isRequired) throw new Error("The configured custom field cannot be cleared.")
      await prismaTx.contactCustomFieldValue.deleteMany({ where: { tenantId, contactId, fieldId: field.id } })
    } else if (action.type === "SET_CONTACT_STATUS") {
      if (!catalog.activeStatusIds.has(action.statusConfigId)) {
        throw new Error("The configured contact status is unavailable.")
      }
      await prismaTx.contact.update({ where: { id: contactId }, data: { statusConfigId: action.statusConfigId } })
    } else if (action.type === "SET_CONTACT_ASSIGNEE") {
      if (!catalog.activeUserIds.has(action.assignedUserId)) {
        throw new Error("The configured assignee is unavailable.")
      }
      await prismaTx.contact.update({ where: { id: contactId }, data: { assignedToUserId: action.assignedUserId } })
    } else if (action.type === "CLEAR_CONTACT_ASSIGNEE") {
      await prismaTx.contact.update({ where: { id: contactId }, data: { assignedToUserId: null } })
    } else if (action.type === "ADD_CONTACT_TAG") {
      if (!catalog.tagIds.has(action.tagId)) throw new Error("The configured tag is unavailable.")
      await prismaTx.contactTag.upsert({
        where: { tenantId_contactId_tagId: { tenantId, contactId, tagId: action.tagId } },
        create: { tenantId, contactId, tagId: action.tagId },
        update: {},
      })
    } else if (action.type === "REMOVE_CONTACT_TAG") {
      if (!catalog.tagIds.has(action.tagId)) throw new Error("The configured tag is unavailable.")
      await prismaTx.contactTag.deleteMany({ where: { tenantId, contactId, tagId: action.tagId } })
    } else if (action.type === "ADD_CONTACT_NOTE") {
      const rendered = await renderContactNoteTemplates(prismaTx, {
        tenantId,
        contactId,
        titleTemplate: action.noteTitle,
        bodyTemplate: action.noteBody,
        timezone: catalog.timezone,
        occurredAt,
        automationValues,
        executionContext: templateContext,
      })
      const title = NoteTitleInputSchema.safeParse(rendered.title)
      if (!title.success) {
        throw new Error("The rendered contact note title must contain 1 to 160 characters.")
      }
      const body = NoteBodyInputSchema.safeParse(rendered.body)
      if (!body.success) {
        throw new Error("The rendered contact note body must contain 1 to 5,000 characters.")
      }
      await prismaTx.contactNote.create({
        data: {
          tenantId,
          contactId,
          automationId,
          automationName,
          title: title.data,
          body: body.data,
          createdById: null,
        },
      })
      return `Added contact note “${title.data}”.`
    } else if (action.type === "CREATE_TASK") {
      const config: AutomationTaskConfig = action.taskConfig
      if (!catalog.activeTaskStatusIds.has(config.statusConfigId)) {
        throw new Error("The configured task status is unavailable.")
      }

      const rendered = await renderContactTemplates(prismaTx, {
        tenantId,
        contactId,
        templates: {
          name: config.nameTemplate,
          description: config.descriptionTemplate ?? "",
          reminderMessage: config.reminder?.messageTemplate ?? "",
        },
        timezone: catalog.timezone,
        occurredAt,
        automationValues,
        executionContext: templateContext,
      })
      const name = sanitizeTaskSingleLine(rendered.name ?? "")
      if (!name || name.length > 160) {
        throw new Error("The rendered task name must contain 1 to 160 characters.")
      }
      const description = sanitizeTaskMultiline(rendered.description ?? "") || null
      if (description && description.length > 4_000) {
        throw new Error("The rendered task description must contain 4,000 characters or fewer.")
      }
      const reminderMessage = sanitizeTaskMultiline(rendered.reminderMessage ?? "") || null
      if (reminderMessage && reminderMessage.length > 500) {
        throw new Error("The rendered reminder message must contain 500 characters or fewer.")
      }

      let assignedToUserId: string | null = null
      if (config.assignee.mode === "SPECIFIC_USER") {
        if (!catalog.activeUserIds.has(config.assignee.userId)) {
          throw new Error("The configured task assignee is unavailable.")
        }
        assignedToUserId = config.assignee.userId
      } else if (config.assignee.mode === "CONTACT_ASSIGNEE") {
        const contact = await prismaTx.contact.findFirst({
          where: { tenantId, id: contactId },
          select: { assignedToUserId: true },
        })
        assignedToUserId = contact?.assignedToUserId && catalog.activeUserIds.has(contact.assignedToUserId)
          ? contact.assignedToUserId
          : null
      }
      if (config.reminder && !assignedToUserId) {
        throw new Error("The task reminder requires an active assignee.")
      }

      const dueDate = config.dueAt
        ? await resolveAutomationTaskDateTime(prismaTx, {
            tenantId,
            contactId,
            config: config.dueAt,
            tenantTimezone: catalog.timezone,
            occurredAt,
            label: "The task due date",
            executionContext: templateContext,
          })
        : null
      if (dueDate && dueDate.getTime() < occurredAt.getTime()) {
        throw new Error("The task due date cannot be before the task start time.")
      }
      const reminderAt = config.reminder
        ? await resolveAutomationTaskDateTime(prismaTx, {
            tenantId,
            contactId,
            config: config.reminder.at,
            tenantTimezone: catalog.timezone,
            occurredAt,
            label: "The task reminder date",
            executionContext: templateContext,
          })
        : null
      if (
        reminderAt &&
        (!dueDate || reminderAt.getTime() < occurredAt.getTime() || reminderAt.getTime() > dueDate.getTime())
      ) {
        throw new Error("The task reminder must be between the task start and due times.")
      }

      const statusName = catalog.taskStatusMap.get(config.statusConfigId) ?? ""
      const task = await prismaTx.task.create({
        data: {
          tenantId,
          contactId,
          automationId,
          automationName,
          statusConfigId: config.statusConfigId,
          assignedToUserId,
          priority: getTaskPriorityFromDueDate(
            dueDate,
            catalog.timezone,
            isCompletedStatusName(statusName),
          ),
          name,
          description,
          dueDate,
          startedAt: occurredAt,
          linkedEntityName: config.linkedService?.nameSnapshot ?? null,
          linkedEntityType: config.linkedService ? "SERVICE" : null,
        },
        select: { id: true },
      })
      await prismaTx.taskActivity.create({
        data: {
          tenantId,
          taskId: task.id,
          actorUserId: null,
          type: "CREATED",
          title: "Task created",
          details: `Created by Automation · ${automationName}.`,
        },
      })

      if (reminderAt && assignedToUserId) {
        const membership = await prismaTx.membership.findUnique({
          where: { userId_tenantId: { userId: assignedToUserId, tenantId } },
          select: { id: true, status: true },
        })
        if (!membership || membership.status !== "ACTIVE") {
          throw new Error("The task reminder recipient is no longer active.")
        }
        await prismaTx.taskReminder.create({
          data: {
            tenantId,
            taskId: task.id,
            recipientUserId: assignedToUserId,
            membershipId: membership.id,
            createdById: null,
            remindAt: reminderAt,
            message: reminderMessage,
          },
        })
      }

      const notificationIds: string[] = []
      if (assignedToUserId) {
        const notification = await prismaTx.notification.create({
          data: {
            tenantId,
            userId: assignedToUserId,
            contactId,
            taskId: task.id,
            eventKey: `task-assigned:${task.id}:${assignedToUserId}`,
            type: "TASK_ASSIGNED",
            title: `Task assigned: ${name}`,
            body: `Automation · ${automationName} assigned this task to you.`,
          },
          select: { id: true },
        })
        notificationIds.push(notification.id)
      }

      const assignee = assignedToUserId
        ? catalog.userMap.get(assignedToUserId) ?? "an active teammate"
        : "Unassigned"
      const dueLabel = dueDate
        ? new Intl.DateTimeFormat("en-US", {
            timeZone: catalog.timezone,
            dateStyle: "medium",
            timeStyle: "short",
          }).format(dueDate)
        : null
      return {
        details: `Created task “${name}” · ${assignee}${dueLabel ? ` · Due ${dueLabel}` : ""}.`,
        notificationIds,
      }
    } else if (action.type === "FORMAT_DATE_TIME") {
      const value = await resolveAutomationDateTimeFormatter(prismaTx, {
        tenantId,
        contactId,
        config: action.dateTimeFormatterConfig,
        tenantTimezone: catalog.timezone,
        occurredAt,
        automationValues,
        executionContext: templateContext,
      })
      automationValues[action.dateTimeFormatterConfig.outputKey] = value
      return `Created automation value “${action.dateTimeFormatterConfig.outputKey}”.`
    } else if (action.type === "FORMAT_NUMBER") {
      const result = await resolveAutomationNumberFormatter(prismaTx, {
        tenantId,
        contactId,
        config: action.numberFormatterConfig,
        automationValues,
        executionContext: templateContext,
      })
      if (result.status === "EMPTY_SOURCE") {
        return "Source field was empty. No automation value was created."
      }
      automationValues[action.numberFormatterConfig.outputKey] = result.value
      return `Created automation value “${action.numberFormatterConfig.outputKey}”.`
    } else if (action.type === "FORMAT_TEXT") {
      const value = await resolveAutomationTextFormatter(prismaTx, {
        tenantId,
        contactId,
        config: action.textFormatterConfig,
        automationValues,
        executionContext: templateContext,
      })
      automationValues[action.textFormatterConfig.outputKey] = value
      return `Created automation value “${action.textFormatterConfig.outputKey}”.`
    } else if (action.type === "MATH_OPERATION") {
      const value = await resolveAutomationMathOperation(prismaTx, {
        tenantId,
        contactId,
        config: action.mathOperationConfig,
        tenantTimezone: catalog.timezone,
        occurredAt,
        automationValues,
        executionContext: templateContext,
      })
      automationValues[action.mathOperationConfig.outputKey] = value
      return `Created automation value “${action.mathOperationConfig.outputKey}”.`
    } else if (action.type === "DELETE_CONTACT") {
      const currentRun = runId && prismaTx.automationRun?.findUnique
        ? await prismaTx.automationRun.findUnique({
            where: { id: runId },
            select: { dispatchId: true, dispatch: { select: { eventId: true } } },
          })
        : null
      const queuedDispatches = prismaTx.automationDispatch?.findMany
        ? await prismaTx.automationDispatch.findMany({
            where: {
              tenantId,
              status: "QUEUED",
              event: { contactId },
              ...(currentRun?.dispatchId ? { id: { not: currentRun.dispatchId } } : {}),
            },
            include: { event: true },
          })
        : []
      if (queuedDispatches.length > 0) {
        const canceledAt = new Date()
        await prismaTx.automationNodeExecution.updateMany({
          where: { id: { in: queuedDispatches.map((dispatch: any) => dispatch.triggerExecutionId) } },
          data: {
            status: "SKIPPED",
            reasonCode: "CONTACT_DELETED",
            details: "Skipped because an automation deleted the contact.",
            occurredAt: canceledAt,
          },
        })
        const canceledActionLogs = queuedDispatches.flatMap((dispatch: any) =>
          parseActionSnapshot(dispatch.actionSnapshot).map((queuedAction, queuedIndex) => ({
            tenantId,
            automationId: dispatch.automationId,
            automationName: dispatch.automationName,
            contactId,
            contactName: dispatch.event.contactName,
            actorUserId: dispatch.event.actorUserId,
            processId: null,
            opportunityId: dispatch.event.opportunityId,
            attemptId: dispatch.attemptId,
            eventSource: dispatch.event.triggerType,
            nodeKind: "ACTION" as const,
            nodeOrder: queuedIndex + 1,
            nodeKey: queuedAction.nodeKey,
            nodeLabel: getAutomationActionNodeLabel(queuedAction),
            status: "SKIPPED" as const,
            reasonCode: "CONTACT_DELETED",
            details: "Skipped because an automation deleted the contact.",
            occurredAt: canceledAt,
          })),
        )
        if (canceledActionLogs.length > 0) {
          await prismaTx.automationNodeExecution.createMany({ data: canceledActionLogs })
        }
        await prismaTx.automationDispatch.updateMany({
          where: { id: { in: queuedDispatches.map((dispatch: any) => dispatch.id) } },
          data: { status: "CANCELED", completedAt: canceledAt },
        })
        const otherEventIds = [...new Set(
          queuedDispatches
            .map((dispatch: any) => dispatch.eventId)
            .filter((eventId: string) => eventId !== currentRun?.dispatch?.eventId),
        )]
        if (otherEventIds.length > 0) {
          for (const eventId of otherEventIds) {
            const skippedCount = queuedDispatches.filter(
              (dispatch: any) => dispatch.eventId === eventId,
            ).length
            await prismaTx.automationEvent.update({
              where: { id: eventId },
              data: {
                status: "CANCELED",
                skippedCount,
                cursor: skippedCount,
                leaseToken: null,
                leaseExpiresAt: null,
                completedAt: canceledAt,
                lastError: "Canceled because an automation deleted the contact.",
              },
            })
          }
        }
      }
      const [contactNoteAttachments, serviceNoteAttachments] = await Promise.all([
        prismaTx.contactNoteAttachment.findMany({
          where: { tenantId, note: { contactId } },
          select: {
            file: { select: { id: true, tenantId: true, key: true } },
          },
        }),
        prismaTx.contactServiceNoteAttachment.findMany({
          where: { tenantId, note: { contactService: { contactId } } },
          select: {
            file: { select: { id: true, tenantId: true, key: true } },
          },
        }),
      ])
      const possibleFileCleanupCandidates = [...new Map(
        [...contactNoteAttachments, ...serviceNoteAttachments]
          .map((attachment: { file: AutomationFileCleanupCandidate }) => [
            attachment.file.id,
            attachment.file,
          ]),
      ).values()]
      await prismaTx.automationRun.updateMany({
        where: {
          tenantId,
          contactId,
          status: { in: ["RUNNING", "WAITING"] },
          ...(runId ? { id: { not: runId } } : {}),
        },
        data: {
          status: "EXITED",
          resumeAt: null,
          waitingNodeKey: null,
          waitingNodeExecutionId: null,
          leaseToken: null,
          leaseExpiresAt: null,
          exitedAt: occurredAt,
        },
      })
      await prismaTx.automationNodeExecution.updateMany({
        where: { tenantId, contactId, status: "WAITING" },
        data: {
          status: "SKIPPED",
          reasonCode: "CONTACT_DELETED",
          details: "The contact was deleted by an automation and removed from all workflows.",
          occurredAt,
        },
      })
      await prismaTx.automationProcessContact.updateMany({
        where: { tenantId, contactId, status: "PENDING" },
        data: {
          status: "FAILED",
          errorCode: "CONTACT_DELETED",
          errorMessage: "The contact was deleted by an automation.",
          completedAt: occurredAt,
        },
      })
      await prismaTx.notification.updateMany({
        where: { tenantId, contactId },
        data: { contactId: null },
      })
      const deleted = await prismaTx.contact.deleteMany({ where: { tenantId, id: contactId } })
      if (deleted.count !== 1) throw new Error("The contact is no longer available.")
      const fileCleanupCandidates: AutomationFileCleanupCandidate[] =
        possibleFileCleanupCandidates.length > 0
          ? await prismaTx.file.findMany({
              where: {
                id: { in: possibleFileCleanupCandidates.map((file) => file.id) },
                noteAttachments: { none: {} },
                serviceNoteAttachments: { none: {} },
              },
              select: { id: true, tenantId: true, key: true },
            })
          : []
      if (fileCleanupCandidates.length > 0) {
        await prismaTx.file.deleteMany({
          where: { id: { in: fileCleanupCandidates.map((file) => file.id) } },
        })
      }
      return {
        details: "Deleted the contact and removed it from all workflows in this account.",
        contactDeleted: true,
        fileCleanupCandidates,
      }
    }
  } catch (error) {
    throw new AutomationExecutionError({
      automationId,
      automationName,
      actionIndex,
      contactId,
      message: error instanceof Error ? error.message : "The automation action could not be completed.",
    })
  }
}

export async function applyAutomationActions(
  prismaTx: any,
  params: { automation: any; tenantId: string; contactId: string; catalog: AutomationRuntimeCatalog },
) {
  const actions = params.automation.actions.map(automationActionSnapshot)
  const occurredAt = new Date()
  const automationValues: Record<string, unknown> = {}
  const templateContext = createContactTemplateExecutionContext()
  for (let index = 0; index < actions.length; index += 1) {
    if (actions[index]!.type === "WAIT") continue
    if (actions[index]!.type === "DELETE_CONTACT" && index !== actions.length - 1) {
      throw new AutomationExecutionError({
        automationId: params.automation.id,
        automationName: params.automation.name,
        actionIndex: index,
        contactId: params.contactId,
        message: "Delete contact can only be the last action in an automation.",
      })
    }
    await applyAutomationAction(prismaTx, {
      action: actions[index]!,
      actionIndex: index,
      automationId: params.automation.id,
      automationName: params.automation.name,
      tenantId: params.tenantId,
      contactId: params.contactId,
      catalog: params.catalog,
      occurredAt,
      runId: null,
      automationValues,
      templateContext,
    })
    if (CONTACT_CONTEXT_MUTATING_ACTIONS.has(actions[index]!.type)) templateContext.invalidate()
  }
}

const WAIT_UNIT_MS: Record<(typeof AUTOMATION_WAIT_UNITS)[number], number> = {
  SECONDS: 1_000,
  MINUTES: 60_000,
  HOURS: 3_600_000,
  DAYS: 86_400_000,
}

function calculateWaitAt(config: AutomationWaitConfig, now: Date) {
  if (config.mode === "DURATION") {
    return new Date(now.getTime() + config.amount * WAIT_UNIT_MS[config.unit])
  }
  const anchor = new Date(config.dateTime).getTime()
  const offset = config.timing === "ON"
    ? 0
    : (config.offsetAmount ?? 0) * WAIT_UNIT_MS[config.offsetUnit ?? "MINUTES"]
  return new Date(anchor + (config.timing === "BEFORE" ? -offset : offset))
}

function formatWaitInstant(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(value)
}

function actionLog(
  base: Omit<AutomationNodeLogData, "id" | "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">,
  action: RuntimeAutomationAction,
  index: number,
  status: AutomationNodeLogData["status"],
  reasonCode: string | null,
  details: string,
  id?: string,
  metadata?: { nodeOrder: number; branchPath: AutomationBranchPathEntry[] },
): AutomationNodeLogData {
  return {
    ...(id ? { id } : {}),
    ...base,
    nodeKind: "ACTION",
    nodeOrder: metadata?.nodeOrder ?? index + 1,
    nodeKey: action.nodeKey,
    nodeLabel: getAutomationActionNodeLabel(action),
    status,
    reasonCode,
    details,
    branchPath: metadata?.branchPath ?? null,
  }
}

type AutomationBranchDecision = {
  branchKey: string
  branchName: string
  decidedAt: string
}

type AutomationBranchDecisions = Record<string, AutomationBranchDecision>

function normalizeBranchDecisions(value: unknown): AutomationBranchDecisions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const decisions: AutomationBranchDecisions = {}
  for (const [nodeKey, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const record = raw as Record<string, unknown>
    if (typeof record.branchKey !== "string" || typeof record.branchName !== "string") continue
    decisions[nodeKey] = {
      branchKey: record.branchKey,
      branchName: record.branchName,
      decidedAt: typeof record.decidedAt === "string" ? record.decidedAt : new Date(0).toISOString(),
    }
  }
  return decisions
}

export function selectedAutomationActionSteps(
  actions: RuntimeAutomationAction[],
  decisions: AutomationBranchDecisions,
) {
  const flatByKey = new Map(flattenAutomationActionTree(actions).map((item) => [item.action.nodeKey, item]))
  const selected: FlattenedAutomationAction[] = []
  const visit = (pathActions: RuntimeAutomationAction[]) => {
    for (const action of pathActions) {
      const step = flatByKey.get(action.nodeKey)
      if (!step) continue
      selected.push(step)
      if (action.type !== "IF_ELSE" && action.type !== "SPLIT") continue
      const decision = decisions[action.nodeKey]
      if (!decision) return
      if (action.type === "IF_ELSE") {
        const branch = action.ifElseConfig.branches.find((candidate) => candidate.branchKey === decision.branchKey)
        if (!branch || branch.isDefault) return
        visit(branch.actions)
      } else {
        const route = action.splitConfig.routes.find((candidate) => candidate.branchKey === decision.branchKey)
        if (!route) return
        visit(route.actions)
      }
      return
    }
  }
  visit(actions)
  return selected
}

export function automationSplitBucket(runId: string, nodeKey: string) {
  const digest = createHash("sha256").update(`${runId}:${nodeKey}`).digest()
  return digest.readUInt32BE(0) % 100 + 1
}

export function selectAutomationSplitRoute(
  action: Extract<RuntimeAutomationAction, { type: "SPLIT" }>,
  runId: string,
) {
  const total = action.splitConfig.routes.reduce((sum, route) => sum + route.percentage, 0)
  if (total !== 100 || action.splitConfig.routes.length < 2) {
    throw new Error("The saved Split routes are invalid and must total 100%.")
  }
  const bucket = automationSplitBucket(runId, action.nodeKey)
  let boundary = 0
  for (const route of action.splitConfig.routes) {
    if (!Number.isInteger(route.percentage) || route.percentage < 1 || route.percentage > 99) {
      throw new Error("The saved Split route percentages are invalid.")
    }
    boundary += route.percentage
    if (bucket <= boundary) return route
  }
  throw new Error("The saved Split routes could not select a destination.")
}

type AutomationOpportunityEventContext = {
  pipelineId?: string | null
  valueCents?: number | null
  sourceStageId?: string | null
  targetStageId?: string | null
  occurredAt?: string | null
}

function normalizeOpportunityEventContext(value: unknown): AutomationOpportunityEventContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  return {
    pipelineId: typeof record.pipelineId === "string" ? record.pipelineId : null,
    valueCents: typeof record.valueCents === "number" && Number.isFinite(record.valueCents) ? record.valueCents : null,
    sourceStageId: typeof record.sourceStageId === "string" ? record.sourceStageId : null,
    targetStageId: typeof record.targetStageId === "string" ? record.targetStageId : null,
    occurredAt: typeof record.occurredAt === "string" ? record.occurredAt : null,
  }
}

async function evaluateIfElseCondition(
  prismaTx: any,
  params: {
    condition: AutomationBranchConditionInput
    run: SegmentRun
    catalog: AutomationRuntimeCatalog
    automationValues: Record<string, unknown>
    occurredAt: Date
    eventContext: AutomationOpportunityEventContext
    templateContext: ContactTemplateExecutionContext
    directContactContext: () => Promise<{
      statusConfigId: string | null
      assignedToUserId: string | null
      tagIds: string[]
    }>
  },
) {
  const { condition } = params
  let currentValue: unknown = null
  let valueType: ValueType = "string"

  if (condition.source === "CONTACT_FIELD") {
    const resolved = await resolveSafeContactTemplateFieldValue(prismaTx, {
      tenantId: params.run.tenantId,
      contactId: params.run.contactId!,
      source: "CONTACT_FIELD",
      key: condition.fieldKey,
      executionContext: params.templateContext,
    })
    currentValue = resolved?.value ?? null
    valueType = resolved ? valueTypeForCustomField(resolved.fieldType as CustomFieldType) : "string"
  } else if (condition.source === "CONTACT_CUSTOM_FIELD") {
    const field = params.catalog.fieldMap.get(condition.customFieldId)
    if (!field) throw new Error("The configured branch custom field is unavailable.")
    const resolved = await resolveSafeContactTemplateFieldValue(prismaTx, {
      tenantId: params.run.tenantId,
      contactId: params.run.contactId!,
      source: "CUSTOM_FIELD",
      key: field.key,
      executionContext: params.templateContext,
    })
    currentValue = resolved?.value ?? null
    valueType = valueTypeForCustomField(field.fieldType)
  } else if (condition.source === "CONTACT_STATUS") {
    currentValue = (await params.directContactContext()).statusConfigId
  } else if (condition.source === "CONTACT_ASSIGNEE") {
    currentValue = (await params.directContactContext()).assignedToUserId
  } else if (condition.source === "CONTACT_TAGS") {
    currentValue = (await params.directContactContext()).tagIds
    valueType = "stringArray"
  } else if (condition.source === "AUTOMATION_VALUE") {
    currentValue = params.automationValues[condition.key]
    if (typeof currentValue === "number") valueType = "number"
    else if (typeof currentValue === "boolean") valueType = "boolean"
    else if (Array.isArray(currentValue)) valueType = "stringArray"
    else if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(String(currentValue ?? ""))) valueType = "date"
  } else if (condition.source === "CURRENT_DATE_TIME") {
    currentValue = params.occurredAt.toISOString()
    valueType = "date"
  } else if (condition.field === "VALUE") {
    currentValue = params.eventContext.valueCents === null || params.eventContext.valueCents === undefined
      ? null
      : params.eventContext.valueCents / 100
    valueType = "number"
  } else if (condition.field === "PIPELINE") {
    currentValue = params.eventContext.pipelineId ?? null
  } else if (condition.field === "PREVIOUS_STAGE") {
    currentValue = params.eventContext.sourceStageId ?? null
  } else {
    currentValue = params.eventContext.targetStageId ?? null
  }

  if (!EMPTY_OPERATORS.has(condition.operator) && isEmptyValue(currentValue, valueType)) return false
  if (valueType === "stringArray" || condition.operator === "BETWEEN") {
    return evaluateAutomationOperator(condition.operator, currentValue, condition.compareValue, valueType)
  }
  const workflowOperators: Partial<Record<AutomationOperator, "eq" | "neq" | "includes" | "not_includes" | "gt" | "gte" | "lt" | "lte" | "is_empty" | "is_not_empty">> = {
    EQUALS: "eq",
    NOT_EQUALS: "neq",
    CONTAINS: "includes",
    NOT_CONTAINS: "not_includes",
    GREATER_THAN: "gt",
    GREATER_THAN_OR_EQUAL: "gte",
    LESS_THAN: "lt",
    LESS_THAN_OR_EQUAL: "lte",
    IS_EMPTY: "is_empty",
    IS_NOT_EMPTY: "is_not_empty",
    IS_TRUE: "eq",
    IS_FALSE: "eq",
  }
  const operator = workflowOperators[condition.operator]
  if (!operator) return false
  return evaluateWorkflowOperator({
    id: condition.conditionKey ?? "automation-condition",
    source: "variable",
    variableKey: "automation-condition",
    valueType: valueType === "date" ? "dateTime" : valueType,
    operator,
    compareValue: condition.operator === "IS_TRUE"
      ? true
      : condition.operator === "IS_FALSE"
        ? false
        : condition.compareValue,
  }, currentValue)
}

async function selectIfElseBranch(
  prismaTx: any,
  params: Omit<Parameters<typeof evaluateIfElseCondition>[1], "condition"> & {
    action: Extract<RuntimeAutomationAction, { type: "IF_ELSE" }>
  },
) {
  const defaultBranch = params.action.ifElseConfig.branches.find((branch) => branch.isDefault)
  for (const branch of params.action.ifElseConfig.branches) {
    if (branch.isDefault) continue
    const results = await Promise.all(branch.conditions.map((condition) =>
      evaluateIfElseCondition(prismaTx, { ...params, condition }),
    ))
    const matches = branch.matchMode === "ALL" ? results.every(Boolean) : results.some(Boolean)
    if (matches) return branch
  }
  if (!defaultBranch) throw new Error("The If/Else action does not contain a Default branch.")
  return defaultBranch
}

function failureLogsForSegment(
  base: Omit<AutomationNodeLogData, "id" | "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">,
  actions: RuntimeAutomationAction[],
  startIndex: number,
  failedIndex: number,
  completedLogs: AutomationNodeLogData[],
  message: string,
) {
  const existing = new Map(completedLogs.map((log) => [log.nodeOrder - 1, log]))
  const logs: AutomationNodeLogData[] = []
  for (let index = startIndex; index < actions.length; index += 1) {
    const prior = existing.get(index)
    if (prior?.status === "SKIPPED") {
      logs.push(prior)
    } else if (index < failedIndex && prior) {
      logs.push({
        ...prior,
        status: "FAILED",
        reasonCode: "TRANSACTION_ROLLED_BACK",
        details: "This action ran, but its changes were rolled back because a later action failed.",
      })
    } else if (index === failedIndex) {
      logs.push(actionLog(base, actions[index]!, index, "FAILED", "AUTOMATION_EXECUTION_FAILED", message.slice(0, 500)))
    } else if (!prior) {
      logs.push(actionLog(base, actions[index]!, index, "SKIPPED", "PREVIOUS_ACTION_FAILED", "Skipped because an earlier action failed."))
    }
  }
  return logs
}

export type SegmentRun = {
  id: string
  tenantId: string
  automationId: string | null
  automationName: string
  contactId: string | null
  contactName: string
  actorUserId: string | null
  opportunityId: string | null
  attemptId: string
  eventSource: AutomationNodeEventSource
  triggerType: AutomationTriggerType
  sourceStageId: string | null
  targetStageId: string | null
  cursorIndex: number
  cursorPath?: unknown
  branchDecisions?: unknown
  eventContext?: unknown
  variables: unknown
}

function normalizeAutomationVariables(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>
  }
  return { ...(value as Record<string, unknown>) }
}

function branchFailureLogs(
  base: Omit<AutomationNodeLogData, "id" | "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">,
  steps: FlattenedAutomationAction[],
  startIndex: number,
  failedIndex: number,
  completedLogs: AutomationNodeLogData[],
  message: string,
) {
  const priorByKey = new Map(completedLogs.map((log) => [log.nodeKey, log]))
  const selectedPathKeys = new Set(steps.map((step) => step.action.nodeKey))
  const logs = steps.slice(startIndex).map((step, relativeIndex) => {
    const index = startIndex + relativeIndex
    const prior = priorByKey.get(step.action.nodeKey)
    if (prior?.status === "SKIPPED") return prior
    if (index < failedIndex && prior) {
      return {
        ...prior,
        status: "FAILED" as const,
        reasonCode: "TRANSACTION_ROLLED_BACK",
        details: "This action ran, but its changes were rolled back because a later action failed.",
      }
    }
    if (index === failedIndex) {
      return actionLog(
        base,
        step.action,
        step.nodeOrder - 1,
        "FAILED",
        "AUTOMATION_EXECUTION_FAILED",
        message.slice(0, 500),
        undefined,
        step,
      )
    }
    if (!prior) {
      return actionLog(
        base,
        step.action,
        step.nodeOrder - 1,
        "SKIPPED",
        "PREVIOUS_ACTION_FAILED",
        "Skipped because an earlier action failed.",
        undefined,
        step,
      )
    }
    return prior
  })
  for (const prior of completedLogs) {
    if (prior.status === "SKIPPED" && !selectedPathKeys.has(prior.nodeKey)) logs.push(prior)
  }
  return logs.sort((left, right) => left.nodeOrder - right.nodeOrder)
}

async function executeBranchedAutomationSegmentTx(
  prismaTx: any,
  params: {
    run: SegmentRun
    actions: RuntimeAutomationAction[]
    catalog: AutomationRuntimeCatalog
    occurredAt?: Date
  },
) {
  const { run, actions, catalog } = params
  if (!run.contactId) throw new Error("The contact for this automation run is no longer available.")
  const now = params.occurredAt ?? new Date()
  const base = {
    tenantId: run.tenantId,
    automationId: run.automationId,
    automationName: run.automationName,
    contactId: run.contactId,
    contactName: run.contactName,
    actorUserId: run.actorUserId,
    processId: null,
    opportunityId: run.opportunityId,
    attemptId: run.attemptId,
    eventSource: run.eventSource,
    occurredAt: now,
  } satisfies Omit<AutomationNodeLogData, "id" | "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">
  const logs: AutomationNodeLogData[] = []
  const notificationIds: string[] = []
  const fileCleanupCandidates: AutomationFileCleanupCandidate[] = []
  const automationValues = normalizeAutomationVariables(run.variables)
  const branchDecisions = normalizeBranchDecisions(run.branchDecisions)
  const eventContext = normalizeOpportunityEventContext(run.eventContext)
  const templateContext = createContactTemplateExecutionContext()
  let directContactPromise: Promise<{ statusConfigId: string | null; assignedToUserId: string | null; tagIds: string[] }> | null = null
  const directContactContext = () => {
    if (!directContactPromise) {
      directContactPromise = prismaTx.contact.findFirst({
        where: { tenantId: run.tenantId, id: run.contactId },
        select: {
          statusConfigId: true,
          assignedToUserId: true,
          tags: { select: { tagId: true } },
        },
      }).then((contact: any) => {
        if (!contact) throw new Error("The contact for this If/Else action is no longer available.")
        return {
          statusConfigId: contact.statusConfigId ?? null,
          assignedToUserId: contact.assignedToUserId ?? null,
          tagIds: (contact.tags ?? []).map((item: any) => item.tagId),
        }
      })
    }
    return directContactPromise!
  }
  const invalidateContactContext = () => {
    templateContext.invalidate()
    directContactPromise = null
  }

  let steps = selectedAutomationActionSteps(actions, branchDecisions)
  const cursorRecord = run.cursorPath && typeof run.cursorPath === "object" && !Array.isArray(run.cursorPath)
    ? run.cursorPath as Record<string, unknown>
    : null
  const nextNodeKey = typeof cursorRecord?.nextNodeKey === "string" ? cursorRecord.nextNodeKey : null
  let index = nextNodeKey ? steps.findIndex((step) => step.action.nodeKey === nextNodeKey) : 0
  if (nextNodeKey && index < 0) {
    throw new AutomationExecutionError({
      automationId: run.automationId,
      automationName: run.automationName,
      actionIndex: 0,
      contactId: run.contactId,
      message: "The saved branch continuation is no longer available in this pinned run.",
    })
  }
  const segmentStartIndex = Math.max(0, index)
  let contactDeleted = false

  while (index < steps.length) {
    const step = steps[index]!
    const action = step.action

    if (action.type === "IF_ELSE") {
      try {
        const selectedBranch = await selectIfElseBranch(prismaTx, {
          action,
          run,
          catalog,
          automationValues,
          occurredAt: now,
          eventContext,
          templateContext,
          directContactContext,
        })
        branchDecisions[action.nodeKey] = {
          branchKey: selectedBranch.branchKey,
          branchName: selectedBranch.name,
          decidedAt: now.toISOString(),
        }
        logs.push(actionLog(
          base,
          action,
          step.nodeOrder - 1,
          "EXECUTED",
          selectedBranch.isDefault ? "DEFAULT_BRANCH_SELECTED" : "BRANCH_SELECTED",
          selectedBranch.isDefault
            ? `No conditions matched; selected ${selectedBranch.name}.`
            : `Selected branch “${selectedBranch.name}”.`,
          undefined,
          step,
        ))

        for (const branch of action.ifElseConfig.branches) {
          if (branch.isDefault || branch.branchKey === selectedBranch.branchKey) continue
          const skippedPath = [
            ...step.branchPath,
            { nodeKey: action.nodeKey, branchKey: branch.branchKey, branchName: branch.name },
          ]
          for (const skipped of flattenAutomationActionTree(branch.actions)) {
            logs.push(actionLog(
              base,
              skipped.action,
              skipped.nodeOrder - 1,
              "SKIPPED",
              "BRANCH_NOT_SELECTED",
              `Skipped because branch “${branch.name}” was not selected.`,
              undefined,
              {
                nodeOrder: flattenAutomationActionTree(actions).find((item) => item.action.nodeKey === skipped.action.nodeKey)?.nodeOrder ?? skipped.nodeOrder,
                branchPath: [...skippedPath, ...skipped.branchPath],
              },
            ))
          }
        }

        steps = selectedAutomationActionSteps(actions, branchDecisions)
        index = steps.findIndex((candidate) => candidate.action.nodeKey === action.nodeKey) + 1
        if (selectedBranch.isDefault) index = steps.length
        continue
      } catch (error) {
        const executionError = error instanceof AutomationExecutionError
          ? error
          : new AutomationExecutionError({
              automationId: run.automationId,
              automationName: run.automationName,
              actionIndex: step.nodeOrder - 1,
              contactId: run.contactId,
              message: error instanceof Error ? error.message : "The If/Else conditions could not be evaluated.",
            })
        const failureLogs = branchFailureLogs(base, steps, segmentStartIndex, index, logs, executionError.message)
        const loggedKeys = new Set(failureLogs.map((log) => log.nodeKey))
        for (const descendant of flattenAutomationActionTree(actions)) {
          if (
            loggedKeys.has(descendant.action.nodeKey) ||
            !descendant.branchPath.some((entry) => entry.nodeKey === action.nodeKey)
          ) continue
          failureLogs.push(actionLog(
            base,
            descendant.action,
            descendant.nodeOrder - 1,
            "SKIPPED",
            "PREVIOUS_ACTION_FAILED",
            "Skipped because the If/Else conditions could not be evaluated.",
            undefined,
            descendant,
          ))
        }
        executionError.nodeExecutions = failureLogs.sort((left, right) => left.nodeOrder - right.nodeOrder)
        executionError.branchDecisions = { ...branchDecisions }
        executionError.cursorPath = { nextNodeKey: action.nodeKey }
        throw executionError
      }
    }

    if (action.type === "SPLIT") {
      try {
        const savedDecision = branchDecisions[action.nodeKey]
        const selectedRoute = savedDecision
          ? action.splitConfig.routes.find((route) => route.branchKey === savedDecision.branchKey)
          : selectAutomationSplitRoute(action, run.id)
        if (!selectedRoute) {
          throw new Error("The saved Split route decision is no longer available in this pinned run.")
        }
        branchDecisions[action.nodeKey] = {
          branchKey: selectedRoute.branchKey,
          branchName: selectedRoute.name,
          decidedAt: now.toISOString(),
        }
        logs.push(actionLog(
          base,
          action,
          step.nodeOrder - 1,
          "EXECUTED",
          "ROUTE_SELECTED",
          `Selected route “${selectedRoute.name}” (${selectedRoute.percentage}%).`,
          undefined,
          step,
        ))

        const flattenedActions = flattenAutomationActionTree(actions)
        for (const route of action.splitConfig.routes) {
          if (route.branchKey === selectedRoute.branchKey) continue
          const skippedPath = [
            ...step.branchPath,
            { nodeKey: action.nodeKey, branchKey: route.branchKey, branchName: route.name },
          ]
          for (const skipped of flattenAutomationActionTree(route.actions)) {
            logs.push(actionLog(
              base,
              skipped.action,
              skipped.nodeOrder - 1,
              "SKIPPED",
              "ROUTE_NOT_SELECTED",
              `Skipped because route “${route.name}” was not selected.`,
              undefined,
              {
                nodeOrder: flattenedActions.find((item) => item.action.nodeKey === skipped.action.nodeKey)?.nodeOrder ?? skipped.nodeOrder,
                branchPath: [...skippedPath, ...skipped.branchPath],
              },
            ))
          }
        }

        steps = selectedAutomationActionSteps(actions, branchDecisions)
        index = steps.findIndex((candidate) => candidate.action.nodeKey === action.nodeKey) + 1
        continue
      } catch (error) {
        const executionError = error instanceof AutomationExecutionError
          ? error
          : new AutomationExecutionError({
              automationId: run.automationId,
              automationName: run.automationName,
              actionIndex: step.nodeOrder - 1,
              contactId: run.contactId,
              message: error instanceof Error ? error.message : "The Split route could not be selected.",
            })
        const failureLogs = branchFailureLogs(base, steps, segmentStartIndex, index, logs, executionError.message)
        const loggedKeys = new Set(failureLogs.map((log) => log.nodeKey))
        for (const descendant of flattenAutomationActionTree(actions)) {
          if (
            loggedKeys.has(descendant.action.nodeKey) ||
            !descendant.branchPath.some((entry) => entry.nodeKey === action.nodeKey)
          ) continue
          failureLogs.push(actionLog(
            base,
            descendant.action,
            descendant.nodeOrder - 1,
            "SKIPPED",
            "PREVIOUS_ACTION_FAILED",
            "Skipped because the Split route could not be selected.",
            undefined,
            descendant,
          ))
        }
        executionError.nodeExecutions = failureLogs.sort((left, right) => left.nodeOrder - right.nodeOrder)
        executionError.branchDecisions = { ...branchDecisions }
        executionError.cursorPath = { nextNodeKey: action.nodeKey }
        throw executionError
      }
    }

    if (action.type === "WAIT") {
      const resumeAt = calculateWaitAt(action.waitConfig, now)
      if (resumeAt.getTime() > now.getTime()) {
        const logId = randomUUID()
        logs.push(actionLog(
          base,
          action,
          step.nodeOrder - 1,
          "WAITING",
          "WAIT_SCHEDULED",
          `Waiting until ${formatWaitInstant(resumeAt, catalog.timezone)}.`,
          logId,
          step,
        ))
        const nextStep = steps[index + 1]
        await prismaTx.automationRun.update({
          where: { id: run.id },
          data: {
            status: "WAITING",
            cursorIndex: index + 1,
            cursorPath: { nextNodeKey: nextStep?.action.nodeKey ?? null },
            branchDecisions,
            resumeAt,
            waitingNodeKey: action.nodeKey,
            waitingNodeExecutionId: logId,
            leaseToken: null,
            leaseExpiresAt: null,
            variables: automationValues,
          },
        })
        return { logs, notificationIds, fileCleanupCandidates, status: "WAITING" as const, contactDeleted: false }
      }

      logs.push(actionLog(
        base,
        action,
        step.nodeOrder - 1,
        "EXECUTED",
        "WAIT_TIME_PASSED",
        `The calculated wait time (${formatWaitInstant(resumeAt, catalog.timezone)}) had already passed.`,
        undefined,
        step,
      ))
      if (action.waitConfig.mode === "FIXED_DATE" && action.waitConfig.pastBehavior === "EXIT") {
        for (const skipped of steps.slice(index + 1)) {
          logs.push(actionLog(base, skipped.action, skipped.nodeOrder - 1, "SKIPPED", "WAIT_EXITED", "Skipped because the wait action exited this run.", undefined, skipped))
        }
        await prismaTx.automationRun.update({
          where: { id: run.id },
          data: {
            status: "EXITED",
            cursorIndex: index + 1,
            cursorPath: { nextNodeKey: null },
            branchDecisions,
            resumeAt: null,
            waitingNodeKey: null,
            waitingNodeExecutionId: null,
            leaseToken: null,
            leaseExpiresAt: null,
            exitedAt: now,
            variables: automationValues,
          },
        })
        await prismaTx.automationExecution.create({
          data: {
            tenantId: run.tenantId,
            automationId: run.automationId,
            automationName: run.automationName,
            triggerType: run.triggerType,
            status: "EXITED",
            opportunityId: run.opportunityId,
            contactId: run.contactId,
            sourceStageId: run.sourceStageId,
            targetStageId: run.targetStageId,
            actorUserId: run.actorUserId,
            actionCount: index + 1,
          },
        })
        return { logs, notificationIds, fileCleanupCandidates, status: "EXITED" as const, contactDeleted: false }
      }
      if (action.waitConfig.mode === "FIXED_DATE" && action.waitConfig.pastBehavior === "GO_TO_STEP") {
        const targetNodeKey = action.waitConfig.targetNodeKey
        const targetIndex = steps.findIndex((candidate) => candidate.action.nodeKey === targetNodeKey)
        if (targetIndex <= index) {
          throw new AutomationExecutionError({
            automationId: run.automationId,
            automationName: run.automationName,
            actionIndex: step.nodeOrder - 1,
            contactId: run.contactId,
            message: "The configured wait destination is no longer available in this branch.",
          })
        }
        for (const skipped of steps.slice(index + 1, targetIndex)) {
          logs.push(actionLog(base, skipped.action, skipped.nodeOrder - 1, "SKIPPED", "WAIT_JUMPED", "Skipped because the wait action continued at a later step.", undefined, skipped))
        }
        index = targetIndex
        continue
      }
      index += 1
      continue
    }

    try {
      const successDetails = await applyAutomationAction(prismaTx, {
        action,
        actionIndex: step.nodeOrder - 1,
        automationId: run.automationId,
        automationName: run.automationName,
        tenantId: run.tenantId,
        contactId: run.contactId,
        catalog,
        occurredAt: now,
        runId: run.id,
        automationValues,
        templateContext,
      })
      if (CONTACT_CONTEXT_MUTATING_ACTIONS.has(action.type)) invalidateContactContext()
      const details = typeof successDetails === "string" ? successDetails : successDetails?.details
      if (typeof successDetails === "object" && successDetails?.notificationIds) notificationIds.push(...successDetails.notificationIds)
      if (typeof successDetails === "object" && successDetails && "contactDeleted" in successDetails && successDetails.contactDeleted === true) contactDeleted = true
      if (typeof successDetails === "object" && successDetails && "fileCleanupCandidates" in successDetails && Array.isArray(successDetails.fileCleanupCandidates)) {
        fileCleanupCandidates.push(...successDetails.fileCleanupCandidates)
      }
      logs.push(actionLog(base, action, step.nodeOrder - 1, "EXECUTED", null, details ?? "Action completed successfully.", undefined, step))
    } catch (error) {
      const executionError = error instanceof AutomationExecutionError
        ? error
        : new AutomationExecutionError({
            automationId: run.automationId,
            automationName: run.automationName,
            actionIndex: step.nodeOrder - 1,
            contactId: run.contactId,
            message: error instanceof Error ? error.message : "The automation action failed.",
          })
      executionError.nodeExecutions = branchFailureLogs(base, steps, segmentStartIndex, index, logs, executionError.message)
      executionError.branchDecisions = { ...branchDecisions }
      executionError.cursorPath = { nextNodeKey: action.nodeKey }
      throw executionError
    }
    index += 1
  }

  await prismaTx.automationRun.update({
    where: { id: run.id },
    data: {
      status: "SUCCEEDED",
      cursorIndex: steps.length,
      cursorPath: { nextNodeKey: null },
      branchDecisions,
      resumeAt: null,
      waitingNodeKey: null,
      waitingNodeExecutionId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: now,
      variables: automationValues,
    },
  })
  await prismaTx.automationExecution.create({
    data: {
      tenantId: run.tenantId,
      automationId: run.automationId,
      automationName: run.automationName,
      triggerType: run.triggerType,
      status: "SUCCEEDED",
      opportunityId: run.opportunityId,
      contactId: run.contactId,
      sourceStageId: run.sourceStageId,
      targetStageId: run.targetStageId,
      actorUserId: run.actorUserId,
      actionCount: steps.length,
    },
  })
  return {
    logs: contactDeleted ? logs.map((log) => ({ ...log, contactId: null })) : logs,
    notificationIds,
    fileCleanupCandidates,
    status: "SUCCEEDED" as const,
    contactDeleted,
  }
}

export async function executeAutomationSegmentTx(
  prismaTx: any,
  params: {
    run: SegmentRun
    actions: RuntimeAutomationAction[]
    catalog: AutomationRuntimeCatalog
    startIndex: number
    occurredAt?: Date
  },
) {
  if (
    flattenAutomationActionTree(params.actions).some((step) =>
      step.action.type === "IF_ELSE" || step.action.type === "SPLIT"
    ) || params.run.cursorPath
  ) {
    return executeBranchedAutomationSegmentTx(prismaTx, params)
  }
  const { run, actions, catalog, startIndex } = params
  if (!run.contactId) throw new Error("The contact for this automation run is no longer available.")
  const now = params.occurredAt ?? new Date()
  const base = {
    tenantId: run.tenantId,
    automationId: run.automationId,
    automationName: run.automationName,
    contactId: run.contactId,
    contactName: run.contactName,
    actorUserId: run.actorUserId,
    processId: null,
    opportunityId: run.opportunityId,
    attemptId: run.attemptId,
    eventSource: run.eventSource,
    occurredAt: now,
  } satisfies Omit<AutomationNodeLogData, "id" | "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">
  const logs: AutomationNodeLogData[] = []
  const notificationIds: string[] = []
  const fileCleanupCandidates: AutomationFileCleanupCandidate[] = []
  const automationValues = normalizeAutomationVariables(run.variables)
  const templateContext = createContactTemplateExecutionContext()
  let contactDeleted = false

  for (let index = startIndex; index < actions.length; index += 1) {
    const action = actions[index]!
    if (action.type === "WAIT") {
      const resumeAt = calculateWaitAt(action.waitConfig, now)
      if (resumeAt.getTime() > now.getTime()) {
        const logId = randomUUID()
        logs.push(actionLog(
          base,
          action,
          index,
          "WAITING",
          "WAIT_SCHEDULED",
          `Waiting until ${formatWaitInstant(resumeAt, catalog.timezone)}.`,
          logId,
        ))
        await prismaTx.automationRun.update({
          where: { id: run.id },
          data: {
            status: "WAITING",
            cursorIndex: index + 1,
            resumeAt,
            waitingNodeKey: action.nodeKey,
            waitingNodeExecutionId: logId,
            leaseToken: null,
            leaseExpiresAt: null,
            variables: automationValues,
          },
        })
        return {
          logs,
          notificationIds,
          fileCleanupCandidates,
          status: "WAITING" as const,
          contactDeleted: false,
        }
      }

      logs.push(actionLog(
        base,
        action,
        index,
        "EXECUTED",
        "WAIT_TIME_PASSED",
        `The calculated wait time (${formatWaitInstant(resumeAt, catalog.timezone)}) had already passed.`,
      ))

      if (action.waitConfig.mode === "FIXED_DATE" && action.waitConfig.pastBehavior === "EXIT") {
        for (let skippedIndex = index + 1; skippedIndex < actions.length; skippedIndex += 1) {
          logs.push(actionLog(base, actions[skippedIndex]!, skippedIndex, "SKIPPED", "WAIT_EXITED", "Skipped because the wait action exited this run."))
        }
        await prismaTx.automationRun.update({
          where: { id: run.id },
          data: {
            status: "EXITED",
            cursorIndex: index + 1,
            resumeAt: null,
            waitingNodeKey: null,
            waitingNodeExecutionId: null,
            leaseToken: null,
            leaseExpiresAt: null,
            exitedAt: now,
            variables: automationValues,
          },
        })
        await prismaTx.automationExecution.create({
          data: {
            tenantId: run.tenantId,
            automationId: run.automationId,
            automationName: run.automationName,
            triggerType: run.triggerType,
            status: "EXITED",
            opportunityId: run.opportunityId,
            contactId: run.contactId,
            sourceStageId: run.sourceStageId,
            targetStageId: run.targetStageId,
            actorUserId: run.actorUserId,
            actionCount: index + 1,
          },
        })
        return {
          logs,
          notificationIds,
          fileCleanupCandidates,
          status: "EXITED" as const,
          contactDeleted: false,
        }
      }

      if (action.waitConfig.mode === "FIXED_DATE" && action.waitConfig.pastBehavior === "GO_TO_STEP") {
        const targetNodeKey = action.waitConfig.targetNodeKey
        const targetIndex = actions.findIndex((candidate) => candidate.nodeKey === targetNodeKey)
        if (targetIndex <= index) {
          throw new AutomationExecutionError({
            automationId: run.automationId,
            automationName: run.automationName,
            actionIndex: index,
            contactId: run.contactId,
            message: "The configured wait destination is no longer available.",
          })
        }
        for (let skippedIndex = index + 1; skippedIndex < targetIndex; skippedIndex += 1) {
          logs.push(actionLog(base, actions[skippedIndex]!, skippedIndex, "SKIPPED", "WAIT_JUMPED", "Skipped because the wait action continued at a later step."))
        }
        index = targetIndex - 1
      }
      continue
    }

    try {
      if (action.type === "DELETE_CONTACT" && index !== actions.length - 1) {
        throw new AutomationExecutionError({
          automationId: run.automationId,
          automationName: run.automationName,
          actionIndex: index,
          contactId: run.contactId,
          message: "Delete contact can only be the last action in an automation.",
        })
      }
      const successDetails = await applyAutomationAction(prismaTx, {
        action,
        actionIndex: index,
        automationId: run.automationId,
        automationName: run.automationName,
        tenantId: run.tenantId,
        contactId: run.contactId,
        catalog,
        occurredAt: now,
        runId: run.id,
        automationValues,
        templateContext,
      })
      if (CONTACT_CONTEXT_MUTATING_ACTIONS.has(action.type)) templateContext.invalidate()
      const details = typeof successDetails === "string"
        ? successDetails
        : successDetails?.details
      if (typeof successDetails === "object" && successDetails?.notificationIds) {
        notificationIds.push(...successDetails.notificationIds)
      }
      if (
        typeof successDetails === "object" &&
        successDetails !== null &&
        "contactDeleted" in successDetails &&
        successDetails.contactDeleted === true
      ) {
        contactDeleted = true
      }
      if (
        typeof successDetails === "object" &&
        successDetails !== null &&
        "fileCleanupCandidates" in successDetails &&
        Array.isArray(successDetails.fileCleanupCandidates)
      ) {
        fileCleanupCandidates.push(...successDetails.fileCleanupCandidates)
      }
      logs.push(actionLog(base, action, index, "EXECUTED", null, details ?? "Action completed successfully."))
    } catch (error) {
      if (error instanceof AutomationExecutionError) {
        error.nodeExecutions = failureLogsForSegment(base, actions, startIndex, index, logs, error.message)
      }
      throw error
    }
  }

  await prismaTx.automationRun.update({
    where: { id: run.id },
    data: {
      status: "SUCCEEDED",
      cursorIndex: actions.length,
      resumeAt: null,
      waitingNodeKey: null,
      waitingNodeExecutionId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: now,
      variables: automationValues,
    },
  })
  await prismaTx.automationExecution.create({
    data: {
      tenantId: run.tenantId,
      automationId: run.automationId,
      automationName: run.automationName,
      triggerType: run.triggerType,
      status: "SUCCEEDED",
      opportunityId: run.opportunityId,
      contactId: run.contactId,
      sourceStageId: run.sourceStageId,
      targetStageId: run.targetStageId,
      actorUserId: run.actorUserId,
      actionCount: actions.length,
    },
  })
  return {
    logs: contactDeleted ? logs.map((log) => ({ ...log, contactId: null })) : logs,
    notificationIds,
    fileCleanupCandidates,
    status: "SUCCEEDED" as const,
    contactDeleted,
  }
}

export function evaluateAutomationTrigger(
  automation: any,
  event: OpportunityAutomationEvent,
  catalog: AutomationRuntimeCatalog,
) {
  if (automation.triggerType !== event.triggerType) {
    return {
      matches: false,
      details: `Skipped because this automation listens for ${getAutomationTriggerLabel(automation.triggerType)}, not ${getAutomationTriggerLabel(event.triggerType)}.`,
    }
  }
  if (automation.pipelineId !== event.pipelineId) {
    const expected = catalog.pipelineMap.get(automation.pipelineId) ?? automation.pipelineId
    const found = catalog.pipelineMap.get(event.pipelineId) ?? event.pipelineId
    return {
      matches: false,
      details: `Pipeline: expected ${expected}, found ${found}.`,
    }
  }
  if (
    automation.triggerType === "OPPORTUNITY_STAGE_CHANGED" &&
    automation.targetStageId !== event.targetStageId
  ) {
    const expected = automation.targetStageId
      ? catalog.stageMap.get(automation.targetStageId) ?? automation.targetStageId
      : "empty"
    const found = event.targetStageId
      ? catalog.stageMap.get(event.targetStageId) ?? event.targetStageId
      : "empty"
    return {
      matches: false,
      details: `Stage: expected ${expected}, found ${found}.`,
    }
  }
  return { matches: true, details: "The opportunity event matched this trigger." }
}

export async function executeOpportunityAutomations(prismaTx: any, event: OpportunityAutomationEvent) {
  const automations = await prismaTx.automation.findMany({
    where: {
      tenantId: event.tenantId,
      isEnabled: true,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      conditions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      actions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  })
  if (automations.length === 0) {
    return {
      matchedCount: 0,
      executedCount: 0,
      notificationIds: [] as string[],
      fileCleanupCandidates: [] as AutomationFileCleanupCandidate[],
      contactDeleted: false,
    }
  }

  const [contact, catalog] = await Promise.all([
    prismaTx.contact.findFirst({
      where: { tenantId: event.tenantId, id: event.contactId },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        statusConfigId: true,
        assignedToUserId: true,
        tags: { select: { tagId: true } },
        customFieldValues: { select: { fieldId: true, value: true } },
      },
    }),
    getAutomationRuntimeCatalog(prismaTx, event.tenantId),
  ])
  if (!contact) throw new Error("Contact not found while executing automation.")

  const contactName = getContactDisplayName(contact)
  type AutomationPlan = {
    automation: any
    actions: RuntimeAutomationAction[]
    logs: AutomationNodeLogData[]
    shouldRun: boolean
  }
  const plans: AutomationPlan[] = automations.map((automation: any) => {
    const actions: RuntimeAutomationAction[] = automation.actions.map((action: any) => automationActionSnapshot(action))
    const attemptId = randomUUID()
    const occurredAt = new Date()
    const base = {
      tenantId: event.tenantId,
      automationId: automation.id,
      automationName: automation.name,
      contactId: event.contactId,
      contactName,
      actorUserId: event.actorUserId,
      processId: null,
      opportunityId: event.opportunityId,
      attemptId,
      eventSource: event.triggerType,
      occurredAt,
    } satisfies Omit<AutomationNodeLogData, "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">
    const trigger = evaluateAutomationTrigger(automation, event, catalog)
    const logs: AutomationNodeLogData[] = [{
      ...base,
      nodeKind: "TRIGGER",
      nodeOrder: 0,
      nodeKey: automation.triggerType,
      nodeLabel: getAutomationTriggerLabel(automation.triggerType),
      status: trigger.matches ? "EXECUTED" : "SKIPPED",
      reasonCode: trigger.matches ? null : "TRIGGER_NOT_MATCHED",
      details: trigger.details,
    }]

    if (!trigger.matches) {
      logs.push(...flattenAutomationActionTree(actions).map(({ action, nodeOrder, branchPath }) => ({
        ...base,
        nodeKind: "ACTION" as const,
        nodeOrder,
        nodeKey: action.nodeKey,
        nodeLabel: getAutomationActionNodeLabel(action),
        status: "SKIPPED" as const,
        reasonCode: "TRIGGER_NOT_MET",
        details: `Skipped because the automation trigger did not match. ${trigger.details}`,
        branchPath,
      })))
      return { automation, actions, logs, shouldRun: false }
    }

    const conditionResult = evaluateAutomationConditions(automation, event, contact, catalog)
    if (!conditionResult.matches) {
      const details = conditionResult.failures.join(" ")
      logs.push(...flattenAutomationActionTree(actions).map(({ action, nodeOrder, branchPath }) => ({
        ...base,
        nodeKind: "ACTION" as const,
        nodeOrder,
        nodeKey: action.nodeKey,
        nodeLabel: getAutomationActionNodeLabel(action),
        status: "SKIPPED" as const,
        reasonCode: "FILTERS_NOT_MET",
        details,
        branchPath,
      })))
      return { automation, actions, logs, shouldRun: false }
    }

    return { automation, actions, logs, shouldRun: true }
  })

  const notificationIds: string[] = []
  const fileCleanupCandidates: AutomationFileCleanupCandidate[] = []
  let executedCount = 0
  let contactDeleted = false
  for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
    const plan = plans[planIndex]
    if (!plan.shouldRun) continue

    if (contactDeleted) {
      const triggerLog = plan.logs[0]!
      plan.logs.push(...flattenAutomationActionTree(plan.actions).map(({ action, nodeOrder, branchPath }) => actionLog(
        triggerLog,
        action,
        nodeOrder - 1,
        "SKIPPED",
        "CONTACT_DELETED",
        "Skipped because an earlier automation deleted the contact.",
        undefined,
        { nodeOrder, branchPath },
      )))
      continue
    }

    try {
      const triggerLog = plan.logs[0]!
      const run = await prismaTx.automationRun.create({
        data: {
          tenantId: event.tenantId,
          automationId: plan.automation.id,
          automationName: plan.automation.name,
          contactId: event.contactId,
          contactName,
          actorUserId: event.actorUserId,
          opportunityId: event.opportunityId,
          attemptId: triggerLog.attemptId,
          eventSource: event.triggerType,
          triggerType: event.triggerType,
          sourceStageId: event.sourceStageId,
          targetStageId: event.targetStageId,
          actionSnapshot: plan.actions,
          cursorIndex: 0,
          eventContext: {
            pipelineId: event.pipelineId,
            valueCents: event.valueCents,
            sourceStageId: event.sourceStageId,
            targetStageId: event.targetStageId,
            occurredAt: triggerLog.occurredAt.toISOString(),
          },
          status: "RUNNING",
        },
      })
      const result = await executeAutomationSegmentTx(prismaTx, {
        run,
        actions: plan.actions,
        catalog,
        startIndex: 0,
      })
      executedCount += 1
      plan.logs.push(...result.logs)
      notificationIds.push(...result.notificationIds)
      fileCleanupCandidates.push(...result.fileCleanupCandidates)
      if (result.contactDeleted) contactDeleted = true
    } catch (error) {
      if (error instanceof AutomationExecutionError) {
        for (let index = 0; index < plans.length; index += 1) {
          const tracePlan = plans[index]
          if (!tracePlan.shouldRun) continue
          const triggerLog = tracePlan.logs.find((log) => log.nodeKind === "TRIGGER")!
          if (index === planIndex) {
            tracePlan.logs = [triggerLog, ...error.nodeExecutions]
            continue
          }
          if (index < planIndex) {
            tracePlan.logs = tracePlan.logs.map((log) =>
              log.nodeKind === "ACTION" && (log.status === "EXECUTED" || log.status === "WAITING")
                ? {
                    ...log,
                    status: "FAILED",
                    reasonCode: "TRANSACTION_ROLLED_BACK",
                    details: "This action ran, but its changes were rolled back because a later automation failed.",
                  }
                : log,
            )
            continue
          }
          tracePlan.logs = [
            triggerLog,
            ...flattenAutomationActionTree(tracePlan.actions).map(({ action, nodeOrder, branchPath }) => actionLog(
              triggerLog,
              action,
              nodeOrder - 1,
              "SKIPPED",
              "PREVIOUS_AUTOMATION_FAILED",
              "Skipped because an earlier automation failed.",
              undefined,
              { nodeOrder, branchPath },
            )),
          ]
        }
        error.nodeExecutions = plans.flatMap((item) => item.logs)
        error.actionSnapshot = plan.actions
        error.attemptId = plan.logs[0]?.attemptId ?? null
        error.eventSource = event.triggerType
        error.contactName = contactName
      }
      throw error
    }
  }

  const nodeExecutions = plans
    .flatMap((plan: { logs: AutomationNodeLogData[] }) => plan.logs)
    .map((log) => contactDeleted ? { ...log, contactId: null } : log)
  if (nodeExecutions.length > 0) {
    await prismaTx.automationNodeExecution.createMany({ data: nodeExecutions })
  }

  const matchedCount = plans.filter((plan: { shouldRun: boolean }) => plan.shouldRun).length
  return {
    matchedCount,
    executedCount,
    notificationIds,
    fileCleanupCandidates,
    contactDeleted,
  }
}

export async function recordAutomationFailure(prismaClient: any, event: OpportunityAutomationEvent, error: AutomationExecutionError) {
  await prismaClient.$transaction(async (transaction: any) => {
    const opportunityId = event.triggerType === "OPPORTUNITY_CREATED" ? null : event.opportunityId
    if (error.attemptId && error.contactName && error.actionSnapshot.length > 0) {
      const failedStep = flattenAutomationActionTree(error.actionSnapshot as RuntimeAutomationAction[])
        .find((step) => step.nodeOrder - 1 === error.actionIndex)
      await transaction.automationRun.create({
        data: {
          tenantId: event.tenantId,
          automationId: error.automationId || null,
          automationName: error.automationName,
          contactId: event.contactId,
          contactName: error.contactName,
          actorUserId: event.actorUserId,
          opportunityId,
          attemptId: error.attemptId,
          eventSource: error.eventSource ?? event.triggerType,
          triggerType: event.triggerType,
          sourceStageId: event.sourceStageId,
          targetStageId: event.targetStageId,
          actionSnapshot: error.actionSnapshot,
          cursorIndex: error.actionIndex,
          cursorPath: error.cursorPath,
          branchDecisions: error.branchDecisions ?? {},
          eventContext: {
            pipelineId: event.pipelineId,
            valueCents: event.valueCents,
            sourceStageId: event.sourceStageId,
            targetStageId: event.targetStageId,
            occurredAt: new Date().toISOString(),
          },
          status: "FAILED",
          failureNodeKey: failedStep?.action.nodeKey ?? (error.actionSnapshot[error.actionIndex] as { nodeKey?: string } | undefined)?.nodeKey,
          failureCode: error.code,
          failureMessage: error.message.slice(0, 500),
          failedAt: new Date(),
        },
      })
    }
    await transaction.automationExecution.create({
      data: {
        tenantId: event.tenantId,
        automationId: error.automationId,
        automationName: error.automationName,
        triggerType: event.triggerType,
        status: "FAILED",
        opportunityId,
        contactId: event.contactId,
        sourceStageId: event.sourceStageId,
        targetStageId: event.targetStageId,
        actorUserId: event.actorUserId,
        actionCount: error.actionIndex,
        errorCode: error.code,
        errorMessage: error.message.slice(0, 500),
      },
    })
    if (error.nodeExecutions.length > 0) {
      await transaction.automationNodeExecution.createMany({
        data: error.nodeExecutions.map((item) => ({
          ...item,
          opportunityId,
        })),
      })
    }
  })
}

async function recordAutomationRunFailure(prismaClient: any, runId: string, leaseToken: string, cause: unknown) {
  const run = await prismaClient.automationRun.findFirst({
    where: { id: runId, status: "RUNNING", leaseToken },
  })
  if (!run) return
  const tenant = await prismaClient.tenant.findUnique({
    where: { id: run.tenantId },
    select: { timezone: true },
  })
  const timezone = tenant?.timezone?.trim() || "America/Chicago"

  let actions: RuntimeAutomationAction[] = []
  try {
    actions = parseActionSnapshot(run.actionSnapshot)
  } catch {
    actions = []
  }
  const error = cause instanceof AutomationExecutionError
    ? cause
    : new AutomationExecutionError({
        automationId: run.automationId,
        automationName: run.automationName,
        actionIndex: Math.min(run.cursorIndex, Math.max(0, actions.length - 1)),
        contactId: run.contactId,
        message: cause instanceof Error ? cause.message : "The automation run could not be resumed.",
      })
  const now = new Date()
  const base = {
    tenantId: run.tenantId,
    automationId: run.automationId,
    automationName: run.automationName,
    contactId: run.contactId,
    contactName: run.contactName,
    actorUserId: run.actorUserId,
    processId: null,
    opportunityId: run.opportunityId,
    attemptId: run.attemptId,
    eventSource: run.eventSource,
    occurredAt: now,
  } satisfies Omit<AutomationNodeLogData, "id" | "nodeKind" | "nodeOrder" | "nodeKey" | "nodeLabel" | "status" | "reasonCode" | "details">
  const branchedSteps = flattenAutomationActionTree(actions).some((step) =>
    step.action.type === "IF_ELSE" || step.action.type === "SPLIT"
  )
    ? selectedAutomationActionSteps(actions, normalizeBranchDecisions(run.branchDecisions))
    : []
  const cursorRecord = run.cursorPath && typeof run.cursorPath === "object" && !Array.isArray(run.cursorPath)
    ? run.cursorPath as Record<string, unknown>
    : null
  const nextNodeKey = typeof cursorRecord?.nextNodeKey === "string" ? cursorRecord.nextNodeKey : null
  const branchStartIndex = nextNodeKey
    ? Math.max(0, branchedSteps.findIndex((step) => step.action.nodeKey === nextNodeKey))
    : Math.min(run.cursorIndex, Math.max(0, branchedSteps.length - 1))
  const branchFailedIndex = Math.max(
    branchStartIndex,
    branchedSteps.findIndex((step) => step.nodeOrder - 1 === error.actionIndex),
  )
  const logs = error.nodeExecutions.length > 0
    ? error.nodeExecutions
    : branchedSteps.length > 0
      ? branchFailureLogs(base, branchedSteps, branchStartIndex, branchFailedIndex, [], error.message)
      : actions.length > 0
      ? failureLogsForSegment(base, actions, run.cursorIndex, error.actionIndex, [], error.message)
      : []

  await prismaClient.$transaction(async (transaction: any) => {
    if (run.waitingNodeExecutionId) {
      await transaction.automationNodeExecution.updateMany({
        where: { tenantId: run.tenantId, id: run.waitingNodeExecutionId },
        data: {
          status: "EXECUTED",
          reasonCode: null,
          details: run.resumeAt
            ? `Scheduled for ${formatWaitInstant(run.resumeAt, timezone)} and resumed at ${formatWaitInstant(now, timezone)} before the following action failed.`
            : `The wait resumed at ${formatWaitInstant(now, timezone)} before the following action failed.`,
          occurredAt: now,
        },
      })
    }
    const updated = await transaction.automationRun.updateMany({
      where: { id: run.id, status: "RUNNING", leaseToken },
      data: {
        status: "FAILED",
        cursorPath: error.cursorPath ?? run.cursorPath,
        branchDecisions: error.branchDecisions ?? run.branchDecisions ?? {},
        failureNodeKey: flattenAutomationActionTree(actions).find((step) => step.nodeOrder - 1 === error.actionIndex)?.action.nodeKey ?? run.waitingNodeKey,
        failureCode: error.code,
        failureMessage: error.message.slice(0, 500),
        failedAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
    if (!updated.count) return
    await transaction.automationExecution.create({
      data: {
        tenantId: run.tenantId,
        automationId: run.automationId,
        automationName: run.automationName,
        triggerType: run.triggerType,
        status: "FAILED",
        opportunityId: run.opportunityId,
        contactId: run.contactId,
        sourceStageId: run.sourceStageId,
        targetStageId: run.targetStageId,
        actorUserId: run.actorUserId,
        actionCount: run.cursorIndex,
        errorCode: error.code,
        errorMessage: error.message.slice(0, 500),
      },
    })
    if (logs.length > 0) await transaction.automationNodeExecution.createMany({ data: logs })
  })
}

async function resumeAutomationRun(prismaClient: any, runId: string, leaseToken: string) {
  try {
    const result = await prismaClient.$transaction(async (transaction: any) => {
      const run = await transaction.automationRun.findFirst({
        where: { id: runId, status: "RUNNING", leaseToken },
      })
      if (!run) {
        return {
          status: "NOT_CLAIMED" as const,
          notificationIds: [] as string[],
          fileCleanupCandidates: [] as AutomationFileCleanupCandidate[],
        }
      }
      const actions = parseActionSnapshot(run.actionSnapshot)
      const contact = run.contactId
        ? await transaction.contact.findFirst({ where: { tenantId: run.tenantId, id: run.contactId }, select: { id: true } })
        : null
      if (!contact) throw new Error("The contact for this automation run is no longer available.")
      const resumedAt = new Date()
      const catalog = await getAutomationRuntimeCatalog(transaction, run.tenantId)
      if (run.waitingNodeExecutionId) {
        await transaction.automationNodeExecution.updateMany({
          where: { tenantId: run.tenantId, id: run.waitingNodeExecutionId },
          data: {
            status: "EXECUTED",
            reasonCode: null,
            details: run.resumeAt
              ? `Scheduled for ${formatWaitInstant(run.resumeAt, catalog.timezone)} and resumed at ${formatWaitInstant(resumedAt, catalog.timezone)}.`
              : `Wait completed at ${formatWaitInstant(resumedAt, catalog.timezone)}.`,
            occurredAt: resumedAt,
          },
        })
      }
      const result = await executeAutomationSegmentTx(transaction, {
        run,
        actions,
        catalog,
        startIndex: run.cursorIndex,
        occurredAt: resumedAt,
      })
      if (result.logs.length > 0) {
        await transaction.automationNodeExecution.createMany({ data: result.logs })
      }
      if (run.dispatchId && (result.notificationIds.length > 0 || result.fileCleanupCandidates.length > 0)) {
        await transaction.automationSideEffect.createMany({
          data: [
            ...result.notificationIds.map((notificationId: string) => ({
              tenantId: run.tenantId,
              type: "NOTIFICATION_DELIVERY" as const,
              idempotencyKey: `automation-run:${run.id}:notification:${notificationId}`,
              payload: { notificationId },
            })),
            ...result.fileCleanupCandidates.map((file: AutomationFileCleanupCandidate) => ({
              tenantId: run.tenantId,
              type: "FILE_DELETE" as const,
              idempotencyKey: `automation-run:${run.id}:file:${file.id}`,
              payload: { fileId: file.id, key: file.key },
            })),
          ],
          skipDuplicates: true,
        })
      }
      return {
        status: result.status,
        notificationIds: run.dispatchId ? [] : result.notificationIds,
        fileCleanupCandidates: run.dispatchId ? [] : result.fileCleanupCandidates,
      }
    })
    await emitAutomationTaskNotifications(prismaClient, result.notificationIds).catch((error) => {
      console.error("Could not emit automation task notification", error)
    })
    await deleteAutomationContactFileObjects(result.fileCleanupCandidates)
    return { status: result.status }
  } catch (error) {
    await recordAutomationRunFailure(prismaClient, runId, leaseToken, error)
    return { status: "FAILED" as const }
  }
}

async function emitAutomationTaskNotifications(prismaClient: any, notificationIds: string[]) {
  if (notificationIds.length === 0) return
  const notifications = await prismaClient.notification.findMany({
    where: { id: { in: notificationIds } },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      contactId: true,
      type: true,
      title: true,
      body: true,
      readAt: true,
      createdAt: true,
      taskId: true,
      taskReminderId: true,
    },
  })

  for (const notification of notifications) {
    const serialized: RealtimeNotificationPayload = {
      id: notification.id,
      tenantId: notification.tenantId,
      userId: notification.userId,
      contactId: notification.contactId ?? null,
      type: notification.type,
      title: notification.title,
      body: notification.body ?? null,
      readAt: notification.readAt?.toISOString?.() ?? null,
      createdAt:
        typeof notification.createdAt === "string"
          ? notification.createdAt
          : notification.createdAt.toISOString(),
      taskId: notification.taskId ?? null,
      taskReminderId: notification.taskReminderId ?? null,
    }
    emitNotificationCreated(serialized.userId, serialized)
  }
}

export async function resumeDueAutomationRuns(prismaOverride?: any) {
  const prismaClient = prismaOverride ?? (await import("./prisma.js")).prisma
  const now = new Date()
  const candidates = await (prismaClient as any).automationRun.findMany({
    where: {
      OR: [
        {
          status: "WAITING",
          resumeAt: { lte: now },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        },
        {
          status: "RUNNING",
          leaseToken: { not: null },
          leaseExpiresAt: { lt: now },
        },
      ],
    },
    orderBy: { resumeAt: "asc" },
    take: 50,
    select: { id: true },
  })
  const results = []
  for (const candidate of candidates) {
    const leaseToken = randomUUID()
    const claimed = await (prismaClient as any).automationRun.updateMany({
      where: {
        id: candidate.id,
        OR: [
          {
            status: "WAITING",
            resumeAt: { lte: now },
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
          },
          {
            status: "RUNNING",
            leaseToken: { not: null },
            leaseExpiresAt: { lt: now },
          },
        ],
      },
      data: {
        status: "RUNNING",
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    })
    if (!claimed.count) continue
    results.push(await resumeAutomationRun(prismaClient as any, candidate.id, leaseToken))
  }
  return results
}
