import { randomInt } from "node:crypto"

import { z } from "zod"

import {
  resolveSafeContactTemplateFieldValue,
  type ContactTemplateFieldType,
} from "./contact-templates.js"

export const AUTOMATION_NUMBER_PHONE_FORMATS = [
  "E164",
  "INTERNATIONAL",
  "INTERNATIONAL_NO_COUNTRY_CODE",
  "INTERNATIONAL_NO_HYPHENS",
  "INTERNATIONAL_NO_SYMBOLS",
  "NATIONAL",
  "NATIONAL_NO_PARENTHESIS",
  "NATIONAL_NO_SYMBOLS",
  "RFC3966",
  "RFC3966_NO_TEL",
] as const

export const AUTOMATION_NUMBER_GROUPING_STYLES = [
  "COMMA_PERIOD",
  "PERIOD_COMMA",
  "SPACE_COMMA",
  "SPACE_PERIOD",
] as const

export const AUTOMATION_NUMBER_CURRENCIES = [
  "USD", "EUR", "GBP", "CAD", "AUD", "MXN", "BRL", "COP", "ARS", "CLP",
  "PEN", "JPY", "CNY", "INR", "KRW", "SGD", "HKD", "NZD", "CHF", "SEK",
  "NOK", "DKK", "PLN", "CZK", "TRY", "ZAR", "AED", "SAR", "EGP", "ILS",
] as const

export type AutomationValueKind = "NUMBER" | "DATE" | "NUMERIC_TEXT" | "PHONE" | "TEXT"

export const AUTOMATION_OUTPUT_KEY_SCHEMA = z.string()
  .trim()
  .regex(
    /^[a-z][a-z0-9_]{0,63}$/,
    "Use a lowercase name that starts with a letter and contains only letters, numbers, and underscores.",
  )

