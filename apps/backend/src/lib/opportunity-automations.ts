import { randomUUID } from "node:crypto"

import { z } from "zod"

import {
  getAutomationActionLabel,
  getAutomationTriggerLabel,
  getContactDisplayName,
  type AutomationNodeEventSource,
  type AutomationNodeLogData,
} from "./automation-node-executions.js"
import { normalizeCustomFieldValue } from "./contact-custom-field-values.js"
import {
  parseContactTemplate,
  renderContactNoteTemplates,
  validateContactTemplate,
} from "./contact-templates.js"
import { NoteBodyInputSchema, NoteTitleInputSchema } from "./note-inputs.js"

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
  "SET_CONTACT_CUSTOM_FIELD",
  "CLEAR_CONTACT_CUSTOM_FIELD",
  "SET_CONTACT_STATUS",
  "SET_CONTACT_ASSIGNEE",
  "CLEAR_CONTACT_ASSIGNEE",
  "ADD_CONTACT_TAG",
  "REMOVE_CONTACT_TAG",
  "ADD_CONTACT_NOTE",
  "WAIT",
] as const

export const AUTOMATION_WAIT_UNITS = ["SECONDS", "MINUTES", "HOURS", "DAYS"] as const

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
  targetNodeKey: z.string().uuid().optional(),
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
const actionNodeKeySchema = z.string().uuid().optional()
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

export const AutomationConditionInputSchema = z.discriminatedUnion("source", [
  opportunityValueConditionSchema,
  contactStatusConditionSchema,
  customFieldConditionSchema,
  contactAssigneeConditionSchema,
  contactTagsConditionSchema,
])

export const AutomationActionInputSchema = z.discriminatedUnion("type", [
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
  z.object({ type: z.literal("WAIT"), nodeKey: actionNodeKeySchema, waitConfig: AutomationWaitConfigSchema }),
])

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
    actions: z.array(AutomationActionInputSchema).min(1).max(20),
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

