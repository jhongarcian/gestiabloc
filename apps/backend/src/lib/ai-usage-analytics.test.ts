import assert from "node:assert/strict"
import { test } from "node:test"
import { buildAiUsageAnalytics } from "./ai-usage-analytics.js"

test("usage zero-fills dates without replacing period totals or counting missing provider tokens as known", () => {
  const dates = ["2026-11-24", "2026-11-25"]
  const report = buildAiUsageAnalytics([{ date: null, creditsUsed: 12, chargedReplies: 1 }, { date: dates[1]!, creditsUsed: 12, chargedReplies: 1 }], [
    { date: null, providerCalls: 3, inputTokens: 200, outputTokens: 25, unknownTokenCalls: 1, inProgressCalls: 0, failedCalls: 1 },
    { date: dates[1]!, providerCalls: 3, inputTokens: 200, outputTokens: 25, unknownTokenCalls: 1, inProgressCalls: 0, failedCalls: 1 },
  ], dates)
  assert.equal(report.totals.creditsUsed, 12); assert.equal(report.totals.chargedReplies, 1)
  assert.equal(report.totals.providerCalls, 3); assert.equal(report.totals.unknownTokenCalls, 1)
  assert.equal(report.daily[0]!.creditsUsed, 0); assert.equal(report.daily[1]!.inputTokens, 200)
  assert.deepEqual(buildAiUsageAnalytics([], [], dates).daily.map(day => day.providerCalls), [0, 0])
  assert.throws(() => buildAiUsageAnalytics([{ date: null, creditsUsed: -1, chargedReplies: 1 }], [], dates), /Invalid/)
})
