import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { processClaimedAutomationEvent, captureContactChangeSnapshot, claimQueuedAutomationDispatch, queueAppointmentCreatedAutomationEvent, queueAppointmentStatusChangedAutomationEvent, queueBirthdayReminderAutomationEvent, queueContactChangedAutomationEvent, queueContactCreatedAutomationEvent, queueContactNoteAddedAutomationEvent, queueTaskAddedAutomationEvent, queueTaskCompletedAutomationEvent, queueOpportunityAutomationEvent } from "./automation-event-queue.js"

const WAIT_ACTION = {
  id: "action-1",
  nodeKey: "00000000-0000-4000-8000-000000000001",
  type: "WAIT",
  waitConfig: { mode: "DURATION", amount: 1, unit: "SECONDS" },
}

describe("queueContactCreatedAutomationEvent", () => {
  test("matches the creation snapshot across standard fields, custom fields, and tags", async () => {
    const writes: Record<string, any> = {}
    const contact = {
      id: "contact-1",
      firstName: "Mary",
      middleName: null,
      lastName: "Reed",
      email: "mary@example.com",
      dateOfBirth: new Date("1990-05-03T12:00:00.000Z"),
      statusConfigId: "status-active",
      assignedToUserId: null,
      tags: [{ tagId: "tag-new" }],
      customFieldValues: [{ fieldId: "field-source", value: "Referral" }],
    }
    const base = {
      name: "Welcome",
      triggerType: "CONTACT_CREATED",
      pipelineId: null,
      conditions: [
        { source: "CONTACT_FIELD", fieldKey: "email", operator: "CONTAINS", compareValue: "@example.com" },
        { source: "CONTACT_FIELD", fieldKey: "date_of_birth", operator: "EQUALS", compareValue: "1990-05-03" },
        { source: "CONTACT_CUSTOM_FIELD", customFieldId: "field-source", operator: "EQUALS", compareValue: "Referral" },
        { source: "CONTACT_TAGS", tagId: "tag-new", operator: "EQUALS", compareValue: null },
      ],
      actions: [WAIT_ACTION],
    }
    const prismaTx = {
      automation: { findMany: async () => [
        { ...base, id: "automation-match" },
        { ...base, id: "automation-skip", conditions: [{ source: "CONTACT_FIELD", fieldKey: "first_name", operator: "EQUALS", compareValue: "John" }] },
      ] },
      contact: { findFirst: async () => contact },
      contactCustomField: { findMany: async () => [{ id: "field-source", key: "source", label: "Source", fieldType: "TEXT", isActive: true, isEncrypted: false, isSensitive: false, options: null }] },
      contactStatusConfig: { findMany: async () => [{ id: "status-active", name: "Active" }] },
      taskStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [{ id: "tag-new", name: "New" }] },
      opportunityPipeline: { findMany: async () => [] },
      tenant: { findUnique: async () => ({ timezone: "America/Chicago" }) },
      automationEvent: { create: async ({ data }: any) => { writes.event = data; return data } },
      automationDispatch: { createMany: async ({ data }: any) => { writes.dispatches = data } },
      automationNodeExecution: { createMany: async ({ data }: any) => { writes.logs = data } },
    }
    const result = await queueContactCreatedAutomationEvent(prismaTx, {
      tenantId: "tenant-1", contactId: "contact-1", actorUserId: "actor-1",
    })
    assert.equal(result.matchedCount, 1)
    assert.equal(writes.dispatches[0].automationId, "automation-match")
    assert.equal(writes.dispatches.length, 1)
    assert.equal(writes.event.triggerType, "CONTACT_CREATED")
    assert.equal(writes.event.pipelineId, null)
    assert.equal(writes.event.opportunitySnapshotId, null)
    assert.equal(writes.logs[0].eventSource, "CONTACT_CREATED")
  })
})

