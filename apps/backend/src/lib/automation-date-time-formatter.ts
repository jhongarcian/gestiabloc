import { z } from "zod"

import { addCalendarDateOffset } from "./calendar-date.js"
import {
  isValidTemplateDate,
  resolveSafeContactTemplateFieldValue,
  type ContactTemplateExecutionContext,
} from "./contact-templates.js"
import { AUTOMATION_OUTPUT_KEY_SCHEMA } from "./automation-number-formatter.js"
import { zonedDateTimeToUtc } from "./timezone-date-time.js"

export const AUTOMATION_DATE_FORMAT_OPTIONS = [
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD", preview: "2023-12-21" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY", preview: "12/21/2023" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY", preview: "21/12/2023" },
  { value: "MMMM DD YYYY", label: "MMMM DD YYYY", preview: "December 21 2023" },
  { value: "dddd, MMMM D, YYYY", label: "dddd, MMMM D, YYYY", preview: "Thursday, December 21, 2023" },
  { value: "MMM D, YYYY", label: "MMM D, YYYY", preview: "Dec 21, 2023" },
  { value: "MMMM Do YYYY", label: "MMMM Do YYYY", preview: "December 21st 2023" },
  { value: "MM-DD-YYYY", label: "MM-DD-YYYY", preview: "12-21-2023" },
  { value: "DD-MMM-YYYY", label: "DD-MMM-YYYY", preview: "21-Dec-2023" },
  { value: "X", label: "Unix timestamp", preview: "1703116800" },
] as const

export const AUTOMATION_DATE_TIME_FORMAT_OPTIONS = [
  { value: "ddd MMM DD HH:mm:ss YYYY", label: "ddd MMM DD HH:mm:ss YYYY", preview: "Thu Dec 21 13:30:59 2023" },
  { value: "MMMM DD YYYY HH:mm:ss", label: "MMMM DD YYYY HH:mm:ss", preview: "December 21 2023 13:30:59" },
  { value: "YYYY-MM-DD HH:mm:ss", label: "YYYY-MM-DD HH:mm:ss", preview: "2023-12-21 13:30:59" },
  { value: "YYYY-MM-DD hh:mm A", label: "YYYY-MM-DD hh:mm A", preview: "2023-12-21 01:30 PM" },
  { value: "DD/MM/YYYY HH:mm:ss", label: "DD/MM/YYYY HH:mm:ss", preview: "21/12/2023 13:30:59" },
  { value: "MM/DD/YYYY hh:mm A", label: "MM/DD/YYYY hh:mm A", preview: "12/21/2023 01:30 PM" },
  { value: "dddd, MMMM D, YYYY hh:mm A", label: "dddd, MMMM D, YYYY hh:mm A", preview: "Thursday, December 21, 2023 01:30 PM" },
  { value: "MMM D, YYYY hh:mm:ss A", label: "MMM D, YYYY hh:mm:ss A", preview: "Dec 21, 2023 01:30:59 PM" },
  { value: "YYYY-MM-DDTHH:mm:ss", label: "YYYY-MM-DDTHH:mm:ss", preview: "2023-12-21T13:30:59" },
  { value: "MMMM Do YYYY hh:mm A", label: "MMMM Do YYYY hh:mm A", preview: "December 21st 2023 01:30 PM" },
  { value: "MM-DD-YYYY hh:mm A", label: "MM-DD-YYYY hh:mm A", preview: "12-21-2023 01:30 PM" },
  { value: "DD-MMM-YYYY hh:mm A", label: "DD-MMM-YYYY hh:mm A", preview: "21-Dec-2023 01:30 PM" },
  { value: "X", label: "Unix timestamp", preview: "1703165459" },
] as const

