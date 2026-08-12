import { z } from "zod"

import { normalizeCustomFieldValue } from "./contact-custom-field-values.js"

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
  "CLEAR_CONTACT_STATUS",
  "SET_CONTACT_ASSIGNEE",
  "CLEAR_CONTACT_ASSIGNEE",
  "ADD_CONTACT_TAG",
  "REMOVE_CONTACT_TAG",
] as const

const idSchema = z.string().trim().min(1).max(100)
const operatorSchema = z.enum(AUTOMATION_OPERATORS)

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
    customFieldId: idSchema,
    value: z.unknown(),
  }),
  z.object({ type: z.literal("CLEAR_CONTACT_CUSTOM_FIELD"), customFieldId: idSchema }),
  z.object({ type: z.literal("SET_CONTACT_STATUS"), statusConfigId: idSchema }),
  z.object({ type: z.literal("CLEAR_CONTACT_STATUS") }),
  z.object({ type: z.literal("SET_CONTACT_ASSIGNEE"), assignedUserId: idSchema }),
  z.object({ type: z.literal("CLEAR_CONTACT_ASSIGNEE") }),
  z.object({ type: z.literal("ADD_CONTACT_TAG"), tagId: idSchema }),
  z.object({ type: z.literal("REMOVE_CONTACT_TAG"), tagId: idSchema }),
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
        sourceStageId: idSchema.nullable().optional(),
        targetStageId: idSchema,
      }),
    ]),
    conditions: z.array(AutomationConditionInputSchema).max(20).default([]),
    actions: z.array(AutomationActionInputSchema).min(1).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.trigger.type === "OPPORTUNITY_STAGE_CHANGED" &&
      value.trigger.sourceStageId === value.trigger.targetStageId
    ) {
      context.addIssue({
        code: "custom",
        path: ["trigger", "sourceStageId"],
        message: "Source and destination stages must be different.",
      })
    }
  })

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
  automationId: string
  automationName: string
  actionIndex: number

  constructor(params: {
    automationId: string
    automationName: string
    actionIndex: number
    message: string
  }) {
    super(params.message)
    this.name = "AutomationExecutionError"
    this.automationId = params.automationId
    this.automationName = params.automationName
    this.actionIndex = params.actionIndex
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
      throw new AutomationConfigurationError("PIPELINE_STAGE_NOT_FOUND", "The destination stage does not belong to the selected pipeline.")
    }
    if (input.trigger.sourceStageId && !stageIds.has(input.trigger.sourceStageId)) {
      throw new AutomationConfigurationError("PIPELINE_STAGE_NOT_FOUND", "The source stage does not belong to the selected pipeline.")
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

  const actions = input.actions.map((action, index) => {
    const base = { tenantId, type: action.type, sortOrder: (index + 1) * 10 }
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
    sourceStageId:
      input.trigger.type === "OPPORTUNITY_STAGE_CHANGED"
        ? input.trigger.sourceStageId ?? null
        : null,
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

function automationMatchesSnapshot(
  automation: any,
  event: AutomationEvent,
  contact: {
    statusConfigId: string | null
    assignedToUserId: string | null
    tags: Array<{ tagId: string }>
    customFieldValues: Array<{ fieldId: string; value: unknown }>
  },
  fieldMap: Map<string, CustomFieldRecord>,
) {
  const values = new Map(contact.customFieldValues.map((item) => [item.fieldId, item.value]))
  const contactTagIds = contact.tags.map((item) => item.tagId)
  return automation.conditions.every((condition: any) => {
    if (condition.source === "OPPORTUNITY_VALUE") {
      return evaluateAutomationOperator(condition.operator, event.valueCents, condition.compareValue, "number")
    }
    if (condition.source === "CONTACT_STATUS") {
      return evaluateAutomationOperator(
        condition.operator,
        contact.statusConfigId,
        condition.statusConfigId,
        "string",
      )
    }
    if (condition.source === "CONTACT_ASSIGNEE") {
      return evaluateAutomationOperator(
        condition.operator,
        contact.assignedToUserId,
        condition.assignedUserId,
        "string",
      )
    }
    if (condition.source === "CONTACT_TAGS") {
      if (condition.operator === "IS_EMPTY") return contactTagIds.length === 0
      if (condition.operator === "IS_NOT_EMPTY") return contactTagIds.length > 0
      if (condition.operator === "EQUALS") return contactTagIds.includes(condition.tagId)
      if (condition.operator === "NOT_EQUALS") return !contactTagIds.includes(condition.tagId)
      return false
    }
    const field = condition.customFieldId ? fieldMap.get(condition.customFieldId) : null
    if (!field) return false
    return evaluateAutomationOperator(
      condition.operator,
      values.get(field.id) ?? null,
      condition.compareValue,
      valueTypeForCustomField(field.fieldType),
    )
  })
}

export async function executeOpportunityAutomations(prismaTx: any, event: AutomationEvent) {
  const automations = await prismaTx.automation.findMany({
    where: {
      tenantId: event.tenantId,
      isEnabled: true,
      pipelineId: event.pipelineId,
      triggerType: event.triggerType,
      ...(event.triggerType === "OPPORTUNITY_STAGE_CHANGED"
        ? {
            targetStageId: event.targetStageId,
            OR: [{ sourceStageId: null }, { sourceStageId: event.sourceStageId }],
          }
        : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      conditions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      actions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  })
  if (automations.length === 0) return { matchedCount: 0, executedCount: 0 }

  const [contact, fields, statuses, memberships, tags] = await Promise.all([
    prismaTx.contact.findFirst({
      where: { tenantId: event.tenantId, id: event.contactId },
      select: {
        id: true,
        statusConfigId: true,
        assignedToUserId: true,
        tags: { select: { tagId: true } },
        customFieldValues: { select: { fieldId: true, value: true } },
      },
    }),
    prismaTx.contactCustomField.findMany({
      where: { tenantId: event.tenantId, isActive: true, isEncrypted: false, isSensitive: false },
      select: { id: true, label: true, fieldType: true, isRequired: true, isActive: true, isEncrypted: true, isSensitive: true, options: true },
    }),
    prismaTx.contactStatusConfig.findMany({ where: { tenantId: event.tenantId, isActive: true }, select: { id: true } }),
    prismaTx.membership.findMany({ where: { tenantId: event.tenantId, status: "ACTIVE" }, select: { userId: true } }),
    prismaTx.tenantTag.findMany({ where: { tenantId: event.tenantId }, select: { id: true } }),
  ])
  if (!contact) throw new Error("Contact not found while executing automation.")

  const fieldMap = new Map<string, CustomFieldRecord>(fields.map((field: CustomFieldRecord) => [field.id, field]))
  const activeStatusIds = new Set(statuses.map((item: any) => item.id))
  const activeUserIds = new Set(memberships.map((item: any) => item.userId))
  const tagIds = new Set(tags.map((item: any) => item.id))
  const matched = automations.filter((automation: any) =>
    automationMatchesSnapshot(automation, event, contact, fieldMap),
  )

  for (const automation of matched) {
    for (let index = 0; index < automation.actions.length; index += 1) {
      const action = automation.actions[index]
      try {
        if (action.type === "SET_CONTACT_CUSTOM_FIELD") {
          const field = action.customFieldId ? fieldMap.get(action.customFieldId) : null
          if (!field) throw new Error("The configured custom field is unavailable.")
          const normalized = normalizeCustomFieldValue(
            { ...field, options: fieldOptions(field) },
            action.value,
          )
          if (!normalized.ok || normalized.value === null) throw new Error(normalized.ok ? `${field.label} requires a value.` : normalized.message)
          await prismaTx.contactCustomFieldValue.upsert({
            where: { tenantId_contactId_fieldId: { tenantId: event.tenantId, contactId: event.contactId, fieldId: field.id } },
            create: { tenantId: event.tenantId, contactId: event.contactId, fieldId: field.id, value: normalized.value },
            update: { value: normalized.value, valueCiphertext: null, valueIv: null, valueAuthTag: null, valueKeyVersion: null },
          })
        } else if (action.type === "CLEAR_CONTACT_CUSTOM_FIELD") {
          const field = action.customFieldId ? fieldMap.get(action.customFieldId) : null
          if (!field || field.isRequired) throw new Error("The configured custom field cannot be cleared.")
          await prismaTx.contactCustomFieldValue.deleteMany({ where: { tenantId: event.tenantId, contactId: event.contactId, fieldId: field.id } })
        } else if (action.type === "SET_CONTACT_STATUS") {
          if (!action.statusConfigId || !activeStatusIds.has(action.statusConfigId)) throw new Error("The configured contact status is unavailable.")
          await prismaTx.contact.update({ where: { id: event.contactId }, data: { statusConfigId: action.statusConfigId } })
        } else if (action.type === "CLEAR_CONTACT_STATUS") {
          await prismaTx.contact.update({ where: { id: event.contactId }, data: { statusConfigId: null } })
        } else if (action.type === "SET_CONTACT_ASSIGNEE") {
          if (!action.assignedUserId || !activeUserIds.has(action.assignedUserId)) throw new Error("The configured assignee is unavailable.")
          await prismaTx.contact.update({ where: { id: event.contactId }, data: { assignedToUserId: action.assignedUserId } })
        } else if (action.type === "CLEAR_CONTACT_ASSIGNEE") {
          await prismaTx.contact.update({ where: { id: event.contactId }, data: { assignedToUserId: null } })
        } else if (action.type === "ADD_CONTACT_TAG") {
          if (!action.tagId || !tagIds.has(action.tagId)) throw new Error("The configured tag is unavailable.")
          await prismaTx.contactTag.upsert({
            where: { tenantId_contactId_tagId: { tenantId: event.tenantId, contactId: event.contactId, tagId: action.tagId } },
            create: { tenantId: event.tenantId, contactId: event.contactId, tagId: action.tagId },
            update: {},
          })
        } else if (action.type === "REMOVE_CONTACT_TAG") {
          if (!action.tagId || !tagIds.has(action.tagId)) throw new Error("The configured tag is unavailable.")
          await prismaTx.contactTag.deleteMany({ where: { tenantId: event.tenantId, contactId: event.contactId, tagId: action.tagId } })
        }
      } catch (error) {
        throw new AutomationExecutionError({
          automationId: automation.id,
          automationName: automation.name,
          actionIndex: index,
          message: error instanceof Error ? error.message : "The automation action could not be completed.",
        })
      }
    }

    await prismaTx.automationExecution.create({
      data: {
        tenantId: event.tenantId,
        automationId: automation.id,
        automationName: automation.name,
        triggerType: event.triggerType,
        status: "SUCCEEDED",
        opportunityId: event.opportunityId,
        contactId: event.contactId,
        sourceStageId: event.sourceStageId,
        targetStageId: event.targetStageId,
        actorUserId: event.actorUserId,
        actionCount: automation.actions.length,
      },
    })
  }

  return { matchedCount: matched.length, executedCount: matched.length }
}

export async function recordAutomationFailure(prismaClient: any, event: AutomationEvent, error: AutomationExecutionError) {
  await prismaClient.automationExecution.create({
    data: {
      tenantId: event.tenantId,
      automationId: error.automationId,
      automationName: error.automationName,
      triggerType: event.triggerType,
      status: "FAILED",
      opportunityId: event.triggerType === "OPPORTUNITY_CREATED" ? null : event.opportunityId,
      contactId: event.contactId,
      sourceStageId: event.sourceStageId,
      targetStageId: event.targetStageId,
      actorUserId: event.actorUserId,
      actionCount: error.actionIndex,
      errorCode: error.code,
      errorMessage: error.message.slice(0, 500),
    },
  })
}
