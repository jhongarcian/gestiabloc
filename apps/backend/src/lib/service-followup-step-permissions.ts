export type ServiceFollowUpStepAssignmentStatus =
  | "PENDING"
  | "ACTIVE"
  | "COMPLETED"
  | "SKIPPED"
  | "POSTPONED"

export const canChangeServiceFollowUpStepAssignee = (
  status: ServiceFollowUpStepAssignmentStatus,
) => status !== "COMPLETED" && status !== "SKIPPED"
