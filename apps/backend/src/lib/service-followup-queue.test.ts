import assert from "node:assert/strict"
import { test } from "node:test"
import { followUpUrgency } from "./service-followup-queue.js"

test("urgency uses the effective timeframe, with exact final-quarter and overdue boundaries", () => {
  const enteredAt = new Date("2026-10-01T12:00:00Z")
  const dueAt = new Date("2026-10-21T12:00:00Z")
  const input = { enteredAt, dueAt, actionable: true }
  assert.equal(followUpUrgency(input, new Date("2026-10-16T11:59:59.999Z")).status, "ON_TRACK")
  const warning = followUpUrgency(input, new Date("2026-10-16T12:00:00Z"))
  assert.equal(warning.status, "DUE_SOON")
  assert.equal(warning.remainingMs, 5 * 86400000)
  assert.equal(warning.timeframeMs, 20 * 86400000)
  assert.equal(warning.warningAt?.toISOString(), "2026-10-16T12:00:00.000Z")
  assert.equal(followUpUrgency(input, dueAt).status, "OVERDUE")
  assert.equal(followUpUrgency(input, new Date(dueAt.getTime() + 1000)).remainingMs, -1000)
  // Short minute-based deadlines and offset timestamps use the same elapsed clock.
  assert.equal(
    followUpUrgency(
      { enteredAt, dueAt: new Date(enteredAt.getTime() + 60000), actionable: true },
      new Date(enteredAt.getTime() + 45000),
    ).status,
    "DUE_SOON",
  )
})

test("unentered, scheduled and resolved work cannot become overdue", () => {
  const now = new Date("2026-10-20T12:00:00Z")
  const enteredAt = new Date("2026-10-01T12:00:00Z")
  const dueAt = new Date("2026-10-02T12:00:00Z")
  for (const input of [
    { enteredAt: null, dueAt, actionable: true },
    { enteredAt, dueAt, actionable: false },
    { enteredAt, dueAt: null, actionable: true },
    { enteredAt: now, dueAt, actionable: true },
    {
      enteredAt: new Date(now.getTime() + 1000),
      dueAt: new Date(now.getTime() + 2000),
      actionable: true,
    },
  ])
    assert.deepEqual(followUpUrgency(input, now), {
      status: "NONE",
      remainingMs: null,
      timeframeMs: null,
      warningAt: null,
    })
})