describe("contact-linked automation events", () => {
  const fixture = (automations: any[]) => {
    const writes = {
      events: [] as any[],
      dispatches: [] as any[],
      logs: [] as any[],
      claims: new Map<string, any>(),
    }
    const contact = {
      id: "contact-1",
      firstName: "Mary",
      lastName: "Reed",
      statusConfigId: null,
      assignedToUserId: null,
      dateOfBirth: new Date("1990-10-16T12:00:00.000Z"),
      deceasedAt: null as Date | null,
      tags: [{ tagId: "tag-new" }],
      customFieldValues: [{ fieldId: "field-source", value: "Referral" }],
    }
    const task = {
      id: "task-1", name: "Call Mary", description: null, statusConfigId: "todo", assignedToUserId: "user-john",
      startedAt: new Date("2026-10-15T14:00:00.000Z"), dueDate: new Date("2026-10-16T19:00:00.000Z"),
      priority: "HIGH", linkedEntityName: "Annual review", linkedEntityType: "SERVICE",
    }
    const appointment = {
      id: "appointment-1", title: "Annual review with Mary", notes: null as string | null, serviceId: "service-a" as string | null,
      service: { name: "Annual review" } as { name: string } | null,
      bookedByUserId: "user-john", assignedToUserId: "user-jane",
      startAt: new Date("2026-10-20T15:00:00.000Z"), endAt: new Date("2026-10-20T16:00:00.000Z"),
      isAllDay: false, status: "SCHEDULED", createdAt: new Date("2026-10-16T18:00:00.000Z"),
    }
    const prismaTx = {
      automation: {
        findMany: async ({ where }: any) => automations.filter((automation) => automation.triggerType === where.triggerType && (!where.id || automation.id === where.id)),
      },
      automationBirthdayClaim: {
        createManyAndReturn: async ({ data }: any) => {
          const owned: Array<{ contactId: string }> = []
          for (const claim of data) {
            const key = `birthday:${claim.tenantId}:${claim.automationId}:${claim.contactId}:${claim.occurrenceYear}`
            if (writes.claims.has(key)) continue
            writes.claims.set(key, claim)
            owned.push({ contactId: claim.contactId })
          }
          return owned
        },
      },
      automationTriggerChainClaim: {
        createManyAndReturn: async ({ data }: any) => {
          const owned: Array<{ automationId: string }> = []
          for (const claim of data) {
            const key = `${claim.tenantId}:${claim.chainId}:${claim.automationId}`
            if (writes.claims.has(key)) continue
            writes.claims.set(key, claim)
            owned.push({ automationId: claim.automationId })
          }
          return owned
        },
      },
      automationEvent: {
        findUnique: async ({ where }: any) => {
          const existing = writes.events.find((item) => item.causationKey === where.causationKey)
          return existing ? {
            ...existing,
            dispatches: writes.dispatches.filter((dispatch) => dispatch.eventId === existing.id),
            completedCount: 0,
          } : null
        },
        create: async ({ data }: any) => { writes.events.push(data); return data },
      },
      contact: { findFirst: async () => contact },
      task: { findFirst: async ({ where }: any) => ({ ...task, id: where.id }) },
      appointment: { findFirst: async ({ where }: any) => ({ ...appointment, id: where.id }) },
      contactCustomField: { findMany: async () => [{ id: "field-source", key: "source", label: "Source", fieldType: "TEXT", isActive: true, isEncrypted: false, isSensitive: false, options: null }] },
      contactStatusConfig: { findMany: async () => [] },
      taskStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [{ id: "tag-new", name: "New" }] },
      opportunityPipeline: { findMany: async () => [] },
      tenant: { findUnique: async () => ({ timezone: "America/Chicago" }) },
      automationDispatch: { createMany: async ({ data }: any) => { writes.dispatches.push(...data) } },
      automationNodeExecution: { createMany: async ({ data }: any) => { writes.logs.push(...data) } },
    }
    return { prismaTx, contact, task, appointment, writes }
  }

  const noteAutomation = (id: string, conditions: any[] = []) => ({
    id,
    name: id,
    triggerType: "CONTACT_NOTE_ADDED",
    conditions,
    actions: [WAIT_ACTION],
  })
  const taskAutomation = (id: string, conditions: any[] = []) => ({
    id, name: id, triggerType: "TASK_ADDED", conditions, actions: [WAIT_ACTION],
  })
  const completedAutomation = (id: string, conditions: any[] = []) => ({
    id, name: id, triggerType: "TASK_COMPLETED", conditions, actions: [WAIT_ACTION],
  })
  const appointmentAutomation = (id: string, conditions: any[] = []) => ({
    id, name: id, triggerType: "APPOINTMENT_CREATED", conditions, actions: [WAIT_ACTION],
  })
  const appointmentStatusAutomation = (id: string, status: string, conditions: any[] = []) => ({
    id, name: id, triggerType: "APPOINTMENT_STATUS_CHANGED", appointmentTargetStatus: status, conditions, actions: [WAIT_ACTION],
  })

  test("appointment status changes match one destination status and snapshot contact filters", async () => {
    const filters = [
      { source: "CONTACT_FIELD", fieldKey: "first_name", operator: "EQUALS", compareValue: "Mary" },
      { source: "CONTACT_CUSTOM_FIELD", customFieldId: "field-source", operator: "EQUALS", compareValue: "Referral" },
      { source: "CONTACT_TAGS", tagId: "tag-new", operator: "EQUALS" },
    ]
    const { prismaTx, appointment, contact, writes } = fixture([
      appointmentStatusAutomation("match", "COMPLETED", filters),
      appointmentStatusAutomation("wrong-status", "SHOW", filters),
      appointmentStatusAutomation("wrong-contact", "COMPLETED", [{ source: "CONTACT_FIELD", fieldKey: "first_name", operator: "EQUALS", compareValue: "John" }]),
    ])
    appointment.status = "COMPLETED"
    const event = { tenantId: "tenant-1", contactId: contact.id, appointmentId: appointment.id, actorUserId: "user-john", previousStatus: "CONFIRMED", status: "COMPLETED", changedAt: new Date("2026-10-20T16:00:00Z"), causationKey: "appointment-status-audit:1" }
    const first = await queueAppointmentStatusChangedAutomationEvent(prismaTx, event)
    assert.equal(first.matchedCount, 1)
    assert.equal(writes.dispatches[0].automationId, "match")
    assert.equal(writes.events[0].appointmentSnapshot.previousStatus, "CONFIRMED")
    assert.equal(writes.events[0].appointmentSnapshot.status, "COMPLETED")
    assert.equal(writes.events[0].contactSnapshot.fields.firstName, "Mary")
    assert.deepEqual(writes.events[0].contactSnapshot.tagIds, ["tag-new"])
    assert.deepEqual(writes.events[0].contactSnapshot.customFieldValues, [{ fieldId: "field-source", value: "Referral" }])
    contact.firstName = "Changed later"
    assert.equal(writes.events[0].contactSnapshot.fields.firstName, "Mary")
    assert.equal((await queueAppointmentStatusChangedAutomationEvent(prismaTx, event)).automationEventId, first.automationEventId)
    assert.equal(writes.events.length, 1)
    appointment.status = "SHOW"
    await queueAppointmentStatusChangedAutomationEvent(prismaTx, { ...event, previousStatus: "COMPLETED", status: "SHOW", causationKey: "appointment-status-audit:2" })
    appointment.status = "COMPLETED"
    contact.firstName = "Mary"
    const again = await queueAppointmentStatusChangedAutomationEvent(prismaTx, { ...event, previousStatus: "SHOW", causationKey: "appointment-status-audit:3" })
    assert.equal(again.matchedCount, 1)
    const suppressed = await queueAppointmentStatusChangedAutomationEvent(prismaTx, { ...event, previousStatus: "SHOW", causationKey: "appointment-status-audit:4", chainId: first.automationEventId, chainDepth: 1 })
    assert.equal(suppressed.matchedCount, 0)
    assert.match(writes.dispatches.at(-1).decisionDetails, /already ran for this automation chain/)
  })

  test("appointment creation matches its service, details, and contact state at booking", async () => {
    const filters = [
      { source: "APPOINTMENT_FIELD", fieldKey: "serviceId", operator: "INCLUDES_ANY", compareValue: ["service-b", "service-a"] },
      { source: "APPOINTMENT_FIELD", fieldKey: "title", operator: "CONTAINS", compareValue: "review" },
      { source: "APPOINTMENT_FIELD", fieldKey: "notes", operator: "IS_EMPTY" },
      { source: "APPOINTMENT_FIELD", fieldKey: "assignedToUserId", operator: "INCLUDES_ANY", compareValue: ["user-jane"] },
      { source: "APPOINTMENT_FIELD", fieldKey: "bookedByUserId", operator: "INCLUDES_ANY", compareValue: ["user-john"] },
      { source: "APPOINTMENT_FIELD", fieldKey: "startAt", operator: "GREATER_THAN", compareValue: "2026-10-20T14:00:00.000Z" },
      { source: "APPOINTMENT_FIELD", fieldKey: "endAt", operator: "BETWEEN", compareValue: { min: "2026-10-20T15:00:00.000Z", max: "2026-10-20T17:00:00.000Z" } },
      { source: "APPOINTMENT_FIELD", fieldKey: "isAllDay", operator: "IS_FALSE" },
      { source: "CONTACT_FIELD", fieldKey: "first_name", operator: "EQUALS", compareValue: "Mary" },
      { source: "CONTACT_CUSTOM_FIELD", customFieldId: "field-source", operator: "EQUALS", compareValue: "Referral" },
      { source: "CONTACT_TAGS", tagId: "tag-new", operator: "EQUALS" },
    ]
    const { prismaTx, appointment, contact, writes } = fixture([
      appointmentAutomation("match", filters),
      appointmentAutomation("any-appointment"),
      appointmentAutomation("wrong-service", [{ source: "APPOINTMENT_FIELD", fieldKey: "serviceId", operator: "INCLUDES_ANY", compareValue: ["service-b"] }]),
    ])
    const event = { tenantId: "tenant-1", contactId: "contact-1", appointmentId: appointment.id, actorUserId: "user-john" }
    const first = await queueAppointmentCreatedAutomationEvent(prismaTx, event)
    assert.equal(first.matchedCount, 2)
    assert.deepEqual(writes.dispatches.map((dispatch) => dispatch.automationId), ["match", "any-appointment"])
    assert.equal(writes.events[0].appointmentId, appointment.id)
    assert.equal(writes.events[0].appointmentSnapshot.serviceName, "Annual review")
    assert.equal(writes.events[0].appointmentSnapshot.startAt, "2026-10-20T15:00:00.000Z")
    assert.equal(writes.events[0].causationKey, "appointment:appointment-1:created")
    appointment.title = "Renamed later"
    appointment.service!.name = "Renamed service"
    contact.firstName = "Changed"
    assert.equal(writes.events[0].appointmentSnapshot.title, "Annual review with Mary")
    assert.equal(writes.events[0].appointmentSnapshot.serviceName, "Annual review")
    assert.equal(writes.events[0].contactName, "Mary Reed")
    assert.equal((await queueAppointmentCreatedAutomationEvent(prismaTx, event)).automationEventId, first.automationEventId)
    assert.equal(writes.events.length, 1)
  })

  test("appointment creation can match no service and suppress a repeated chain enrollment", async () => {
    const { prismaTx, appointment, writes } = fixture([
      appointmentAutomation("no-service", [{ source: "APPOINTMENT_FIELD", fieldKey: "serviceId", operator: "IS_EMPTY" }]),
      appointmentAutomation("with-service", [{ source: "APPOINTMENT_FIELD", fieldKey: "serviceId", operator: "IS_NOT_EMPTY" }]),
    ])
    appointment.serviceId = null
    appointment.service = null
    const first = await queueAppointmentCreatedAutomationEvent(prismaTx, { tenantId: "tenant-1", contactId: "contact-1", appointmentId: "appointment-1", actorUserId: null })
    assert.equal(first.matchedCount, 1)
    assert.equal(writes.events[0].appointmentSnapshot.serviceId, null)
    const repeated = await queueAppointmentCreatedAutomationEvent(prismaTx, { tenantId: "tenant-1", contactId: "contact-1", appointmentId: "appointment-2", actorUserId: null, chainId: first.automationEventId, chainDepth: 1 })
    assert.equal(repeated.matchedCount, 0)
    assert.match(writes.dispatches.at(-1).decisionDetails, /already ran for this automation chain/)
    const separateBooking = await queueAppointmentCreatedAutomationEvent(prismaTx, { tenantId: "tenant-1", contactId: "contact-1", appointmentId: "appointment-3", actorUserId: null })
    assert.equal(separateBooking.matchedCount, 1)
    const overDepth = await queueAppointmentCreatedAutomationEvent(prismaTx, { tenantId: "tenant-1", contactId: "contact-1", appointmentId: "appointment-4", actorUserId: null, chainId: first.automationEventId, chainDepth: 21 })
    assert.equal(overDepth.matchedCount, 0)
    assert.match(writes.dispatches.at(-1).decisionDetails, /maximum depth.*appointment was saved/i)
  })
  const birthdayAutomation = (id: string, conditions: any[] = []) => ({
    id, name: id, triggerType: "BIRTHDAY_REMINDER", birthdayLocalTime: "09:00", conditions, actions: [WAIT_ACTION],
  })

  test("birthday reminder checks current contact filters, saves the occurrence, and claims once per year", async () => {
    const filters = [
      { source: "CONTACT_FIELD", fieldKey: "first_name", operator: "EQUALS", compareValue: "Mary" },
      { source: "CONTACT_CUSTOM_FIELD", customFieldId: "field-source", operator: "EQUALS", compareValue: "Referral" },
      { source: "CONTACT_TAGS", tagId: "tag-new", operator: "EQUALS" },
    ]
    const { prismaTx, contact, writes } = fixture([birthdayAutomation("birthday-a", filters)])
    const base = {
      tenantId: "tenant-1", contactId: "contact-1", automationId: "birthday-a", actorUserId: null,
      occurrenceYear: 2026, localDate: "2026-10-16", timezone: "America/Chicago", scheduledLocalTime: "09:00",
      clockAt: new Date("2026-10-16T15:00:00.000Z"),
    }
    contact.firstName = "John"
    assert.equal((await queueBirthdayReminderAutomationEvent(prismaTx, base)).matchedCount, 0)
    assert.equal(writes.claims.size, 0)
    contact.firstName = "Mary"
    const first = await queueBirthdayReminderAutomationEvent(prismaTx, base)
    assert.equal(first.matchedCount, 1)
    assert.equal(writes.events[0].triggerType, "BIRTHDAY_REMINDER")
    assert.deepEqual(writes.events[0].birthdaySnapshot, {
      dateOfBirth: "1990-10-16", localDate: "2026-10-16", timezone: "America/Chicago", scheduledLocalTime: "09:00",
    })
    assert.equal(writes.events[0].causationKey, "birthday:tenant-1:birthday-a:contact-1:2026")
    assert.equal((await queueBirthdayReminderAutomationEvent(prismaTx, base)).automationEventId, first.automationEventId)
    assert.equal(writes.events.length, 1)
    const nextYear = await queueBirthdayReminderAutomationEvent(prismaTx, {
      ...base, occurrenceYear: 2027, localDate: "2027-10-16", clockAt: new Date("2027-10-16T15:00:00.000Z"),
    })
    assert.equal(nextYear.matchedCount, 1)
    assert.equal(writes.events.length, 2)
    contact.deceasedAt = new Date("2028-01-01T00:00:00.000Z")
    assert.equal((await queueBirthdayReminderAutomationEvent(prismaTx, {
      ...base, occurrenceYear: 2028, localDate: "2028-10-16", clockAt: new Date("2028-10-16T15:00:00.000Z"),
    })).matchedCount, 0)
    assert.equal(writes.events.length, 2)
    contact.deceasedAt = null
    contact.dateOfBirth = new Date("1990-10-17T12:00:00.000Z")
    assert.equal((await queueBirthdayReminderAutomationEvent(prismaTx, {
      ...base, occurrenceYear: 2028, localDate: "2028-10-16", clockAt: new Date("2028-10-16T15:00:00.000Z"),
    })).matchedCount, 0)
    contact.dateOfBirth = new Date("1990-10-16T12:00:00.000Z")
    assert.equal((await queueBirthdayReminderAutomationEvent(prismaTx, {
      ...base, occurrenceYear: 2028, localDate: "2028-10-16", clockAt: new Date("2028-10-16T15:00:00.000Z"),
    })).matchedCount, 1)
    assert.equal((await queueBirthdayReminderAutomationEvent(prismaTx, {
      ...base, occurrenceYear: 2029, localDate: "2029-10-16", clockAt: new Date("2029-10-17T05:00:00.000Z"),
    })).matchedCount, 0)
  })

  test("concurrent birthday enrollments produce one event and one annual claim", async () => {
    const { prismaTx, writes } = fixture([birthdayAutomation("birthday-a")])
    const event = {
      tenantId: "tenant-1", contactId: "contact-1", automationId: "birthday-a", actorUserId: null,
      occurrenceYear: 2026, localDate: "2026-10-16", timezone: "America/Chicago", scheduledLocalTime: "09:00",
      clockAt: new Date("2026-10-16T15:00:00.000Z"),
    }
    await Promise.all([queueBirthdayReminderAutomationEvent(prismaTx, event), queueBirthdayReminderAutomationEvent(prismaTx, event)])
    assert.equal(writes.events.length, 1)
    assert.equal([...writes.claims.keys()].filter((key) => key.startsWith("birthday:")).length, 1)
  })

  test("task completion uses contact filters and preserves the completion-time task snapshot", async () => {
    const filters = [
      { source: "CONTACT_FIELD", fieldKey: "first_name", operator: "EQUALS", compareValue: "Mary" },
      { source: "CONTACT_CUSTOM_FIELD", customFieldId: "field-source", operator: "EQUALS", compareValue: "Referral" },
      { source: "CONTACT_TAGS", tagId: "tag-new", operator: "EQUALS" },
    ]
    const { prismaTx, contact, task, writes } = fixture([
      completedAutomation("match", filters),
      completedAutomation("unfiltered"),
      completedAutomation("other-contact", [{ ...filters[0], compareValue: "John" }]),
    ])
    task.statusConfigId = "completed"
    const completedAt = new Date("2026-10-16T16:30:00.000Z")
    const event = { tenantId: "tenant-1", contactId: "contact-1", taskId: task.id, actorUserId: "user-john", causationKey: "task-status-activity:activity-1:completed", completedAt }
    const first = await queueTaskCompletedAutomationEvent(prismaTx, event)
    assert.equal(first.matchedCount, 2)
    assert.deepEqual(writes.dispatches.map((dispatch) => dispatch.automationId), ["match", "unfiltered"])
    assert.equal(writes.events[0].triggerType, "TASK_COMPLETED")
    assert.equal(writes.events[0].taskId, task.id)
    assert.equal(writes.events[0].taskSnapshot.completedAt, completedAt.toISOString())
    assert.equal(writes.events[0].taskSnapshot.statusConfigId, "completed")
    assert.equal(writes.events[0].contactName, "Mary Reed")
    task.name = "Changed later"
    contact.firstName = "John"
    assert.equal(writes.events[0].taskSnapshot.name, "Call Mary")
    assert.equal(writes.events[0].contactName, "Mary Reed")
    assert.equal((await queueTaskCompletedAutomationEvent(prismaTx, event)).automationEventId, first.automationEventId)
    assert.equal(writes.events.length, 1)
    const repeatedCompletion = await queueTaskCompletedAutomationEvent(prismaTx, { ...event, causationKey: "task-status-activity:activity-2:completed" })
    assert.equal(repeatedCompletion.matchedCount, 2)
    assert.notEqual(repeatedCompletion.automationEventId, first.automationEventId)
  })

  test("task completion claims once per chain and records a depth-limit skip", async () => {
    const { prismaTx, writes } = fixture([completedAutomation("complete-A")])
    const base = { tenantId: "tenant-1", contactId: "contact-1", taskId: "task-1", actorUserId: null, completedAt: new Date("2026-10-16T16:30:00.000Z") }
    const first = await queueTaskCompletedAutomationEvent(prismaTx, { ...base, causationKey: "completion-1" })
    assert.equal(first.matchedCount, 1)
    const repeatedInChain = await queueTaskCompletedAutomationEvent(prismaTx, { ...base, causationKey: "completion-2", chainId: first.automationEventId, chainDepth: 1 })
    assert.equal(repeatedInChain.matchedCount, 0)
    assert.match(writes.dispatches.at(-1).decisionDetails, /already ran for this automation chain/)
    const overDepth = await queueTaskCompletedAutomationEvent(prismaTx, { ...base, causationKey: "completion-3", chainId: first.automationEventId, chainDepth: 21 })
    assert.equal(overDepth.matchedCount, 0)
    assert.match(writes.dispatches.at(-1).decisionDetails, /maximum depth.*task remains completed/i)
  })

  test("task creation matches all task and contact filters against the creation snapshot", async () => {
    const filters = [
      { source: "TASK_FIELD", fieldKey: "name", operator: "CONTAINS", compareValue: "Mary" },
      { source: "TASK_FIELD", fieldKey: "description", operator: "IS_EMPTY" },
      { source: "TASK_FIELD", fieldKey: "statusConfigId", operator: "EQUALS", compareValue: "todo" },
      { source: "TASK_FIELD", fieldKey: "assignedToUserId", operator: "INCLUDES_ANY", compareValue: ["user-jane", "user-john"] },
      { source: "TASK_FIELD", fieldKey: "startedAt", operator: "GREATER_THAN_OR_EQUAL", compareValue: "2026-10-15T13:00:00.000Z" },
      { source: "TASK_FIELD", fieldKey: "dueDate", operator: "BETWEEN", compareValue: { min: "2026-10-16T00:00:00.000Z", max: "2026-10-17T00:00:00.000Z" } },
      { source: "TASK_FIELD", fieldKey: "priority", operator: "EQUALS", compareValue: "HIGH" },
      { source: "TASK_FIELD", fieldKey: "linkedEntityName", operator: "CONTAINS", compareValue: "review" },
      { source: "TASK_FIELD", fieldKey: "linkedEntityType", operator: "EQUALS", compareValue: "SERVICE" },
      { source: "CONTACT_FIELD", fieldKey: "first_name", operator: "EQUALS", compareValue: "Mary" },
      { source: "CONTACT_CUSTOM_FIELD", customFieldId: "field-source", operator: "EQUALS", compareValue: "Referral" },
      { source: "CONTACT_TAGS", tagId: "tag-new", operator: "EQUALS" },
    ]
    const { prismaTx, task, writes } = fixture([
      taskAutomation("match", filters),
      taskAutomation("no-filter"),
      taskAutomation("skip", [{ source: "TASK_FIELD", fieldKey: "priority", operator: "EQUALS", compareValue: "LOW" }]),
    ])
    const event = { tenantId: "tenant-1", contactId: "contact-1", taskId: task.id, actorUserId: "user-1" }
    const result = await queueTaskAddedAutomationEvent(prismaTx, event)
    assert.equal(result.matchedCount, 2)
    assert.deepEqual(writes.dispatches.map((dispatch) => dispatch.automationId), ["match", "no-filter"])
    assert.equal(writes.events[0].taskId, task.id)
    assert.equal(writes.events[0].taskSnapshot.name, "Call Mary")
    assert.equal(writes.events[0].taskSnapshot.dueDate, "2026-10-16T19:00:00.000Z")
    assert.equal(writes.events[0].causationKey, "task:task-1:added")
    task.name = "Changed later"
    assert.equal(writes.events[0].taskSnapshot.name, "Call Mary")
    assert.equal((await queueTaskAddedAutomationEvent(prismaTx, event)).automationEventId, result.automationEventId)
    assert.equal(writes.events.length, 1)
  })

  test("task filters match cleared optional fields and reject filled values", async () => {
    const { prismaTx, task, writes } = fixture([
      taskAutomation("empty-values", [
        { source: "TASK_FIELD", fieldKey: "dueDate", operator: "IS_EMPTY" },
        { source: "TASK_FIELD", fieldKey: "linkedEntityName", operator: "IS_EMPTY" },
        { source: "TASK_FIELD", fieldKey: "assignedToUserId", operator: "IS_EMPTY" },
        { source: "TASK_FIELD", fieldKey: "priority", operator: "IS_NOT_EMPTY" },
      ]),
      taskAutomation("filled-due-date", [{ source: "TASK_FIELD", fieldKey: "dueDate", operator: "IS_NOT_EMPTY" }]),
    ])
    Object.assign(task, { dueDate: null, linkedEntityName: null, assignedToUserId: null })
    const result = await queueTaskAddedAutomationEvent(prismaTx, { tenantId: "tenant-1", contactId: "contact-1", taskId: "task-empty", actorUserId: null })
    assert.equal(result.matchedCount, 1)
    assert.deepEqual(writes.dispatches.map((dispatch) => dispatch.automationId), ["empty-values"])
    assert.equal(writes.events[0].taskSnapshot.dueDate, null)
  })

  test("task and note chains claim each automation once and preserve suppressed tasks", async () => {
    const { prismaTx, writes } = fixture([noteAutomation("note-A"), taskAutomation("task-B")])
    const base = { tenantId: "tenant-1", contactId: "contact-1", actorUserId: null }
    const root = await queueContactNoteAddedAutomationEvent(prismaTx, { ...base, causationKey: "manual-note" })
    assert.equal(root.matchedCount, 1)
    const child = await queueTaskAddedAutomationEvent(prismaTx, { ...base, taskId: "task-1", chainId: root.automationEventId, parentEventId: root.automationEventId, chainDepth: 1, sourceAutomationId: "note-A" })
    assert.equal(child.matchedCount, 1)
    const loop = await queueContactNoteAddedAutomationEvent(prismaTx, { ...base, chainId: root.automationEventId, chainDepth: 2, sourceAutomationId: "task-B", causationKey: "child-note" })
    assert.equal(loop.matchedCount, 0)
    const skippedTask = await queueTaskAddedAutomationEvent(prismaTx, { ...base, taskId: "task-2", chainId: root.automationEventId, chainDepth: 3, sourceAutomationId: "note-A" })
    assert.equal(skippedTask.matchedCount, 0)
    assert.match(writes.dispatches.at(-1).decisionDetails, /already ran for this automation chain/)
    const laterManualTask = await queueTaskAddedAutomationEvent(prismaTx, { ...base, taskId: "task-3" })
    assert.equal(laterManualTask.matchedCount, 1)
    assert.equal(writes.claims.size, 3)
    const deepTask = await queueTaskAddedAutomationEvent(prismaTx, { ...base, taskId: "task-4", chainId: root.automationEventId, chainDepth: 21 })
    assert.equal(deepTask.matchedCount, 0)
    assert.match(writes.dispatches.at(-1).decisionDetails, /maximum depth.*task was saved/i)
  })

  test("task-created tasks do not restart their source, and concurrent child tasks claim a peer once", async () => {
    const { prismaTx, task, writes } = fixture([
      taskAutomation("task-A"),
      taskAutomation("task-B", [{ source: "TASK_FIELD", fieldKey: "assignedToUserId", operator: "IS_EMPTY" }]),
    ])
    const base = { tenantId: "tenant-1", contactId: "contact-1", actorUserId: null }
    const root = await queueTaskAddedAutomationEvent(prismaTx, { ...base, taskId: "task-root" })
    assert.equal(root.matchedCount, 1)
    Object.assign(task, { assignedToUserId: null })
    const children = await Promise.all([
      queueTaskAddedAutomationEvent(prismaTx, { ...base, taskId: "task-child-1", chainId: root.automationEventId, chainDepth: 1, sourceAutomationId: "task-A" }),
      queueTaskAddedAutomationEvent(prismaTx, { ...base, taskId: "task-child-2", chainId: root.automationEventId, chainDepth: 1, sourceAutomationId: "task-A" }),
    ])
    assert.deepEqual(children.map((item) => item.matchedCount).sort(), [0, 1])
    assert.equal(writes.dispatches.filter((item) => item.automationId === "task-B" && item.decision === "RUN").length, 1)
    assert.equal(writes.claims.size, 2)
  })

  test("matches contact, custom-field, and tag filters, with a new chain for each manually added note", async () => {
    const filters = [
      { source: "CONTACT_FIELD", fieldKey: "first_name", operator: "EQUALS", compareValue: "Mary" },
      { source: "CONTACT_CUSTOM_FIELD", customFieldId: "field-source", operator: "EQUALS", compareValue: "Referral" },
      { source: "CONTACT_TAGS", tagId: "tag-new", operator: "EQUALS", compareValue: null },
    ]
    const { prismaTx, writes } = fixture([
      noteAutomation("match", filters),
      noteAutomation("unfiltered"),
      noteAutomation("skip", [{ ...filters[0], compareValue: "John" }]),
    ])
    const event = { tenantId: "tenant-1", contactId: "contact-1", actorUserId: "user-1", causationKey: "contact-note:note-1:added" }
    const first = await queueContactNoteAddedAutomationEvent(prismaTx, event)
    assert.equal(first.matchedCount, 2)
    assert.deepEqual(writes.dispatches.map((dispatch) => dispatch.automationId), ["match", "unfiltered"])
    assert.equal(writes.events[0].triggerType, "CONTACT_NOTE_ADDED")
    assert.equal(writes.logs[0].eventSource, "CONTACT_NOTE_ADDED")
    const retry = await queueContactNoteAddedAutomationEvent(prismaTx, event)
    assert.equal(retry.automationEventId, first.automationEventId)
    assert.equal(writes.events.length, 1)
    const second = await queueContactNoteAddedAutomationEvent(prismaTx, { ...event, causationKey: "contact-note:note-2:added" })
    assert.equal(second.matchedCount, 2)
    assert.notEqual(second.automationEventId, first.automationEventId)
    assert.equal(writes.claims.size, 4)
  })

  test("allows A to start B, then skips both when B adds another note", async () => {
    const { prismaTx, contact, writes } = fixture([
      noteAutomation("A"),
      noteAutomation("B", [{ source: "CONTACT_FIELD", fieldKey: "first_name", operator: "EQUALS", compareValue: "Maria" }]),
    ])
    const base = { tenantId: "tenant-1", contactId: "contact-1", actorUserId: null }
    const root = await queueContactNoteAddedAutomationEvent(prismaTx, { ...base, causationKey: "note-root" })
    assert.equal(root.matchedCount, 1)
    contact.firstName = "Maria"
    const child = await queueContactNoteAddedAutomationEvent(prismaTx, {
      ...base, chainId: root.automationEventId, parentEventId: root.automationEventId,
      sourceAutomationId: "A", chainDepth: 1, causationKey: "note-child",
    })
    assert.equal(child.matchedCount, 1)
    assert.deepEqual(writes.dispatches.filter((dispatch) => dispatch.eventId === child.automationEventId).map((dispatch) => dispatch.decision), ["SKIP_TRIGGER", "RUN"])
    const grandchild = await queueContactNoteAddedAutomationEvent(prismaTx, {
      ...base, chainId: root.automationEventId, parentEventId: child.automationEventId,
      sourceAutomationId: "B", chainDepth: 2, causationKey: "note-grandchild",
    })
    assert.equal(grandchild.matchedCount, 0)
    const skipped = writes.dispatches.filter((dispatch) => dispatch.eventId === grandchild.automationEventId)
    assert.deepEqual(skipped.map((dispatch) => dispatch.decision), ["SKIP_TRIGGER", "SKIP_TRIGGER"])
    assert.match(skipped[0].decisionDetails, /already ran for this automation chain/)
    assert.match(skipped[1].decisionDetails, /created the note/)
    assert.equal(writes.claims.size, 2)
    const retry = await queueContactNoteAddedAutomationEvent(prismaTx, {
      ...base, chainId: root.automationEventId, sourceAutomationId: "B", causationKey: "note-grandchild",
    })
    assert.equal(retry.automationEventId, grandchild.automationEventId)
    assert.equal(writes.events.length, 3)
  })

  test("claims concurrent child notes once per chain", async () => {
    const { prismaTx, writes } = fixture([noteAutomation("B")])
    const base = { tenantId: "tenant-1", contactId: "contact-1", actorUserId: null, chainId: "shared-chain", sourceAutomationId: "A" }
    const results = await Promise.all([
      queueContactNoteAddedAutomationEvent(prismaTx, { ...base, causationKey: "child-1" }),
      queueContactNoteAddedAutomationEvent(prismaTx, { ...base, causationKey: "child-2" }),
    ])
    assert.deepEqual(results.map((result) => result.matchedCount).sort(), [0, 1])
    assert.equal(writes.claims.size, 1)
    assert.equal(writes.dispatches.filter((dispatch) => dispatch.decision === "RUN").length, 1)
  })

  test("suppresses an over-depth note event without failing the note operation", async () => {
    const { prismaTx, writes } = fixture([noteAutomation("A")])
    const result = await queueContactNoteAddedAutomationEvent(prismaTx, {
      tenantId: "tenant-1", contactId: "contact-1", actorUserId: null,
      chainId: "deep-chain", chainDepth: 21, causationKey: "deep-note",
    })
    assert.equal(result.matchedCount, 0)
    assert.equal(writes.claims.size, 0)
    assert.equal(writes.dispatches[0].decision, "SKIP_TRIGGER")
    assert.match(writes.dispatches[0].decisionDetails, /maximum depth.*note was saved/i)
  })
})

