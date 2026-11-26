// Compatibility exports for existing Groq callers. Billing, metering and budgets
// live in the provider-independent runner and catalog.
import { aiModelCost, aiModels, findAiModel } from "./ai-model-catalog.js"
import { countAiInput, type AiMessages } from "./ai-token-budget.js"
export { requestAi as requestGroq, completionJson, AiProviderRequestError as GroqRequestError } from "./ai-provider-request.js"
export type { AiProviderRequest as GroqRequest } from "./ai-provider-adapters.js"
export { nanoUsd } from "./ai-model-catalog.js"
export const GROQ_RATES = Object.fromEntries(aiModels.filter(model => model.provider === "groq").map(model => [model.model, model.rates]))
export const GROQ_RATE_VERSION = findAiModel("openai/gpt-oss-120b")!.rateVersion
export const providerCost = (model: string, input: number, output: number, cached = 0) => aiModelCost(findAiModel(model), input, output, cached)
export const countGroqInput = (messages: AiMessages) => countAiInput(messages, findAiModel("openai/gpt-oss-120b"))
