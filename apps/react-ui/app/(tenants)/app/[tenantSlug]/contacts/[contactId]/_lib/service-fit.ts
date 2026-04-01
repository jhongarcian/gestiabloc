export type ServiceFitScanItem = {
  serviceId: string
  serviceName: string
  description: string | null
  fitProfile: {
    enabled: boolean
    summary: string
  }
  eligibilityStatus: "ELIGIBLE" | "NEEDS_INFO" | "NOT_ELIGIBLE"
  fitScore: number
  matchedRules: Array<{ ruleId: string; label: string; reason: string }>
  blockingRules: Array<{ ruleId: string; label: string; reason: string }>
  missingRules: Array<{ ruleId: string; label: string; reason: string }>
  summary: string
  explanation: string | null
  explanationSource: "ai" | "deterministic"
  configurationGapNotes: string[]
  recommendedUpdates: string[]
  hasPurchased: boolean
  hasActiveEnrollment: boolean
  currentContactServiceId: string | null
  currentContactServiceStatus:
    | "IN_PROGRESS"
    | "PENDING_PAYMENT"
    | "COMPLETED"
    | "CANCELED"
    | null
}

export type ServiceFitScanResponse = {
  ok: boolean
  items: ServiceFitScanItem[]
}

export const FIT_STATUS_STYLES = {
  ELIGIBLE: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  NEEDS_INFO: "border border-amber-200 bg-amber-50 text-amber-700",
  NOT_ELIGIBLE: "border border-rose-200 bg-rose-50 text-rose-700",
} as const

export function toSentence(value: string) {
  return value.toLowerCase().replace(/_/g, " ")
}

function dedupe(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function buildReviewedFacts(items: ServiceFitScanItem[]) {
  const labels = dedupe(
    items.flatMap((item) => [
      ...item.matchedRules.map((rule) => rule.label),
      ...item.blockingRules.map((rule) => rule.label),
      ...item.missingRules.map((rule) => rule.label),
    ]),
  )

  return labels.slice(0, 6)
}

export function buildQualificationNextSteps(items: ServiceFitScanItem[]) {
  const eligibleCount = items.filter((item) => item.eligibilityStatus === "ELIGIBLE").length
  const needsInfoItems = items.filter((item) => item.eligibilityStatus === "NEEDS_INFO")
  const recommendedUpdates = dedupe(
    needsInfoItems.flatMap((item) => item.recommendedUpdates),
  ).slice(0, 4)

  const steps: string[] = []

  if (eligibleCount > 0) {
    steps.push(
      eligibleCount === 1
        ? "You can move forward with 1 service right now."
        : `You can move forward with ${eligibleCount} services right now.`,
    )
  }

  if (recommendedUpdates.length > 0) {
    steps.push(...recommendedUpdates)
  }

  const activeEnrollments = items.filter((item) => item.hasActiveEnrollment).length
  if (activeEnrollments > 0) {
    steps.push(
      activeEnrollments === 1
        ? "1 service is already active for this contact. Review it before starting another transaction."
        : `${activeEnrollments} services are already active for this contact. Review them before starting another transaction.`,
    )
  }

  if (steps.length === 0) {
    steps.push("No services are ready yet. Review the blockers below and update the contact details.")
  }

  return steps
}

export function groupServiceFitResults(items: ServiceFitScanItem[]) {
  return {
    eligible: items.filter((item) => item.eligibilityStatus === "ELIGIBLE"),
    needsInfo: items.filter((item) => item.eligibilityStatus === "NEEDS_INFO"),
    notEligible: items.filter((item) => item.eligibilityStatus === "NOT_ELIGIBLE"),
  }
}

export function getEnrollmentSummary(item: ServiceFitScanItem) {
  if (item.currentContactServiceStatus === "IN_PROGRESS") {
    return {
      label: "Already in progress",
      detail: "This service already has an active transaction for this contact.",
    }
  }

  if (item.currentContactServiceStatus === "PENDING_PAYMENT") {
    return {
      label: "Pending payment",
      detail: "This service is already active and waiting for payment completion.",
    }
  }

  if (item.currentContactServiceStatus === "COMPLETED") {
    return {
      label: "Previously completed",
      detail: "This service has already been purchased and completed for this contact.",
    }
  }

  if (item.currentContactServiceStatus === "CANCELED") {
    return {
      label: "Previously canceled",
      detail: "There is a canceled transaction for this service on this contact record.",
    }
  }

  return null
}
