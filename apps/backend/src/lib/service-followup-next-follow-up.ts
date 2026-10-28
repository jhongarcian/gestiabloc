export type NextFollowUpSource =
  | "STEP_DUE"
  | "STEP_AVAILABLE"

export type EffectiveNextFollowUp = {
  at: Date
  stepId: string | null
  source: NextFollowUpSource
  projected: boolean
}

export const FOLLOW_UP_LIST_SERVICE_STATUSES = [
  "IN_PROGRESS",
  "PENDING_PAYMENT",
  "COMPLETED",
] as const

export function isFollowUpListServiceStatus(status: string) {
  return (FOLLOW_UP_LIST_SERVICE_STATUSES as readonly string[]).includes(status)
}

type FollowUpStepLike = {
  id: string
  status?: string | null
  dueAt?: Date | string | null
  availableAt?: Date | string | null
}

const TERMINAL_FOLLOW_UP_STEP_STATUSES = new Set(["COMPLETED", "SKIPPED"])

export function selectFollowUpListStep(params: {
  steps: FollowUpStepLike[]
  effectiveNextFollowUp?: EffectiveNextFollowUp | null
  status?: string | null
}) {
  const { steps, effectiveNextFollowUp, status } = params
  const effectiveStep = effectiveNextFollowUp?.stepId
    ? steps.find((step) => step.id === effectiveNextFollowUp.stepId) ?? null
    : null

  if (status) {
    if (effectiveStep?.status === status) return effectiveStep
    const matchingSteps = steps.filter((step) => step.status === status)
    return TERMINAL_FOLLOW_UP_STEP_STATUSES.has(status)
      ? matchingSteps[matchingSteps.length - 1] ?? null
      : matchingSteps[0] ?? null
  }

  const activeStep = firstStepWithStatus(steps, "ACTIVE")
  if (activeStep) return activeStep

  const postponedStep = firstStepWithStatus(steps, "POSTPONED")
  if (postponedStep) return postponedStep

  if (effectiveStep?.status === "PENDING") return effectiveStep

  const pendingStep = firstStepWithStatus(steps, "PENDING")
  if (pendingStep) return pendingStep

  const terminalSteps = steps.filter((step) =>
    TERMINAL_FOLLOW_UP_STEP_STATUSES.has(step.status ?? ""),
  )
  return terminalSteps[terminalSteps.length - 1] ?? null
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
}): EffectiveNextFollowUp | null {
  const { steps } = params
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

export function canCompleteFollowUpStepNow(params: {
  step: { id: string; status?: string | null }
  firstUnresolvedStepId: string | null
}): boolean {
  const { step, firstUnresolvedStepId } = params
  return ["ACTIVE", "PENDING", "POSTPONED"].includes(step.status ?? "") && firstUnresolvedStepId === step.id
}
