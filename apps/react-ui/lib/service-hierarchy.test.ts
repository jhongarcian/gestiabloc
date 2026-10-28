import assert from "node:assert/strict"
import { test } from "node:test"
import {
  enrolledServiceStepLabel,
  enrolledServiceStepProgress,
  offeringsInGroup,
  serviceGroups,
  serviceOfferingLabel,
  serviceWorkflowError,
} from "./service-hierarchy"

const offerings = [
  { id: "advantage", name: "Advantage", parentService: { id: "medicare", name: "Medicare" } },
  { id: "a", name: "Part A", parentService: { id: "medicare", name: "Medicare" } },
  { id: "other-a", name: "Part A", parentService: { id: "other", name: "Other" } },
]

test("service pickers use parent identity and preserve equal labels under different parents", () => {
  assert.equal(serviceOfferingLabel(offerings[0]), "Medicare / Advantage")
  assert.deepEqual(serviceGroups(offerings).map(item => item.id), ["medicare", "other"])
  assert.deepEqual(offeringsInGroup(offerings, "medicare").map(item => item.id), ["advantage", "a"])
  assert.deepEqual(offeringsInGroup(offerings, "other").map(item => item.id), ["other-a"])
  assert.equal(offeringsInGroup(offerings, "missing").length, 0)
})

test("new enrollment requires loaded steps and never treats templates as a substitute", () => {
  assert.ok(serviceWorkflowError(null))
  assert.ok(serviceWorkflowError({ steps: [] }))
  assert.equal(serviceWorkflowError({ steps: [{ id: "saved-step" }] }), null)
})

const earlier = "2026-10-21T12:00:00.000Z"
const later = "2026-10-21T13:00:00.000Z"
test("progress counts completed and bypassed saved steps, then resets a revisited step", () => {
  const steps: Array<{ id: string; occurrences: Array<{ status: string; enteredAt: string; supersededAt?: string }> }> = [
    { id: "review", occurrences: [{ status: "COMPLETED", enteredAt: earlier, supersededAt: later }] },
    { id: "middle", occurrences: [] },
    { id: "submit", occurrences: [{ status: "ACTIVE", enteredAt: later }] },
  ]
  const movements = [{ skippedStepIds: ["middle"], createdAt: later }]
  assert.deepEqual(enrolledServiceStepProgress(steps, movements), { total: 3, completed: 2, remaining: 1, percentage: 67 })
  assert.equal(enrolledServiceStepLabel(steps[0], movements), "Completed")
  assert.equal(enrolledServiceStepLabel(steps[1], movements), "Skipped")
  steps[1].occurrences.push({ status: "ACTIVE", enteredAt: "2026-10-21T14:00:00Z" })
  assert.equal(enrolledServiceStepProgress(steps, movements).completed, 1)
  assert.equal(enrolledServiceStepLabel(steps[1], movements), "Current step")
})

test("step summaries show completion waits, staff attention, and untouched steps", () => {
  assert.equal(enrolledServiceStepLabel({ occurrences: [] }), "Upcoming")
  for (const [progressionStatus, label] of [["WAITING_AUTOMATION", "Waiting for automation"], ["PAUSED", "Needs attention"]]) {
    const step = { occurrences: [{ status: "COMPLETED", progressionStatus }] }
    assert.equal(enrolledServiceStepLabel(step), label)
    assert.equal(enrolledServiceStepProgress([step]).completed, 1)
  }
  assert.deepEqual(enrolledServiceStepProgress([]), { total: 0, completed: 0, remaining: 0, percentage: 0 })
})
