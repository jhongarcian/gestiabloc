import type { ServiceFitExplanationRuleSummary } from "./service-fit-explanations.js"

type ServiceFitAssistantStatus = "ELIGIBLE" | "NEEDS_INFO" | "NOT_ELIGIBLE"

type ContactServiceEnrollmentStatus =
  | "IN_PROGRESS"
  | "PENDING_PAYMENT"
  | "COMPLETED"
  | "CANCELED"

export type ServiceFitAssistantScanItem = {
  serviceId: string
  serviceName: string
  eligibilityStatus: ServiceFitAssistantStatus
  fitScore: number
  summary: string
  explanation: string | null
  matchedRules: ServiceFitExplanationRuleSummary[]
  blockingRules: ServiceFitExplanationRuleSummary[]
  missingRules: ServiceFitExplanationRuleSummary[]
  recommendedUpdates: string[]
  configurationGapNotes: string[]
  hasPurchased: boolean
  hasActiveEnrollment: boolean
  currentContactServiceStatus: ContactServiceEnrollmentStatus | null
}

export type ServiceFitAssistantReply = {
  title: string
  summary: string
  bullets: string[]
  suggestedQuestions: string[]
  citations?: Array<{
    url: string
    title: string
  }>
}

type BuildServiceFitAssistantReplyInput = {
  items: ServiceFitAssistantScanItem[]
  scope: "all" | "service"
  serviceId?: string | null
  question?: string | null
}

function normalizeQuestion(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? ""
}

