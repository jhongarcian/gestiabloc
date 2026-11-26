import { randomUUID } from "node:crypto"
import { aiModelCost, findAiModel, isAiModelApproved, modelKey } from "./ai-model-catalog.js"
import { aiProviderAdapters, type AiProviderAdapter, type AiProviderRequest } from "./ai-provider-adapters.js"
import { countAiInput } from "./ai-token-budget.js"
import { currentAiUsage, withAiUsage, writeProviderUsage, type ProviderUsageRecord } from "./ai-provider-usage.js"

export class AiProviderRequestError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}
export function createAiProviderRequest(adapters = aiProviderAdapters) {
  return async function requestAi<T>(request: AiProviderRequest, parse: (payload: unknown) => T): Promise<T> {
    if (!currentAiUsage()) return withAiUsage({ channel: "SYSTEM" }, () => requestAi(request, parse))
    const scope = currentAiUsage()!, provider = request.provider ?? "groq"
    const adapter: AiProviderAdapter | undefined = Object.hasOwn(adapters, provider) ? adapters[provider] : undefined
    const model = findAiModel({ provider, model: request.model })
    const enforced = process.env.AI_CREDIT_ENFORCEMENT_ENABLED === "true"
    if (!adapter) throw new AiProviderRequestError(503, "AI_PROVIDER_UNAVAILABLE")
    if (enforced && (!scope.creditRequestId || !model || !isAiModelApproved(model, process.env) || scope.billingModelKey !== modelKey(model) || scope.billingPolicyVersion !== model.policyVersion))
      throw new AiProviderRequestError(503, "AI_BILLING_UNAVAILABLE")
    const limited = Boolean(model && (enforced || model.limitUnbilledRequests || scope.budgetModelKey === modelKey(model)))
    const input = countAiInput(request.messages, model)
    const maxTokens = limited ? Math.min(request.maxTokens ?? model!.maxOutputTokens, model!.maxOutputTokens - scope.output) : request.maxTokens ?? 1800
    if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0 || (limited && input + scope.input > model!.maxInputTokens))
      throw new AiProviderRequestError(413, "AI_CONTEXT_TOO_LARGE")
    const record: ProviderUsageRecord = {
      id: randomUUID(), logicalRequestId: scope.logicalRequestId, tenantId: scope.tenantId ?? null, actorId: scope.actorId ?? null,
      channel: scope.channel, purpose: request.purpose, provider, requestedModel: request.model, model: null,
      status: "STARTED", httpStatus: null, durationMs: 0, inputTokens: null, outputTokens: null,
      cachedTokens: null, reasoningTokens: null, estimatedCostUsd: null,
      upperBoundCostUsd: aiModelCost(model, input, maxTokens), rateVersion: model?.rateVersion ?? "unknown",
    }
    try { await writeProviderUsage(record) } catch { throw new AiProviderRequestError(503, "AI_METERING_UNAVAILABLE") }
    const start = Date.now()
    scope.input += input
    scope.output += maxTokens
    try {
      const response = await adapter.send(request, model, maxTokens)
      record.httpStatus = response.status
      if (!response.ok) { record.status = "HTTP_ERROR"; throw new AiProviderRequestError(response.status === 429 ? 429 : 503, response.status === 429 ? "AI_PROVIDER_BUSY" : "AI_PROVIDER_UNAVAILABLE") }
      record.status = "INVALID_RESPONSE"
      const payload = await response.json() as Record<string, unknown>
      record.model = adapter.model(payload)
      const usage = adapter.usage(payload)
      if (usage) {
        record.inputTokens = usage.input; record.outputTokens = usage.output
        record.cachedTokens = usage.cached; record.reasoningTokens = usage.reasoning
        const actualModel = record.model ? findAiModel({ provider, model: record.model }) : undefined
        record.estimatedCostUsd = aiModelCost(actualModel, usage.input, usage.output, usage.cached)
        if (actualModel) record.rateVersion = actualModel.rateVersion
        scope.input += usage.input - input; scope.output += usage.output - maxTokens
      }
      if (enforced && record.model !== request.model) throw new AiProviderRequestError(502, "AI_INVALID_RESPONSE")
      const value = parse(adapter.completion(payload))
      record.status = usage && record.estimatedCostUsd !== null ? "SUCCESS" : "USAGE_UNKNOWN"
      return value
    } catch (error) {
      if (record.status === "STARTED") record.status = "TRANSPORT_ERROR"
      if (error instanceof AiProviderRequestError) throw error
      throw new AiProviderRequestError(record.status === "INVALID_RESPONSE" ? 502 : 503, record.status === "INVALID_RESPONSE" ? "AI_INVALID_RESPONSE" : "AI_PROVIDER_UNAVAILABLE")
    } finally {
      record.durationMs = Date.now() - start
      try { await writeProviderUsage(record) } catch { throw new AiProviderRequestError(503, "AI_METERING_UNAVAILABLE") }
    }
  }
}
export const requestAi = createAiProviderRequest()

export function completionJson(payload: unknown): unknown {
  const value = payload as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }> }
  const choice = value.choices?.[0]
  if (choice?.finish_reason === "length" || !choice?.message?.content) throw new AiProviderRequestError(502, "AI_INVALID_RESPONSE")
  return JSON.parse(choice.message.content)
}
