import assert from "node:assert/strict"
import { test } from "node:test"
import { hydrateAutomationTrigger, isAutomationTriggerReady, serializeAutomationTrigger } from "./automation-trigger"
import { defaultServiceTriggerConfig, ENROLLMENT_SERVICE_TRIGGER_LABELS, type EnrollmentServiceTriggerType } from "./service-automation-trigger"
import { serviceActionPickerOptions, serviceActionReady } from "./service-automation-action"

test("every enrollment trigger round trips its scope and selectors", () => {
  for (const type of Object.keys(ENROLLMENT_SERVICE_TRIGGER_LABELS) as EnrollmentServiceTriggerType[]) {
    const saved = { type, serviceGroupId: "group", serviceOfferingId: null, serviceTriggerConfig: defaultServiceTriggerConfig(type) }
    const draft = hydrateAutomationTrigger(saved)
    assert.equal(isAutomationTriggerReady(draft), true)
    assert.deepEqual(serializeAutomationTrigger(draft), saved)
    assert.equal(isAutomationTriggerReady({ ...draft, serviceGroupId: "" }), false)
    assert.equal(isAutomationTriggerReady({ ...draft, serviceOfferingId: "" }), false)
  }
})
test("payment changes must be selected and stale configuration does not leak into another trigger", () => {
  const draft = hydrateAutomationTrigger({ type: "SERVICE_PAYMENT_CHANGED", serviceGroupId: "group", serviceOfferingId: "child", serviceTriggerConfig: { changes: [], paymentState: "PAID" } })
  assert.equal(isAutomationTriggerReady(draft), false)
  assert.throws(() => serializeAutomationTrigger(draft))
  assert.deepEqual(serializeAutomationTrigger({ ...draft, triggerType: "SERVICE_ENROLLED" }).serviceTriggerConfig, {})
})
test("enrollment actions and shared pickers are restricted by group and saved IDs", () => {
  const offerings = [
    { id: "a", name: "A", serviceGroupId: "g", steps: [{ id: "step", name: "Review" }], checklistItems: [{ id: "common", name: "Same" }, { id: "unique", name: "Other" }], professionals: [] },
    { id: "b", name: "B", serviceGroupId: "g", steps: [{ id: "custom", name: "Review" }], checklistItems: [{ id: "common", name: "Same" }], professionals: [] },
    { id: "c", name: "C", serviceGroupId: "other", steps: [], checklistItems: [], professionals: [] },
  ]
  const options = serviceActionPickerOptions(offerings, undefined, null, "g")
  assert.deepEqual(options.checklistItems.map(item => item.id), ["common"])
  assert.equal(serviceActionReady({ type: "SET_SERVICE_COORDINATOR", serviceConfig: { assignedToUserId: null } }, options, "SERVICE_ENROLLED"), true)
  assert.equal(serviceActionReady({ type: "COMPLETE_SERVICE_STEP", serviceConfig: {} }, options, "SERVICE_ENROLLED"), false)
  assert.equal(serviceActionReady({ type: "SET_SERVICE_STATUS", serviceConfig: { status: "CANCELED" } }, options, "CONTACT_CREATED"), false)
})
