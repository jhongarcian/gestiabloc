import { z } from "zod"

import { addCalendarDateOffset } from "./calendar-date.js"
import {
  isValidTemplateDate,
  parseContactTemplate,
  resolveContactDateValue,
} from "./contact-templates.js"
import { zonedDateTimeToUtc } from "./timezone-date-time.js"

const stripHtmlTags = (value: string) => value.replace(/<[^>]*>/g, " ")
const removeUnsafeControls = (value: string) =>
  value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")

export const sanitizeTaskSingleLine = (value: string) =>
  removeUnsafeControls(stripHtmlTags(value)).replace(/\s+/g, " ").trim()

export const sanitizeTaskMultiline = (value: string) =>
  removeUnsafeControls(stripHtmlTags(value))
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .trim()

function templateSchema(maxLength: number, required: boolean, multiline = false) {
  const schema = z.string().max(maxLength).superRefine((value, context) => {
    for (const issue of parseContactTemplate(value).issues) {
      context.addIssue({ code: "custom", message: issue.message })
    }
  })

  return schema.transform((value) =>
    multiline ? sanitizeTaskMultiline(value) : sanitizeTaskSingleLine(value),
  ).pipe(required ? z.string().min(1).max(maxLength) : z.string().max(maxLength))
}

const TaskNameTemplateSchema = templateSchema(160, true)
const TaskDescriptionTemplateSchema = templateSchema(4_000, false, true)
const TaskReminderMessageTemplateSchema = templateSchema(500, false, true)

const TaskDateSourceSchema = z.discriminatedUnion("type", [
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

const TaskDateTimeSchema = z.object({
  source: TaskDateSourceSchema,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time."),
}).strict()

const TaskAssigneeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("UNASSIGNED") }).strict(),
  z.object({ mode: z.literal("CONTACT_ASSIGNEE") }).strict(),
  z.object({
    mode: z.literal("SPECIFIC_USER"),
    userId: z.string().trim().min(1).max(100),
  }).strict(),
])

export const AutomationTaskConfigSchema = z.object({
  nameTemplate: TaskNameTemplateSchema,
  descriptionTemplate: TaskDescriptionTemplateSchema.nullable().optional(),
  statusConfigId: z.string().trim().min(1).max(100),
  assignee: TaskAssigneeSchema,
  linkedService: z.object({
    id: z.string().trim().min(1).max(100),
    nameSnapshot: z.string().trim().min(1).max(120),
  }).strict().nullable().optional(),
  dueAt: TaskDateTimeSchema.nullable().optional(),
  reminder: z.object({
    at: TaskDateTimeSchema,
    messageTemplate: TaskReminderMessageTemplateSchema.nullable().optional(),
  }).strict().nullable().optional(),
}).strict().superRefine((config, context) => {
  if (config.reminder && !config.dueAt) {
    context.addIssue({
      code: "custom",
      path: ["dueAt"],
      message: "Set a due date before adding a reminder.",
    })
  }
  if (config.reminder && config.assignee.mode === "UNASSIGNED") {
    context.addIssue({
      code: "custom",
      path: ["assignee"],
      message: "A reminder requires a task assignee.",
    })
  }
})

export type AutomationTaskConfig = z.infer<typeof AutomationTaskConfigSchema>
export type AutomationTaskDateTime = NonNullable<AutomationTaskConfig["dueAt"]>

export function taskConfigCustomFieldKeys(config: AutomationTaskConfig) {
  const keys = new Set<string>()
  for (const template of [
    config.nameTemplate,
    config.descriptionTemplate ?? "",
    config.reminder?.messageTemplate ?? "",
  ]) {
    for (const token of parseContactTemplate(template).tokens) {
      if (token.source === "CUSTOM_FIELD") keys.add(token.key)
    }
  }
  for (const dateTime of [config.dueAt, config.reminder?.at]) {
    if (dateTime?.source.type === "CUSTOM_FIELD") keys.add(dateTime.source.key)
  }
  return [...keys]
}

function localDateTimeMatches(
  date: Date,
  timezone: string,
  expected: { year: number; month: number; day: number; hour: number; minute: number },
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? -1)
  return part("year") === expected.year &&
    part("month") === expected.month &&
    part("day") === expected.day &&
    part("hour") === expected.hour &&
    part("minute") === expected.minute
}

export async function resolveAutomationTaskDateTime(
  prismaTx: any,
  params: {
    tenantId: string
    contactId: string
    config: AutomationTaskDateTime
    tenantTimezone: string
    occurredAt: Date
    label: string
  },
) {
  const dateKey = params.config.source.type === "RELATIVE_DATE"
    ? addCalendarDateOffset(
        await resolveContactDateValue(prismaTx, {
          tenantId: params.tenantId,
          contactId: params.contactId,
          source: { type: "CURRENT_DATE" },
          timezone: params.tenantTimezone,
          occurredAt: params.occurredAt,
        }) ?? "",
        params.config.source.amount,
        params.config.source.unit,
      )
    : await resolveContactDateValue(prismaTx, {
        tenantId: params.tenantId,
        contactId: params.contactId,
        source: params.config.source,
        timezone: params.tenantTimezone,
        occurredAt: params.occurredAt,
      })
  if (!dateKey) {
    throw new Error(`${params.label} could not be resolved because its configured date is empty or unavailable.`)
  }

  const [year, month, day] = dateKey.split("-").map(Number)
  const [hour, minute] = params.config.time.split(":").map(Number)
  const timezone = params.config.source.type === "SPECIFIC_DATE"
    ? params.config.source.timezone
    : params.tenantTimezone
  let resolved: Date
  try {
    resolved = zonedDateTimeToUtc(timezone, year!, month!, day!, hour!, minute!, 0)
  } catch {
    throw new Error(`${params.label} uses an invalid timezone.`)
  }
  if (!localDateTimeMatches(resolved, timezone, { year: year!, month: month!, day: day!, hour: hour!, minute: minute! })) {
    throw new Error(`${params.label} falls on a local time that does not exist in ${timezone}.`)
  }
  return resolved
}
