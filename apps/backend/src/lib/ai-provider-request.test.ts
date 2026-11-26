import assert from "node:assert/strict"
import { test } from "node:test"
import { requestAi, completionJson, createAiProviderRequest } from "./ai-provider-request.js"
import { withAiUsage, type ProviderUsageRecord } from "./ai-provider-usage.js"
import { findAiModel, modelApprovalKey, modelKey } from "./ai-model-catalog.js"
import type { AiProviderAdapter } from "./ai-provider-adapters.js"

test("the shared runner enforces the reserved model and applies another model's policy", async t => {
  const model = findAiModel("openai/gpt-oss-20b")!, qwen = findAiModel("qwen/qwen3.8-27b")!
  const oldEnforced = process.env.AI_CREDIT_ENFORCEMENT_ENABLED, oldApproved = process.env.AI_CREDIT_APPROVED_MODELS, original = globalThis.fetch
  process.env.AI_CREDIT_ENFORCEMENT_ENABLED = "true"
  process.env.AI_CREDIT_APPROVED_MODELS = [modelApprovalKey(model), modelApprovalKey(qwen)].join(",")
  t.after(() => { globalThis.fetch = original; if (oldEnforced === undefined) delete process.env.AI_CREDIT_ENFORCEMENT_ENABLED; else process.env.AI_CREDIT_ENFORCEMENT_ENABLED = oldEnforced; if (oldApproved === undefined) delete process.env.AI_CREDIT_APPROVED_MODELS; else process.env.AI_CREDIT_APPROVED_MODELS = oldApproved })
  let calls = 0
  globalThis.fetch = async (_url, options) => {
    calls++
    assert.equal(JSON.parse(String(options?.body)).max_completion_tokens, 1800)
    return new Response(JSON.stringify({ model: model.model, usage: { prompt_tokens: 100, completion_tokens: 10 }, choices: [{ finish_reason: "stop", message: { content: '{"answer":"yes"}' } }] }))
  }
  const request = { provider: "groq" as const, model: model.model, apiKey: "fixture", baseUrl: "https://example.test", purpose: "CHAT", maxTokens: 3000, messages: [{ role: "user", content: "Hello" }] }
  const records: ProviderUsageRecord[] = []
  const context = { tenantId: "tenant", channel: "TEST", creditRequestId: "reserved", billingModelKey: modelKey(model), billingPolicyVersion: model.policyVersion }
  await withAiUsage(context, async () => {
    assert.deepEqual(await requestAi(request, completionJson), { answer: "yes" })
    await assert.rejects(requestAi({ ...request, model: qwen.model }, completionJson), /AI_BILLING_UNAVAILABLE/)
  }, async record => { records.push({ ...record }) })
  assert.equal(calls, 1)
  assert.equal(records.at(-1)!.estimatedCostUsd, "0.000010500")
  await withAiUsage({ ...context, billingPolicyVersion: "stale" }, async () => {
    await assert.rejects(requestAi(request, completionJson), /AI_BILLING_UNAVAILABLE/)
  }, async () => {})
  await withAiUsage({ ...context, billingModelKey: modelKey(qwen) }, async () => {
    await assert.rejects(requestAi({ ...request, model: qwen.model, messages: [{ role: "user", content: "x".repeat(qwen.maxInputTokens + 100) }] }, completionJson), /AI_CONTEXT_TOO_LARGE/)
  }, async () => {})
  assert.equal(calls, 1)
  globalThis.fetch = async () => new Response(JSON.stringify({ model: "openai/gpt-oss-120b", usage: { prompt_tokens: 100, completion_tokens: 10 }, choices: [{ finish_reason: "stop", message: { content: '{"answer":"different model"}' } }] }))
  await withAiUsage(context, async () => {
    await assert.rejects(requestAi(request, completionJson), /AI_INVALID_RESPONSE/)
  }, async record => { records.push({ ...record }) })
  assert.equal(records.at(-1)!.model, "openai/gpt-oss-120b")
  assert.equal(records.at(-1)!.inputTokens, 100)
  assert.equal(records.at(-1)!.status, "INVALID_RESPONSE")
})

test("new provider adapters normalize their own response format and usage without changing metering", async () => {
  const adapter: AiProviderAdapter = {
    configuration: { apiKeyEnv: "TEST_KEY", modelEnv: "TEST_MODEL", baseUrlEnv: "TEST_URL", defaultModel: "fixture-model", defaultUrl: "https://example.test" },
    send: async () => new Response(JSON.stringify({ deployed: "fixture-model", text: "Synthetic reply", tokens: 42 })),
    model: payload => String(payload.deployed),
    usage: payload => ({ input: Number(payload.tokens), output: 5, cached: 0, reasoning: null }),
    completion: payload => ({ answer: payload.text }),
  }
  const request = createAiProviderRequest({ anthropic: adapter })
  const records: ProviderUsageRecord[] = []
  const reply = await withAiUsage({ tenantId: "tenant", channel: "TEST" }, () => request({ provider: "anthropic", model: "fixture-model", apiKey: "fixture", baseUrl: "https://example.test", purpose: "CHAT", messages: [] }, payload => payload), async record => { records.push({ ...record }) })
  assert.deepEqual(reply, { answer: "Synthetic reply" })
  assert.equal(records.at(-1)!.provider, "anthropic")
  assert.equal(records.at(-1)!.inputTokens, 42)
  assert.equal(records.at(-1)!.status, "USAGE_UNKNOWN")
  assert.equal(records.at(-1)!.estimatedCostUsd, null)
  await assert.rejects(requestAi({ provider: "anthropic", model: "unconnected", apiKey: "fixture", baseUrl: "https://example.test", purpose: "CHAT", messages: [] }, payload => payload), /AI_PROVIDER_UNAVAILABLE/)
})
