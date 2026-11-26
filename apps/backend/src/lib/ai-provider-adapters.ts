import { z } from "zod"
import type { AiModelDefinition, AiProviderId } from "./ai-model-catalog.js"
import type { AiMessages } from "./ai-token-budget.js"

export type AiProviderRequest = {
  provider?: AiProviderId; apiKey: string; model: string; baseUrl: string; purpose: string
  messages: AiMessages; maxTokens?: number; signal?: AbortSignal
}
export type AiProviderUsage = { input: number; output: number; cached: number; reasoning: number | null }
export type AiProviderAdapter = {
  configuration: { apiKeyEnv: string; modelEnv: string; baseUrlEnv: string; defaultModel: string; defaultUrl: string }
  send(request: AiProviderRequest, model: AiModelDefinition | undefined, maxTokens: number): Promise<Response>
  completion(payload: Record<string, unknown>): unknown
  model(payload: Record<string, unknown>): string | null
  usage(payload: Record<string, unknown>): AiProviderUsage | null
}
const count = z.number().int().nonnegative().max(2147483647)
const usageSchema = z.object({
  prompt_tokens: count, completion_tokens: count,
  prompt_tokens_details: z.object({ cached_tokens: count.optional() }).optional(),
  completion_tokens_details: z.object({ reasoning_tokens: count.optional() }).optional(),
}).refine(u => (u.prompt_tokens_details?.cached_tokens ?? 0) <= u.prompt_tokens && (u.completion_tokens_details?.reasoning_tokens ?? 0) <= u.completion_tokens)

// New providers implement this transport/usage contract once. Credit accounting
// and request budgeting are exclusively owned by the shared request runner.
const groq: AiProviderAdapter = {
  configuration: { apiKeyEnv: "GROQ_API_KEY", modelEnv: "GROQ_MODEL", baseUrlEnv: "GROQ_BASE_URL", defaultModel: "qwen/qwen3.8-27b", defaultUrl: "https://api.groq.com/openai/v1/chat/completions" },
  completion: payload => payload,
  send: (request, model, maxTokens) => fetch(request.baseUrl, {
    method: "POST", signal: AbortSignal.any([AbortSignal.timeout(30000), ...(request.signal ? [request.signal] : [])]),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${request.apiKey}` },
    body: JSON.stringify({ model: request.model, temperature: 0.2, max_completion_tokens: maxTokens,
      ...(model?.requestOptions ?? (request.model.startsWith("qwen/") ? { reasoning_effort: "none", reasoning_format: "hidden" } : {})),
      response_format: { type: "json_object" }, messages: request.messages }),
  }),
  model: payload => typeof payload.model === "string" ? payload.model.slice(0, 120) : null,
  usage: payload => {
    const result = usageSchema.safeParse(payload.usage)
    if (!result.success) return null
    const u = result.data
    return { input: u.prompt_tokens, output: u.completion_tokens, cached: u.prompt_tokens_details?.cached_tokens ?? 0, reasoning: u.completion_tokens_details?.reasoning_tokens ?? null }
  },
}
export const aiProviderAdapters: Readonly<Partial<Record<AiProviderId, AiProviderAdapter>>> = { groq }
