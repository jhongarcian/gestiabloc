export type ServiceOverviewPriorityTone = "ROSE" | "AMBER" | "BLUE" | "EMERALD" | "SLATE"
export type ServiceOverviewPriorityAction = "FOLLOW_UP" | "CHECKLIST"

export type ServiceOverviewPriority = {
  kind:
    | "WORKFLOW_ATTENTION"
    | "OVERDUE_FOLLOW_UP"
    | "MISSING_REQUIREMENTS"
    | "NEXT_FOLLOW_UP"
    | "FOLLOW_UP_COMPLETE"
    | "NO_WORKFLOW"
  tone: ServiceOverviewPriorityTone
  badge: string
  title: string
  description: string
  dateAt: string | null
  action: ServiceOverviewPriorityAction
  actionLabel: string
}

type PriorityFollowUpStep = {
  title: string
  status: "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED" | "POSTPONED"
  dueAt: string | null
}

type GetServiceOverviewPriorityInput = {
  followUpRunStatus?:
    | "RUNNING"
    | "WAITING"
    | "AWAITING_STEP"
    | "COMPLETED"
    | "FAILED"
    | "NEEDS_REVIEW"
    | "CANCELED"
    | null
  failureMessage?: string | null
  failedAt?: string | null
  followUpSteps: PriorityFollowUpStep[]
  completedStepCount: number
  requiredMissingCount: number
  nextFollowUpAt?: string | null
  nowMs?: number
}

const OPEN_STEP_STATUSES = new Set(["ACTIVE", "PENDING", "POSTPONED"])

function isPast(value: string | null, nowMs: number) {
  if (!value) return false
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp < nowMs
}

export function getServiceOverviewPriority({
  followUpRunStatus,
  failureMessage,
  failedAt,
  followUpSteps,
  completedStepCount,
  requiredMissingCount,
  nextFollowUpAt,
  nowMs = Date.now(),
}: GetServiceOverviewPriorityInput): ServiceOverviewPriority {
  if (followUpRunStatus === "FAILED" || followUpRunStatus === "NEEDS_REVIEW") {
    return {
      kind: "WORKFLOW_ATTENTION",
      tone: "ROSE",
      badge: "Needs attention",
      title:
        followUpRunStatus === "FAILED"
          ? "Follow-up workflow is paused"
          : "Follow-up workflow needs review",
      description:
        failureMessage?.trim() ||
        "Review the follow-up workflow before continuing work on this service.",
      dateAt: failedAt ?? null,
      action: "FOLLOW_UP",
      actionLabel: "Open follow-ups",
    }
  }

  const overdueStep = followUpSteps.find(
    (step) => OPEN_STEP_STATUSES.has(step.status) && isPast(step.dueAt, nowMs),
  )
  if (overdueStep) {
    return {
      kind: "OVERDUE_FOLLOW_UP",
      tone: "ROSE",
      badge: "Overdue",
      title: overdueStep.title,
      description: "This follow-up step is past its due date and needs attention.",
      dateAt: overdueStep.dueAt,
      action: "FOLLOW_UP",
      actionLabel: "Open follow-ups",
    }
  }

  if (requiredMissingCount > 0) {
    return {
      kind: "MISSING_REQUIREMENTS",
      tone: "AMBER",
      badge: "Requirements blocked",
      title: `${requiredMissingCount} required item${requiredMissingCount === 1 ? " is" : "s are"} missing`,
      description: "Review the missing requirements before moving this service forward.",
      dateAt: null,
      action: "CHECKLIST",
      actionLabel: "Open checklist",
    }
  }

  const nextStep = followUpSteps.find((step) => OPEN_STEP_STATUSES.has(step.status))
  if (nextStep) {
    return {
      kind: "NEXT_FOLLOW_UP",
      tone: "BLUE",
      badge: "Next action",
      title: nextStep.title,
      description:
        nextStep.status === "POSTPONED"
          ? "This follow-up is postponed and ready for review at the scheduled time."
          : "Continue with the next open step in the enrolled follow-up workflow.",
      dateAt: nextFollowUpAt ?? nextStep.dueAt,
      action: "FOLLOW_UP",
      actionLabel: "Open follow-ups",
    }
  }

  if (followUpSteps.length > 0 && completedStepCount >= followUpSteps.length) {
    return {
      kind: "FOLLOW_UP_COMPLETE",
      tone: "EMERALD",
      badge: "Complete",
      title: "Follow-up workflow is complete",
      description: "Every enrolled follow-up step has been completed or skipped.",
      dateAt: null,
      action: "FOLLOW_UP",
      actionLabel: "Review follow-ups",
    }
  }

  return {
    kind: "NO_WORKFLOW",
    tone: "SLATE",
    badge: "Not configured",
    title: "No follow-up workflow is enrolled",
    description: "There are no follow-up steps attached to this service enrollment.",
    dateAt: null,
    action: "FOLLOW_UP",
    actionLabel: "View follow-ups",
  }
}
