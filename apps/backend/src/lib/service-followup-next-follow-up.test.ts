import assert from "node:assert/strict"
import test from "node:test"

import {
  FOLLOW_UP_LIST_SERVICE_STATUSES,
  canCompleteFollowUpStepNow,
  isFollowUpListServiceStatus,
  resolveEffectiveNextFollowUp,
  selectFollowUpListStep,
  serializeEffectiveNextFollowUp,
} from "./service-followup-next-follow-up.js"

test("includes completed service workflows but excludes canceled workflows", () => {
  assert.deepEqual(FOLLOW_UP_LIST_SERVICE_STATUSES, [
    "IN_PROGRESS",
    "PENDING_PAYMENT",
    "COMPLETED",
  ])
  assert.equal(isFollowUpListServiceStatus("COMPLETED"), true)
  assert.equal(isFollowUpListServiceStatus("CANCELED"), false)
})

test("saved manual scheduling uses the enrolled date without projecting retired actions", () => {
  const result = resolveEffectiveNextFollowUp({ steps: [{ id: "saved", status: "POSTPONED", availableAt: "2030-05-01T15:30:00.000Z" }] })
  assert.deepEqual(serializeEffectiveNextFollowUp(result), { at: "2030-05-01T15:30:00.000Z", stepId: "saved", source: "STEP_AVAILABLE", projected: false })
  assert.equal(resolveEffectiveNextFollowUp({ steps: [{ id: "saved", status: "PENDING" }] }), null)
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
  })

  assert.deepEqual(serializeEffectiveNextFollowUp(result), {
    at: "2030-06-01T12:00:00.000Z",
    stepId: "active",
    source: "STEP_DUE",
    projected: false,
  })
})

test("only the first unresolved saved step can be completed manually", () => {
  for (const status of ["PENDING", "ACTIVE", "POSTPONED"]) {
    assert.equal(canCompleteFollowUpStepNow({ firstUnresolvedStepId: "next", step: { id: "next", status } }), true)
    assert.equal(canCompleteFollowUpStepNow({ firstUnresolvedStepId: "next", step: { id: "later", status } }), false)
  }
  assert.equal(canCompleteFollowUpStepNow({ firstUnresolvedStepId: "next", step: { id: "next", status: "COMPLETED" } }), false)
})

test("prefers active and postponed steps before a pending projection", () => {
  const steps = [
    { id: "active", status: "ACTIVE" },
    { id: "postponed", status: "POSTPONED" },
    { id: "pending", status: "PENDING" },
  ]

  assert.equal(
    selectFollowUpListStep({
      steps,
      effectiveNextFollowUp: {
        at: new Date("2030-05-01T15:30:00.000Z"),
        stepId: "pending",
        source: "STEP_AVAILABLE",
        projected: true,
      },
    })?.id,
    "active",
  )
})

test("selects the final terminal step for a completed workflow", () => {
  const steps = [
    { id: "first", status: "COMPLETED" },
    { id: "second", status: "SKIPPED" },
    { id: "final", status: "COMPLETED" },
  ]

  assert.equal(selectFollowUpListStep({ steps })?.id, "final")
  assert.equal(selectFollowUpListStep({ steps, status: "SKIPPED" })?.id, "second")
})
