import assert from "node:assert/strict"
import { test } from "node:test"
import {
  followUpTimeRemaining,
  sanitizeFollowUpQueue,
  type FollowUpTiming,
} from "./follow-up-queue"

test("remaining time stays meaningful for minute, hour and multi-day deadlines", () => {
  const timing: FollowUpTiming = {
    status: "ON_TRACK",
    remainingMs: 30000,
    timeframeMs: 60000,
    warningAt: null,
  }
  assert.equal(followUpTimeRemaining(timing), "Less than a minute left")
  assert.equal(followUpTimeRemaining({ ...timing, remainingMs: 60000 }), "1 minute left")
  assert.equal(followUpTimeRemaining({ ...timing, remainingMs: 90 * 60000 }), "1 hour 30 min left")
  assert.equal(followUpTimeRemaining({ ...timing, remainingMs: 25 * 3600000 }), "1 day 1 hr left")
  assert.equal(
    followUpTimeRemaining({ ...timing, status: "OVERDUE", remainingMs: -2 * 86400000 }),
    "2 days overdue",
  )
  assert.equal(followUpTimeRemaining({ ...timing, status: "NONE" }), null)
  assert.equal(followUpTimeRemaining({ ...timing, remainingMs: null }), null)
})

test("queue filters retain supported selections and reject unknown URL states", () => {
  for (const state of ["ALL", "ACTIONABLE", "SCHEDULED", "NEEDS_ATTENTION", "FINISHED"])
    assert.equal(sanitizeFollowUpQueue(state), state)
  assert.equal(sanitizeFollowUpQueue(null), "ALL")
  assert.equal(sanitizeFollowUpQueue("OVERDUE"), "ALL")
})
