import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import {
  queueEnrollmentServiceAutomationEvent,
  queueServiceStepEnteredAutomationEvent,
} from "./automation-event-queue.js"
import { AutomationServiceContextError } from "./automation-service-context.js"
import type { ServiceEventSnapshot } from "./service-automation-triggers.js"

function fixture() {
  const tenantId = randomUUID(), contactId = randomUUID(), actorUserId = randomUUID()
  const serviceContext = {
    contactServiceId: randomUUID(), serviceId: randomUUID(),
    contactServiceStepId: randomUUID(), serviceStepId: randomUUID(),
    serviceStepOccurrenceId: randomUUID(),
  }
  const reads = { enrollment: 0, step: 0, occurrence: 0, definitions: 0 }
  const events: any[] = []
  const tx = {
    contactService: {
      findFirst: async ({ where }: any) => {
        reads.enrollment++
        return where.tenantId === tenantId && where.contactId === contactId && where.id === serviceContext.contactServiceId
          ? { id: serviceContext.contactServiceId, serviceId: serviceContext.serviceId } : null
      },
      findFirstOrThrow: async () => {
        reads.definitions++
        return { configurationSnapshot: { serviceAutomations: { schemaVersion: 1, definitions: [] } } }
      },
    },
    contactServiceStep: { findFirst: async () => {
      reads.step++
      return { id: serviceContext.contactServiceStepId, sourceStepId: serviceContext.serviceStepId }
    } },
    serviceStepOccurrence: { findFirst: async () => {
      reads.occurrence++
      return { id: serviceContext.serviceStepOccurrenceId }
    } },
    automation: { findMany: async () => { throw new Error("Use the saved definitions") } },
    automationEvent: {
      findUnique: async () => null,
      create: async ({ data }: any) => { events.push(data); return data },
    },
    contact: { findFirst: async () => ({
      id: contactId, firstName: "Test", lastName: "Contact",
      tags: [{ tagId: "tag-1" }],
      customFieldValues: [{ fieldId: "allowed", value: "Referral" }, { fieldId: "sensitive", value: "Hidden" }],
    }) },
    contactCustomField: { findMany: async ({ where }: any) => {
      assert.deepEqual(where, { tenantId, isActive: true, isEncrypted: false, isSensitive: false })
      return [{ id: "allowed", key: "source" }]
    } },
    membership: { findMany: async () => [{ userId: actorUserId, user: { name: "Recorder" } }] },
    automationDispatch: { createMany: async () => ({ count: 0 }) },
    automationNodeExecution: { createMany: async () => ({ count: 0 }) },
  }
  return { tx, tenantId, contactId, actorUserId, serviceContext, reads, events }
}

test("step queuing validates attribution and reads saved definitions once", async () => {
  const f = fixture()
  const result = await queueServiceStepEnteredAutomationEvent(f.tx, f)
  assert.equal(result.automationStatus, "NOT_APPLICABLE")
  assert.deepEqual(f.reads, { enrollment: 1, step: 1, occurrence: 1, definitions: 1 })
  await assert.rejects(
    queueServiceStepEnteredAutomationEvent(f.tx, { ...f, contactId: randomUUID() }),
    AutomationServiceContextError,
  )
})

test("unmatched service events retain safe contact and actor history without loading action catalogs", async () => {
  const f = fixture()
  const snapshot: ServiceEventSnapshot = {
    schemaVersion: 1, revision: 1, occurredAt: new Date().toISOString(),
    serviceGroupId: randomUUID(), serviceGroupName: "Group",
    serviceOfferingId: f.serviceContext.serviceId, serviceOfferingName: "Sub-service",
    contactServiceId: f.serviceContext.contactServiceId, recordId: null,
    checklistItemId: null, itemLabel: null, change: null, isInitialPayment: false,
    previous: null, next: { status: "IN_PROGRESS" }, automationSource: null,
    financials: { totalPriceCents: 10000, paidCents: 0, remainingCents: 10000, paymentState: "UNPAID", currency: "USD" },
  }
  const result = await queueEnrollmentServiceAutomationEvent(f.tx, {
    ...f,
    serviceContext: { ...f.serviceContext, contactServiceStepId: null, serviceStepId: null, serviceStepOccurrenceId: null },
    serviceEventSnapshot: snapshot, automationIds: [],
  }, "SERVICE_ENROLLED")
  assert.equal(result.automationStatus, "NOT_APPLICABLE")
  assert.equal(f.events.length, 1)
  assert.equal(f.events[0].status, "COMPLETED")
  assert.equal(f.events[0].actorName, "Recorder")
  assert.deepEqual(f.events[0].serviceEventSnapshot, snapshot)
  assert.deepEqual(f.events[0].contactSnapshot.customFieldValues, [{ fieldId: "allowed", value: "Referral" }])
  assert.deepEqual(f.events[0].contactSnapshot.tagIds, ["tag-1"])
})
