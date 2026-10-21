import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { ServiceAutomationActionSchema, isTerminalServiceAction, serviceActionOptions, validateServiceActionSelection } from "./service-automation-actions.js"
import { executionBudget, transientAutomationFailure, TRANSIENT_AUTOMATION_RETRY_DELAYS } from "./automation-execution-budget.js"

test("service action schemas reject unrelated fields, invalid statuses and empty reasons", () => {
  for (const invalid of [
    { type: "MOVE_SERVICE_STEP", serviceConfig: { targetSourceStepId: randomUUID(), reason: " " } },
    { type: "SKIP_SERVICE_STEP", serviceConfig: { reason: "" } },
    { type: "SET_SERVICE_STATUS", serviceConfig: { status: "COMPLETED" } },
    { type: "SET_SERVICE_STATUS", serviceConfig: { status: "PENDING_PAYMENT" } },
    { type: "SET_SERVICE_CHECKLIST_STATUS", serviceConfig: { checklistItemId: randomUUID(), status: "COMPLETED" } },
    { type: "SET_SERVICE_STEP_OWNER", serviceConfig: { assignedToUserId: "contact" } },
    { type: "COMPLETE_SERVICE_STEP", serviceConfig: { contactServiceId: randomUUID() } },
    { type: "SCHEDULE_SERVICE_STEP", serviceConfig: { schedule: { mode: "DURATION", amount: 0, unit: "DAYS" } } },
  ]) assert.equal(ServiceAutomationActionSchema.safeParse(invalid).success, false, JSON.stringify(invalid))
  for (const type of ["COMPLETE_SERVICE_STEP", "SKIP_SERVICE_STEP", "MOVE_SERVICE_STEP"]) assert.equal(isTerminalServiceAction({ type }), true)
})
test("shared pickers exclude selections missing in any eligible sub-service", () => {
  const source = randomUUID(), target = randomUUID(), custom = randomUUID(), professional = randomUUID()
  const catalog = [{ id: "a", name: "A", steps: [{ id: source, name: "Start" }, { id: target, name: "End" }], checklistItems: [], professionals: [{ id: professional, name: "Doctor" }] }, { id: "b", name: "B", steps: [{ id: source, name: "Start" }, { id: custom, name: "Other" }], checklistItems: [], professionals: [] }]
  const shared = serviceActionOptions(catalog, source)
  assert.deepEqual(shared.steps.map(item => item.id), [source])
  assert.equal(shared.professionals.length, 0)
  assert.equal(serviceActionOptions(catalog, source, "a").steps.length, 2)
  assert.throws(() => validateServiceActionSelection({ type: "MOVE_SERVICE_STEP", serviceConfig: { targetSourceStepId: target, reason: "Move" } }, shared, new Set()))
  assert.throws(() => validateServiceActionSelection({ type: "SET_SERVICE_COORDINATOR", serviceConfig: { assignedToUserId: randomUUID() } }, shared, new Set()))
})
test("execution settings reserve four database connections and retries retain their original delays", () => {
  assert.deepEqual(executionBudget({}), { global: 4, tenant: 2 })
  assert.deepEqual(executionBudget({ PRISMA_POOL_MAX: "5" }), { global: 1, tenant: 1 })
  assert.throws(() => executionBudget({ PRISMA_POOL_MAX: "7", AUTOMATION_EXECUTION_CONCURRENCY: "4" }))
  assert.throws(() => executionBudget({ AUTOMATION_EXECUTION_TENANT_CONCURRENCY: "5" }))
  assert.deepEqual(TRANSIENT_AUTOMATION_RETRY_DELAYS, [5000, 30000, 120000])
  assert.equal(transientAutomationFailure(new Error("wrapped", { cause: { code: "P2034" } })), true)
  assert.equal(transientAutomationFailure(new Error("INVALID_ASSIGNEE")), false)
})
