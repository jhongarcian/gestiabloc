import type { AppointmentAutomationStatus, AutomationContactChangeRule, AutomationTriggerType } from "../app/(tenants)/app/[tenantSlug]/account-settings/_components/automation-types"

export type AutomationBuilderTriggerType = Exclude<AutomationTriggerType, "OPPORTUNITY_STAGE_CHANGED">
export type AutomationChangeType = "" | "STAGE_ENTERED" | "RESULT_WON" | "RESULT_LOST"

export type AutomationTriggerDraft = {
  serviceOfferingId?: string | null
  serviceGroupId?: string
  serviceStepId?: string
  triggerType: AutomationBuilderTriggerType | null
  pipelineId: string
  changeType: AutomationChangeType
  targetStageId: string
  changes?: AutomationContactChangeRule[]
  birthdayLocalTime?: string
  appointmentTargetStatus?: AppointmentAutomationStatus | ""
}

type SavedAutomationTrigger =
  | { type: "SERVICE_STEP_ENTERED"; serviceStepId: string; serviceOfferingId?: string | null }
  | { type: "SERVICE_STEP_COMPLETED"; serviceStepId: string; serviceOfferingId?: string | null }
  | { type: "CONTACT_CREATED" }
  | { type: "CONTACT_CHANGED"; changes: AutomationContactChangeRule[] }
  | { type: "CONTACT_TAG"; tagId: string; change: "ADDED" | "REMOVED" }
  | { type: "CONTACT_NOTE_ADDED" }
  | { type: "TASK_ADDED" }
  | { type: "TASK_COMPLETED" }
  | { type: "APPOINTMENT_CREATED" }
  | { type: "APPOINTMENT_STATUS_CHANGED"; status: AppointmentAutomationStatus }
  | { type: "BIRTHDAY_REMINDER"; localTime: string }
  | { type: "OPPORTUNITY_CREATED"; pipelineId: string }
  | { type: "OPPORTUNITY_STAGE_CHANGED"; pipelineId: string; targetStageId: string }
  | {
      type: "OPPORTUNITY_CHANGED"
      pipelineId: string
      change:
        | { type: "STAGE_ENTERED"; stageId: string }
        | { type: "RESULT_CHANGED"; result: "WON" | "LOST" }
    }

export function isAutomationTriggerReady(draft: AutomationTriggerDraft | null) {
  if (!draft?.triggerType) return false
  if ((draft.triggerType === "SERVICE_STEP_ENTERED" || draft.triggerType === "SERVICE_STEP_COMPLETED")) return Boolean(draft.serviceStepId) && (draft.serviceOfferingId === null || Boolean(draft.serviceOfferingId))
  if (draft.triggerType === "CONTACT_CREATED") return true
  if (draft.triggerType === "CONTACT_NOTE_ADDED") return true
  if (draft.triggerType === "TASK_ADDED") return true
  if (draft.triggerType === "TASK_COMPLETED") return true
  if (draft.triggerType === "APPOINTMENT_CREATED") return true
  if (draft.triggerType === "APPOINTMENT_STATUS_CHANGED") return ["SCHEDULED", "CONFIRMED", "SHOW", "NO_SHOW", "CANCELED", "COMPLETED"].includes(draft.appointmentTargetStatus ?? "")
  if (draft.triggerType === "BIRTHDAY_REMINDER") return /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.birthdayLocalTime ?? "09:00")
  if (draft.triggerType === "CONTACT_TAG") {
    return draft.changes?.length === 1 && draft.changes[0]?.source === "CONTACT_TAGS"
      && Boolean(draft.changes[0].tagId) && ["ADDED", "REMOVED"].includes(draft.changes[0].operator)
  }
  if (draft.triggerType === "CONTACT_CHANGED") return Boolean(draft.changes?.length) && draft.changes!.every((rule) => {
    if (rule.source === "CONTACT_FIELD") return Boolean(rule.fieldKey) && (rule.operator !== "HAS_CHANGED_TO" || validTarget(rule.value))
    if (rule.source === "CONTACT_CUSTOM_FIELD") return Boolean(rule.customFieldId) && (rule.operator !== "HAS_CHANGED_TO" || validTarget(rule.value))
    if (rule.source === "CONTACT_STATUS") return rule.operator !== "HAS_CHANGED_TO" || Boolean(rule.statusConfigId)
    if (rule.source === "CONTACT_ASSIGNEE") return rule.operator !== "HAS_CHANGED_TO" || Object.hasOwn(rule, "assignedUserId")
    return true
  })
  if (!draft.pipelineId) return false
  if (draft.triggerType === "OPPORTUNITY_CREATED") return true
  if (!draft.changeType) return false
  return draft.changeType !== "STAGE_ENTERED" || Boolean(draft.targetStageId)
}

function validTarget(value: unknown) {
  if (value === undefined || value === "") return false
  if (typeof value === "number" && !Number.isFinite(value)) return false
  if (Array.isArray(value) && value.length === 0) return false
  return true
}

