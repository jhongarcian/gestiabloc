import { z } from "zod"

import type {
  ServiceFitProfile,
  ServiceVerificationProfile,
} from "./service-fit.js"

type VerificationDocument = {
  url: string
  title: string
  text: string
}

type SearchResult = {
  url: string
  title: string
}

export type ServiceVerificationCitation = {
  url: string
  title: string
}

export type ServiceVerificationResult = {
  summary: string
  bullets: string[]
  citations: ServiceVerificationCitation[]
}

type VerifyServiceQuestionInput = {
  question: string
  serviceName: string
  serviceDescription: string | null
  fitProfile: ServiceFitProfile
  eligibilityStatus: "ELIGIBLE" | "NEEDS_INFO" | "NOT_ELIGIBLE"
}

const PROVIDER_OUTPUT_SCHEMA = z.object({
  summary: z.string().trim().min(1).max(1200),
  bullets: z.array(z.string().trim().min(1).max(320)).max(5).default([]),
  citations: z
    .array(
      z.object({
        url: z.string().url(),
        title: z.string().trim().min(1).max(200),
      }),
    )
    .max(5)
    .default([]),
})

const QUESTION_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "better",
  "but",
  "can",
  "client",
  "contact",
  "do",
  "for",
  "has",
  "have",
  "he",
  "her",
  "him",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "plan",
  "service",
  "she",
  "that",
  "the",
  "they",
  "this",
  "to",
  "we",
  "what",
  "with",
  "wants",
  "already",
])

const DEFAULT_VERIFICATION_PATTERNS = [
  /\bcan we\b/i,
  /\bcan they\b/i,
  /\ballowed\b/i,
  /\bswitch\b/i,
  /\bchange\b/i,
  /\bdeadline\b/i,
  /\bperiod\b/i,
  /\bcoverage\b/i,
  /\bbenefit\b/i,
  /\bpolicy\b/i,
  /\blaw\b/i,
  /\brule\b/i,
  /\brenew\b/i,
  /\bcancel\b/i,
  /\bupgrade\b/i,
  /\bdowngrade\b/i,
  /\btransfer\b/i,
]

function normalizeText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") ?? ""
}

function tokenize(value: string | null | undefined) {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !QUESTION_STOP_WORDS.has(token))
}

function buildRelevanceTokens(input: VerifyServiceQuestionInput) {
  return dedupe([
    ...tokenize(input.question),
    ...tokenize(input.serviceName),
    ...tokenize(input.serviceDescription),
    ...tokenize(input.fitProfile.summary),
    ...tokenize(input.fitProfile.verificationProfile.guidance),
  ])
}

function dedupe(values: string[]) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))]
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

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
}

function decodeHtmlBasic(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return normalizeText(decodeHtmlBasic(match?.[1] ?? ""))
}

function extractDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

function extractRedirectTarget(url: string) {
  try {
    const parsed = new URL(url, "https://duckduckgo.com")
    const uddg = parsed.searchParams.get("uddg")
    return uddg ? decodeURIComponent(uddg) : parsed.toString()
  } catch {
    return url
  }
}

function parseDuckDuckGoResults(html: string) {
  const results: SearchResult[] = []
  const pattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi

  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const rawHref = decodeHtmlBasic(match[1] ?? "")
    const title = normalizeText(stripHtml(decodeHtmlBasic(match[2] ?? "")))
    const url = extractRedirectTarget(rawHref)

    if (!title || !/^https?:\/\//i.test(url)) continue
    results.push({ url, title })
  }

  return results
}

function buildSearchQuery(input: VerifyServiceQuestionInput) {
  const serviceName = normalizeText(input.serviceName)
  const question = normalizeText(input.question)
  const guidanceTokens = tokenize(input.fitProfile.verificationProfile.guidance).slice(0, 6)
  return dedupe([serviceName, question, guidanceTokens.join(" ")]).join(" ").trim()
}

