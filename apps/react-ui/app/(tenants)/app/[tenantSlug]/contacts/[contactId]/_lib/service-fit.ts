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

function joinPhrases(values: string[]) {
  if (values.length === 0) return ""
  if (values.length === 1) return values[0]
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`
}

function humanizeRuleReason(reason: string) {
  const trimmed = reason.trim()
  if (!trimmed) return ""

  const presentMatch = trimmed.match(/^(.+?) is present\.$/i)
  if (presentMatch) {
    return `${presentMatch[1]} is already on file`
  }

  const notEmptyMatch = trimmed.match(/^(.+?) is not empty\.$/i)
  if (notEmptyMatch) {
    return `${notEmptyMatch[1]} is already on file`
  }

  const missingMatch = trimmed.match(/^(.+?) is missing\.$/i)
  if (missingMatch) {
    return `${missingMatch[1]} is still missing`
  }

  const missingDataMatch = trimmed.match(/^(.+?) does not have enough data yet\.$/i)
  if (missingDataMatch) {
    return `${missingDataMatch[1]} still needs to be confirmed`
  }

  const aboveLimitMatch = trimmed.match(/^(.+?) does not satisfy is at most (.+)\.$/i)
  if (aboveLimitMatch) {
    return `${aboveLimitMatch[1]} is above the allowed limit of ${aboveLimitMatch[2]}`
  }

  const belowMinimumMatch = trimmed.match(/^(.+?) does not satisfy is at least (.+)\.$/i)
  if (belowMinimumMatch) {
    return `${belowMinimumMatch[1]} is below the required minimum of ${belowMinimumMatch[2]}`
  }

  const matchedYes = trimmed.match(/^(.+?) matches Yes\.$/i)
  if (matchedYes) {
    return `${matchedYes[1]} is confirmed`
  }

  return trimmed.replace(/\.$/, "")
}

export function buildAllScopeServiceNarrative(item: ServiceFitScanItem) {
  const reasons =
    item.eligibilityStatus === "ELIGIBLE"
      ? item.matchedRules
      : item.eligibilityStatus === "NEEDS_INFO"
        ? item.missingRules
        : item.blockingRules

  const humanizedReasons = dedupe(
    reasons.slice(0, 2).map((rule) => humanizeRuleReason(rule.reason)),
  ).filter(Boolean)
  const detail = joinPhrases(humanizedReasons)

  if (item.eligibilityStatus === "ELIGIBLE") {
    return detail
      ? `${item.serviceName} looks like a good match because ${detail}.`
      : `${item.serviceName} looks like a good match under the current rules.`
  }

  if (item.eligibilityStatus === "NEEDS_INFO") {
    return detail
      ? `${item.serviceName} may qualify, but ${detail}.`
      : `${item.serviceName} may qualify, but more information is still needed.`
  }

  return detail
    ? `${item.serviceName} does not qualify right now because ${detail}.`
    : `${item.serviceName} is currently blocked by the configured rules.`
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
