import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { EnrollmentServiceTriggerSchema, matchesServiceEventTrigger, isServiceTrigger, serviceEventDetails, type ServiceEventSnapshot } from "./service-automation-triggers.js"

const event: ServiceEventSnapshot = {
  schemaVersion: 1, revision: 3, occurredAt: new Date().toISOString(), serviceGroupId: randomUUID(), serviceGroupName: "Medicare", serviceOfferingId: randomUUID(), serviceOfferingName: "Advantage", contactServiceId: randomUUID(), recordId: randomUUID(), checklistItemId: randomUUID(), itemLabel: "Consent", change: "UPDATED", isInitialPayment: false,
  previous: { status: "MISSING", amountCents: 10 }, next: { status: "RECEIVED", amountCents: 20 },
  financials: { totalPriceCents: 100, paidCents: 20, remainingCents: 80, paymentState: "PARTIAL", currency: "USD" }, automationSource: null,
}
test("service trigger selectors use exact scope and saved source IDs", () => {
  const trigger = EnrollmentServiceTriggerSchema.parse({ type: "SERVICE_CHECKLIST_STATUS_CHANGED", serviceGroupId: event.serviceGroupId, serviceOfferingId: null, serviceTriggerConfig: { checklistItemId: event.checklistItemId, previousStatus: "MISSING", status: "RECEIVED" } })
  assert.equal(matchesServiceEventTrigger(trigger, event), true)
  assert.equal(matchesServiceEventTrigger(trigger, { ...event, serviceOfferingId: randomUUID() }), true)
  for (const patch of [{ serviceGroupId: randomUUID() }, { checklistItemId: randomUUID() }, { previous: { status: "NOT_RECEIVED" } }, { next: { status: "MISSING" } }]) assert.equal(matchesServiceEventTrigger(trigger, { ...event, ...patch }), false)
  assert.equal(matchesServiceEventTrigger({ ...trigger, serviceOfferingId: randomUUID() }, event), false)
})
test("payment selector combines operations with the resulting financial state", () => {
  const trigger = EnrollmentServiceTriggerSchema.parse({ type: "SERVICE_PAYMENT_CHANGED", serviceGroupId: event.serviceGroupId, serviceOfferingId: event.serviceOfferingId, serviceTriggerConfig: { changes: ["UPDATED", "REMOVED"], paymentState: "PARTIAL" } })
  assert.equal(matchesServiceEventTrigger(trigger, event), true)
  assert.equal(matchesServiceEventTrigger(trigger, { ...event, change: "ADDED" }), false)
  assert.equal(matchesServiceEventTrigger(trigger, { ...event, financials: { ...event.financials, paymentState: "PAID" } }), false)
  for (const changes of [[], ["ADDED", "ADDED"], ["BOGUS"]]) assert.equal(EnrollmentServiceTriggerSchema.safeParse({ ...trigger, serviceTriggerConfig: { changes, paymentState: null } }).success, false)
})
test("status selectors and service classification reject invalid configuration", () => {
  assert.equal(isServiceTrigger("SERVICE_ENROLLED"), true)
  assert.equal(isServiceTrigger("SERVICE_STEP_ENTERED"), true)
  assert.equal(isServiceTrigger("CONTACT_CREATED"), false)
  const trigger = { type: "SERVICE_STATUS_CHANGED", serviceGroupId: event.serviceGroupId, serviceOfferingId: null, serviceTriggerConfig: { previousStatus: null, status: "COMPLETED" } }
  assert.equal(matchesServiceEventTrigger(EnrollmentServiceTriggerSchema.parse(trigger), { ...event, next: { status: "COMPLETED" } }), true)
  assert.equal(EnrollmentServiceTriggerSchema.safeParse({ ...trigger, serviceTriggerConfig: { status: "RECEIVED", previousStatus: null } }).success, false)
})

test("service event history presents amounts and statuses in readable terms", () => {
  const details = serviceEventDetails("SERVICE_PAYMENT_CHANGED", event)
  assert.match(details, /Amount: \$0\.10 → \$0\.20/)
  assert.match(details, /Remaining: \$0\.80 \(partly paid\)/)
  assert.doesNotMatch(details, /cents|PARTIAL|NOT_RECEIVED/)
  assert.match(serviceEventDetails("SERVICE_STATUS_CHANGED", { ...event, previous: { status: "IN_PROGRESS" }, next: { status: "PENDING_PAYMENT" } }), /In progress → Pending payment/)
})
