import assert from "node:assert/strict"
import { test } from "node:test"
import { encryptReviewDetails, decryptReviewDetails, aiReviewCaptureAvailable, AI_REVIEW_TTL_MS } from "./ai-review-details.js"
import { recordAiInteraction } from "./ai-analytics.js"

const env = { AI_REPLAY_ENCRYPTION_KEY: Buffer.alloc(32, 31).toString("base64") }
const identity = { tenantId: "tenant", actorId: "actor", channel: "TEST", requestId: "request" }
const details = { question: "Private fixture question?", answer: "Private fixture reply.", sourceLabels: ["Saved FAQ"] }
test("review details are encrypted, bound to their tenant/request/expiry and unavailable after thirty days", () => {
  const now = new Date("2026-11-25T12:00:00Z"), encrypted = encryptReviewDetails(details, identity, now, env)
  assert.doesNotMatch(JSON.stringify(encrypted), /Private fixture|Saved FAQ/)
  assert.deepEqual(decryptReviewDetails(encrypted, identity, now, env), details)
  assert.notEqual(encryptReviewDetails(details, identity, now, env).reviewCiphertext, encrypted.reviewCiphertext)
  for (const change of [{ tenantId: "foreign" }, { actorId: "foreign" }, { channel: "CONTACT_ASSISTANT" }, { requestId: "foreign" }]) assert.throws(() => decryptReviewDetails(encrypted, { ...identity, ...change }, now, env))
  assert.throws(() => decryptReviewDetails({ ...encrypted, reviewExpiresAt: new Date(encrypted.reviewExpiresAt.getTime() + 1) }, identity, now, env))
  assert.throws(() => decryptReviewDetails(encrypted, identity, new Date(now.getTime() + AI_REVIEW_TTL_MS), env))
  assert.equal(aiReviewCaptureAvailable({}), false)
  assert.equal(aiReviewCaptureAvailable(env), true)
})
test("answered interactions never persist supplied question/answer details; flagged capture failure keeps safe metadata", async () => {
  const rows: unknown[] = []
  const db = { aiInteraction: { createMany: async ({ data }: { data: unknown }) => { rows.push(data); return { count: 1 } } } } as unknown as Parameters<typeof recordAiInteraction>[0]
  const metadata = { ...identity, channel: "TEST" as const, qualificationRun: false }
  await recordAiInteraction(db, { ...metadata, questionOutcome: "ANSWERED", review: details })
  assert.doesNotMatch(JSON.stringify(rows), /Private fixture|reviewCiphertext|reviewReason/)
  assert.equal("review" in (rows[0] as object[])[0]!, false)
  const oldKey = process.env.AI_REPLAY_ENCRYPTION_KEY
  process.env.AI_REPLAY_ENCRYPTION_KEY = "invalid"
  try { await recordAiInteraction(db, { ...metadata, questionOutcome: "NEEDS_REVIEW", review: details }) }
  finally { if (oldKey === undefined) delete process.env.AI_REPLAY_ENCRYPTION_KEY; else process.env.AI_REPLAY_ENCRYPTION_KEY = oldKey }
  assert.doesNotMatch(JSON.stringify(rows), /Private fixture|reviewCiphertext/)
  assert.equal((rows[1] as { reviewReason: string }[])[0]?.reviewReason, "OTHER")
})