describe("queueContactChangedAutomationEvent", () => {
  test("captures workflow action snapshots when a contact tag trigger is enabled", async () => {
    const contact = { id: "contact-1", firstName: "Mary", statusConfigId: "active", assignedToUserId: null, tags: [], customFieldValues: [] }
    let countWhere: any
    const snapshot = await captureContactChangeSnapshot({
      automation: { count: async ({ where }: any) => { countWhere = where; return 1 } },
      contact: { findFirst: async () => contact },
    }, "tenant-1", "contact-1")
    assert.equal(snapshot, contact)
    assert.deepEqual(countWhere.triggerType, { in: ["CONTACT_CHANGED", "CONTACT_TAG"] })
  })
  test("does not queue a no-op and stops an over-deep automation chain", async () => {
    const before = { id: "contact-1", firstName: "Mary", statusConfigId: "active", assignedToUserId: null, tags: [], customFieldValues: [] }
    let after = before
    const prismaTx = { contact: { findFirst: async () => after } }
    const noOp = await queueContactChangedAutomationEvent(prismaTx, { tenantId: "tenant-1", contactId: "contact-1", actorUserId: null, before })
    assert.equal(noOp.automationEventId, null)
    after = { ...before, firstName: "Maria" }
    await assert.rejects(
      queueContactChangedAutomationEvent(prismaTx, { tenantId: "tenant-1", contactId: "contact-1", actorUserId: null, before, chainDepth: 21 }),
      /maximum automation chain depth/,
    )
  })
  test("queues one matching run after all change rules and resulting-state filters pass", async () => {
    const writes: Record<string, any> = {}
    const before = { id: "contact-1", firstName: "Mary", lastName: "Reed", statusConfigId: "active", assignedToUserId: null, tags: [], customFieldValues: [] }
    const after = { ...before, firstName: "Maria", tags: [{ tagId: "new" }] }
    const changes = [
      { source: "CONTACT_FIELD", operator: "HAS_CHANGED_TO", fieldKey: "firstName", compareValue: "Maria" },
      { source: "CONTACT_TAGS", operator: "ADDED", tagId: "new" },
    ]
    const base = { name: "Contact changed", triggerType: "CONTACT_CHANGED", changeRules: changes, conditions: [], actions: [WAIT_ACTION] }
    const prismaTx = {
      contact: { findFirst: async () => after },
      automation: { findMany: async () => [
        { ...base, id: "match", conditions: [{ source: "CONTACT_FIELD", operator: "EQUALS", fieldKey: "first_name", compareValue: "Maria" }] },
        { ...base, id: "filter-fail", conditions: [{ source: "CONTACT_FIELD", operator: "EQUALS", fieldKey: "first_name", compareValue: "Mary" }] },
        { ...base, id: "change-fail", changeRules: [...changes, { source: "CONTACT_ASSIGNEE", operator: "HAS_CHANGED" }] },
      ] },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "active", name: "Active" }] },
      taskStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [{ id: "new", name: "New" }] },
      opportunityPipeline: { findMany: async () => [] },
      tenant: { findUnique: async () => ({ timezone: "America/Chicago" }) },
      automationEvent: { create: async ({ data }: any) => { writes.event = data; return data } },
      automationDispatch: { createMany: async ({ data }: any) => { writes.dispatches = data } },
      automationNodeExecution: { createMany: async ({ data }: any) => { writes.logs = data } },
    }
    const result = await queueContactChangedAutomationEvent(prismaTx, { tenantId: "tenant-1", contactId: "contact-1", actorUserId: null, before })
    assert.equal(result.matchedCount, 1)
    assert.equal(writes.dispatches[0].automationId, "match")
    assert.equal(writes.event.triggerType, "CONTACT_CHANGED")
    assert.equal(writes.logs[0].eventSource, "CONTACT_CHANGED")
  })
  test("queues the selected contact tag change once and keeps contact-change matches in the same event", async () => {
    const events: any[] = []
    const dispatches: any[][] = []
    const logs: any[][] = []
    let queryWhere: any
    const empty = { id: "contact-1", firstName: "Mary", statusConfigId: "active", assignedToUserId: null, tags: [], customFieldValues: [] }
    const tagged = { ...empty, tags: [{ tagId: "tag-1" }] }
    let after = tagged
    const tagRule = (operator: "ADDED" | "REMOVED", tagId = "tag-1") => [{ source: "CONTACT_TAGS", operator, tagId }]
    const base = { name: "Tag automation", conditions: [], actions: [WAIT_ACTION] }
    const prismaTx = {
      contact: { findFirst: async () => after },
      automation: { findMany: async ({ where }: any) => {
        queryWhere = where
        return [
          { ...base, id: "added", triggerType: "CONTACT_TAG", changeRules: tagRule("ADDED") },
          { ...base, id: "removed", triggerType: "CONTACT_TAG", changeRules: tagRule("REMOVED") },
          { ...base, id: "other-tag", triggerType: "CONTACT_TAG", changeRules: tagRule("ADDED", "tag-2") },
          { ...base, id: "filtered", triggerType: "CONTACT_TAG", changeRules: tagRule("ADDED"), conditions: [{ source: "CONTACT_STATUS", operator: "EQUALS", statusConfigId: "inactive" }] },
          { ...base, id: "changed", triggerType: "CONTACT_CHANGED", changeRules: tagRule("ADDED") },
        ]
      } },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "active", name: "Active" }] },
      taskStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [{ id: "tag-1", name: "One" }, { id: "tag-2", name: "Two" }] },
      opportunityPipeline: { findMany: async () => [] },
      tenant: { findUnique: async () => ({ timezone: "America/Chicago" }) },
      automationEvent: { create: async ({ data }: any) => { events.push(data); return data } },
      automationDispatch: { createMany: async ({ data }: any) => { dispatches.push(data) } },
      automationNodeExecution: { createMany: async ({ data }: any) => { logs.push(data) } },
    }

    const added = await queueContactChangedAutomationEvent(prismaTx, { tenantId: "tenant-1", contactId: "contact-1", actorUserId: null, before: empty })
    assert.deepEqual(queryWhere.triggerType, { in: ["CONTACT_CHANGED", "CONTACT_TAG"] })
    assert.equal(added.matchedCount, 2)
    assert.equal(events.length, 1)
    assert.deepEqual(dispatches[0].map((item) => [item.automationId, item.triggerType]), [["added", "CONTACT_TAG"], ["changed", "CONTACT_CHANGED"]])
    assert.deepEqual(logs[0].map((item) => item.eventSource), ["CONTACT_TAG", "CONTACT_CHANGED"])

    const noOp = await queueContactChangedAutomationEvent(prismaTx, { tenantId: "tenant-1", contactId: "contact-1", actorUserId: null, before: tagged })
    assert.equal(noOp.matchedCount, 0)
    assert.equal(events.length, 1)

    after = empty
    const removed = await queueContactChangedAutomationEvent(prismaTx, { tenantId: "tenant-1", contactId: "contact-1", actorUserId: null, before: tagged })
    assert.equal(removed.matchedCount, 1)
    assert.deepEqual(dispatches[1].map((item) => item.automationId), ["removed"])
    assert.equal(logs[1][0].eventSource, "CONTACT_TAG")
  })
})

