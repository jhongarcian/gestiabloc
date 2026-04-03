import {
  buildServiceFitAssistantReply,
  type ServiceFitAssistantReply,
} from "./service-fit-assistant.js"
import {
  answerImmigrationQuestion,
  shouldUseImmigrationAdapter,
} from "./service-fit-immigration-adapter.js"
import type { ServiceFitProfile } from "./service-fit.js"
import {
  shouldRunServiceVerification,
  verifyServiceQuestion,
} from "./service-fit-verification.js"

type ServiceQuestionRouterItem = {
  serviceId: string
  serviceName: string
  description: string | null
  fitProfile: ServiceFitProfile
  eligibilityStatus: "ELIGIBLE" | "NEEDS_INFO" | "NOT_ELIGIBLE"
  fitScore: number
  summary: string
  explanation: string | null
  matchedRules: Array<{ ruleId: string; label: string; reason: string }>
  blockingRules: Array<{ ruleId: string; label: string; reason: string }>
  missingRules: Array<{ ruleId: string; label: string; reason: string }>
  recommendedUpdates: string[]
  configurationGapNotes: string[]
  hasPurchased: boolean
  hasActiveEnrollment: boolean
  currentContactServiceStatus: "IN_PROGRESS" | "PENDING_PAYMENT" | "COMPLETED" | "CANCELED" | null
}

type RouteServiceQuestionInput = {
  items: ServiceQuestionRouterItem[]
  scope: "all" | "service"
  serviceId?: string | null
  question?: string | null
}

function normalizeQuestion(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? ""
}

function hasPatterns(question: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(question))
}

