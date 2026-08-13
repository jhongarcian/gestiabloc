export const ONBOARDING_STEPS = [
  "welcome",
  "business-profile",
  "workflow",
  "ready",
] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]
export type OnboardingStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "SKIPPED"
  | "COMPLETED"

export type OnboardingStateAction =
  | { action: "start" }
  | { action: "advance"; step: OnboardingStep }
  | { action: "skip" }
  | { action: "resume" }
  | { action: "complete" }
  | { action: "dismissChecklist" }

export type CurrentOnboardingState = {
  status: OnboardingStatus
  currentStep: string
  startedAt: Date | null
}

export function isOnboardingStep(value: string): value is OnboardingStep {
  return (ONBOARDING_STEPS as readonly string[]).includes(value)
}

export function normalizeOnboardingStep(value: string): OnboardingStep {
  return isOnboardingStep(value) ? value : "welcome"
}

export function buildOnboardingStateUpdate(
  current: CurrentOnboardingState,
  action: OnboardingStateAction,
  now = new Date(),
) {
  if (action.action === "dismissChecklist") {
    return current.status === "SKIPPED"
      ? { onboardingChecklistDismissedAt: now }
      : {}
  }

  if (current.status === "COMPLETED") {
    return {}
  }

  if (action.action === "complete") {
    return {
      onboardingStatus: "COMPLETED" as const,
      onboardingCurrentStep: "ready",
      onboardingStartedAt: current.startedAt ?? now,
      onboardingCompletedAt: now,
      onboardingChecklistDismissedAt: null,
    }
  }

  if (action.action === "skip") {
    return {
      onboardingStatus: "SKIPPED" as const,
      onboardingStartedAt: current.startedAt ?? now,
      onboardingSkippedAt: now,
      onboardingChecklistDismissedAt: null,
    }
  }

  if (action.action === "advance") {
    return {
      onboardingStatus: "IN_PROGRESS" as const,
      onboardingCurrentStep: action.step,
      onboardingStartedAt: current.startedAt ?? now,
      onboardingChecklistDismissedAt: null,
    }
  }

  return {
    onboardingStatus: "IN_PROGRESS" as const,
    onboardingCurrentStep: normalizeOnboardingStep(current.currentStep),
    onboardingStartedAt: current.startedAt ?? now,
    onboardingChecklistDismissedAt: null,
  }
}
