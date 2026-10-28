import assert from "node:assert/strict"
import { test } from "node:test"
import { SERVICE_ACTION_LABELS, serviceActionPickerOptions, serviceActionReady, serializeServiceConfig, terminalServiceAction } from "./service-automation-action.js"
import { serializeAutomationAction } from "./automation-action-payload.js"

test("service pickers intersect inherited configuration for a shared trigger", () => {
  const shared = { id: "step", name: "Review" }
  const offerings = [
    { id: "a", name: "A", steps: [shared, { id: "only-a", name: "A" }], professionals: [], checklistItems: [{ id: "common", name: "Form" }] },
    { id: "b", name: "B", steps: [shared], professionals: [], checklistItems: [{ id: "common", name: "Form" }, { id: "only-b", name: "ID" }] },
  ]
  assert.deepEqual(serviceActionPickerOptions(offerings, "step").steps, [shared])
  assert.equal(serviceActionPickerOptions(offerings, "step").checklistItems.length, 1)
  assert.equal(serviceActionPickerOptions(offerings, "step", "a").steps.length, 2)
  assert.equal(serviceActionPickerOptions(offerings, "unknown").steps.length, 0)
})
test("all service actions serialize only their typed configuration and require a step trigger", () => {
  const configs = {
    MOVE_SERVICE_STEP: { targetSourceStepId: "step", reason: "Revisit" }, COMPLETE_SERVICE_STEP: {}, SKIP_SERVICE_STEP: { reason: "Not needed" },
    SCHEDULE_SERVICE_STEP: { schedule: { mode: "DEFAULT" as const } }, SET_SERVICE_STEP_OWNER: { assignedToUserId: null }, SET_SERVICE_COORDINATOR: { assignedToUserId: null }, SET_SERVICE_PROFESSIONAL: { professionalId: null },
    SET_SERVICE_CHECKLIST_STATUS: { checklistItemId: "item", status: "RECEIVED" as const }, SET_SERVICE_STATUS: { status: "CANCELED" as const },
  }
  const options = { steps: [{ id: "step", name: "Review" }], checklistItems: [{ id: "item", name: "Form" }], professionals: [] }
  for (const type of Object.keys(SERVICE_ACTION_LABELS) as Array<keyof typeof configs>) {
    const action = { type, nodeKey: "node", serviceConfig: configs[type], noteTitle: "old draft" }
    assert.deepEqual(serializeAutomationAction(action), { type, nodeKey: "node", serviceConfig: configs[type] })
    assert.equal(serviceActionReady(action, options, "SERVICE_STEP_ENTERED"), true, type)
    assert.equal(serviceActionReady(action, options, "CONTACT_CREATED"), false, type)
  }
  assert.deepEqual(serializeServiceConfig("COMPLETE_SERVICE_STEP", { reason: "leftover" }), {})
  assert.equal(terminalServiceAction({ type: "SET_SERVICE_STATUS", serviceConfig: { status: "CANCELED" } }), true)
  assert.equal(terminalServiceAction({ type: "SET_SERVICE_STATUS", serviceConfig: { status: "IN_PROGRESS" } }), false)
})
