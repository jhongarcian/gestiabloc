import { z } from "zod"

import { isValidTemplateDate, parseContactTemplate, type ContactTemplateExecutionContext } from "./contact-templates.js"
import { resolveAutomationTaskDateTime, sanitizeTaskMultiline, sanitizeTaskSingleLine, TaskDateSourceSchema } from "./automation-task.js"

const templateSchema = (limit: number, required: boolean, multiline = false) =>
  z.string().max(limit).superRefine((value, context) => {
    for (const issue of parseContactTemplate(value).issues) {
      context.addIssue({ code: "custom", message: issue.message })
    }
  }).transform((value) => multiline ? sanitizeTaskMultiline(value) : sanitizeTaskSingleLine(value))
    .pipe(required ? z.string().min(1).max(limit) : z.string().max(limit))

export const AutomationAppointmentConfigSchema = z.object({
  actionName: z.string().trim().min(1).max(120),
  titleTemplate: templateSchema(160, true),
  notesTemplate: templateSchema(4_000, false, true).nullable().optional(),
  assignee: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("CONTACT_ASSIGNEE") }).strict(),
    z.object({ mode: z.literal("SPECIFIC_USER"), userId: z.string().trim().min(1).max(100) }).strict(),
  ]),
  linkedService: z.object({
    id: z.string().trim().min(1).max(100),
    nameSnapshot: z.string().trim().min(1).max(120),
  }).strict().nullable().optional(),
  startAt: z.object({
    source: z.union([
      TaskDateSourceSchema,
      z.object({ type: z.literal("AUTOMATION_VALUE"), key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/) }).strict(),
    ]),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time."),
  }).strict(),
}).strict()

export type AutomationAppointmentConfig = z.infer<typeof AutomationAppointmentConfigSchema>

export async function resolveAutomationAppointmentStart(
  prismaTx: any,
  params: {
    tenantId: string
    contactId: string
    startAt: AutomationAppointmentConfig["startAt"]
    tenantTimezone: string
    occurredAt: Date
    automationValues: Record<string, unknown>
    executionContext?: ContactTemplateExecutionContext
  },
) {
  const source = params.startAt.source
  if (source.type === "AUTOMATION_VALUE") {
    const value = params.automationValues[source.key]
    if (typeof value !== "string" || !isValidTemplateDate(value)) {
      throw new Error(`The automation date value “${source.key}” is missing or invalid.`)
    }
    return resolveAutomationTaskDateTime(prismaTx, {
      ...params,
      config: {
        source: { type: "SPECIFIC_DATE", date: value, timezone: params.tenantTimezone },
        time: params.startAt.time,
      },
      label: "The appointment start time",
    })
  }
  return resolveAutomationTaskDateTime(prismaTx, {
    ...params,
    config: { source, time: params.startAt.time },
    label: "The appointment start time",
  })
}
