import { getAiConfiguration } from "./ai-provider-config.js"
// Shared server-only configuration for qualification explanations and workspace chat.
export function getGroqConfiguration(env: Record<string, string | undefined> = process.env) {
  const config = getAiConfiguration(env)
  return config?.provider === "groq" ? config : null
}
