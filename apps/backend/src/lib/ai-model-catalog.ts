// Server-owned policy. A catalog entry never approves itself for customer billing.
export type AiProviderId = "groq" | "openai" | "anthropic"
export type AiModelReference = { provider: AiProviderId; model: string }
export type AiModelSelection = string | AiModelReference
export type AiModelDefinition = AiModelReference & {
  policyVersion: string
  rateVersion: string
  rates: { input: bigint; output: bigint; cached: bigint }
  creditsPerReply: number
  maxInputTokens: number
  maxOutputTokens: number
  inputEstimator: "harmony" | "utf8"
  requestOptions: { reasoning_effort: "low" | "none"; reasoning_format: "hidden" }
  requirePreviewApproval: boolean
  limitUnbilledRequests: boolean
}

const groq = (model: string, input: bigint, output: bigint, cached: bigint, creditsPerReply: number, oss: boolean): AiModelDefinition => ({
  provider: "groq", model, rates: { input, output, cached }, creditsPerReply,
  policyVersion: "v1", rateVersion: "groq-2026-10-28",
  maxInputTokens: oss ? 6000 : 24000, maxOutputTokens: 1800,
  inputEstimator: oss ? "harmony" : "utf8",
  requestOptions: { reasoning_effort: oss ? "low" : "none", reasoning_format: "hidden" },
  requirePreviewApproval: oss, limitUnbilledRequests: oss,
})

// USD nanodollars per token. Qwen uses a conservative UTF-8 preflight bound:
// allow enough room for the grounding prompt and price its $0.0264 upper estimate.
// Its twelve-credit policy is staged, not activated (at least $0.054 in pack value).
export const aiModels: readonly AiModelDefinition[] = [
  groq("openai/gpt-oss-120b", 150n, 600n, 75n, 1, true),
  groq("openai/gpt-oss-20b", 75n, 300n, 75n, 1, true),
  groq("qwen/qwen3.8-27b", 800n, 4000n, 800n, 12, false),
]

export const modelReference = (selection: AiModelSelection): AiModelReference => typeof selection === "string" ? { provider: "groq", model: selection } : selection
export const modelKey = (reference: AiModelReference) => `${reference.provider}:${reference.model}`
export const modelApprovalKey = (definition: AiModelDefinition) => `${modelKey(definition)}@${definition.policyVersion}`
export function findAiModel(selection?: AiModelSelection): AiModelDefinition | undefined {
  if (!selection) return undefined
  const ref = modelReference(selection)
  return aiModels.find(item => item.provider === ref.provider && item.model === ref.model)
}
export function approvedAiModels(env: { AI_CREDIT_APPROVED_MODELS?: string }) {
  const approvals = (env.AI_CREDIT_APPROVED_MODELS ?? "").split(",").map(value => value.trim()).filter(Boolean)
  if (approvals.some(key => !aiModels.some(model => modelApprovalKey(model) === key))) throw new Error("Unknown AI model approval or policy version")
  return approvals
}
export function isAiModelApproved(model: AiModelDefinition, env: Record<string, string | undefined>) {
  // Preserve the existing rollout approval for this original model only.
  return approvedAiModels(env).includes(modelApprovalKey(model)) ||
    (env.AI_CREDIT_MODEL_GATE_PASSED === "true" && modelApprovalKey(model) === "groq:openai/gpt-oss-120b@v1")
}
export const nanoUsd = (value: bigint) => `${value / 1_000_000_000n}.${String(value % 1_000_000_000n).padStart(9, "0")}`
export function aiModelCost(model: AiModelDefinition | undefined, input: number, output: number, cached = 0) {
  if (!model) return null
  if (![input, output, cached].every(value => Number.isSafeInteger(value) && value >= 0) || cached > input) throw new Error("Invalid AI token counts")
  return nanoUsd(BigInt(input - cached) * model.rates.input + BigInt(cached) * model.rates.cached + BigInt(output) * model.rates.output)
}