function dedupe(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function truncate(value: string, maxLength = 180) {
  const normalized = value.trim().replace(/\s+/g, " ")
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function toSentence(value: string) {
  return value.toLowerCase().replace(/_/g, " ")
}

function joinRuleReasons(
  rules: ServiceFitExplanationRuleSummary[],
  emptyText: string,
  limit = 2,
) {
  if (rules.length === 0) return emptyText

  return rules
    .slice(0, limit)
    .map((rule) => rule.reason.trim())
    .filter(Boolean)
    .join(" ")
}

function buildEnrollmentNote(item: ServiceFitAssistantScanItem) {
  if (item.currentContactServiceStatus === "IN_PROGRESS") {
    return "This service already has an active in-progress transaction for the contact."
  }

  if (item.currentContactServiceStatus === "PENDING_PAYMENT") {
    return "This service is already active and waiting for payment completion."
  }

  if (item.currentContactServiceStatus === "COMPLETED") {
    return "This service was already purchased and completed for the contact."
  }

  if (item.currentContactServiceStatus === "CANCELED") {
    return "There is a canceled transaction on record for this service."
  }

  return null
}

function buildStatusSummary(item: ServiceFitAssistantScanItem) {
  if (item.eligibilityStatus === "ELIGIBLE") {
    return `Based on the configured rules, ${item.serviceName} is currently eligible for this contact.`
  }

  if (item.eligibilityStatus === "NEEDS_INFO") {
    return `Based on the configured rules, ${item.serviceName} may qualify, but more information is still needed.`
  }

  return `Based on the configured rules, ${item.serviceName} is not eligible for this contact right now.`
}

function buildGeneralServiceBullets(item: ServiceFitAssistantScanItem) {
  const bullets: string[] = [
    `Status: ${toSentence(item.eligibilityStatus)} with fit score ${item.fitScore}.`,
  ]

  if (item.eligibilityStatus === "ELIGIBLE") {
    bullets.push(
      joinRuleReasons(item.matchedRules, "The configured rules show a strong match for this service."),
    )
  }

  if (item.eligibilityStatus === "NEEDS_INFO") {
    bullets.push(
      joinRuleReasons(
        item.missingRules,
        "The record is missing information needed to confirm this service.",
      ),
    )
  }

  if (item.eligibilityStatus === "NOT_ELIGIBLE") {
    bullets.push(
      joinRuleReasons(
        item.blockingRules,
        "One or more required rules are currently blocking this service.",
      ),
    )
  }

  const enrollmentNote = buildEnrollmentNote(item)
  if (enrollmentNote) {
    bullets.push(enrollmentNote)
  }

  bullets.push(...item.recommendedUpdates.slice(0, 2))
  bullets.push(...item.configurationGapNotes.slice(0, 1))

  return dedupe(bullets).slice(0, 5)
}

function buildServiceSuggestions(item: ServiceFitAssistantScanItem) {
  if (item.eligibilityStatus === "ELIGIBLE") {
    return [
      "What makes this service a good fit?",
      "What should I do next for this service?",
      "Is anything still missing for this service?",
    ]
  }

  if (item.eligibilityStatus === "NEEDS_INFO") {
    return [
      "What does this contact still need for this service?",
      "What fields should I update first?",
      "Can this service move forward yet?",
    ]
  }

  return [
    "Why is this service blocked?",
    "What would need to change for this service?",
    "Should I review another service instead?",
  ]
}

function questionMatches(
  question: string,
  patterns: RegExp[],
) {
  return patterns.some((pattern) => pattern.test(question))
}

function buildMissingInfoReply(item: ServiceFitAssistantScanItem): ServiceFitAssistantReply {
  const bullets = dedupe([
    ...item.recommendedUpdates,
    ...item.missingRules.slice(0, 3).map((rule) => rule.reason),
    buildEnrollmentNote(item) ?? "",
  ]).slice(0, 5)

  const summary =
    bullets.length > 0
      ? `${buildStatusSummary(item)} The main missing pieces are already reflected in the configured rule results.`
      : `${buildStatusSummary(item)} There are no missing fields flagged for this service right now.`

  return {
    title: `What this contact still needs for ${item.serviceName}`,
    summary,
    bullets:
      bullets.length > 0
        ? bullets
        : ["No missing information is blocking this service right now."],
    suggestedQuestions: [
      "What should I do next for this service?",
      "Why is this service in this status?",
      "Show me another service to review.",
    ],
  }
}

function buildQualificationReasonReply(item: ServiceFitAssistantScanItem): ServiceFitAssistantReply {
  const rules =
    item.eligibilityStatus === "ELIGIBLE"
      ? item.matchedRules
      : item.eligibilityStatus === "NEEDS_INFO"
        ? item.missingRules
        : item.blockingRules

  const summary = item.explanation?.trim() || buildStatusSummary(item)

  return {
    title: `Why ${item.serviceName} is ${toSentence(item.eligibilityStatus)}`,
    summary,
    bullets:
      rules.length > 0
        ? rules.slice(0, 4).map((rule) => `${rule.label}: ${rule.reason}`)
        : buildGeneralServiceBullets(item),
    suggestedQuestions: buildServiceSuggestions(item),
  }
}

function buildNextStepsReply(item: ServiceFitAssistantScanItem): ServiceFitAssistantReply {
  const bullets = dedupe([
    ...item.recommendedUpdates,
    item.eligibilityStatus === "ELIGIBLE"
      ? "The configured rules allow this service to move forward now."
      : "",
    item.eligibilityStatus === "NOT_ELIGIBLE"
      ? "Review another active service or update the underlying contact data before retrying."
      : "",
    buildEnrollmentNote(item) ?? "",
  ]).slice(0, 5)

  return {
    title: `Next steps for ${item.serviceName}`,
    summary:
      item.eligibilityStatus === "ELIGIBLE"
        ? `${buildStatusSummary(item)} The next step is to open or start the service workflow.`
        : item.eligibilityStatus === "NEEDS_INFO"
          ? `${buildStatusSummary(item)} Update the missing record details first, then run the check again.`
          : `${buildStatusSummary(item)} This service should not move forward until the blocking conditions change.`,
    bullets:
      bullets.length > 0
        ? bullets
        : ["No additional actions are recommended beyond reviewing the current status."],
    suggestedQuestions: buildServiceSuggestions(item),
  }
}

function buildEnrollmentChangeReply(item: ServiceFitAssistantScanItem): ServiceFitAssistantReply {
  const enrollmentNote = buildEnrollmentNote(item)
  const bullets = dedupe([
    enrollmentNote ??
      (item.hasPurchased
        ? "This contact already has a recorded history for this service, so review that service record before opening another one."
        : "The current qualification result does not confirm an existing recorded service or benefit record for this contact, so verify the current details first."),
    "The qualification scan only confirms whether this service can move forward under the configured rules. It does not decide whether an existing benefit, package, provider, or service record should be changed or replaced.",
    item.hasActiveEnrollment
      ? "Because this service is already active, open the current service record first and confirm whether this should be handled as an update to the existing record instead of a new service."
      : "If the client already has this service or benefit outside the current record, confirm that status before starting a new workflow for this service.",
    item.eligibilityStatus === "ELIGIBLE"
      ? "The contact is still eligible for this service under the configured rules, but eligibility alone does not answer whether an existing service should be changed."
      : "",
  ]).slice(0, 5)

  return {
    title: `Existing service record question for ${item.serviceName}`,
    summary: `${buildStatusSummary(item)} I can confirm qualification status here, but I cannot confirm from the current fit data alone whether the contact should keep, replace, or change an existing service or benefit record.`,
    bullets,
    suggestedQuestions: [
      "Is there already an active service record for this contact?",
      "What should I do next for this service?",
      "What information is missing for this service?",
    ],
  }
}

function buildReviewedSignalsReply(item: ServiceFitAssistantScanItem): ServiceFitAssistantReply {
  const labels = dedupe([
    ...item.matchedRules.map((rule) => rule.label),
    ...item.missingRules.map((rule) => rule.label),
    ...item.blockingRules.map((rule) => rule.label),
  ]).slice(0, 6)

  return {
    title: `Signals reviewed for ${item.serviceName}`,
    summary:
      labels.length > 0
        ? `This service decision is based on the configured signals already attached to the rule set for ${item.serviceName}.`
        : `There are no detailed rule signals available to summarize for ${item.serviceName}.`,
    bullets:
      labels.length > 0
        ? labels.map((label) => `Reviewed signal: ${label}.`)
        : ["No rule labels were available to summarize for this service."],
    suggestedQuestions: [
      "Why is this service in this status?",
      "What does this contact still need for this service?",
      "What should I do next for this service?",
    ],
  }
}

function buildDefaultServiceReply(item: ServiceFitAssistantScanItem): ServiceFitAssistantReply {
  return {
    title: `${item.serviceName} qualification summary`,
    summary: item.explanation?.trim() || buildStatusSummary(item),
    bullets: buildGeneralServiceBullets(item),
    suggestedQuestions: buildServiceSuggestions(item),
  }
}

function buildServiceReply(
  item: ServiceFitAssistantScanItem,
  question: string,
): ServiceFitAssistantReply {
  if (!question) {
    return buildDefaultServiceReply(item)
  }

  if (
    questionMatches(question, [
      /\balready enrolled\b/,
      /\balready enroll/i,
      /\bswitch\b/,
      /\bchange\b/,
      /\bbetter plan\b/,
      /\bplan\b/,
      /\bcoverage\b/,
      /\bdental\b/,
    ])
  ) {
    return buildEnrollmentChangeReply(item)
  }

  if (
    questionMatches(question, [
      /\bneed\b/,
      /\bneeds\b/,
      /\bmissing\b/,
      /\brequire\b/,
      /\brequired\b/,
      /\bapply\b/,
      /\binformation\b/,
      /\binfo\b/,
    ])
  ) {
    return buildMissingInfoReply(item)
  }

  if (
    questionMatches(question, [
      /\bnext\b/,
      /\bstart\b/,
      /\bmove forward\b/,
      /\bshould\b/,
      /\bdo now\b/,
      /\benroll\b/,
    ])
  ) {
    return buildNextStepsReply(item)
  }

  if (
    questionMatches(question, [
      /\bdata\b/,
      /\breviewed\b/,
      /\bsignal\b/,
      /\bfield\b/,
      /\brecord\b/,
      /\busing\b/,
      /\bused\b/,
    ])
  ) {
    return buildReviewedSignalsReply(item)
  }

  if (
    questionMatches(question, [
      /\bwhy\b/,
      /\bqualif/i,
      /\beligible\b/,
      /\bblocked\b/,
      /\bblocking\b/,
      /\bfit\b/,
      /\bmatch\b/,
    ])
  ) {
    return buildQualificationReasonReply(item)
  }

  return buildDefaultServiceReply(item)
}

function buildServiceListBullet(item: ServiceFitAssistantScanItem) {
  const detail =
    item.eligibilityStatus === "ELIGIBLE"
      ? joinRuleReasons(item.matchedRules, item.explanation || "Ready to move forward.")
      : item.eligibilityStatus === "NEEDS_INFO"
        ? joinRuleReasons(
            item.missingRules,
            item.recommendedUpdates[0] || "More information is still needed.",
          )
        : joinRuleReasons(item.blockingRules, item.explanation || "Blocked by the configured rules.")

  return `${item.serviceName}: ${toSentence(item.eligibilityStatus)}. ${truncate(detail, 120)}`
}

function buildAllScopeSuggestions() {
  return [
    "Which eligible service should I start with?",
    "Show services that still need information.",
    "Which service is already active for this contact?",
  ]
}

function buildAllScopeReply(
  items: ServiceFitAssistantScanItem[],
  question: string,
): ServiceFitAssistantReply {
  const eligible = items.filter((item) => item.eligibilityStatus === "ELIGIBLE")
  const needsInfo = items.filter((item) => item.eligibilityStatus === "NEEDS_INFO")
  const active = items.filter((item) => item.hasActiveEnrollment)

  if (!question) {
    return {
      title: "Qualification scope",
      summary:
        items.length === 0
          ? "There are no active services with fit rules available for this contact."
          : `${items.length} active services were reviewed. ${eligible.length} are eligible now, ${needsInfo.length} need more information, and ${items.length - eligible.length - needsInfo.length} are not eligible.`,
      bullets: items.slice(0, 4).map(buildServiceListBullet),
      suggestedQuestions: buildAllScopeSuggestions(),
    }
  }

  if (
    questionMatches(question, [
      /\bbest\b/,
      /\bstart\b/,
      /\beligible\b/,
      /\bready\b/,
      /\bmove forward\b/,
    ])
  ) {
    const shortlist = (eligible.length > 0 ? eligible : needsInfo).slice(0, 4)
    return {
      title: eligible.length > 0 ? "Best services to start with" : "Services closest to qualifying",
      summary:
        eligible.length > 0
          ? `Start with the services that are already eligible under the current rules.`
          : `No service is fully eligible yet, so start with the services that only need more information.`,
      bullets:
        shortlist.length > 0
          ? shortlist.map(buildServiceListBullet)
          : ["No services are currently ready to shortlist."],
      suggestedQuestions: buildAllScopeSuggestions(),
    }
  }

  if (
    questionMatches(question, [
      /\bmissing\b/,
      /\bneed info\b/,
      /\binformation\b/,
      /\binfo\b/,
      /\bapply\b/,
    ])
  ) {
    return {
      title: "Services waiting on more information",
      summary:
        needsInfo.length > 0
          ? `These services may qualify, but the record still needs more information for confirmation.`
          : `No active services are currently waiting on missing information.`,
      bullets:
        needsInfo.length > 0
          ? needsInfo.slice(0, 4).map(buildServiceListBullet)
          : ["No services are in the needs information group right now."],
      suggestedQuestions: buildAllScopeSuggestions(),
    }
  }

  if (
    questionMatches(question, [
      /\bactive\b/,
      /\balready\b/,
      /\bpurchased\b/,
      /\bin progress\b/,
      /\bpending payment\b/,
      /\bcompleted\b/,
    ])
  ) {
    return {
      title: "Existing service activity",
      summary:
        active.length > 0
          ? `Some services are already active for this contact, so review those before opening another workflow.`
          : `There are no active in-progress service enrollments tied to this contact right now.`,
      bullets:
        active.length > 0
          ? active.slice(0, 4).map(buildServiceListBullet)
          : ["No active service enrollments were found in the current scan."],
      suggestedQuestions: buildAllScopeSuggestions(),
    }
  }

  return {
    title: "Choose a service to go deeper",
    summary:
      "I can compare the active services at a high level here, but service-specific questions work best after you choose one service.",
    bullets: items.slice(0, 4).map(buildServiceListBullet),
    suggestedQuestions: buildAllScopeSuggestions(),
  }
}

export function buildServiceFitAssistantReply(
  input: BuildServiceFitAssistantReplyInput,
): ServiceFitAssistantReply {
  const question = normalizeQuestion(input.question)

  if (input.scope === "service") {
    const item = input.items.find((entry) => entry.serviceId === input.serviceId) ?? input.items[0]
    if (!item) {
      return {
        title: "Service not found",
        summary: "The selected service could not be evaluated for this contact.",
        bullets: ["Choose another active service and try the analysis again."],
        suggestedQuestions: buildAllScopeSuggestions(),
      }
    }

    return buildServiceReply(item, question)
  }

  return buildAllScopeReply(input.items, question)
}
