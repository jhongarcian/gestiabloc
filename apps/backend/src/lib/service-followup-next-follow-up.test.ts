import assert from "node:assert/strict"
import test from "node:test"

import {
  resolveEffectiveNextFollowUp,
  serializeEffectiveNextFollowUp,
} from "./service-followup-next-follow-up.js"

test("projects a manual Wait timestamp onto the first pending step", () => {
  const result = resolveEffectiveNextFollowUp({
    steps: [
      { id: "completed", status: "COMPLETED", dueAt: null, availableAt: null },
      { id: "next", status: "PENDING", dueAt: null, availableAt: null },
      { id: "later", status: "PENDING", dueAt: null, availableAt: null },
    ],
    run: { status: "WAITING", resumeAt: "2030-05-01T15:30:00.000Z" },
    isUserScheduledWait: true,
  })

  assert.deepEqual(serializeEffectiveNextFollowUp(result), {
    at: "2030-05-01T15:30:00.000Z",
    stepId: "next",
    source: "USER_SCHEDULED_WAIT",
    projected: true,
  })
})

test("does not project fixed-duration or postponed waits", () => {
  const result = resolveEffectiveNextFollowUp({
    steps: [{ id: "next", status: "PENDING", dueAt: null, availableAt: null }],
    run: { status: "WAITING", resumeAt: "2030-05-01T15:30:00.000Z" },
    isUserScheduledWait: false,
  })

  assert.equal(result, null)
})

test("prefers the active step due date outside a manual Wait", () => {
  const result = resolveEffectiveNextFollowUp({
    steps: [
      {
        id: "active",
        status: "ACTIVE",
        dueAt: "2030-06-01T12:00:00.000Z",
        availableAt: "2030-05-01T12:00:00.000Z",
      },
      { id: "pending", status: "PENDING", dueAt: "2030-07-01T12:00:00.000Z" },
    ],
    run: { status: "AWAITING_STEP", resumeAt: null },
  })

  assert.deepEqual(serializeEffectiveNextFollowUp(result), {
    at: "2030-06-01T12:00:00.000Z",
    stepId: "active",
    source: "STEP_DUE",
    projected: false,
  })
})