const DATE_FORMAT_VALUES = AUTOMATION_DATE_FORMAT_OPTIONS.map((option) => option.value) as [
  (typeof AUTOMATION_DATE_FORMAT_OPTIONS)[number]["value"],
  ...(typeof AUTOMATION_DATE_FORMAT_OPTIONS)[number]["value"][],
]
const DATE_TIME_FORMAT_VALUES = AUTOMATION_DATE_TIME_FORMAT_OPTIONS.map((option) => option.value) as [
  (typeof AUTOMATION_DATE_TIME_FORMAT_OPTIONS)[number]["value"],
  ...(typeof AUTOMATION_DATE_TIME_FORMAT_OPTIONS)[number]["value"][],
]

export const AutomationDateSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CURRENT_DATE") }).strict(),
  z.object({
    type: z.literal("RELATIVE_DATE"),
    amount: z.number().int().positive().max(10_000),
    unit: z.enum(["DAYS", "WEEKS", "MONTHS"]),
  }).strict(),
  z.object({
    type: z.literal("CONTACT_FIELD"),
    key: z.string().trim().regex(/^[a-z][a-z0-9_]*$/),
  }).strict(),
  z.object({
    type: z.literal("CUSTOM_FIELD"),
    key: z.string().trim().regex(/^[a-z0-9_]+$/),
  }).strict(),
  z.object({
    type: z.literal("SPECIFIC_DATE"),
    date: z.string().refine(isValidTemplateDate, "Select a valid specific date."),
    timezone: z.string().trim().min(1).max(100),
  }).strict(),
])

const AutomationDateValueSourceSchema = z.object({
  type: z.literal("AUTOMATION_VALUE"),
  key: AUTOMATION_OUTPUT_KEY_SCHEMA,
}).strict()

export const AutomationFormatterDateSourceSchema = z.union([
  AutomationDateSourceSchema,
  AutomationDateValueSourceSchema,
])

const TIME_SCHEMA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time.")

const DateFormatterConfigSchema = z.object({
  mode: z.literal("DATE"),
  source: AutomationFormatterDateSourceSchema,
  format: z.enum(DATE_FORMAT_VALUES),
  outputKey: AUTOMATION_OUTPUT_KEY_SCHEMA,
}).strict()

const DateTimeFormatterConfigSchema = z.object({
  mode: z.literal("DATE_TIME"),
  source: AutomationFormatterDateSourceSchema,
  format: z.enum(DATE_TIME_FORMAT_VALUES),
  time: TIME_SCHEMA.optional(),
  outputKey: AUTOMATION_OUTPUT_KEY_SCHEMA,
}).strict().superRefine((config, context) => {
  if (
    (
      config.source.type === "CUSTOM_FIELD" ||
      config.source.type === "SPECIFIC_DATE" ||
      config.source.type === "AUTOMATION_VALUE" ||
      (
        config.source.type === "CONTACT_FIELD" &&
        config.source.key !== "created_at" &&
        config.source.key !== "updated_at"
      )
    ) &&
    !config.time
  ) {
    context.addIssue({
      code: "custom",
      path: ["time"],
      message: "Choose a time for this date-only source.",
    })
  }
})

const CompareDatesFormatterConfigSchema = z.object({
  mode: z.literal("COMPARE_DATES"),
  from: AutomationFormatterDateSourceSchema,
  to: AutomationFormatterDateSourceSchema,
  unit: z.enum(["DAYS", "MONTHS", "YEARS"]),
  outputKey: AUTOMATION_OUTPUT_KEY_SCHEMA,
}).strict()

export const AutomationDateTimeFormatterConfigSchema = z.discriminatedUnion("mode", [
  DateFormatterConfigSchema,
  DateTimeFormatterConfigSchema,
  CompareDatesFormatterConfigSchema,
])

export type AutomationDateSource = z.infer<typeof AutomationDateSourceSchema>
export type AutomationFormatterDateSource = z.infer<typeof AutomationFormatterDateSourceSchema>
export type AutomationDateTimeFormatterConfig = z.infer<typeof AutomationDateTimeFormatterConfigSchema>

export function dateTimeFormatterCustomFieldKeys(config: AutomationDateTimeFormatterConfig) {
  const sources = config.mode === "COMPARE_DATES" ? [config.from, config.to] : [config.source]
  return [...new Set(sources.flatMap((source) => source.type === "CUSTOM_FIELD" ? [source.key] : []))]
}

