export const ENROLLMENT_SERVICE_TRIGGER_LABELS = {
  SERVICE_ENROLLED: "Enrollment created", SERVICE_STATUS_CHANGED: "Service status changed",
  SERVICE_CHECKLIST_STATUS_CHANGED: "Checklist status changed", SERVICE_PAYMENT_CHANGED: "Payment changed",
} as const
export type EnrollmentServiceTriggerType = keyof typeof ENROLLMENT_SERVICE_TRIGGER_LABELS
export type ServiceTriggerConfig = {
  previousStatus?: string | null; status?: string | null; checklistItemId?: string | null
  changes?: Array<"ADDED" | "UPDATED" | "REMOVED">; paymentState?: "UNPAID" | "PARTIAL" | "PAID" | null
}
export type EnrollmentServiceTrigger = { type: EnrollmentServiceTriggerType; serviceGroupId: string; serviceOfferingId: string | null; serviceTriggerConfig: ServiceTriggerConfig }
export const isEnrollmentServiceTrigger = (type?: string | null): type is EnrollmentServiceTriggerType => Boolean(type && Object.hasOwn(ENROLLMENT_SERVICE_TRIGGER_LABELS, type))
export const isServiceTrigger = (type?: string | null) => Boolean(type?.startsWith("SERVICE_STEP_") || isEnrollmentServiceTrigger(type))
export const isEnrollmentServiceAction = (type: string) => ["SET_SERVICE_COORDINATOR", "SET_SERVICE_PROFESSIONAL", "SET_SERVICE_CHECKLIST_STATUS", "SET_SERVICE_STATUS"].includes(type)
export function defaultServiceTriggerConfig(type: string): ServiceTriggerConfig {
  if (type === "SERVICE_PAYMENT_CHANGED") return { changes: ["ADDED", "UPDATED", "REMOVED"], paymentState: null }
  if (type === "SERVICE_CHECKLIST_STATUS_CHANGED") return { checklistItemId: null, previousStatus: null, status: null }
  if (type === "SERVICE_STATUS_CHANGED") return { previousStatus: null, status: null }
  return {}
}
export function canonicalServiceTriggerConfig(type: string, config: ServiceTriggerConfig = {}): ServiceTriggerConfig {
  if (type === "SERVICE_PAYMENT_CHANGED") return { changes: config.changes ?? ["ADDED", "UPDATED", "REMOVED"], paymentState: config.paymentState ?? null }
  if (type === "SERVICE_CHECKLIST_STATUS_CHANGED") return { checklistItemId: config.checklistItemId || null, previousStatus: config.previousStatus || null, status: config.status || null }
  if (type === "SERVICE_STATUS_CHANGED") return { previousStatus: config.previousStatus || null, status: config.status || null }
  return {}
}
