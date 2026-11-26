import { buildAiEvaluationCases, checkEvaluationAnswer } from "./ai-evaluation-cases.js"
import { getAiChatProvider, replyToAiHelper } from "./ai-helper-replies.js"
import { withAiUsage, type ProviderUsageRecord } from "./ai-provider-usage.js"
import { findAiModel, modelKey } from "./ai-model-catalog.js"
import type { AiProviderRequest } from "./ai-provider-adapters.js"

export type EvaluationRow = { id: string; critical: boolean; passed: boolean; answer?: string; error?: string }
export function evaluationGate(rows: EvaluationRow[], records: ProviderUsageRecord[], expected = 100, creditsPerReply = 1) {
  // Include interrupted attempts whose final write never arrived.
  const final = [...new Map(records.map(r => [r.id, r])).values()]
  const unknown = final.filter(r => r.status === "STARTED" || r.estimatedCostUsd === null).length
  const total = final.reduce((sum, r) => sum + Number(r.estimatedCostUsd ?? r.upperBoundCostUsd ?? 0), 0)
  const complete = rows.length === expected && new Set(rows.map(r => r.id)).size === expected && expected >= 100
  const quality = complete && rows.filter(r => r.passed).length / rows.length >= .95 && rows.filter(r => r.critical).every(r => r.passed)
  const providerCostPassed = complete && final.length > 0 && unknown === 0 && Number.isSafeInteger(creditsPerReply) && creditsPerReply > 0 && total / rows.length <= .0015 * creditsPerReply
  return { complete, qualityChecksPassed: quality, providerCostPassed, unknownAttempts: unknown,
    totalEstimatedUsd: total, averageProviderCostUsd: rows.length ? total / rows.length : null,
    // Automated substring checks do not establish nuanced answer correctness.
    requiresHumanReview: true, releaseApproved: false }
}

export async function runAiEvaluation(config: Pick<AiProviderRequest, "provider" | "apiKey" | "model" | "baseUrl">, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Evaluation limit must be 1–100")
  const provider = getAiChatProvider(config)!
  const definition = findAiModel({ provider: config.provider ?? "groq", model: config.model })
  if (!definition) throw new Error("Unknown evaluation model")
  const rows: EvaluationRow[] = []; const records: ProviderUsageRecord[] = []
  let spent = 0; let pending = 0; let consecutiveUnavailable = 0
  const holds = new Map<string, number>()
  for (const item of buildAiEvaluationCases().slice(0, limit)) {
    try {
      const reply = await withAiUsage({ channel: "EVALUATION", budgetModelKey: modelKey(definition) }, () => replyToAiHelper(item.snapshot, { question: item.question, history: [] }, provider, undefined, item.contact ? "CONTACT" : "TEST", item.contact), async record => {
        if (record.status === "STARTED") {
          if (record.upperBoundCostUsd === null) throw new Error("Unknown price")
          const upper = Number(record.upperBoundCostUsd)
          if (spent + pending + upper > 5) throw new Error("Evaluation budget exhausted")
          holds.set(record.id, upper); pending += upper
        } else {
          pending -= holds.get(record.id) ?? 0
          spent += Number(record.estimatedCostUsd ?? record.upperBoundCostUsd ?? 0)
        }
        records.push({ ...record })
      })
      rows.push({ id: item.id, critical: item.critical, passed: checkEvaluationAnswer(item, reply.answer), answer: reply.answer })
      consecutiveUnavailable = 0
    } catch (error) {
      const code = error instanceof Error && /^AI_[A-Z_]+$/.test(error.message) ? error.message : "EVALUATION_FAILED"
      rows.push({ id: item.id, critical: item.critical, passed: false, error: code })
      if (["AI_PROVIDER_BUSY", "AI_PROVIDER_UNAVAILABLE", "AI_METERING_UNAVAILABLE"].includes(code)) consecutiveUnavailable++
      if (consecutiveUnavailable >= 3) break
    }
  }
  return { provider: definition.provider, model: config.model, policyVersion: definition.policyVersion, creditsPerReply: definition.creditsPerReply, limit, rows, records, ...evaluationGate(rows, records, 100, definition.creditsPerReply) }
}