const CONTACT_DATE_FIELDS = {
  date_of_birth: { field: "dateOfBirth", precision: "DATE" },
  deceased_at: { field: "deceasedAt", precision: "DATE" },
  lead_date: { field: "leadDate", precision: "DATE" },
  created_at: { field: "createdAt", precision: "DATE_TIME" },
  updated_at: { field: "updatedAt", precision: "DATE_TIME" },
} as const

type ResolvedDateSource = {
  dateKey: string
  instant: Date
  timezone: string
  precision: "DATE" | "DATE_TIME"
}

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function timezoneParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value)
  const numberPart = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? -1)
  return {
    year: numberPart("year"),
    month: numberPart("month"),
    day: numberPart("day"),
    hour: numberPart("hour"),
    minute: numberPart("minute"),
    second: numberPart("second"),
  }
}

function dateKeyForInstant(value: Date, timezone: string) {
  const parts = timezoneParts(value, timezone)
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
}

function dateOnlyKey(value: unknown) {
  if (typeof value === "string" && isValidTemplateDate(value.slice(0, 10))) return value.slice(0, 10)
  const parsed = value instanceof Date ? value : new Date(String(value ?? ""))
  if (Number.isNaN(parsed.getTime())) return null
  const key = parsed.toISOString().slice(0, 10)
  return isValidTemplateDate(key) ? key : null
}

function localDateTimeMatches(
  date: Date,
  timezone: string,
  expected: { year: number; month: number; day: number; hour: number; minute: number; second: number },
) {
  const actual = timezoneParts(date, timezone)
  return actual.year === expected.year && actual.month === expected.month && actual.day === expected.day &&
    actual.hour === expected.hour && actual.minute === expected.minute && actual.second === expected.second
}

function resolveLocalInstant(dateKey: string, time: string, timezone: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  const [hour, minute] = time.split(":").map(Number)
  let value: Date
  try {
    value = zonedDateTimeToUtc(timezone, year!, month!, day!, hour!, minute!, 0)
  } catch {
    throw new Error(`The configured date uses an invalid timezone (${timezone}).`)
  }
  if (!localDateTimeMatches(value, timezone, {
    year: year!, month: month!, day: day!, hour: hour!, minute: minute!, second: 0,
  })) {
    throw new Error(`The configured time does not exist in ${timezone}.`)
  }
  return value
}

async function resolveStoredDateSource(
  prismaTx: any,
  params: {
    tenantId: string
    contactId: string
    source: AutomationDateSource
    executionContext?: ContactTemplateExecutionContext
  },
) {
  const { source } = params
  if (source.type === "CONTACT_FIELD") {
    const definition = CONTACT_DATE_FIELDS[source.key as keyof typeof CONTACT_DATE_FIELDS]
    if (!definition) throw new Error("The configured contact date field is unavailable.")
    const resolved = await resolveSafeContactTemplateFieldValue(prismaTx, {
      tenantId: params.tenantId,
      contactId: params.contactId,
      source: "CONTACT_FIELD",
      key: source.key,
      executionContext: params.executionContext,
    })
    const raw = resolved?.value
    if (raw === null || raw === undefined || raw === "") {
      throw new Error("The configured contact date field is empty.")
    }
    return { raw, precision: definition.precision }
  }
  if (source.type !== "CUSTOM_FIELD") return null
  let value = await resolveSafeContactTemplateFieldValue(prismaTx, {
    tenantId: params.tenantId,
    contactId: params.contactId,
    source: "CUSTOM_FIELD",
    key: source.key,
    executionContext: params.executionContext,
  })
  if (!value && !params.executionContext && prismaTx.contactCustomFieldValue?.findFirst) {
    const legacyValue = await prismaTx.contactCustomFieldValue.findFirst({
      where: {
        tenantId: params.tenantId,
        contactId: params.contactId,
        field: {
          key: source.key,
          fieldType: "DATE",
          isActive: true,
          isEncrypted: false,
          isSensitive: false,
        },
      },
      select: { value: true },
    })
    value = legacyValue ? { value: legacyValue.value, fieldType: "DATE" } : null
  }
  if (!value || value.fieldType !== "DATE" || value.value === null || value.value === undefined || value.value === "") {
    throw new Error("The configured custom date field is empty or unavailable.")
  }
  return { raw: value.value, precision: "DATE" as const }
}

