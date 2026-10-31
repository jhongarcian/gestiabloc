import { randomUUID } from "node:crypto"
import { z } from "zod"
import { encode } from "gpt-tokenizer/encoding/o200k_harmony"
import { currentAiUsage, withAiUsage, writeProviderUsage, type ProviderUsageRecord } from "./ai-provider-usage.js"

// USD nanodollars per token, avoiding floating-point money arithmetic.
export const GROQ_RATES: Record<string, { input: bigint; output: bigint; cached: bigint }> = {
  "qwen/qwen3.8-27b": { input: 800n, output: 4000n, cached: 800n }, // conservative: no cache discount assumed
  "openai/gpt-oss-120b": { input: 150n, output: 600n, cached: 75n },
  "openai/gpt-oss-20b": { input: 75n, output: 300n, cached: 75n }, // conservative: no fractional-nanodollar cache discount
}
export const GROQ_RATE_VERSION = "groq-2026-10-28"
export const nanoUsd = (value: bigint) => `${value / 1_000_000_000n}.${String(value % 1_000_000_000n).padStart(9, "0")}`
export function providerCost(model: string, input: number, output: number, cached = 0) {
  const rate = GROQ_RATES[model]
  return rate ? nanoUsd(BigInt(input - cached) * rate.input + BigInt(cached) * rate.cached + BigInt(output) * rate.output) : null
}
const count = z.number().int().nonnegative().max(2147483647)
const usageSchema = z.object({
  prompt_tokens: count, completion_tokens: count,
  prompt_tokens_details: z.object({ cached_tokens: count.optional() }).optional(),
  completion_tokens_details: z.object({ reasoning_tokens: count.optional() }).optional(),
}).refine(u => (u.prompt_tokens_details?.cached_tokens ?? 0) <= u.prompt_tokens && (u.completion_tokens_details?.reasoning_tokens ?? 0) <= u.completion_tokens)
export class GroqRequestError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}
export type GroqRequest = {
  apiKey: string; model: string; baseUrl: string; purpose: string
  messages: Array<{ role: string; content: string }>; maxTokens?: number; signal?: AbortSignal
}
// Includes conservative framing overhead; count literal control-token text as
// ordinary user content rather than interpreting it as trusted chat framing.
export function countGroqInput(messages: GroqRequest["messages"]) {
  return 32 + messages.reduce((total, m) => total + encode(m.content, { disallowedSpecial: new Set() }).length + encode(m.role).length + 24, 0)
}

export async function requestGroq<T>(request: GroqRequest, parse: (payload: unknown) => T): Promise<T> {
  if (!currentAiUsage()) return withAiUsage({ channel: "SYSTEM" }, () => requestGroq(request, parse))
  const scope = currentAiUsage()!
  if (process.env.AI_CREDIT_ENFORCEMENT_ENABLED === "true" && (!scope.creditRequestId || request.model !== "openai/gpt-oss-120b"))
    throw new GroqRequestError(503, "AI_BILLING_UNAVAILABLE")
  const candidate = request.model === "openai/gpt-oss-120b" || request.model === "openai/gpt-oss-20b"
  const input = candidate ? countGroqInput(request.messages) : Buffer.byteLength(JSON.stringify(request.messages), "utf8")
  const maxTokens = candidate ? Math.min(request.maxTokens ?? 1800, 1800 - scope.output) : request.maxTokens ?? 1800
  if (candidate && (input + scope.input > 6000 || maxTokens <= 0)) throw new GroqRequestError(413, "AI_CONTEXT_TOO_LARGE")
  const record: ProviderUsageRecord = {
    id: randomUUID(), logicalRequestId: scope.logicalRequestId, tenantId: scope.tenantId ?? null, actorId: scope.actorId ?? null,
    channel: scope.channel, purpose: request.purpose, provider: "groq", requestedModel: request.model, model: null,
    status: "STARTED", httpStatus: null, durationMs: 0, inputTokens: null, outputTokens: null,
    cachedTokens: null, reasoningTokens: null, estimatedCostUsd: null,
    upperBoundCostUsd: providerCost(request.model, input, maxTokens), rateVersion: GROQ_RATE_VERSION,
  }
  try { await writeProviderUsage(record) } catch { throw new GroqRequestError(503, "AI_METERING_UNAVAILABLE") }
  const start = Date.now()
  scope.input += input
  scope.output += maxTokens // uncertain attempts retain their reserved budget
  try {
    const response = await fetch(request.baseUrl, {
      method: "POST", signal: AbortSignal.any([AbortSignal.timeout(30000), ...(request.signal ? [request.signal] : [])]),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${request.apiKey}` },
      body: JSON.stringify({ model: request.model, temperature: 0.2, max_completion_tokens: maxTokens,
        ...(candidate ? { reasoning_effort: "low", reasoning_format: "hidden" } : request.model.startsWith("qwen/") ? { reasoning_effort: "none", reasoning_format: "hidden" } : {}),
        response_format: { type: "json_object" }, messages: request.messages }),
    })
    record.httpStatus = response.status
    if (!response.ok) { record.status = "HTTP_ERROR"; throw new GroqRequestError(response.status === 429 ? 429 : 503, response.status === 429 ? "AI_PROVIDER_BUSY" : "AI_PROVIDER_UNAVAILABLE") }
    record.status = "INVALID_RESPONSE"
    const payload = await response.json() as Record<string, unknown>
    record.model = typeof payload.model === "string" ? payload.model.slice(0, 120) : null
    const usage = usageSchema.safeParse(payload.usage)
    if (usage.success) {
      const u = usage.data
      record.inputTokens = u.prompt_tokens; record.outputTokens = u.completion_tokens
      record.cachedTokens = u.prompt_tokens_details?.cached_tokens ?? 0
      record.reasoningTokens = u.completion_tokens_details?.reasoning_tokens ?? null
      record.estimatedCostUsd = record.model ? providerCost(record.model, u.prompt_tokens, u.completion_tokens, record.cachedTokens) : null
      scope.input += u.prompt_tokens - input; scope.output += u.completion_tokens - maxTokens
    }
    record.status = "INVALID_RESPONSE"
    const value = parse(payload)
    record.status = usage.success && record.estimatedCostUsd !== null ? "SUCCESS" : "USAGE_UNKNOWN"
    return value
  } catch (error) {
    if (record.status === "STARTED") record.status = "TRANSPORT_ERROR"
    if (error instanceof GroqRequestError) throw error
    throw new GroqRequestError(record.status === "INVALID_RESPONSE" ? 502 : 503, record.status === "INVALID_RESPONSE" ? "AI_INVALID_RESPONSE" : "AI_PROVIDER_UNAVAILABLE")
  } finally {
    record.durationMs = Date.now() - start
    try { await writeProviderUsage(record) } catch { throw new GroqRequestError(503, "AI_METERING_UNAVAILABLE") }
  }
}

export function completionJson(payload: unknown): unknown {
  const value = payload as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }> }
  const choice = value.choices?.[0]
  if (choice?.finish_reason === "length" || !choice?.message?.content) throw new GroqRequestError(502, "AI_INVALID_RESPONSE")
  return JSON.parse(choice.message.content)
}
