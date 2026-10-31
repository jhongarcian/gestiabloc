// Shared server-only configuration for qualification explanations and workspace chat.
export function getGroqConfiguration(env: Record<string, string | undefined> = process.env) {
  if (env.SERVICE_FIT_AI_PROVIDER?.trim().toLowerCase() !== "groq")
    return null
  const apiKey = env.GROQ_API_KEY?.trim()
  if (!apiKey) return null
  const model = env.GROQ_MODEL?.trim() || "qwen/qwen3.8-27b"
  // Benchmark tooling passes an explicit trusted config; deployed selection is gated.
  if (model.startsWith("openai/gpt-oss-") && env.AI_CREDIT_MODEL_GATE_PASSED !== "true") return null
  return {
    apiKey,
    model,
    baseUrl:
      env.GROQ_BASE_URL?.trim() ||
      "https://api.groq.com/openai/v1/chat/completions",
  }
}
