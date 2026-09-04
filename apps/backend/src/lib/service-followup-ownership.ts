export type ServiceFollowUpOwnershipStepStatus =
  | "PENDING"
  | "ACTIVE"
  | "COMPLETED"
  | "SKIPPED"
  | "POSTPONED"

export type ServiceFollowUpOwnershipRunStatus =
  | "RUNNING"
  | "WAITING"
  | "AWAITING_STEP"
  | "COMPLETED"
  | "FAILED"
  | "NEEDS_REVIEW"
  | "CANCELED"

export function isServiceFollowUpWorkflowCompleted(params: {
  runStatus?: ServiceFollowUpOwnershipRunStatus | null
  stepStatuses: ServiceFollowUpOwnershipStepStatus[]
}) {
  if (params.runStatus === "COMPLETED") return true
  if (params.stepStatuses.length === 0) return false
  return params.stepStatuses.every((status) =>
    status === "COMPLETED" || status === "SKIPPED",
  )
}

export function resolveUnanimousFollowUpCoordinator(
  steps: Array<{
    status: ServiceFollowUpOwnershipStepStatus
    assignedToUserId: string | null
  }>,
) {
  const openSteps = steps.filter(
    (step) => step.status !== "COMPLETED" && step.status !== "SKIPPED",
  )
  const relevantSteps = openSteps.length > 0 ? openSteps : steps
  if (relevantSteps.length === 0) return null

  const firstUserId = relevantSteps[0]?.assignedToUserId ?? null
  if (!firstUserId) return null
  return relevantSteps.every((step) => step.assignedToUserId === firstUserId)
    ? firstUserId
    : null
}

export function buildFollowUpStepResolutionUpdate(params: {
  action?: "REOPEN"
  nextStatus?: ServiceFollowUpOwnershipStepStatus
  completedAtProvided?: boolean
  completedAtValue?: string | null
  actorUserId: string
  now: Date
}) {
  if (params.action === "REOPEN") {
    return {
      resolvedByUserId: null,
      resolvedAt: null,
    }
  }

  const isResolvedStatus =
    params.nextStatus === "COMPLETED" || params.nextStatus === "SKIPPED"
  const isLegacyCompletion =
    params.completedAtProvided && Boolean(params.completedAtValue)

  if (isResolvedStatus || isLegacyCompletion) {
    return {
      resolvedByUserId: params.actorUserId,
      resolvedAt: params.now,
    }
  }

  if (params.nextStatus !== undefined || params.completedAtProvided) {
    return {
      resolvedByUserId: null,
      resolvedAt: null,
    }
  }

  return {}
}
