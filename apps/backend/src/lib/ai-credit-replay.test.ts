import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { aiCreditFingerprint, encryptAiReply, decryptAiReply, AI_REPLAY_TTL_MS } from "./ai-credit-replay.js"
import { createAiReplyExecutor } from "./ai-credit-execution.js"
import { creditTestEnv as env } from "./ai-credit-execution.test-fixtures.js"
import { getBillingConfiguration } from "./billing-config.js"
const identity = { tenantId: randomUUID(), actorId: randomUUID(), channel: "TEST" as const, requestId: randomUUID(), conversationId: randomUUID() }
const p = { ...identity, requestHash: "a".repeat(64) }, now = new Date("2026-10-29T12:00:00Z")
test("replay is encrypted, authenticated to the exact request and expires at fifteen minutes", () => {
  const reply = { answer: "Synthetic private response", sourceIds: [] }
  const encrypted = encryptAiReply(reply, p, now, env)
  assert.doesNotMatch(JSON.stringify(encrypted), /Synthetic private response/)
  assert.deepEqual(decryptAiReply(encrypted, p, now, env), reply)
  assert.notEqual(encryptAiReply(reply, p, now, env).responseCiphertext, encrypted.responseCiphertext)
  for (const changed of [{ ...p, tenantId: randomUUID() }, { ...p, actorId: randomUUID() }, { ...p, requestId: randomUUID() }, { ...p, channel: "CONTACT_ASSISTANT" as const }, { ...p, requestHash: "b".repeat(64) }])
    assert.throws(() => decryptAiReply(encrypted, changed, now, env))
  assert.throws(() => decryptAiReply({ ...encrypted, responseExpiresAt: new Date(encrypted.responseExpiresAt.getTime() + 1) }, p, now, env))
  assert.throws(() => decryptAiReply({ ...encrypted, responseAuthTag: Buffer.alloc(16).toString("base64") }, p, now, env))
  assert.throws(() => decryptAiReply(encrypted, p, new Date(now.getTime() + AI_REPLAY_TTL_MS), env))
})
test("fingerprints use canonical keyed hashing and cover history, context and scope", () => {
  assert.equal(aiCreditFingerprint({ b: 2, a: 1 }, env), aiCreditFingerprint({ a: 1, b: 2 }, env))
  const original = aiCreditFingerprint({ question: "Hello", history: [], context: "original", scope: "service" }, env)
  for (const changed of [{ question: "Changed", history: [], context: "original", scope: "service" }, { question: "Hello", history: [], context: "changed", scope: "service" }, { question: "Hello", history: [], context: "original", scope: "case" }])
    assert.notEqual(aiCreditFingerprint(changed, env), original)
  assert.notEqual(aiCreditFingerprint({ a: 1 }, env), aiCreditFingerprint({ a: 1 }, { AI_REPLAY_ENCRYPTION_KEY: Buffer.alloc(32, 20).toString("base64") }))
})
test("disabled enforcement uses the old path; unsafe config and missing IDs fail before database/provider work", async () => {
  const db = { $transaction: () => { throw new Error("Unexpected database call") } } as never
  assert.equal(await createAiReplyExecutor(db, identity, { env: {} })({}, async () => "free"), "free")
  for (const override of [{ AI_PROVIDER_METERING_ENABLED: "false" }, { AI_CREDIT_MODEL_GATE_PASSED: "false" }, { AI_REPLAY_ENCRYPTION_KEY: "invalid" }])
    assert.throws(() => getBillingConfiguration({ ...env, ...override }))
  await assert.rejects(createAiReplyExecutor(db, identity, { env })({}, async () => "no", "qwen/qwen3.8-27b"), /AI_BILLING_UNAVAILABLE/)
  await assert.rejects(createAiReplyExecutor(db, { ...identity, requestId: undefined }, { env })({}, async () => "no", "openai/gpt-oss-120b"), /AI_REQUEST_ID_REQUIRED/)
})
