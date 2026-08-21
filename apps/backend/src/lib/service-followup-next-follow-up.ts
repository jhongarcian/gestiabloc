export type NextFollowUpSource =
  | "USER_SCHEDULED_WAIT"
  | "STEP_DUE"
  | "STEP_AVAILABLE"

export type EffectiveNextFollowUp = {
  at: Date
  stepId: string | null
  source: NextFollowUpSource
  projected: boolean
}

type FollowUpStepLike = {
  id: string
  status?: string | null
  dueAt?: Date | string | null
  availableAt?: Date | string | null
}

type FollowUpRunLike = {
  status?: string | null
  resumeAt?: Date | string | null
}

function validDate(value: Date | string | null | undefined) {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function firstStepWithStatus(steps: FollowUpStepLike[], status: string) {
  return steps.find((step) => step.status === status) ?? null
}

export function resolveEffectiveNextFollowUp(params: {
  steps: FollowUpStepLike[]
  run?: FollowUpRunLike | null
  isUserScheduledWait?: boolean
}): EffectiveNextFollowUp | null {
  const { steps, run, isUserScheduledWait = false } = params
  const scheduledAt = validDate(run?.resumeAt)

  if (run?.status === "WAITING" && isUserScheduledWait && scheduledAt) {
    const projectedStep = firstStepWithStatus(steps, "PENDING")
    return {
      at: scheduledAt,
      stepId: projectedStep?.id ?? null,
      source: "USER_SCHEDULED_WAIT",
      projected: true,
    }
  }

  const currentStep =
    firstStepWithStatus(steps, "ACTIVE") ??
    firstStepWithStatus(steps, "POSTPONED") ??
    firstStepWithStatus(steps, "PENDING")
  if (!currentStep) return null

  const dueAt = validDate(currentStep.dueAt)
  if (dueAt) {
    return {
      at: dueAt,
      stepId: currentStep.id,
      source: "STEP_DUE",
      projected: false,
    }
  }

  const availableAt = validDate(currentStep.availableAt)
  if (!availableAt) return null
  return {
    at: availableAt,
    stepId: currentStep.id,
    source: "STEP_AVAILABLE",
    projected: false,
  }
}

export function serializeEffectiveNextFollowUp(value: EffectiveNextFollowUp | null) {
  return value
    ? {
        ...value,
        at: value.at.toISOString(),
      }
    : null
}

