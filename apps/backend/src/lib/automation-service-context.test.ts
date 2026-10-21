import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import {
  AutomationServiceContextError,
  AutomationServiceContextSchema,
  assertAutomationServiceContextRetry,
  automationServiceContextData,
  resolveAutomationServiceContextTx,
  validateAutomationServiceContextTx,
} from "./automation-service-context.js"

function fixture() {
  const tenantId = randomUUID()
  const contactId = randomUUID()
  const contactServiceId = randomUUID()
  const stepId = randomUUID()
  const enrollment = { id: contactServiceId, tenantId, contactId, serviceId: randomUUID() }
  const step = { id: stepId, tenantId, contactServiceId, sourceStepId: randomUUID() }
  const occurrence = { id: randomUUID(), tenantId, contactServiceId, stepId }
  const scoped = (record: Record<string, string>) => ({
    findFirst: async ({ where }: any) =>
      Object.entries(where).every(([key, value]) => record[key] === value) ? record : null,
  })
  const tx = {
    contactService: scoped(enrollment),
    contactServiceStep: scoped(step),
    serviceStepOccurrence: scoped(occurrence),
  }
  const context = {
    contactServiceId,
    serviceId: enrollment.serviceId,
    contactServiceStepId: stepId,
    serviceStepId: step.sourceStepId,
    serviceStepOccurrenceId: occurrence.id,
  }
  return { tenantId, contactId, tx, context }
}

test("resolves immutable enrollment and source step IDs without consulting current service configuration", async () => {
  const { tx, context, tenantId, contactId } = fixture()
  assert.deepEqual(
    await resolveAutomationServiceContextTx(tx, { ...context, tenantId, contactId }),
    context,
  )
  assert.deepEqual(
    await validateAutomationServiceContextTx(tx, { serviceContext: context, tenantId, contactId }),
    context,
  )
  assert.deepEqual(
    await resolveAutomationServiceContextTx(tx, {
      tenantId,
      contactId,
      contactServiceId: context.contactServiceId,
    }),
    {
      ...context,
      contactServiceStepId: null,
      serviceStepId: null,
      serviceStepOccurrenceId: null,
    },
  )
})

test("rejects foreign tenants, contacts, enrollments, steps, occurrences, and spoofed service attribution", async () => {
  const { tx, context, tenantId, contactId } = fixture()
  for (const params of [
    { tenantId: randomUUID(), contactId, serviceContext: context },
    { tenantId, contactId: randomUUID(), serviceContext: context },
    ...Object.keys(context).map((key) => ({
      tenantId,
      contactId,
      serviceContext: { ...context, [key]: randomUUID() },
    })),
  ]) {
    await assert.rejects(
      validateAutomationServiceContextTx(tx, params),
      AutomationServiceContextError,
    )
  }
})

test("rejects incomplete or corrupt context instead of silently running against the contact", async () => {
  const { tx, context, tenantId, contactId } = fixture()
  for (const serviceContext of [
    {},
    "enrollment",
    { ...context, serviceId: "invalid" },
    { ...context, contactServiceStepId: null },
  ]) {
    await assert.rejects(
      validateAutomationServiceContextTx(tx, { tenantId, contactId, serviceContext }),
      AutomationServiceContextError,
    )
  }
  assert.equal(
    AutomationServiceContextSchema.safeParse({ ...context, serviceStepOccurrenceId: null }).success,
    true,
  )
})

test("ordinary contact automations never infer a service enrollment", async () => {
  assert.equal(
    await validateAutomationServiceContextTx(
      {},
      { tenantId: randomUUID(), contactId: randomUUID() },
    ),
    null,
  )
  assert.deepEqual(automationServiceContextData({}), {})
  assert.deepEqual(automationServiceContextData({ serviceContext: null }), {})
})

test("causation retries cannot reuse another enrollment's event", () => {
  const { tenantId, contactId, context } = fixture()
  const event = { tenantId, contactId, serviceContext: context }
  assert.doesNotThrow(() => assertAutomationServiceContextRetry(event, { ...event }))
  assert.throws(
    () =>
      assertAutomationServiceContextRetry(event, {
        ...event,
        serviceContext: { ...context, contactServiceId: randomUUID() },
      }),
    AutomationServiceContextError,
  )
  assert.throws(
    () => assertAutomationServiceContextRetry(event, { tenantId, contactId }),
    AutomationServiceContextError,
  )
})
