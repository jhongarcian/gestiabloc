import { aiProviderAdapters } from "./ai-provider-adapters.js"
import { findAiModel, isAiModelApproved, type AiProviderId } from "./ai-model-catalog.js"

export function configuredAiModel(env: Record<string, string | undefined> = process.env) {
  const provider = env.SERVICE_FIT_AI_PROVIDER?.trim().toLowerCase() as AiProviderId | undefined
  const adapter = provider && Object.hasOwn(aiProviderAdapters, provider) ? aiProviderAdapters[provider] : undefined
  if (!provider || !adapter) return null
  const config = adapter.configuration
  return { provider, model: env.AI_MODEL?.trim() || env[config.modelEnv]?.trim() || config.defaultModel }
}
export function getAiConfiguration(env: Record<string, string | undefined> = process.env) {
  const reference = configuredAiModel(env)
  if (!reference) return null
  const config = aiProviderAdapters[reference.provider]!.configuration
  const apiKey = env[config.apiKeyEnv]?.trim()
  if (!apiKey) return null
  const model = findAiModel(reference)
  if (model?.requirePreviewApproval && !isAiModelApproved(model, env)) return null
  if (env.AI_CREDIT_ENFORCEMENT_ENABLED === "true" && (!model || !isAiModelApproved(model, env))) return null
  return { ...reference, apiKey, baseUrl: env[config.baseUrlEnv]?.trim() || config.defaultUrl }
}