function dedupe(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

const FIT_SUMMARY_PATTERNS = [
  /\bneed\b/,
  /\bneeds\b/,
  /\bmissing\b/,
  /\brequire\b/,
  /\brequired\b/,
  /\bapply\b/,
  /\binformation\b/,
  /\binfo\b/,
  /\bnext\b/,
  /\bstart\b/,
  /\bmove forward\b/,
  /\bdo now\b/,
  /\benroll\b/,
  /\bdata\b/,
  /\breviewed\b/,
  /\bsignal\b/,
  /\bfield\b/,
  /\brecord\b/,
  /\busing\b/,
  /\bused\b/,
  /\bwhy\b/,
  /\bqualif/i,
  /\beligible\b/,
  /\bblocked\b/,
  /\bblocking\b/,
  /\bfit\b/,
  /\bmatch\b/,
]

const OPEN_ENDED_SERVICE_PATTERNS = [
  /\bcan we\b/,
  /\bcan they\b/,
  /\bwhat if\b/,
  /\bcost\b/,
  /\bprice\b/,
  /\bfee\b/,
  /\bdeadline\b/,
  /\bperiod\b/,
  /\bcoverage\b/,
  /\bbenefit\b/,
  /\bpolicy\b/,
  /\blaw\b/,
  /\brule\b/,
  /\brenew\b/,
  /\bcancel\b/,
  /\bupgrade\b/,
  /\bdowngrade\b/,
  /\btransfer\b/,
  /\bswitch\b/,
  /\bchange\b/,
]

function isFitSummaryQuestion(question: string) {
  if (!question) return false
  if (hasPatterns(question, OPEN_ENDED_SERVICE_PATTERNS)) {
    return false
  }

  return hasPatterns(question, FIT_SUMMARY_PATTERNS)
}

function shouldPreferVerification(
  question: string,
  item: ServiceQuestionRouterItem,
) {
  if (!question || item.fitProfile.verificationProfile.mode === "NONE") {
    return false
  }

  if (shouldRunServiceVerification(question, item.fitProfile.verificationProfile)) {
    return true
  }

  return !isFitSummaryQuestion(question)
}

function buildKnowledgeReply(
  item: ServiceQuestionRouterItem,
  question: string,
): ServiceFitAssistantReply | null {
  const knowledge = item.fitProfile.knowledgeProfile
  const pricingQuestion = hasPatterns(question, [/\bcost\b/, /\bprice\b/, /\bfee\b/, /\bhow much\b/])
  const workflowQuestion = hasPatterns(question, [
    /\bprocess\b/,
    /\bworkflow\b/,
    /\bnext\b/,
    /\bsteps\b/,
    /\bwhat should\b/,
    /\bhow do we\b/,
  ])
  const faqQuestion = hasPatterns(question, [/\bcan we\b/, /\bcan they\b/, /\bwhat if\b/, /\bquestion\b/])

  const bullets: string[] = []
  let summary = ""
  let title = `${item.serviceName} service guidance`

  if (pricingQuestion && knowledge.pricingNotes) {
    title = `${item.serviceName} pricing guidance`
    summary = knowledge.pricingNotes
  } else if (workflowQuestion && knowledge.workflowNotes) {
    title = `${item.serviceName} workflow guidance`
    summary = knowledge.workflowNotes
  } else if (faqQuestion && knowledge.faqNotes) {
    title = `${item.serviceName} answer guidance`
    summary = knowledge.faqNotes
  } else if (knowledge.overview) {
    summary = knowledge.overview
  }

  if (!summary) {
    return null
  }

  if (knowledge.pricingNotes && knowledge.pricingNotes !== summary) {
    bullets.push(knowledge.pricingNotes)
  }
  if (knowledge.workflowNotes && knowledge.workflowNotes !== summary) {
    bullets.push(knowledge.workflowNotes)
  }
  if (knowledge.faqNotes && knowledge.faqNotes !== summary) {
    bullets.push(knowledge.faqNotes)
  }

  return {
    title,
    summary: `Based on your configured service knowledge for ${item.serviceName}, ${summary}`,
    bullets: dedupe(bullets).slice(0, 4),
    suggestedQuestions: [
      "What is the live rule or fee for this service?",
      "What should I do next for this service?",
      "What is still missing for this service?",
    ],
  }
}

export async function routeServiceQuestion(
  input: RouteServiceQuestionInput,
): Promise<ServiceFitAssistantReply> {
  const baseReply = buildServiceFitAssistantReply(input)
  const question = normalizeQuestion(input.question)

  if (input.scope !== "service" || !question) {
    return baseReply
  }

  const item = input.items.find((entry) => entry.serviceId === input.serviceId) ?? input.items[0]
  if (!item) {
    return baseReply
  }

  if (shouldUseImmigrationAdapter(question, item.fitProfile)) {
    const immigrationReply = await answerImmigrationQuestion({
      question,
      serviceName: item.serviceName,
      serviceDescription: item.description,
      fitProfile: item.fitProfile,
      eligibilityStatus: item.eligibilityStatus,
    })

    if (immigrationReply) {
      return immigrationReply
    }
  }

  const knowledgeReply = buildKnowledgeReply(item, question)
  const shouldVerify = shouldPreferVerification(question, item)

  if (knowledgeReply) {
    if (shouldVerify) {
      const verification = await verifyServiceQuestion({
        question,
        serviceName: item.serviceName,
        serviceDescription: item.description,
        fitProfile: item.fitProfile,
        eligibilityStatus: item.eligibilityStatus,
      })

      if (verification) {
        return {
          ...knowledgeReply,
          summary: `${knowledgeReply.summary} ${verification.summary}`.trim(),
          bullets: dedupe([...knowledgeReply.bullets, ...verification.bullets]).slice(0, 6),
          citations: verification.citations,
        }
      }
    }

    return knowledgeReply
  }

  if (shouldVerify) {
    const verification = await verifyServiceQuestion({
      question,
      serviceName: item.serviceName,
      serviceDescription: item.description,
      fitProfile: item.fitProfile,
      eligibilityStatus: item.eligibilityStatus,
    })

    if (verification) {
      return {
        ...baseReply,
        summary: `${baseReply.summary} ${verification.summary}`.trim(),
        bullets: dedupe([...baseReply.bullets, ...verification.bullets]).slice(0, 6),
        citations: verification.citations,
      }
    }
  }

  return baseReply
}
