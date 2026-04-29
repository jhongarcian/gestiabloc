import { z } from "zod"

export type ServiceFitExplanationStatus = "ELIGIBLE" | "NEEDS_INFO" | "NOT_ELIGIBLE"

export type ServiceFitExplanationRuleSummary = {
  ruleId: string
  label: string
  reason: string
}

export type ServiceFitExplanationInput = {
  serviceName: string
  serviceDescription: string | null
  fitSummary: string | null
  eligibilityStatus: ServiceFitExplanationStatus
  fitScore: number
  matchedRules: ServiceFitExplanationRuleSummary[]
  blockingRules: ServiceFitExplanationRuleSummary[]
  missingRules: ServiceFitExplanationRuleSummary[]
}

export type ServiceFitExplanationOutput = {
  reasonSummary: string
  configurationGapNotes: string[]
}

export type ServiceFitExplanationResult = {
  explanation: string
  configurationGapNotes: string[]
  recommendedUpdates: string[]
  explanationSource: "ai" | "deterministic"
}

export interface ServiceFitExplanationProvider {
  explainQualification(input: ServiceFitExplanationInput): Promise<ServiceFitExplanationOutput>
}

const PROVIDER_OUTPUT_SCHEMA = z.object({
  reasonSummary: z.string().trim().min(1).max(900),
  configurationGapNotes: z.array(z.string().trim().min(1).max(240)).max(5).default([]),
})

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "based",
  "by",
  "can",
  "contact",
  "current",
  "do",
  "does",
  "for",
  "from",
  "have",
  "if",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "person",
  "rules",
  "service",
  "should",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "with",
])

const SENTENCE_CONNECTOR_REGEX =
  /\b(or if|also if|also qualify|alternatively|unless|except|in case of|another path|another way)\b/i

function normalizeText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? ""
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token))
}

function dedupeStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function extractJsonObject(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return null
  }

  return trimmed.slice(firstBrace, lastBrace + 1)
}

export function detectServiceFitConfigurationGapNotes(input: ServiceFitExplanationInput) {
  const description = [normalizeText(input.serviceDescription), normalizeText(input.fitSummary)]
    .filter(Boolean)
    .join(". ")

  if (!description) return []

  const knownRuleText = [
    ...input.matchedRules.flatMap((rule) => [rule.label, rule.reason]),
    ...input.blockingRules.flatMap((rule) => [rule.label, rule.reason]),
    ...input.missingRules.flatMap((rule) => [rule.label, rule.reason]),
  ]
    .join(" ")
    .toLowerCase()

  const notes: string[] = []
  const sentences = description
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  for (const sentence of sentences) {
    const hasExceptionSignal = SENTENCE_CONNECTOR_REGEX.test(sentence)

    if (!hasExceptionSignal) continue

    const meaningfulTokens = tokenize(sentence)
    const represented = meaningfulTokens.some((token) => knownRuleText.includes(token))
    if (represented) continue

    notes.push(
      `The service description includes additional qualification guidance that is not encoded in the current fit rules: "${sentence}"`,
    )
  }

  return dedupeStrings(notes).slice(0, 3)
}

function joinReasons(reasons: ServiceFitExplanationRuleSummary[], limit = 2) {
  return reasons
    .slice(0, limit)
    .map((rule) => normalizeText(rule.reason))
    .filter(Boolean)
}

export function buildDeterministicServiceFitExplanation(input: ServiceFitExplanationInput) {
  const matched = joinReasons(input.matchedRules)
  const blocking = joinReasons(input.blockingRules)
  const missing = joinReasons(input.missingRules)

  if (input.eligibilityStatus === "ELIGIBLE") {
    if (matched.length > 0) {
      return `${input.serviceName} is currently a strong match for this contact record based on the configured rules. ${matched.join(" ")}`
    }

    return `${input.serviceName} is currently eligible based on the configured service rules.`
  }

  if (input.eligibilityStatus === "NEEDS_INFO") {
    if (missing.length > 0) {
      return `${input.serviceName} may be eligible, but the record needs more information before a worker can confirm it. ${missing.join(" ")}`
    }

    return `${input.serviceName} may be eligible, but the record needs more information before a worker can confirm it.`
  }

  if (blocking.length > 0) {
    return `${input.serviceName} is not eligible under the current configured rules. ${blocking.join(" ")}`
  }

  return `${input.serviceName} is not eligible under the current configured rules.`
}

export function buildServiceFitRecommendedUpdates(input: ServiceFitExplanationInput) {
  if (input.missingRules.length === 0) return []

  return dedupeStrings(
    input.missingRules.map((rule) => `Update ${rule.label} on the contact record.`),
  ).slice(0, 5)
}