async function searchVerificationResults(input: VerifyServiceQuestionInput): Promise<SearchResult[]> {
  const query = buildSearchQuery(input)
  if (!query) return []

  try {
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        method: "GET",
        headers: {
          "User-Agent": "GestiaBloc-Service-Verification/1.0",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(8000),
      },
    )

    if (!response.ok) return []
    const html = await response.text()
    return parseDuckDuckGoResults(html)
  } catch {
    return []
  }
}

function prioritizeSearchResults(
  results: SearchResult[],
  sourceUrls: string[],
) {
  const trustedDomains = new Set(
    sourceUrls.map((url) => extractDomain(url)).filter(Boolean),
  )

  const ranked = results
    .map((result) => ({
      result,
      preferred: trustedDomains.size > 0 && trustedDomains.has(extractDomain(result.url)),
    }))
    .sort((left, right) => Number(right.preferred) - Number(left.preferred))
    .map((entry) => entry.result)

  return dedupe(ranked.map((entry) => `${entry.url}|||${entry.title}`)).map((entry) => {
    const [url, title] = entry.split("|||")
    return { url, title }
  })
}

async function fetchVerificationDocument(url: string): Promise<VerificationDocument | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "GestiaBloc-Service-Verification/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) {
      return null
    }

    const html = await response.text()
    const text = stripHtml(html)
    if (!text) return null

    return {
      url,
      title: extractTitle(html) || new URL(url).hostname,
      text: text.slice(0, 20000),
    }
  } catch {
    return null
  }
}

function splitIntoSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeText(sentence))
    .filter((sentence) => sentence.length >= 40 && sentence.length <= 360)
}

function selectRelevantSnippets(input: VerifyServiceQuestionInput, docs: VerificationDocument[]) {
  const questionTokens = buildRelevanceTokens(input)

  const scored = docs.flatMap((doc) =>
    splitIntoSentences(doc.text).map((sentence) => {
      const sentenceLower = sentence.toLowerCase()
      const overlap = questionTokens.filter((token) => sentenceLower.includes(token)).length
      return {
        url: doc.url,
        title: doc.title,
        sentence,
        score: overlap,
      }
    }),
  )

  return scored
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.sentence.length - right.sentence.length)
    .slice(0, 4)
}

function hasConfiguredKeywordMatch(question: string, profile: ServiceVerificationProfile) {
  const normalizedQuestion = question.toLowerCase()
  return profile.triggerKeywords.some((keyword) => normalizedQuestion.includes(keyword.toLowerCase()))
}

export function shouldRunServiceVerification(question: string, profile: ServiceVerificationProfile) {
  if (profile.mode === "NONE") return false
  if (!normalizeText(question)) return false
  if (hasConfiguredKeywordMatch(question, profile)) return true

  return DEFAULT_VERIFICATION_PATTERNS.some((pattern) => pattern.test(question))
}

class GroqServiceVerificationProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
  ) {}

  async summarize(
    input: VerifyServiceQuestionInput,
    snippets: Array<{ url: string; title: string; sentence: string }>,
  ): Promise<ServiceVerificationResult | null> {
    const prompt = [
      "You answer an internal worker's question about a tenant-configured service.",
      "Use only the provided source excerpts and service configuration.",
      "Do not invent policies, deadlines, or coverage details.",
      "If the excerpts are insufficient, say that clearly.",
      'Return strict JSON: {"summary":"string","bullets":["string"],"citations":[{"url":"string","title":"string"}]}.',
      "",
      `Question: ${input.question}`,
      `Service name: ${input.serviceName}`,
      `Service description: ${normalizeText(input.serviceDescription) || "None provided."}`,
      `Fit summary: ${normalizeText(input.fitProfile.summary) || "None provided."}`,
      `Eligibility status: ${input.eligibilityStatus}`,
      `Verifier guidance: ${normalizeText(input.fitProfile.verificationProfile.guidance) || "None provided."}`,
      "",
      "Source excerpts:",
      ...snippets.map(
        (snippet, index) =>
          `[${index + 1}] ${snippet.title} (${snippet.url}) ${snippet.sentence}`,
      ),
    ].join("\n")

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: "You summarize service verification findings from provided sources. Return only JSON.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      signal: AbortSignal.timeout(12000),
    })

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } | null }>
    }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== "string" || !content.trim()) {
      return null
    }

    const rawJson = extractJsonObject(content)
    if (!rawJson) return null

    try {
      const parsed = PROVIDER_OUTPUT_SCHEMA.parse(JSON.parse(rawJson))
      return {
        summary: parsed.summary,
        bullets: dedupe(parsed.bullets).slice(0, 5),
        citations: parsed.citations,
      }
    } catch {
      return null
    }
  }
}