describe("queueOpportunityAutomationEvent", () => {
  test("claims only a dispatch that is still queued", async () => {
    let where: Record<string, unknown> | null = null
    const claimed = await claimQueuedAutomationDispatch({
      automationDispatch: {
        updateMany: async (args: { where: Record<string, unknown> }) => {
          where = args.where
          return { count: 0 }
        },
      },
    }, { id: "dispatch-1", startedAt: null }, new Date("2026-10-02T12:00:00.000Z"))

    assert.equal(claimed, false)
    assert.deepEqual(where, { id: "dispatch-1", status: "QUEUED" })
  })

  test("queues and logs only automations that match the trigger and contact filters", async () => {
    const captured: Record<string, any> = {}
    const automations = [
      {
        id: "automation-run",
        name: "Run",
        sortOrder: 0,
        triggerType: "OPPORTUNITY_STAGE_CHANGED",
        pipelineId: "pipeline-1",
        targetStageId: "stage-2",
        sourceStageId: null,
        conditions: [],
        actions: [WAIT_ACTION],
      },
      {
        id: "automation-filter",
        name: "Filter mismatch",
        sortOrder: 1,
        triggerType: "OPPORTUNITY_STAGE_CHANGED",
        pipelineId: "pipeline-1",
        targetStageId: "stage-2",
        sourceStageId: null,
        conditions: [{
          source: "CONTACT_ASSIGNEE",
          operator: "EQUALS",
          assignedUserId: "user-john",
          compareValue: null,
        }],
        actions: [WAIT_ACTION],
      },
      {
        id: "automation-stage",
        name: "Stage mismatch",
        sortOrder: 2,
        triggerType: "OPPORTUNITY_STAGE_CHANGED",
        pipelineId: "pipeline-1",
        targetStageId: "stage-3",
        sourceStageId: null,
        conditions: [],
        actions: [WAIT_ACTION],
      },
    ]
    const prismaTx = {
      automation: {
        findMany: async ({ where }: any) => {
          captured.where = where
          return automations
        },
      },
      contact: {
        findFirst: async () => ({
          firstName: "Mary",
          middleName: null,
          lastName: "Reed",
          statusConfigId: "status-active",
          assignedToUserId: "user-mary",
          tags: [],
          customFieldValues: [],
        }),
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "status-active", name: "Active" }] },
      taskStatusConfig: { findMany: async () => [] },
      membership: {
        findMany: async () => [
          { userId: "user-john", user: { name: "John", email: "john@example.com" } },
          { userId: "user-mary", user: { name: "Mary", email: "mary@example.com" } },
        ],
      },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: {
        findMany: async () => [{
          id: "pipeline-1",
          name: "Work",
          stages: [
            { id: "stage-1", name: "New" },
            { id: "stage-2", name: "Working" },
            { id: "stage-3", name: "Closed" },
          ],
        }],
      },
      tenant: { findUnique: async () => ({ timezone: "America/Chicago" }) },
      automationEvent: {
        create: async ({ data }: any) => {
          captured.event = data
          return data
        },
      },
      automationDispatch: {
        createMany: async ({ data }: any) => {
          captured.dispatches = data
          return { count: data.length }
        },
      },
      automationNodeExecution: {
        createMany: async ({ data }: any) => {
          captured.logs = data
          return { count: data.length }
        },
      },
    }

    const result = await queueOpportunityAutomationEvent(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "actor-1",
      triggerType: "OPPORTUNITY_STAGE_CHANGED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-1",
      valueCents: 25_000,
      sourceStageId: "stage-1",
      targetStageId: "stage-2",
    })

    assert.deepEqual(captured.where, {
      tenantId: "tenant-1",
      isEnabled: true,
      pipelineId: "pipeline-1",
      OR: [
        { triggerType: "OPPORTUNITY_STAGE_CHANGED", targetStageId: "stage-2" },
        { triggerType: "OPPORTUNITY_CHANGED", targetStageId: "stage-2", targetResult: null },
      ],
    })
    assert.deepEqual(captured.dispatches.map((item: any) => item.decision), ["RUN"])
    assert.equal(captured.dispatches[0].automationId, "automation-run")
    assert.equal(captured.event.dispatchCount, 1)
    assert.equal(captured.logs.length, 1)
    assert.ok(captured.logs.every((item: any) => item.status === "QUEUED"))
    assert.equal(result.automationStatus, "QUEUED")
    assert.equal(result.queuedAutomationCount, 1)
    assert.equal(result.matchedCount, 1)
    assert.equal(captured.event.chainDepth, 0)
    assert.equal(captured.event.chainId, captured.event.id)
    assert.deepEqual(captured.event.transitionHistory, [{
      kind: "STAGE_CHANGED",
      opportunityKey: "opportunity-1",
      pipelineId: "pipeline-1",
      sourceStageId: "stage-1",
      targetStageId: "stage-2",
      sourceResult: null,
      targetResult: null,
    }])
  })

  test("does not create queue records when every candidate fails contact filters", async () => {
    const writes = {
      events: 0,
      dispatches: 0,
      logs: 0,
    }
    const result = await queueOpportunityAutomationEvent({
      automation: {
        findMany: async () => [{
          id: "automation-filter",
          name: "John opportunities",
          triggerType: "OPPORTUNITY_CREATED",
          pipelineId: "pipeline-1",
          targetStageId: null,
          sourceStageId: null,
          conditions: [{
            source: "CONTACT_ASSIGNEE",
            operator: "EQUALS",
            assignedUserId: "user-john",
            compareValue: null,
          }],
          actions: [WAIT_ACTION],
        }],
      },
      contact: {
        findFirst: async () => ({
          firstName: "Mary",
          middleName: null,
          lastName: "Reed",
          statusConfigId: "status-active",
          assignedToUserId: "user-mary",
          tags: [],
          customFieldValues: [],
        }),
      },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [{ id: "status-active", name: "Active" }] },
      taskStatusConfig: { findMany: async () => [] },
      membership: {
        findMany: async () => [
          { userId: "user-john", user: { name: "John", email: "john@example.com" } },
          { userId: "user-mary", user: { name: "Mary", email: "mary@example.com" } },
        ],
      },
      tenantTag: { findMany: async () => [] },
      opportunityPipeline: {
        findMany: async () => [{
          id: "pipeline-1",
          name: "Work",
          stages: [{ id: "stage-1", name: "New" }],
        }],
      },
      tenant: { findUnique: async () => ({ timezone: "America/Chicago" }) },
      automationEvent: { create: async () => { writes.events += 1 } },
      automationDispatch: { createMany: async () => { writes.dispatches += 1 } },
      automationNodeExecution: { createMany: async () => { writes.logs += 1 } },
    }, {
      tenantId: "tenant-1",
      actorUserId: "actor-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-1",
      valueCents: 25_000,
      sourceStageId: null,
      targetStageId: "stage-1",
    })

    assert.deepEqual(result, {
      automationEventId: null,
      automationStatus: "NOT_APPLICABLE",
      queuedAutomationCount: 0,
      matchedCount: 0,
      executedCount: 0,
      contactDeleted: false,
    })
    assert.deepEqual(writes, { events: 0, dispatches: 0, logs: 0 })
  })

  test("returns the existing child event for the same causation key", async () => {
    let automationQueries = 0
    const result = await queueOpportunityAutomationEvent({
      automationEvent: {
        findUnique: async () => ({
          id: "existing-event",
          completedCount: 1,
          dispatches: [{ decision: "RUN" }, { decision: "SKIP_FILTERS" }],
        }),
      },
      automation: { findMany: async () => { automationQueries += 1; return [] } },
    }, {
      tenantId: "tenant-1",
      actorUserId: null,
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-1",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-1",
      causationKey: "automation-run:run-1:node:node-1",
    })

    assert.equal(result.automationEventId, "existing-event")
    assert.equal(result.queuedAutomationCount, 2)
    assert.equal(result.matchedCount, 1)
    assert.equal(result.executedCount, 1)
    assert.equal(automationQueries, 0)
  })

  test("does not create a queue event when no trigger and pipeline candidate exists", async () => {
    let where: Record<string, unknown> | undefined
    const result = await queueOpportunityAutomationEvent({
      automation: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          where = args.where
          return []
        },
      },
    }, {
      tenantId: "tenant-1",
      actorUserId: "actor-1",
      triggerType: "OPPORTUNITY_CREATED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-1",
      valueCents: 0,
      sourceStageId: null,
      targetStageId: "stage-1",
    })

    assert.equal(result.automationStatus, "NOT_APPLICABLE")
    assert.equal(result.automationEventId, null)
    assert.equal(result.queuedAutomationCount, 0)
    assert.deepEqual(where, {
      tenantId: "tenant-1",
      isEnabled: true,
      triggerType: "OPPORTUNITY_CREATED",
      pipelineId: "pipeline-1",
    })
  })
})

test("an event worker whose shared lease expired cannot renew or execute a dispatch", async () => {
  let eventRenewed = false
  const client = {
    automationEvent: {
      findUnique: async () => ({ id: "event", leaseToken: "old-token", status: "PROCESSING", dispatches: [{ id: "dispatch", status: "QUEUED" }] }),
      updateMany: async () => { eventRenewed = true; return { count: 1 } },
    },
    automationExecutionLease: { updateMany: async () => ({ count: 0 }) },
    $transaction: async () => { throw new Error("An expired worker must not execute") },
  }
  await processClaimedAutomationEvent(client, { eventId: "event", leaseToken: "old-token" })
  assert.equal(eventRenewed, false)
})
