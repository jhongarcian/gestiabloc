import assert from "node:assert/strict"
import { test } from "node:test"
import { requestGroq, providerCost, completionJson, GroqRequestError } from "./groq-request.js"
import { withAiUsage, type ProviderUsageRecord } from "./ai-provider-usage.js"

const request = { apiKey: "secret", model: "openai/gpt-oss-120b", baseUrl: "https://example.test", purpose: "CHAT", messages: [{ role: "user", content: "private question" }] }
test("enabled enforcement blocks provider calls outside a credit reservation", async t => {
  const previous = process.env.AI_CREDIT_ENFORCEMENT_ENABLED
  process.env.AI_CREDIT_ENFORCEMENT_ENABLED = "true"
  t.after(() => { if (previous === undefined) delete process.env.AI_CREDIT_ENFORCEMENT_ENABLED; else process.env.AI_CREDIT_ENFORCEMENT_ENABLED = previous })
  await assert.rejects(requestGroq(request, completionJson), /AI_BILLING_UNAVAILABLE/)
})
function response(usage: unknown = { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 50 }, completion_tokens_details: { reasoning_tokens: 10 } }) {
  return new Response(JSON.stringify({ model: request.model, usage, choices: [{ message: { content: '{"answer":"yes"}' }, finish_reason: "stop" }] }))
}
test("fixed-precision pricing counts cached input and reasoning subsets once, with unknown prices explicit", () => {
  assert.equal(providerCost(request.model, 100, 20, 50), "0.000023250")
  assert.equal(providerCost(request.model, 6000, 800), "0.001380000")
  assert.equal(providerCost("unknown", 6000, 800), null)
})
test("attempts capture usage without content, share a logical request and bound internal calls", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  const records: ProviderUsageRecord[] = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    assert.equal(body.reasoning_effort, "low"); assert.equal(body.reasoning_format, "hidden")
    assert.ok(body.max_completion_tokens <= 1800)
    return response()
  }
  await withAiUsage({ tenantId: "one", actorId: "actor", channel: "TEST" }, async () => {
    await requestGroq(request, completionJson); await requestGroq({ ...request, purpose: "FAQ_MATCH" }, completionJson)
  }, async r => { records.push(structuredClone(r)) })
  assert.deepEqual(records.map(r => r.status), ["STARTED", "SUCCESS", "STARTED", "SUCCESS"])
  assert.equal(new Set(records.map(r => r.logicalRequestId)).size, 1)
  assert.equal(records[1]!.reasoningTokens, 10)
  assert.equal(records[1]!.estimatedCostUsd, "0.000023250")
  assert.doesNotMatch(JSON.stringify(records), /private question|\"answer\"|secret/)
})
test("invalid output still records paid token usage; timeout and missing usage stay uncertain", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  const records: ProviderUsageRecord[] = []
  await withAiUsage({ channel: "TEST" }, async () => {
    globalThis.fetch = async () => response()
    await assert.rejects(requestGroq(request, () => { throw new Error("invalid citation") }), GroqRequestError)
    globalThis.fetch = async () => { throw new Error("secret provider failure") }
    await assert.rejects(requestGroq(request, completionJson), /AI_PROVIDER_UNAVAILABLE/)
  }, async r => { records.push(structuredClone(r)) })
  assert.equal(records[1]!.status, "INVALID_RESPONSE"); assert.notEqual(records[1]!.estimatedCostUsd, null)
  assert.equal(records[3]!.status, "TRANSPORT_ERROR"); assert.equal(records[3]!.estimatedCostUsd, null)
  assert.notEqual(records[3]!.upperBoundCostUsd, null)
  globalThis.fetch = async () => response(undefined)
  // Deliberately absent usage, not a zero-token success.
  globalThis.fetch = async () => response({})
  await withAiUsage({ channel: "TEST" }, () => requestGroq(request, completionJson), async r => { records.push(structuredClone(r)) })
  assert.equal(records.at(-1)!.status, "USAGE_UNKNOWN")
})
test("cross-call budget refuses another call after uncertain output and prevents oversize input", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  let calls = 0
  globalThis.fetch = async () => { calls++; return response({}) }
  await withAiUsage({ channel: "TEST" }, async () => {
    await requestGroq(request, completionJson)
    await assert.rejects(requestGroq(request, completionJson), /AI_CONTEXT_TOO_LARGE/)
  }, async () => {})
  await assert.rejects(requestGroq({ ...request, messages: [{ role: "user", content: "oversize ".repeat(10000) }] }, completionJson), /AI_CONTEXT_TOO_LARGE/)
  assert.equal(calls, 1)
})
test("metering failure before dispatch prevents an untracked provider call; concurrent tenants stay isolated", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
  let calls = 0
  globalThis.fetch = async () => { calls++; return response() }
  await assert.rejects(withAiUsage({ channel: "TEST" }, () => requestGroq(request, completionJson), async () => { throw new Error("DB unavailable") }), /AI_METERING_UNAVAILABLE/)
  assert.equal(calls, 0)
  const records: ProviderUsageRecord[] = []
  await Promise.all(["one", "two"].map(tenantId => withAiUsage({ tenantId, channel: "TEST" }, () => requestGroq(request, completionJson), async r => { records.push(structuredClone(r)) })))
  const completed = records.filter(r => r.status === "SUCCESS")
  assert.deepEqual(completed.map(r => r.tenantId).sort(), ["one", "two"])
  assert.notEqual(completed[0]!.logicalRequestId, completed[1]!.logicalRequestId)
})