export async function validateAutomationConfiguration(
  prismaClient: any,
  tenantId: string,
  input: AutomationInput,
) {
  const [pipeline, fields, statuses, memberships, tags] = await Promise.all([
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
    prismaClient.membership.findMany({
      where: { tenantId },
      select: { userId: true, status: true },
    }),
    prismaClient.tenantTag.findMany({ where: { tenantId }, select: { id: true } }),
  ])

  if (!pipeline) throw new AutomationConfigurationError("PIPELINE_NOT_FOUND", "The selected pipeline no longer exists.")
  const stageIds = new Set(pipeline.stages.map((stage: { id: string }) => stage.id))
  if (input.trigger.type === "OPPORTUNITY_STAGE_CHANGED") {
    if (!stageIds.has(input.trigger.targetStageId)) {
      throw new AutomationConfigurationError("PIPELINE_STAGE_NOT_FOUND", "The selected stage does not belong to the selected pipeline.")
    }
  }

  const fieldMap = new Map<string, CustomFieldRecord>(fields.map((field: CustomFieldRecord) => [field.id, field]))
  const activeStatusIds = new Set(statuses.filter((item: any) => item.isActive).map((item: any) => item.id))
  const activeUserIds = new Set(memberships.filter((item: any) => item.status === "ACTIVE").map((item: any) => item.userId))
  const tagIds = new Set(tags.map((item: any) => item.id))

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

  const actionNodeKeys = input.actions.map((action) => action.nodeKey ?? randomUUID())
  if (new Set(actionNodeKeys).size !== actionNodeKeys.length) {
    throw new AutomationConfigurationError("DUPLICATE_ACTION_NODE_KEY", "Every automation action must have a unique node key.")
  }

  const actions = input.actions.map((action, index) => {
    const nodeKey = actionNodeKeys[index]!
    const base = { tenantId, nodeKey, type: action.type, sortOrder: (index + 1) * 10 }
    if (action.type === "WAIT") {
      const waitConfig = action.waitConfig.mode === "FIXED_DATE"
        ? (() => {
            const dateTime = new Date(action.waitConfig.dateTime)
            dateTime.setUTCSeconds(0, 0)
            return { ...action.waitConfig, dateTime: dateTime.toISOString() }
          })()
        : action.waitConfig
      if (waitConfig.mode === "FIXED_DATE" && waitConfig.pastBehavior === "GO_TO_STEP") {
        const targetIndex = actionNodeKeys.indexOf(waitConfig.targetNodeKey ?? "")
        if (targetIndex <= index) {
          throw new AutomationConfigurationError(
            "INVALID_WAIT_TARGET",
            "The wait action can only go to an action that appears later in the automation.",
          )
        }
      }
      return { ...base, waitConfig }
    }
    if (action.type === "ADD_CONTACT_NOTE") {
      const titleValidation = validateContactTemplate(action.noteTitle, fields)
      const bodyValidation = validateContactTemplate(action.noteBody, fields)
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

type AutomationEvent = {
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

function evaluateAutomationConditions(
  automation: any,
  event: AutomationEvent,
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
  activeStatusIds: Set<string>
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
  const [fields, statuses, memberships, tags, pipelines, tenant] = await Promise.all([
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
    activeStatusIds: new Set(statuses.map((item: any) => item.id)),
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

type RuntimeAutomationAction = z.infer<typeof AutomationActionInputSchema> & { nodeKey: string }

function automationActionSnapshot(action: any): RuntimeAutomationAction {
  const parsed = AutomationActionInputSchema.parse({
    nodeKey: action.nodeKey ?? action.id ?? randomUUID(),
    type: action.type,
    customFieldId: action.customFieldId,
    statusConfigId: action.statusConfigId,
    assignedUserId: action.assignedUserId,
    tagId: action.tagId,
    value: action.value,
    waitConfig: action.waitConfig,
    noteTitle: action.noteTitle,
    noteBody: action.noteBody,
  })
  if (!parsed.nodeKey) throw new Error("Automation action is missing its stable node key.")
  return { ...parsed, nodeKey: parsed.nodeKey }
}

function parseActionSnapshot(value: unknown): RuntimeAutomationAction[] {
  const parsed = AutomationActionInputSchema.array().max(20).parse(value)
  return parsed.map((action) => {
    if (!action.nodeKey) throw new Error("Automation run contains an action without a node key.")
    return { ...action, nodeKey: action.nodeKey }
  })
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
  },
) {
  const { action, actionIndex, automationId, automationName, tenantId, contactId, catalog, occurredAt } = params
  try {
    if (action.type === "SET_CONTACT_CUSTOM_FIELD") {
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
  for (let index = 0; index < actions.length; index += 1) {
    if (actions[index]!.type === "WAIT") continue
    await applyAutomationAction(prismaTx, {
      action: actions[index]!,
      actionIndex: index,
      automationId: params.automation.id,
      automationName: params.automation.name,
      tenantId: params.tenantId,
      contactId: params.contactId,
      catalog: params.catalog,
      occurredAt,
    })
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
): AutomationNodeLogData {
  return {
    ...(id ? { id } : {}),
    ...base,
    nodeKind: "ACTION",
    nodeOrder: index + 1,
    nodeKey: action.nodeKey,
    nodeLabel: getAutomationActionLabel(action.type),
    status,
    reasonCode,
    details,
  }
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

type SegmentRun = {
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
}

async function executeAutomationSegmentTx(
  prismaTx: any,
  params: {
    run: SegmentRun
    actions: RuntimeAutomationAction[]
    catalog: AutomationRuntimeCatalog
    startIndex: number
    occurredAt?: Date
  },
) {
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
          },
        })
        return { logs, status: "WAITING" as const }
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
        return { logs, status: "EXITED" as const }
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
      const successDetails = await applyAutomationAction(prismaTx, {
        action,
        actionIndex: index,
        automationId: run.automationId,
        automationName: run.automationName,
        tenantId: run.tenantId,
        contactId: run.contactId,
        catalog,
        occurredAt: now,
      })
      logs.push(actionLog(base, action, index, "EXECUTED", null, successDetails ?? "Action completed successfully."))
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
  return { logs, status: "SUCCEEDED" as const }
}

function evaluateAutomationTrigger(
  automation: any,
  event: AutomationEvent,
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

export async function executeOpportunityAutomations(prismaTx: any, event: AutomationEvent) {
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
  if (automations.length === 0) return { matchedCount: 0, executedCount: 0 }

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
      logs.push(...actions.map((action, index) => ({
        ...base,
        nodeKind: "ACTION" as const,
        nodeOrder: index + 1,
        nodeKey: action.nodeKey,
        nodeLabel: getAutomationActionLabel(action.type),
        status: "SKIPPED" as const,
        reasonCode: "TRIGGER_NOT_MET",
        details: `Skipped because the automation trigger did not match. ${trigger.details}`,
      })))
      return { automation, actions, logs, shouldRun: false }
    }

    const conditionResult = evaluateAutomationConditions(automation, event, contact, catalog)
    if (!conditionResult.matches) {
      const details = conditionResult.failures.join(" ")
      logs.push(...actions.map((action, index) => ({
        ...base,
        nodeKind: "ACTION" as const,
        nodeOrder: index + 1,
        nodeKey: action.nodeKey,
        nodeLabel: getAutomationActionLabel(action.type),
        status: "SKIPPED" as const,
        reasonCode: "FILTERS_NOT_MET",
        details,
      })))
      return { automation, actions, logs, shouldRun: false }
    }

    return { automation, actions, logs, shouldRun: true }
  })

  for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
    const plan = plans[planIndex]
    if (!plan.shouldRun) continue

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
          status: "RUNNING",
        },
      })
      const result = await executeAutomationSegmentTx(prismaTx, {
        run,
        actions: plan.actions,
        catalog,
        startIndex: 0,
      })
      plan.logs.push(...result.logs)
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
            ...tracePlan.actions.map((action, actionIndex) => actionLog(
              triggerLog,
              action,
              actionIndex,
              "SKIPPED",
              "PREVIOUS_AUTOMATION_FAILED",
              "Skipped because an earlier automation failed.",
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

  const nodeExecutions = plans.flatMap((plan: { logs: AutomationNodeLogData[] }) => plan.logs)
  if (nodeExecutions.length > 0) {
    await prismaTx.automationNodeExecution.createMany({ data: nodeExecutions })
  }

  const matchedCount = plans.filter((plan: { shouldRun: boolean }) => plan.shouldRun).length
  return { matchedCount, executedCount: matchedCount }
}

export async function recordAutomationFailure(prismaClient: any, event: AutomationEvent, error: AutomationExecutionError) {
  await prismaClient.$transaction(async (transaction: any) => {
    const opportunityId = event.triggerType === "OPPORTUNITY_CREATED" ? null : event.opportunityId
    if (error.attemptId && error.contactName && error.actionSnapshot.length > 0) {
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
          status: "FAILED",
          failureNodeKey: (error.actionSnapshot[error.actionIndex] as { nodeKey?: string } | undefined)?.nodeKey,
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
  const logs = error.nodeExecutions.length > 0
    ? error.nodeExecutions
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
        failureNodeKey: actions[error.actionIndex]?.nodeKey ?? run.waitingNodeKey,
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
    return await prismaClient.$transaction(async (transaction: any) => {
      const run = await transaction.automationRun.findFirst({
        where: { id: runId, status: "RUNNING", leaseToken },
      })
      if (!run) return { status: "NOT_CLAIMED" as const }
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
      return { status: result.status }
    })
  } catch (error) {
    await recordAutomationRunFailure(prismaClient, runId, leaseToken, error)
    return { status: "FAILED" as const }
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