async function resolveDateSource(
  prismaTx: any,
  params: {
    tenantId: string
    contactId: string
    source: AutomationFormatterDateSource
    tenantTimezone: string
    occurredAt: Date
    dateOnlyTime?: string
    automationValues: Record<string, unknown>
    executionContext?: ContactTemplateExecutionContext
  },
): Promise<ResolvedDateSource> {
  const { source, tenantTimezone, occurredAt } = params
  if (source.type === "AUTOMATION_VALUE") {
    if (!Object.prototype.hasOwnProperty.call(params.automationValues, source.key)) {
      throw new Error(`The automation value “${source.key}” was not created for this run.`)
    }
    const value = params.automationValues[source.key]
    if (typeof value !== "string" || !isValidTemplateDate(value)) {
      throw new Error(`The automation value “${source.key}” is not a valid date.`)
    }
    return {
      dateKey: value,
      instant: resolveLocalInstant(value, params.dateOnlyTime ?? "00:00", tenantTimezone),
      timezone: tenantTimezone,
      precision: "DATE",
    }
  }
  if (source.type === "CURRENT_DATE") {
    return {
      dateKey: dateKeyForInstant(occurredAt, tenantTimezone),
      instant: occurredAt,
      timezone: tenantTimezone,
      precision: "DATE_TIME",
    }
  }
  if (source.type === "RELATIVE_DATE") {
    const currentParts = timezoneParts(occurredAt, tenantTimezone)
    const currentKey = dateKeyForInstant(occurredAt, tenantTimezone)
    const dateKey = addCalendarDateOffset(currentKey, source.amount, source.unit)
    if (!dateKey) throw new Error("The relative date could not be calculated.")
    const time = `${String(currentParts.hour).padStart(2, "0")}:${String(currentParts.minute).padStart(2, "0")}`
    const instant = resolveLocalInstant(dateKey, time, tenantTimezone)
    instant.setUTCSeconds(currentParts.second, 0)
    return { dateKey, instant, timezone: tenantTimezone, precision: "DATE_TIME" }
  }
  if (source.type === "SPECIFIC_DATE") {
    const time = params.dateOnlyTime ?? "00:00"
    return {
      dateKey: source.date,
      instant: resolveLocalInstant(source.date, time, source.timezone),
      timezone: source.timezone,
      precision: "DATE",
    }
  }

  const stored = await resolveStoredDateSource(prismaTx, {
    tenantId: params.tenantId,
    contactId: params.contactId,
    source,
    executionContext: params.executionContext,
  })
  if (!stored) throw new Error("The configured date source is unavailable.")
  if (stored.precision === "DATE_TIME") {
    const instant = stored.raw instanceof Date ? stored.raw : new Date(String(stored.raw))
    if (Number.isNaN(instant.getTime())) throw new Error("The configured contact date is invalid.")
    return {
      dateKey: dateKeyForInstant(instant, tenantTimezone),
      instant,
      timezone: tenantTimezone,
      precision: "DATE_TIME",
    }
  }
  const dateKey = dateOnlyKey(stored.raw)
  if (!dateKey) throw new Error("The configured date field does not contain a valid date.")
  return {
    dateKey,
    instant: resolveLocalInstant(dateKey, params.dateOnlyTime ?? "00:00", tenantTimezone),
    timezone: tenantTimezone,
    precision: "DATE",
  }
}