export function serializeAutomationTrigger(draft: AutomationTriggerDraft) {
  if (!draft.triggerType) throw new Error("Select a trigger.")
  if ((draft.triggerType === "SERVICE_STEP_ENTERED" || draft.triggerType === "SERVICE_STEP_COMPLETED")) {
    if (!isAutomationTriggerReady(draft)) throw new Error("Select a service, sub-service, and step.")
    return { type: draft.triggerType, serviceStepId: draft.serviceStepId!, serviceOfferingId: draft.serviceOfferingId ?? null }
  }
  if (draft.triggerType === "CONTACT_CREATED") return { type: "CONTACT_CREATED" as const }
  if (draft.triggerType === "CONTACT_NOTE_ADDED") return { type: "CONTACT_NOTE_ADDED" as const }
  if (draft.triggerType === "TASK_ADDED") return { type: "TASK_ADDED" as const }
  if (draft.triggerType === "TASK_COMPLETED") return { type: "TASK_COMPLETED" as const }
  if (draft.triggerType === "APPOINTMENT_CREATED") return { type: "APPOINTMENT_CREATED" as const }
  if (draft.triggerType === "APPOINTMENT_STATUS_CHANGED") {
    if (!isAutomationTriggerReady(draft)) throw new Error("Select an appointment status.")
    return { type: "APPOINTMENT_STATUS_CHANGED" as const, status: draft.appointmentTargetStatus as AppointmentAutomationStatus }
  }
  if (draft.triggerType === "BIRTHDAY_REMINDER") return { type: "BIRTHDAY_REMINDER" as const, localTime: draft.birthdayLocalTime ?? "09:00" }
  if (draft.triggerType === "CONTACT_TAG") {
    const rule = draft.changes?.[0]
    if (draft.changes?.length !== 1 || rule?.source !== "CONTACT_TAGS" || !rule.tagId || !["ADDED", "REMOVED"].includes(rule.operator)) {
      throw new Error("Select one tag and whether it is added or removed.")
    }
    return { type: "CONTACT_TAG" as const, tagId: rule.tagId, change: rule.operator }
  }
  if (draft.triggerType === "CONTACT_CHANGED") return { type: "CONTACT_CHANGED" as const, changes: draft.changes ?? [] }
  if (draft.triggerType === "OPPORTUNITY_CREATED") {
    return { type: "OPPORTUNITY_CREATED" as const, pipelineId: draft.pipelineId }
  }
  if (!draft.changeType) throw new Error("Select a change to listen for.")
  if (draft.changeType === "STAGE_ENTERED" && !draft.targetStageId) {
    throw new Error("Select a stage.")
  }
  return {
    type: "OPPORTUNITY_CHANGED" as const,
    pipelineId: draft.pipelineId,
    change: draft.changeType === "STAGE_ENTERED"
      ? { type: "STAGE_ENTERED" as const, stageId: draft.targetStageId }
      : {
          type: "RESULT_CHANGED" as const,
          result: draft.changeType === "RESULT_WON" ? "WON" as const : "LOST" as const,
        },
  }
}

export function hydrateAutomationTrigger(trigger: SavedAutomationTrigger): AutomationTriggerDraft {
  if ((trigger.type === "SERVICE_STEP_ENTERED" || trigger.type === "SERVICE_STEP_COMPLETED")) return { triggerType: trigger.type, serviceStepId: trigger.serviceStepId, serviceOfferingId: trigger.serviceOfferingId ?? null, pipelineId: "", changeType: "", targetStageId: "", changes: [] }
  if (trigger.type === "CONTACT_CREATED") {
    return { triggerType: "CONTACT_CREATED", pipelineId: "", changeType: "", targetStageId: "", changes: [] }
  }
  if (trigger.type === "CONTACT_NOTE_ADDED") {
    return { triggerType: "CONTACT_NOTE_ADDED", pipelineId: "", changeType: "", targetStageId: "", changes: [] }
  }
  if (trigger.type === "TASK_ADDED") {
    return { triggerType: "TASK_ADDED", pipelineId: "", changeType: "", targetStageId: "", changes: [] }
  }
  if (trigger.type === "TASK_COMPLETED") {
    return { triggerType: "TASK_COMPLETED", pipelineId: "", changeType: "", targetStageId: "", changes: [] }
  }
  if (trigger.type === "APPOINTMENT_CREATED") {
    return { triggerType: "APPOINTMENT_CREATED", pipelineId: "", changeType: "", targetStageId: "", changes: [] }
  }
  if (trigger.type === "APPOINTMENT_STATUS_CHANGED") {
    return { triggerType: "APPOINTMENT_STATUS_CHANGED", pipelineId: "", changeType: "", targetStageId: "", changes: [], appointmentTargetStatus: trigger.status }
  }
  if (trigger.type === "BIRTHDAY_REMINDER") {
    return { triggerType: "BIRTHDAY_REMINDER", pipelineId: "", changeType: "", targetStageId: "", changes: [], birthdayLocalTime: trigger.localTime }
  }
  if (trigger.type === "CONTACT_CHANGED") {
    return { triggerType: "CONTACT_CHANGED", pipelineId: "", changeType: "", targetStageId: "", changes: trigger.changes }
  }
  if (trigger.type === "CONTACT_TAG") {
    return { triggerType: "CONTACT_TAG", pipelineId: "", changeType: "", targetStageId: "", changes: [{ source: "CONTACT_TAGS", operator: trigger.change, tagId: trigger.tagId }] }
  }
  if (trigger.type === "OPPORTUNITY_CREATED") {
    return {
      triggerType: "OPPORTUNITY_CREATED",
      pipelineId: trigger.pipelineId,
      changeType: "",
      targetStageId: "",
    }
  }
  if (trigger.type === "OPPORTUNITY_STAGE_CHANGED") {
    return {
      triggerType: "OPPORTUNITY_CHANGED",
      pipelineId: trigger.pipelineId,
      changeType: "STAGE_ENTERED",
      targetStageId: trigger.targetStageId,
    }
  }
  if (trigger.change.type === "STAGE_ENTERED") {
    return {
      triggerType: "OPPORTUNITY_CHANGED",
      pipelineId: trigger.pipelineId,
      changeType: "STAGE_ENTERED",
      targetStageId: trigger.change.stageId,
    }
  }
  return {
    triggerType: "OPPORTUNITY_CHANGED",
    pipelineId: trigger.pipelineId,
    changeType: trigger.change.result === "WON" ? "RESULT_WON" : "RESULT_LOST",
    targetStageId: "",
  }
}
