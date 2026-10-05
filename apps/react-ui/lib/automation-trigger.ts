import type { AutomationTriggerType } from "../app/(tenants)/app/[tenantSlug]/account-settings/_components/automation-types"

export type AutomationBuilderTriggerType = Exclude<AutomationTriggerType, "OPPORTUNITY_STAGE_CHANGED">
export type AutomationChangeType = "" | "STAGE_ENTERED" | "RESULT_WON" | "RESULT_LOST"

export type AutomationTriggerDraft = {
  triggerType: AutomationBuilderTriggerType | null
  pipelineId: string
  changeType: AutomationChangeType
  targetStageId: string
}

type SavedAutomationTrigger =
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
  if (!draft?.triggerType || !draft.pipelineId) return false
  if (draft.triggerType === "OPPORTUNITY_CREATED") return true
  if (!draft.changeType) return false
  return draft.changeType !== "STAGE_ENTERED" || Boolean(draft.targetStageId)
}

export function serializeAutomationTrigger(draft: AutomationTriggerDraft) {
  if (!draft.triggerType) throw new Error("Select a trigger.")
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