function ordinal(value: number) {
  const mod100 = value % 100
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`
  if (value % 10 === 1) return `${value}st`
  if (value % 10 === 2) return `${value}nd`
  if (value % 10 === 3) return `${value}rd`
  return `${value}th`
}

function formatPattern(source: ResolvedDateSource, pattern: string) {
  if (pattern === "X") return String(Math.floor(source.instant.getTime() / 1_000))
  const [year, month, day] = source.dateKey.split("-").map(Number)
  const time = timezoneParts(source.instant, source.timezone)
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()
  const hour12 = time.hour % 12 || 12
  const values: Record<string, string> = {
    YYYY: String(year).padStart(4, "0"),
    MMMM: MONTHS_LONG[month! - 1]!,
    MMM: MONTHS_SHORT[month! - 1]!,
    MM: String(month).padStart(2, "0"),
    DD: String(day).padStart(2, "0"),
    Do: ordinal(day!),
    D: String(day),
    dddd: WEEKDAYS_LONG[weekday]!,
    ddd: WEEKDAYS_SHORT[weekday]!,
    HH: String(time.hour).padStart(2, "0"),
    hh: String(hour12).padStart(2, "0"),
    mm: String(time.minute).padStart(2, "0"),
    ss: String(time.second).padStart(2, "0"),
    A: time.hour >= 12 ? "PM" : "AM",
  }
  return pattern.replace(/dddd|ddd|MMMM|MMM|YYYY|MM|DD|Do|D|HH|hh|mm|ss|A/g, (token) => values[token] ?? token)
}

function compareDateKeys(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1
}

function addMonthsClamped(dateKey: string, amount: number) {
  if (amount === 0) return dateKey
  const [year, month, day] = dateKey.split("-").map(Number)
  const monthIndex = year! * 12 + month! - 1 + amount
  const targetYear = Math.floor(monthIndex / 12)
  const targetMonthIndex = ((monthIndex % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate()
  return `${String(targetYear).padStart(4, "0")}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(Math.min(day!, lastDay)).padStart(2, "0")}`
}

function wholeMonths(from: string, to: string): number {
  if (compareDateKeys(from, to) > 0) return -wholeMonths(to, from)
  const [fromYear, fromMonth] = from.split("-").map(Number)
  const [toYear, toMonth] = to.split("-").map(Number)
  let months = (toYear! - fromYear!) * 12 + toMonth! - fromMonth!
  if (compareDateKeys(addMonthsClamped(from, months), to) > 0) months -= 1
  return months
}

function wholeYears(from: string, to: string) {
  const months = wholeMonths(from, to)
  return months < 0 ? -Math.floor(Math.abs(months) / 12) : Math.floor(months / 12)
}

function differenceInDays(from: string, to: string) {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number)
  const [toYear, toMonth, toDay] = to.split("-").map(Number)
  return Math.round(
    (Date.UTC(toYear!, toMonth! - 1, toDay!) - Date.UTC(fromYear!, fromMonth! - 1, fromDay!)) /
      86_400_000,
  )
}

export async function resolveAutomationDateTimeFormatter(
  prismaTx: any,
  params: {
    tenantId: string
    contactId: string
    config: AutomationDateTimeFormatterConfig
    tenantTimezone: string
    occurredAt: Date
    automationValues?: Record<string, unknown>
    executionContext?: ContactTemplateExecutionContext
  },
) {
  const { config } = params
  const automationValues = params.automationValues ?? {}
  if (config.mode === "COMPARE_DATES") {
    const [from, to] = await Promise.all([
      resolveDateSource(prismaTx, { ...params, automationValues, source: config.from }),
      resolveDateSource(prismaTx, { ...params, automationValues, source: config.to }),
    ])
    if (config.unit === "MONTHS") return wholeMonths(from.dateKey, to.dateKey)
    if (config.unit === "YEARS") return wholeYears(from.dateKey, to.dateKey)
    return differenceInDays(from.dateKey, to.dateKey)
  }

  const resolved = await resolveDateSource(prismaTx, {
    ...params,
    automationValues,
    source: config.source,
    dateOnlyTime: config.mode === "DATE_TIME" ? config.time : undefined,
  })
  return formatPattern(resolved, config.format)
}
