import { z } from "zod"

import {
  resolveSafeContactTemplateFieldValue,
  type ContactTemplateExecutionContext,
  type ContactTemplateFieldType,
} from "./contact-templates.js"
import {
  AUTOMATION_OUTPUT_KEY_SCHEMA,
  type AutomationValueKind,
} from "./automation-number-formatter.js"

export const AUTOMATION_TEXT_FORMATTER_MODES = [
  "UPPER_CASE",
  "LOWER_CASE",
  "TITLE_CASE",
  "CAPITALIZE",
  "DEFAULT_VALUE",
  "TRIM",
  "TRIM_WHITESPACE",
  "REPLACE_TEXT",
  "FIND",
  "WORD_COUNT",
  "LENGTH",
  "SPLIT_TEXT",
  "EXTRACT_EMAIL",
  "EXTRACT_URL",
] as const

export const AutomationTextSourceSchema = z.discriminatedUnion("type", [
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

const actionNameSchema = z.string().trim().min(1).max(120)
const requiredLiteralSchema = z.string().min(1).max(5_000)
const requiredVisibleLiteralSchema = z.string().max(5_000).refine(
  (value) => value.trim().length > 0,
  "Enter a value.",
)

const commonShape = {
  actionName: actionNameSchema,
  source: AutomationTextSourceSchema,
  outputKey: AUTOMATION_OUTPUT_KEY_SCHEMA,
}

const simpleModes = [
  "UPPER_CASE",
  "LOWER_CASE",
  "TITLE_CASE",
  "CAPITALIZE",
  "TRIM_WHITESPACE",
  "WORD_COUNT",
  "LENGTH",
  "EXTRACT_EMAIL",
  "EXTRACT_URL",
] as const

const SimpleTextFormatterSchema = z.object({
  mode: z.enum(simpleModes),
  ...commonShape,
}).strict()

const DefaultValueConfigSchema = z.object({
  mode: z.literal("DEFAULT_VALUE"),
  ...commonShape,
  defaultValue: requiredVisibleLiteralSchema,
}).strict()

const TrimConfigSchema = z.object({
  mode: z.literal("TRIM"),
  ...commonShape,
  maxLength: z.number().int().positive().max(10_000),
}).strict()

const ReplaceTextConfigSchema = z.object({
  mode: z.literal("REPLACE_TEXT"),
  ...commonShape,
  searchText: requiredLiteralSchema,
  replacementText: z.string().max(5_000),
}).strict()

const FindConfigSchema = z.object({
  mode: z.literal("FIND"),
  ...commonShape,
  searchText: requiredLiteralSchema,
}).strict()

const SplitTextConfigSchema = z.object({
  mode: z.literal("SPLIT_TEXT"),
  ...commonShape,
  separator: z.string().min(1).max(100),
  segment: z.number().int().positive().max(10_000),
}).strict()

export const AutomationTextFormatterConfigSchema = z.discriminatedUnion("mode", [
  SimpleTextFormatterSchema,
  DefaultValueConfigSchema,
  TrimConfigSchema,
  ReplaceTextConfigSchema,
  FindConfigSchema,
  SplitTextConfigSchema,
])

export type AutomationTextSource = z.infer<typeof AutomationTextSourceSchema>
export type AutomationTextFormatterConfig = z.infer<typeof AutomationTextFormatterConfigSchema>
export type AutomationTextFormatterMode = AutomationTextFormatterConfig["mode"]

const TEXT_FIELD_TYPES = new Set<ContactTemplateFieldType>([
  "TEXT",
  "TEXTAREA",
  "PHONE",
  "SELECT",
  "RADIO",
  "MULTI_SELECT",
])

export function textFormatterAcceptsFieldType(fieldType: ContactTemplateFieldType) {
  return TEXT_FIELD_TYPES.has(fieldType)
}

export function textFormatterAcceptsValueKind(valueKind: AutomationValueKind) {
  return valueKind === "TEXT" || valueKind === "PHONE" || valueKind === "NUMERIC_TEXT"
}

export function textFormatterOutputKind(
  config: Pick<AutomationTextFormatterConfig, "mode">,
): AutomationValueKind {
  return config.mode === "FIND" || config.mode === "WORD_COUNT" || config.mode === "LENGTH"
    ? "NUMBER"
    : "TEXT"
}

export function textFormatterCustomFieldKeys(config: AutomationTextFormatterConfig) {
  return config.source.type === "CUSTOM_FIELD" ? [config.source.key] : []
}

function textValue(value: unknown) {
  if (value === null || value === undefined) return ""
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ")
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  throw new Error("The configured text formatter field contains an unsupported value.")
}

function graphemes(value: string) {
  const segmenter = new Intl.Segmenter("en-US", { granularity: "grapheme" })
  return [...segmenter.segment(value)].map((part) => part.segment)
}

function titleCase(value: string) {
  const lower = value.toLocaleLowerCase("en-US")
  return lower.replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_match, boundary: string, letter: string) => (
    `${boundary}${letter.toLocaleUpperCase("en-US")}`
  ))
}