export const AutomationNumberSourceSchema = z.discriminatedUnion("type", [
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

const numericSourceShape = {
  source: AutomationNumberSourceSchema,
  decimalMark: z.enum(["PERIOD", "COMMA"]),
  outputKey: AUTOMATION_OUTPUT_KEY_SCHEMA,
}

const TextToNumberConfigSchema = z.object({
  mode: z.literal("TEXT_TO_NUMBER"),
  ...numericSourceShape,
}).strict()

const FormatNumberConfigSchema = z.object({
  mode: z.literal("FORMAT_NUMBER"),
  ...numericSourceShape,
  groupingStyle: z.enum(AUTOMATION_NUMBER_GROUPING_STYLES),
}).strict()

const FormatCurrencyConfigSchema = z.object({
  mode: z.literal("FORMAT_CURRENCY"),
  ...numericSourceShape,
  currencyCode: z.enum(AUTOMATION_NUMBER_CURRENCIES),
}).strict()

const FormatPhoneConfigSchema = z.object({
  mode: z.literal("FORMAT_PHONE_NUMBER"),
  source: AutomationNumberSourceSchema,
  countryCode: z.string().trim().regex(/^\+\d{1,4}$/, "Enter a country code such as +1."),
  phoneFormat: z.enum(AUTOMATION_NUMBER_PHONE_FORMATS),
  outputKey: AUTOMATION_OUTPUT_KEY_SCHEMA,
}).strict()

const RandomNumberConfigSchema = z.object({
  mode: z.literal("RANDOM_NUMBER"),
  min: z.number().int().safe(),
  max: z.number().int().safe(),
  outputKey: AUTOMATION_OUTPUT_KEY_SCHEMA,
}).strict().superRefine((config, context) => {
  if (config.min > config.max) {
    context.addIssue({
      code: "custom",
      path: ["max"],
      message: "Maximum must be greater than or equal to minimum.",
    })
  }
})

export const AutomationNumberFormatterConfigSchema = z.discriminatedUnion("mode", [
  TextToNumberConfigSchema,
  FormatNumberConfigSchema,
  FormatCurrencyConfigSchema,
  FormatPhoneConfigSchema,
  RandomNumberConfigSchema,
])

export type AutomationNumberSource = z.infer<typeof AutomationNumberSourceSchema>
export type AutomationNumberFormatterConfig = z.infer<typeof AutomationNumberFormatterConfigSchema>
export type AutomationNumberFormatterMode = AutomationNumberFormatterConfig["mode"]
export type AutomationNumberFormatterResult =
  | { status: "CREATED"; value: number | string }
  | { status: "EMPTY_SOURCE" }

export function numberFormatterCustomFieldKeys(config: AutomationNumberFormatterConfig) {
  return config.mode !== "RANDOM_NUMBER" && config.source.type === "CUSTOM_FIELD"
    ? [config.source.key]
    : []
}

export function numberFormatterOutputKind(
  config: AutomationNumberFormatterConfig,
): AutomationValueKind {
  if (config.mode === "TEXT_TO_NUMBER" || config.mode === "RANDOM_NUMBER") return "NUMBER"
  if (config.mode === "FORMAT_NUMBER") return "NUMERIC_TEXT"
  if (config.mode === "FORMAT_PHONE_NUMBER") return "PHONE"
  return "TEXT"
}

export function numberFormatterAcceptsValueKind(
  mode: AutomationNumberFormatterMode,
  valueKind: AutomationValueKind,
) {
  if (mode === "RANDOM_NUMBER") return false
  if (mode === "FORMAT_PHONE_NUMBER") return valueKind === "PHONE"
  return valueKind === "NUMBER" || valueKind === "NUMERIC_TEXT"
}

export function numberFormatterAcceptsFieldType(
  mode: AutomationNumberFormatterMode,
  fieldType: ContactTemplateFieldType,
) {
  if (mode === "RANDOM_NUMBER") return false
  if (mode === "FORMAT_PHONE_NUMBER") return fieldType === "PHONE"
  return ["TEXT", "TEXTAREA", "NUMBER", "CURRENCY"].includes(fieldType)
}

function isEmptySourceValue(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "")
}

async function resolveNumberSource(
  prismaTx: any,
  params: {
    tenantId: string
    contactId: string
    source: AutomationNumberSource
    mode: AutomationNumberFormatterMode
    automationValues: Record<string, unknown>
  },
) {
  if (params.source.type === "AUTOMATION_VALUE") {
    if (!Object.prototype.hasOwnProperty.call(params.automationValues, params.source.key)) {
      throw new Error(`The automation value “${params.source.key}” was not created for this run.`)
    }
    const value = params.automationValues[params.source.key]
    if (isEmptySourceValue(value)) {
      throw new Error(`The automation value “${params.source.key}” is empty.`)
    }
    return { status: "VALUE" as const, value }
  }

  const resolved = await resolveSafeContactTemplateFieldValue(prismaTx, {
    tenantId: params.tenantId,
    contactId: params.contactId,
    source: params.source.type,
    key: params.source.key,
  })
  if (!resolved || !numberFormatterAcceptsFieldType(params.mode, resolved.fieldType)) {
    throw new Error("The configured number formatter field is unavailable or incompatible.")
  }
  if (isEmptySourceValue(resolved.value)) {
    return { status: "EMPTY_SOURCE" as const }
  }
  return { status: "VALUE" as const, value: resolved.value }
}

export function parseAutomationNumber(value: unknown, decimalMark: "PERIOD" | "COMMA") {
  const raw = String(value ?? "").trim()
  const normalized = decimalMark === "COMMA"
    ? raw.replace(/[.\s]/g, "").replace(",", ".")
    : raw.replace(/[,\s]/g, "")
  const number = Number(normalized)
  if (!raw || !Number.isFinite(number)) {
    throw new Error("The number formatter input is not a valid number.")
  }
  return number
}

export function formatAutomationPhone(
  value: unknown,
  phoneFormat: (typeof AUTOMATION_NUMBER_PHONE_FORMATS)[number],
  countryCode: string,
) {
  const digits = String(value ?? "").replace(/\D/g, "")
  const countryDigits = countryCode.replace(/\D/g, "")
  const national = digits.startsWith(countryDigits) ? digits.slice(countryDigits.length) : digits
  if (national.length !== 10) {
    throw new Error("Phone input must contain a ten-digit national number.")
  }
  const area = national.slice(0, 3)
  const prefix = national.slice(3, 6)
  const line = national.slice(6)
  if (phoneFormat === "E164") return `+${countryDigits}${national}`
  if (phoneFormat === "INTERNATIONAL") return `+${countryDigits} ${area}-${prefix}-${line}`
  if (phoneFormat === "INTERNATIONAL_NO_COUNTRY_CODE") return `${area}-${prefix}-${line}`
  if (phoneFormat === "INTERNATIONAL_NO_HYPHENS") return `+${countryDigits} ${area} ${prefix} ${line}`
  if (phoneFormat === "INTERNATIONAL_NO_SYMBOLS") return `${countryDigits}${national}`
  if (phoneFormat === "NATIONAL") return `(${area}) ${prefix}-${line}`
  if (phoneFormat === "NATIONAL_NO_PARENTHESIS") return `${area} ${prefix}-${line}`
  if (phoneFormat === "NATIONAL_NO_SYMBOLS") return national
  if (phoneFormat === "RFC3966") return `tel:+${countryDigits}-${area}-${prefix}-${line}`
  return `+${countryDigits}-${area}-${prefix}-${line}`
}

export async function resolveAutomationNumberFormatter(
  prismaTx: any,
  params: {
    tenantId: string
    contactId: string
    config: AutomationNumberFormatterConfig
    automationValues: Record<string, unknown>
  },
): Promise<AutomationNumberFormatterResult> {
  const { config } = params
  if (config.mode === "RANDOM_NUMBER") {
    return { status: "CREATED", value: randomInt(config.min, config.max + 1) }
  }

  const source = await resolveNumberSource(prismaTx, {
    ...params,
    source: config.source,
    mode: config.mode,
  })
  if (source.status === "EMPTY_SOURCE") return source

  if (config.mode === "FORMAT_PHONE_NUMBER") {
    return {
      status: "CREATED",
      value: formatAutomationPhone(source.value, config.phoneFormat, config.countryCode),
    }
  }

  const number = parseAutomationNumber(source.value, config.decimalMark)
  if (config.mode === "TEXT_TO_NUMBER") return { status: "CREATED", value: number }
  if (config.mode === "FORMAT_CURRENCY") {
    return {
      status: "CREATED",
      value: new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: config.currencyCode,
      }).format(number),
    }
  }
  const locale = config.groupingStyle === "PERIOD_COMMA"
    ? "de-DE"
    : config.groupingStyle === "SPACE_COMMA"
      ? "fr-FR"
      : config.groupingStyle === "SPACE_PERIOD"
        ? "en-ZA"
        : "en-US"
  return {
    status: "CREATED",
    value: new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(number),
  }
}
