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

test("projects a fixed-duration Wait onto the first pending step", () => {
  const result = resolveEffectiveNextFollowUp({
    steps: [{ id: "next", status: "PENDING", dueAt: null, availableAt: null }],
    run: { status: "WAITING", resumeAt: "2030-05-01T15:30:00.000Z" },
    isUserScheduledWait: false,
    isWorkflowWait: true,
  })

  assert.deepEqual(serializeEffectiveNextFollowUp(result), {
    at: "2030-05-01T15:30:00.000Z",
    stepId: "next",
    source: "STEP_AVAILABLE",
    projected: true,
  })
})

test("does not project a postponed manual step as a workflow Wait", () => {
  const result = resolveEffectiveNextFollowUp({
    steps: [{ id: "postponed", status: "POSTPONED", dueAt: null, availableAt: null }],
    run: { status: "WAITING", resumeAt: "2030-05-01T15:30:00.000Z" },
    isWorkflowWait: false,
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

test("allows only the next projected pending step to be completed early", () => {
  const effectiveNextFollowUp = resolveEffectiveNextFollowUp({
    steps: [
      { id: "next", status: "PENDING" },
      { id: "later", status: "PENDING" },
    ],
    run: { status: "WAITING", resumeAt: "2030-05-01T15:30:00.000Z" },
    isWorkflowWait: true,
  })
  const shared = {
    firstUnresolvedStepId: "next",
    run: { status: "WAITING" },
    effectiveNextFollowUp,
    canContinueWaitingRun: true,
  }

  assert.equal(canCompleteFollowUpStepNow({ ...shared, step: { id: "next", status: "PENDING" } }), true)
  assert.equal(canCompleteFollowUpStepNow({ ...shared, step: { id: "later", status: "PENDING" } }), false)
})

test("selects the projected pending step for a waiting workflow", () => {
  const steps = [
    { id: "completed", status: "COMPLETED" },
    { id: "next", status: "PENDING" },
    { id: "later", status: "PENDING" },
  ]
  const effectiveNextFollowUp = resolveEffectiveNextFollowUp({
    steps,
    run: { status: "WAITING", resumeAt: "2030-05-01T15:30:00.000Z" },
    isWorkflowWait: true,
  })

  assert.equal(
    selectFollowUpListStep({ steps, effectiveNextFollowUp })?.id,
    "next",
  )
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
