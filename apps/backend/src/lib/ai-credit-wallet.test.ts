import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { AiCreditRequestSchema, grantMonthlyAiCredits, grantPurchasedAiCredits, reserveAiCredit } from "./ai-credit-wallet.js"

test("credit operations reject malformed identities, periods and packs before opening a transaction", async () => {
  const db = { $transaction: () => { throw new Error("Database must not be touched") } } as never
  const tenantId = randomUUID()
  const key = { tenantId, actorId: randomUUID(), requestId: randomUUID(), channel: "TEST", requestHash: "a".repeat(64) }
  assert.equal(AiCreditRequestSchema.safeParse(key).success, true)
  for (const invalid of [{ ...key, tenantId: "foreign" }, { ...key, requestHash: "prompt content" }, { ...key, channel: "CLIENT_CHOSEN" }])
    await assert.rejects(reserveAiCredit(db, invalid as never), { name: "ZodError" })
  await assert.rejects(grantMonthlyAiCredits(db, { tenantId, planKey: "STARTER", sourceKey: "invoice", startsAt: new Date(1), endsAt: new Date(0) }), { name: "ZodError" })
  await assert.rejects(grantPurchasedAiCredits(db, { tenantId, sourceKey: "invoice", packKey: "AI_1" as never }), { name: "ZodError" })
})
