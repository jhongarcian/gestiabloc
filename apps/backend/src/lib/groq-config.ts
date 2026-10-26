// Shared server-only configuration for qualification explanations and workspace chat.
export function getGroqConfiguration() {
  if (process.env.SERVICE_FIT_AI_PROVIDER?.trim().toLowerCase() !== "groq")
    return null
  const apiKey = process.env.GROQ_API_KEY?.trim()
  if (!apiKey) return null
  return {
    apiKey,
    model: process.env.GROQ_MODEL?.trim() || "qwen/qwen3.8-27b",
    baseUrl:
      process.env.GROQ_BASE_URL?.trim() ||
      "https://api.groq.com/openai/v1/chat/completions",
  }
}