function getGroqVerificationProvider() {
  const provider = normalizeText(
    process.env.SERVICE_VERIFICATION_AI_PROVIDER || process.env.SERVICE_FIT_AI_PROVIDER,
  ).toLowerCase()
  if (provider !== "groq") {
    return null
  }

  const apiKey = normalizeText(process.env.GROQ_API_KEY)
  if (!apiKey) {
    return null
  }

  return new GroqServiceVerificationProvider(
    apiKey,
    normalizeText(process.env.SERVICE_VERIFICATION_GROQ_MODEL || process.env.GROQ_MODEL) ||
      "llama-3.1-8b-instant",
    normalizeText(process.env.SERVICE_VERIFICATION_GROQ_BASE_URL || process.env.GROQ_BASE_URL) ||
      "https://api.groq.com/openai/v1/chat/completions",
  )
}

function buildFallbackVerificationResult(
  input: VerifyServiceQuestionInput,
  snippets: Array<{ url: string; title: string; sentence: string }>,
): ServiceVerificationResult | null {
  if (snippets.length === 0) {
    const guidance = normalizeText(input.fitProfile.verificationProfile.guidance)
    if (!guidance) return null

    return {
      summary: `This service is configured to require external verification. The configured verifier guidance for ${input.serviceName} says: ${guidance}`,
      bullets: [
        "No relevant source excerpt was found automatically for this question.",
        "Review the configured verification guidance and source links before answering the client.",
      ],
      citations: input.fitProfile.verificationProfile.sourceUrls.slice(0, 3).map((url) => ({
        url,
        title: new URL(url).hostname,
      })),
    }
  }

  return {
    summary: `Configured external sources for ${input.serviceName} mention additional rules or conditions related to this question.`,
    bullets: dedupe(snippets.map((snippet) => snippet.sentence)).slice(0, 4),
    citations: dedupe(snippets.map((snippet) => `${snippet.url}|||${snippet.title}`)).map((entry) => {
      const [url, title] = entry.split("|||")
      return { url, title }
    }),
  }
}

export async function verifyServiceQuestion(
  input: VerifyServiceQuestionInput,
): Promise<ServiceVerificationResult | null> {
  const profile = input.fitProfile.verificationProfile

  if (profile.mode !== "WEB_SOURCES") {
    const guidance = normalizeText(profile.guidance)
    if (!guidance) return null

    return {
      summary: `This service uses ${profile.mode.toLowerCase().replace(/_/g, " ")} verification. ${guidance}`,
      bullets: [
        "The configured verifier for this service is not a web-source lookup.",
        "Review the tenant-configured workflow before answering the client.",
      ],
      citations: [],
    }
  }

  const searchResults = prioritizeSearchResults(
    await searchVerificationResults(input),
    profile.sourceUrls,
  )
  const candidateUrls = dedupe([
    ...profile.sourceUrls.slice(0, 3),
    ...searchResults.slice(0, 4).map((result) => result.url),
  ]).slice(0, 5)
  const docs = (
    await Promise.all(candidateUrls.map((url) => fetchVerificationDocument(url)))
  ).filter((doc): doc is VerificationDocument => Boolean(doc))

  const snippets = selectRelevantSnippets(input, docs)
  const provider = getGroqVerificationProvider()

  if (provider && snippets.length > 0) {
    const aiSummary = await provider.summarize(input, snippets)
    if (aiSummary) {
      return aiSummary
    }
  }

  return buildFallbackVerificationResult(input, snippets)
}
