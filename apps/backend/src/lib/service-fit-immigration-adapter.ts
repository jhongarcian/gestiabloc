import type { ServiceFitAssistantReply } from "./service-fit-assistant.js"
import type { ServiceFitProfile } from "./service-fit.js"
import { verifyServiceQuestion } from "./service-fit-verification.js"

type ImmigrationAdapterInput = {
  question: string
  serviceName: string
  serviceDescription: string | null
  fitProfile: ServiceFitProfile
  eligibilityStatus: "ELIGIBLE" | "NEEDS_INFO" | "NOT_ELIGIBLE"
}

const USCIS_VERIFICATION_PROFILE: ServiceFitProfile["verificationProfile"] = {
  mode: "WEB_SOURCES",
  guidance:
    "Use official USCIS sources to answer filing fee, filing process, deadline, and form questions. When exact fees depend on category or bundled forms, say that clearly and ask the worker to confirm the filing path.",
  sourceUrls: [
    "https://www.uscis.gov/forms/filing-fees",
    "https://www.uscis.gov/feecalculator?form=i-485",
    "https://www.uscis.gov/green-card/how-to-apply-for-a-green-card",
    "https://www.uscis.gov/i-485",
  ],
  triggerKeywords: [
    "green card",
    "uscis",
    "i-485",
    "filing fee",
    "application fee",
    "adjustment of status",
    "deadline",
    "when can",
  ],
}

function normalizeQuestion(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function matches(question: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(question))
}

export function shouldUseImmigrationAdapter(question: string, fitProfile: ServiceFitProfile) {
  const normalized = normalizeQuestion(question)
  if (fitProfile.knowledgeProfile.adapter !== "IMMIGRATION_USCIS") {
    return false
  }

  const immigrationMarker = matches(normalized, [
    /\bgreen card\b/,
    /\buscis\b/,
    /\bi-485\b/,
    /\badjustment of status\b/,
    /\bimmigrant\b/,
    /\bpermanent resid/i,
  ])

  const livePolicyMarker = matches(normalized, [
    /\bapplication fee\b/,
    /\bfiling fee\b/,
    /\bgovernment fee\b/,
    /\buscis fee\b/,
    /\bdeadline\b/,
    /\bwhen can\b/,
    /\bfiling\b/,
    /\b202[0-9]\b/,
    /\bcurrent fee\b/,
  ])

  return immigrationMarker && livePolicyMarker
}

export async function answerImmigrationQuestion(
  input: ImmigrationAdapterInput,
): Promise<ServiceFitAssistantReply | null> {
  const verification = await verifyServiceQuestion({
    question: input.question,
    serviceName: input.serviceName,
    serviceDescription: input.serviceDescription,
    eligibilityStatus: input.eligibilityStatus,
    fitProfile: {
      ...input.fitProfile,
      verificationProfile: USCIS_VERIFICATION_PROFILE,
    },
  })

  if (!verification) return null

  return {
    title: `${input.serviceName} USCIS guidance`,
    summary: `Based on the configured rules, ${input.serviceName} is ${input.eligibilityStatus.toLowerCase().replace(/_/g, " ")} for this contact. ${verification.summary}`,
    bullets: verification.bullets.length
      ? verification.bullets
      : [
          "Exact immigration filing costs can depend on the forms and filing path involved.",
          "If the question is about pricing, confirm whether this is adjustment of status, consular processing, or another USCIS filing flow.",
        ],
    suggestedQuestions: [
      "What USCIS fee applies in this case?",
      "What information is still missing for this service?",
      "What should I ask the client next?",
    ],
    citations: verification.citations,
  }
}
