import assert from "node:assert/strict"
import { test } from "node:test"
import { AiAnalyticsQuerySchema, analyticsWindow, buildAiAnalytics } from "./ai-analytics.js"

test("analytics accepts only bounded periods and known channels", () => {
  assert.deepEqual(AiAnalyticsQuerySchema.parse({}), { days: "30", channel: "ALL" })
  for (const value of [{ days: "365" }, { channel: "foreign" }, { tenantId: "foreign" }, { days: ["7", "90"] }])
    assert.equal(AiAnalyticsQuerySchema.safeParse(value).success, false)
})

test("UTC calendar windows include today and cross leap days and DST without drifting", () => {
  assert.equal(analyticsWindow(7, new Date("2024-03-01T18:00:00Z")).start.toISOString(), "2024-02-24T00:00:00.000Z")
  assert.equal(analyticsWindow(7, new Date("2026-03-09T02:30:00Z")).start.toISOString(), "2026-03-03T00:00:00.000Z")
  assert.equal(analyticsWindow(90, new Date("2026-01-01T00:01:00Z")).start.toISOString(), "2025-10-04T00:00:00.000Z")
})

test("zero-filled charts retain database distinct conversation totals rather than summing daily chats", () => {
  const now = new Date("2026-03-09T12:00:00Z")
  const query = AiAnalyticsQuerySchema.parse({ days: "7", channel: "TEST" })
  const empty = buildAiAnalytics([], query, now)
  assert.equal(empty.daily.length, 7)
  assert.equal(empty.daily[6]?.date, "2026-03-09")
  assert.deepEqual(empty.totals, { conversations: 0, answered: 0, needsReview: 0, qualificationRuns: 0 })
  const result = buildAiAnalytics([
    { date: null, conversations: 1, answered: 2, needsReview: 1, qualificationRuns: 0 },
    { date: "2026-03-08", conversations: 1, answered: 1, needsReview: 0, qualificationRuns: 0 },
    { date: "2026-03-09", conversations: 1, answered: 1, needsReview: 1, qualificationRuns: 0 },
  ], query, now)
  assert.equal(result.totals.conversations, 1)
  assert.equal(result.daily.reduce((sum, day) => sum + day.conversations, 0), 2)
  assert.equal(result.daily.reduce((sum, day) => sum + day.answered, 0), result.totals.answered)
})
