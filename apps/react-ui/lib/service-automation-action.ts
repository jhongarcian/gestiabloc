import type { StepDeadlineSchedule } from "./service-step-deadline"

export const SERVICE_ACTION_LABELS = {
  MOVE_SERVICE_STEP: "Move to step", COMPLETE_SERVICE_STEP: "Complete step", SKIP_SERVICE_STEP: "Skip step",
  SCHEDULE_SERVICE_STEP: "Schedule step", SET_SERVICE_STEP_OWNER: "Assign step owner",
  SET_SERVICE_COORDINATOR: "Assign coordinator", SET_SERVICE_PROFESSIONAL: "Assign professional",
  SET_SERVICE_CHECKLIST_STATUS: "Update checklist item", SET_SERVICE_STATUS: "Change service status",
} as const
export type ServiceActionType = keyof typeof SERVICE_ACTION_LABELS
export type ServiceActionConfig = {
  targetSourceStepId?: string; reason?: string; schedule?: StepDeadlineSchedule
  assignedToUserId?: string | null; professionalId?: string | null; checklistItemId?: string
  status?: "NOT_RECEIVED" | "INFORMED" | "MISSING" | "RECEIVED" | "IN_PROGRESS" | "CANCELED"
}
export type ServiceActionOffering = {
  id: string; name: string; steps: Array<{ id: string; name: string }>
  checklistItems: Array<{ id: string; name: string }>; professionals: Array<{ id: string; name: string }>
}
export type ServiceActionOptions = Pick<ServiceActionOffering, "steps" | "checklistItems" | "professionals">
export const isServiceAutomationAction = (type: string): type is ServiceActionType => Object.hasOwn(SERVICE_ACTION_LABELS, type)
export function serviceActionPickerOptions(offerings: ServiceActionOffering[], stepId?: string, offeringId?: string | null): ServiceActionOptions {
  const eligible = offerings.filter(offering => (!offeringId || offering.id === offeringId) && offering.steps.some(step => step.id === stepId))
  const common = (key: keyof ServiceActionOptions) => (eligible[0]?.[key] ?? []).filter(item => eligible.every(offering => offering[key].some(option => option.id === item.id)))
  return { steps: common("steps"), checklistItems: common("checklistItems"), professionals: common("professionals") }
}
export function terminalServiceAction(action: { type: string; serviceConfig?: ServiceActionConfig | null }) {
  return ["MOVE_SERVICE_STEP", "SKIP_SERVICE_STEP", "COMPLETE_SERVICE_STEP"].includes(action.type)
    || (action.type === "SET_SERVICE_STATUS" && action.serviceConfig?.status === "CANCELED")
}
export function serializeServiceConfig(type: string, config: ServiceActionConfig = {}): ServiceActionConfig {
  switch (type) {
    case "MOVE_SERVICE_STEP": return { targetSourceStepId: config.targetSourceStepId, reason: config.reason }
    case "SKIP_SERVICE_STEP": return { reason: config.reason }
    case "COMPLETE_SERVICE_STEP": return {}
    case "SCHEDULE_SERVICE_STEP": return { schedule: config.schedule }
    case "SET_SERVICE_STEP_OWNER": case "SET_SERVICE_COORDINATOR": return { assignedToUserId: config.assignedToUserId ?? null }
    case "SET_SERVICE_PROFESSIONAL": return { professionalId: config.professionalId ?? null }
    case "SET_SERVICE_CHECKLIST_STATUS": return { checklistItemId: config.checklistItemId, status: config.status }
    case "SET_SERVICE_STATUS": return { status: config.status }
    default: return {}
  }
}
export function serviceActionReady(action: { type: string; serviceConfig?: ServiceActionConfig | null }, options: ServiceActionOptions, triggerType?: string | null) {
  if (!triggerType?.startsWith("SERVICE_STEP_") || !action.serviceConfig) return false
  const config = action.serviceConfig
  if (action.type === "MOVE_SERVICE_STEP") return Boolean(options.steps.some(step => step.id === config.targetSourceStepId) && config.reason?.trim())
  if (action.type === "SKIP_SERVICE_STEP") return Boolean(config.reason?.trim())
  if (action.type === "SET_SERVICE_PROFESSIONAL") return !config.professionalId || options.professionals.some(item => item.id === config.professionalId)
  if (action.type === "SET_SERVICE_CHECKLIST_STATUS") return options.checklistItems.some(item => item.id === config.checklistItemId) && ["NOT_RECEIVED", "INFORMED", "MISSING", "RECEIVED"].includes(config.status ?? "")
  if (action.type === "SET_SERVICE_STATUS") return ["IN_PROGRESS", "CANCELED"].includes(config.status ?? "")
  if (action.type === "SCHEDULE_SERVICE_STEP") {
    const schedule = config.schedule
    if (!schedule) return false
    if (schedule.mode === "DURATION") return Number.isSafeInteger(schedule.amount) && schedule.amount > 0 && schedule.amount * { MINUTES: 60000, HOURS: 3600000, DAYS: 86400000 }[schedule.unit] <= 3650 * 86400000
    return schedule.mode === "DEFAULT" || Number.isFinite(new Date(schedule.dateTime).getTime())
  }
  return true
}
