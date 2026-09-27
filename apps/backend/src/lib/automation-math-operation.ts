import { z } from "zod"

import { shiftCalendarDate } from "./calendar-date.js"
import {
  isValidTemplateDate,
  resolveContactDateValue,
  resolveSafeContactTemplateFieldValue,
  type ContactTemplateFieldType,
} from "./contact-templates.js"
import {
  AUTOMATION_OUTPUT_KEY_SCHEMA,
  AutomationNumberSourceSchema,
  type AutomationNumberSource,
} from "./automation-number-formatter.js"

export const AUTOMATION_MATH_NUMBER_OPERATIONS = ["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"] as const
export const AUTOMATION_MATH_DATE_OPERATIONS = ["ADD", "SUBTRACT"] as const
export const AUTOMATION_MATH_DATE_UNITS = ["DAYS", "MONTHS", "YEARS"] as const

export const AutomationMathDateSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CONTACT_FIELD"),
    key: z.string().trim().regex(/^[a-z][a-z0-9_]*$/),
  }).strict(),
  z.object({
    type: z.literal("CUSTOM_FIELD"),
    key: z.string().trim().regex(/^[a-z0-9_]+$/),
  }).strict(),
  z.object({
    type: z.literal("AUTOMATION_VALUE"),
    key: AUTOMATION_OUTPUT_KEY_SCHEMA,
  }).strict(),
])

const AutomationNumberMathConfigSchema = z.object({
  mode: z.literal("NUMBER"),
  source: AutomationNumberSourceSchema,
  operation: z.enum(AUTOMATION_MATH_NUMBER_OPERATIONS),
  operand: z.number().finite(),
  outputKey: AUTOMATION_OUTPUT_KEY_SCHEMA,
}).strict().superRefine((config, context) => {
  if (config.operation === "DIVIDE" && config.operand === 0) {
    context.addIssue({
      code: "custom",
      path: ["operand"],
      message: "The divisor cannot be zero.",
    })
  }
})

const AutomationDateMathConfigSchema = z.object({
  mode: z.literal("DATE"),
  source: AutomationMathDateSourceSchema,
  operation: z.enum(AUTOMATION_MATH_DATE_OPERATIONS),
  amount: z.number().int().positive().max(10_000),
  unit: z.enum(AUTOMATION_MATH_DATE_UNITS),
  outputKey: AUTOMATION_OUTPUT_KEY_SCHEMA,
}).strict()

export const AutomationMathOperationConfigSchema = z.discriminatedUnion("mode", [
  AutomationNumberMathConfigSchema,
  AutomationDateMathConfigSchema,
])

export type AutomationMathDateSource = z.infer<typeof AutomationMathDateSourceSchema>
export type AutomationMathOperationConfig = z.infer<typeof AutomationMathOperationConfigSchema>

export function mathOperationCustomFieldKeys(config: AutomationMathOperationConfig) {
  return config.source.type === "CUSTOM_FIELD" ? [config.source.key] : []
}

export function mathOperationAcceptsFieldType(
  mode: AutomationMathOperationConfig["mode"],
  fieldType: ContactTemplateFieldType,
) {
  return mode === "DATE"
    ? fieldType === "DATE"
    : fieldType === "NUMBER" || fieldType === "CURRENCY"
}

function missingAutomationValue(automationValues: Record<string, unknown>, key: string) {
  return !Object.prototype.hasOwnProperty.call(automationValues, key)
}

async function resolveNumberSource(
  prismaTx: any,
  params: {
    tenantId: string
    contactId: string
    source: AutomationNumberSource
    automationValues: Record<string, unknown>
  },
) {
  if (params.source.type === "AUTOMATION_VALUE") {
    if (missingAutomationValue(params.automationValues, params.source.key)) {
      throw new Error(`The automation value “${params.source.key}” was not created for this run.`)
    }
    const value = params.automationValues[params.source.key]
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`The automation value “${params.source.key}” is not a valid number.`)
    }
    return value
  }

  const resolved = await resolveSafeContactTemplateFieldValue(prismaTx, {
    tenantId: params.tenantId,
    contactId: params.contactId,
    source: params.source.type,
    key: params.source.key,
  })
  if (!resolved || !mathOperationAcceptsFieldType("NUMBER", resolved.fieldType)) {
    throw new Error("The configured Math source is unavailable or is not a number field.")
  }
  if (
    resolved.value === null ||
    resolved.value === undefined ||
    (typeof resolved.value === "string" && resolved.value.trim() === "")
  ) {
    throw new Error("The configured Math source is empty.")
  }
  const value = typeof resolved.value === "number"
    ? resolved.value
    : Number(String(resolved.value ?? "").trim())
  if (!Number.isFinite(value)) {
    throw new Error("The configured Math source is empty or is not a valid number.")
  }
  return value
}

async function resolveDateSource(
  prismaTx: any,
  params: {
    tenantId: string
    contactId: string
    source: AutomationMathDateSource
    tenantTimezone: string
    occurredAt: Date
    automationValues: Record<string, unknown>
  },
) {
  if (params.source.type === "AUTOMATION_VALUE") {
    if (missingAutomationValue(params.automationValues, params.source.key)) {
      throw new Error(`The automation value “${params.source.key}” was not created for this run.`)
    }
    const value = params.automationValues[params.source.key]
    if (typeof value !== "string" || !isValidTemplateDate(value)) {
      throw new Error(`The automation value “${params.source.key}” is not a valid date.`)
    }
    return value
  }

  const value = await resolveContactDateValue(prismaTx, {
    tenantId: params.tenantId,
    contactId: params.contactId,
    source: params.source,
    timezone: params.tenantTimezone,
    occurredAt: params.occurredAt,
  })
  if (!value) {
    throw new Error("The configured Math source is empty, unavailable, or is not a date field.")
  }
  return value
}

export async function resolveAutomationMathOperation(
  prismaTx: any,
  params: {
    tenantId: string
    contactId: string
    config: AutomationMathOperationConfig
    tenantTimezone: string
    occurredAt: Date
    automationValues: Record<string, unknown>
  },
) {
  const { config } = params
  if (config.mode === "DATE") {
    const source = await resolveDateSource(prismaTx, {
      ...params,
      source: config.source,
    })
    const amount = config.operation === "SUBTRACT" ? -config.amount : config.amount
    const result = shiftCalendarDate(source, amount, config.unit)
    if (!result) throw new Error("The Math operation produced a date outside the supported calendar range.")
    return result
  }

  const source = await resolveNumberSource(prismaTx, {
    ...params,
    source: config.source,
  })
  const result = config.operation === "SUBTRACT"
    ? source - config.operand
    : config.operation === "MULTIPLY"
      ? source * config.operand
      : config.operation === "DIVIDE"
        ? source / config.operand
        : source + config.operand
  if (!Number.isFinite(result)) {
    throw new Error("The Math operation produced a number outside the supported range.")
  }
  return result
}
