import assert from "node:assert/strict"
import { test } from "node:test"
import { enrolledStepProgress, offeringSteps, serviceScopeWhere } from "./service-presentation.js"

test("service report scope intersects parent and offering IDs without matching names", () => {
  assert.deepEqual(serviceScopeWhere({}), {})
  assert.deepEqual(serviceScopeWhere({ serviceGroupId: "parent", serviceId: "child" }), {
    serviceId: "child", service: { parentServiceId: "parent" },
  })
})

test("catalog workflow summaries include shared and selected offering automations only", () => {
  const steps = [{ id: "step", automations: [{ serviceOfferingId: null }, { serviceOfferingId: "child" }, { serviceOfferingId: "other" }] }]
  assert.equal(offeringSteps(steps, "child")[0].automations?.length, 2)
  assert.equal(steps[0].automations.length, 3)
})

test("saved step progress includes bypasses and respects later revisits", () => {
  const before = new Date("2026-10-21T12:00:00Z")
  const move = new Date("2026-10-21T13:00:00Z")
  const after = new Date("2026-10-21T14:00:00Z")
  const steps = [{ id: "one", occurrences: [{ status: "COMPLETED", enteredAt: before }] }, { id: "two", occurrences: [] as Array<{ status: string; enteredAt: Date }> }]
  const movements = [{ skippedStepIds: ["two"], createdAt: move }]
  assert.deepEqual(enrolledStepProgress(steps, movements), { total: 2, completed: 2, remaining: 0, percentage: 100 })
  steps[1].occurrences.push({ status: "ACTIVE", enteredAt: after })
  assert.equal(enrolledStepProgress(steps, movements).completed, 1)
  assert.equal(enrolledStepProgress([]).percentage, 0)
})
