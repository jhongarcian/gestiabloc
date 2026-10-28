import { z } from "zod"

export const ENROLLMENT_TRIGGER_TYPES = ["SERVICE_ENROLLED", "SERVICE_STATUS_CHANGED", "SERVICE_CHECKLIST_STATUS_CHANGED", "SERVICE_PAYMENT_CHANGED"] as const
export const SERVICE_TRIGGER_TYPES = ["SERVICE_STEP_ENTERED", "SERVICE_STEP_COMPLETED", ...ENROLLMENT_TRIGGER_TYPES] as const
export const ENROLLMENT_SERVICE_ACTIONS = ["SET_SERVICE_COORDINATOR", "SET_SERVICE_PROFESSIONAL", "SET_SERVICE_CHECKLIST_STATUS", "SET_SERVICE_STATUS"] as const
export const isEnrollmentServiceTrigger = (type: string) => (ENROLLMENT_TRIGGER_TYPES as readonly string[]).includes(type)
export const isServiceTrigger = (type: string) => (SERVICE_TRIGGER_TYPES as readonly string[]).includes(type)
export const isEnrollmentServiceAction = (type: string) => (ENROLLMENT_SERVICE_ACTIONS as readonly string[]).includes(type)

const status = z.enum(["IN_PROGRESS", "PENDING_PAYMENT", "COMPLETED", "CANCELED"])
const checklistStatus = z.enum(["NOT_RECEIVED", "INFORMED", "MISSING", "RECEIVED"])
const scope = { serviceGroupId: z.uuid(), serviceOfferingId: z.uuid().nullable() }
export const EnrollmentServiceTriggerSchemas = [
  z.object({ type: z.literal("SERVICE_ENROLLED"), ...scope, serviceTriggerConfig: z.object({}).strict() }).strict(),
  z.object({ type: z.literal("SERVICE_STATUS_CHANGED"), ...scope, serviceTriggerConfig: z.object({ previousStatus: status.nullable(), status: status.nullable() }).strict() }).strict(),
  z.object({ type: z.literal("SERVICE_CHECKLIST_STATUS_CHANGED"), ...scope, serviceTriggerConfig: z.object({ checklistItemId: z.uuid().nullable(), previousStatus: checklistStatus.nullable(), status: checklistStatus.nullable() }).strict() }).strict(),
  z.object({ type: z.literal("SERVICE_PAYMENT_CHANGED"), ...scope, serviceTriggerConfig: z.object({ changes: z.array(z.enum(["ADDED", "UPDATED", "REMOVED"])).min(1).max(3).refine(items => new Set(items).size === items.length), paymentState: z.enum(["UNPAID", "PARTIAL", "PAID"]).nullable() }).strict() }).strict(),
] as const
export const EnrollmentServiceTriggerSchema = z.discriminatedUnion("type", EnrollmentServiceTriggerSchemas)
export type EnrollmentServiceTrigger = z.infer<typeof EnrollmentServiceTriggerSchema>

export type ServiceEventSnapshot = {
  schemaVersion: 1
  revision: number
  occurredAt: string
  serviceGroupId: string
  serviceGroupName: string
  serviceOfferingId: string
  serviceOfferingName: string
  contactServiceId: string
  recordId: string | null
  checklistItemId: string | null
  itemLabel: string | null
  change: "ADDED" | "UPDATED" | "REMOVED" | null
  isInitialPayment: boolean
  previous: Record<string, unknown> | null
  next: Record<string, unknown> | null
  financials: { totalPriceCents: number; paidCents: number; remainingCents: number; paymentState: "UNPAID" | "PARTIAL" | "PAID"; currency: string }
  automationSource: { automationId?: string | null; automationName?: string | null; runId?: string; nodeKey?: string | null } | null
}

export function matchesServiceEventTrigger(trigger: EnrollmentServiceTrigger, event: ServiceEventSnapshot) {
  if (trigger.serviceGroupId !== event.serviceGroupId || (trigger.serviceOfferingId && trigger.serviceOfferingId !== event.serviceOfferingId)) return false
  const config = trigger.serviceTriggerConfig
  if (trigger.type === "SERVICE_ENROLLED") return true
  if (trigger.type === "SERVICE_PAYMENT_CHANGED") return trigger.serviceTriggerConfig.changes.includes(event.change!) && (!trigger.serviceTriggerConfig.paymentState || trigger.serviceTriggerConfig.paymentState === event.financials.paymentState)
  if (trigger.type === "SERVICE_CHECKLIST_STATUS_CHANGED" && trigger.serviceTriggerConfig.checklistItemId && trigger.serviceTriggerConfig.checklistItemId !== event.checklistItemId) return false
  return (!('previousStatus' in config) || !config.previousStatus || config.previousStatus === event.previous?.status)
    && (!('status' in config) || !config.status || config.status === event.next?.status)
}

export function serviceEventDetails(type: string, event: ServiceEventSnapshot) {
  const service = `${event.serviceGroupName} / ${event.serviceOfferingName}`
  const label = (value: unknown) => String(value ?? "None").toLowerCase().replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase())
  if (type === "SERVICE_ENROLLED") return `Enrolled in ${service}.`
  if (type === "SERVICE_PAYMENT_CHANGED") {
    const money = (value: unknown) => typeof value === "number" ? new Intl.NumberFormat("en-US", { style: "currency", currency: event.financials.currency }).format(value / 100) : "None"
    const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "None"
    const changes = [
      ["amountCents", "Amount", money], ["paidAt", "Payment date", date],
      ["paymentMethod", "Method", label], ["note", "Note", (value: unknown) => String(value ?? "None")],
    ] as const
    const details = changes.filter(([key]) => event.previous?.[key] !== event.next?.[key]).map(([key, title, format]) => `${title}: ${format(event.previous?.[key])} → ${format(event.next?.[key])}`).join("; ")
    const balance = { UNPAID: "unpaid", PARTIAL: "partly paid", PAID: "paid in full" }[event.financials.paymentState]
    return `Payment ${event.change === "UPDATED" ? "edited" : event.change?.toLowerCase()} for ${service}. ${details}. Remaining: ${money(event.financials.remainingCents)} (${balance}).`.slice(0, 4000)
  }
  return `${type === "SERVICE_CHECKLIST_STATUS_CHANGED" ? `${event.itemLabel ?? "Checklist item"}: ` : `${service}: `}${label(event.previous?.status)} → ${label(event.next?.status)}.`
}