function capitalize(value: string) {
  const lower = value.toLocaleLowerCase("en-US")
  return lower.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase("en-US"))
}

function wordCount(value: string) {
  const segmenter = new Intl.Segmenter("en-US", { granularity: "word" })
  return [...segmenter.segment(value)].filter((part) => part.isWordLike).length
}

function extractEmail(value: string) {
  return value.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/i)?.[0] ?? ""
}

function extractUrl(value: string) {
  const match = value.match(/\b(?:https?:\/\/|www\.)[^\s<>"']+/i)?.[0] ?? ""
  return match.replace(/[),.;!?]+$/u, "")
}

export function applyAutomationTextFormatter(
  value: string,
  config: AutomationTextFormatterConfig,
): string | number {
  if (config.mode === "UPPER_CASE") return value.toLocaleUpperCase("en-US")
  if (config.mode === "LOWER_CASE") return value.toLocaleLowerCase("en-US")
  if (config.mode === "TITLE_CASE") return titleCase(value)
  if (config.mode === "CAPITALIZE") return capitalize(value)
  if (config.mode === "DEFAULT_VALUE") return value.trim() ? value : config.defaultValue
  if (config.mode === "TRIM") return graphemes(value).slice(0, config.maxLength).join("")
  if (config.mode === "TRIM_WHITESPACE") return value.trim()
  if (config.mode === "REPLACE_TEXT") return value.split(config.searchText).join(config.replacementText)
  if (config.mode === "FIND") return value.indexOf(config.searchText)
  if (config.mode === "WORD_COUNT") return wordCount(value)
  if (config.mode === "LENGTH") return graphemes(value).length
  if (config.mode === "SPLIT_TEXT") return value.split(config.separator)[config.segment - 1] ?? ""
  if (config.mode === "EXTRACT_EMAIL") return extractEmail(value)
  return extractUrl(value)
}

export async function resolveAutomationTextFormatter(
  prismaTx: any,
  params: {
    tenantId: string
    contactId: string
    config: AutomationTextFormatterConfig
    automationValues: Record<string, unknown>
    executionContext?: ContactTemplateExecutionContext
  },
) {
  const { source } = params.config
  let value: unknown
  if (source.type === "AUTOMATION_VALUE") {
    if (!Object.prototype.hasOwnProperty.call(params.automationValues, source.key)) {
      throw new Error(`The automation value “${source.key}” was not created for this run.`)
    }
    value = params.automationValues[source.key]
  } else {
    const resolved = await resolveSafeContactTemplateFieldValue(prismaTx, {
      tenantId: params.tenantId,
      contactId: params.contactId,
      source: source.type,
      key: source.key,
      executionContext: params.executionContext,
    })
    if (!resolved || !textFormatterAcceptsFieldType(resolved.fieldType)) {
      throw new Error("The configured text formatter field is unavailable or incompatible.")
    }
    value = resolved.value
  }

  return applyAutomationTextFormatter(textValue(value), params.config)
}