function buildStatusLockedExplanation(
  input: ServiceFitExplanationInput,
  reasonSummary: string | null | undefined,
) {
  const summary = normalizeText(reasonSummary)

  if (input.eligibilityStatus === "ELIGIBLE") {
    return summary
      ? `Based on the configured rules, ${input.serviceName} is currently eligible for this contact record. ${summary}`
      : `Based on the configured rules, ${input.serviceName} is currently eligible for this contact record.`
  }

  if (input.eligibilityStatus === "NEEDS_INFO") {
    return summary
      ? `Based on the configured rules, ${input.serviceName} may be eligible for this contact record, but more information is still needed. ${summary}`
      : `Based on the configured rules, ${input.serviceName} may be eligible for this contact record, but more information is still needed.`
  }

  return summary
    ? `Based on the configured rules, ${input.serviceName} is not eligible for this contact record. ${summary}`
    : `Based on the configured rules, ${input.serviceName} is not eligible for this contact record.`
}

export function buildServiceFitExplanationPrompt(input: ServiceFitExplanationInput) {
  const description = normalizeText(input.serviceDescription)
  const fitSummary = normalizeText(input.fitSummary)

  return [
    "You explain service qualification results to an agency worker reviewing a client/contact record.",
    "You must not change the provided eligibility status or infer new rules.",
    "Use only the service description, fit summary, and deterministic rule results.",
    "Never mention raw contact values because they were not provided.",
    "Do not restate or override the status. Only explain the reasons behind it.",
    "Write for an internal worker, not for the client directly.",
    "If the service description mentions an alternate qualifying path that is not represented by the listed rules, add it to configurationGapNotes instead of applying it.",
    'Return strict JSON with this shape: {"reasonSummary":"string","configurationGapNotes":["string"]}.',
    "",
    `Service name: ${input.serviceName}`,
    `Eligibility status: ${input.eligibilityStatus}`,
    `Fit score: ${input.fitScore}`,
    description ? `Service description: ${description}` : "Service description: None provided.",
    fitSummary ? `Fit summary: ${fitSummary}` : "Fit summary: None provided.",
    `Matched rules: ${input.matchedRules.map((rule) => rule.reason).join(" | ") || "None"}`,
    `Blocking rules: ${input.blockingRules.map((rule) => rule.reason).join(" | ") || "None"}`,
    `Missing rules: ${input.missingRules.map((rule) => rule.reason).join(" | ") || "None"}`,
  ].join("\n")
}

class GroqServiceFitExplanationProvider implements ServiceFitExplanationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
  ) {}

  async explainQualification(input: ServiceFitExplanationInput): Promise<ServiceFitExplanationOutput> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You produce short, accurate qualification explanations for services. Return only JSON.",
          },
          {
            role: "user",
            content: buildServiceFitExplanationPrompt(input),
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error(`GROQ_REQUEST_FAILED:${response.status}`)
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } | null }>
    }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("GROQ_EMPTY_RESPONSE")
    }

    const rawJson = extractJsonObject(content)
    if (!rawJson) {
      throw new Error("GROQ_INVALID_JSON")
    }

    const parsed = PROVIDER_OUTPUT_SCHEMA.parse(JSON.parse(rawJson))
    return {
      reasonSummary: parsed.reasonSummary,
      configurationGapNotes: dedupeStrings(parsed.configurationGapNotes),
    }
  }
}

export function getServiceFitExplanationProvider(): ServiceFitExplanationProvider | null {
  const provider = normalizeText(process.env.SERVICE_FIT_AI_PROVIDER).toLowerCase()
  if (provider !== "groq") {
    return null
  }

  const apiKey = normalizeText(process.env.GROQ_API_KEY)
  if (!apiKey) {
    return null
  }

  return new GroqServiceFitExplanationProvider(
    apiKey,
    normalizeText(process.env.GROQ_MODEL) || "llama-3.1-8b-instant",
    normalizeText(process.env.GROQ_BASE_URL) || "https://api.groq.com/openai/v1/chat/completions",
  )
}

export async function generateServiceFitExplanation(
  input: ServiceFitExplanationInput,
  provider = getServiceFitExplanationProvider(),
): Promise<ServiceFitExplanationResult> {
  const fallbackExplanation = buildDeterministicServiceFitExplanation(input)
  const heuristicGapNotes = detectServiceFitConfigurationGapNotes(input)
  const recommendedUpdates = buildServiceFitRecommendedUpdates(input)

  if (!provider) {
    return {
      explanation: fallbackExplanation,
      explanationSource: "deterministic",
      configurationGapNotes: heuristicGapNotes,
      recommendedUpdates,
    }
  }

  try {
    const result = await provider.explainQualification(input)
    return {
      explanation: buildStatusLockedExplanation(input, result.reasonSummary) || fallbackExplanation,
      explanationSource: "ai",
      configurationGapNotes: dedupeStrings([
        ...heuristicGapNotes,
        ...(result.configurationGapNotes ?? []),
      ]).slice(0, 5),
      recommendedUpdates,
    }
  } catch {
    return {
      explanation: fallbackExplanation,
      explanationSource: "deterministic",
      configurationGapNotes: heuristicGapNotes,
      recommendedUpdates,
    }
  }
}
