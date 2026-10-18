import assert from "node:assert/strict"
import { describe, test } from "node:test"

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"

const automationModule = import("./opportunity-automations.js")
const bookingModule = import("./appointment-booking.js")

describe("Update appointment status action", () => {
  const config = {
    actionName: "Confirm review",
    targetMode: "TRIGGERING_APPOINTMENT" as const,
    status: "CONFIRMED" as const,
    filters: [],
  }

  test("validates configuration and restricts triggering target to appointment workflows", async () => {
    const { AutomationAppointmentStatusConfigSchema, AutomationUpsertSchema, validateAutomationConfiguration } = await automationModule
    assert.equal(AutomationAppointmentStatusConfigSchema.safeParse(config).success, true)
    assert.equal(AutomationAppointmentStatusConfigSchema.safeParse({ ...config, actionName: " " }).success, false)
    assert.equal(AutomationAppointmentStatusConfigSchema.safeParse({ ...config, status: "INVALID" }).success, false)
    assert.equal(AutomationAppointmentStatusConfigSchema.safeParse({ ...config, filters: Array(21).fill({ source: "CONTACT_TAGS", operator: "IS_EMPTY" }) }).success, false)
    assert.equal(AutomationAppointmentStatusConfigSchema.safeParse({ ...config, filters: [{ source: "CONTACT_STATUS", operator: "EQUALS" }] }).success, false)

    const prismaClient = {
      opportunityPipeline: { findUnique: async () => ({ id: "pipeline-1", stages: [] }) },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [] },
      tenantTag: { findMany: async () => [{ id: "tag-1" }] },
      service: { findMany: async () => [] },
    }
    const input = (trigger: unknown, appointmentStatusConfig: unknown) => AutomationUpsertSchema.parse({
      name: "Appointment status flow", trigger, conditions: [],
      actions: [{ type: "UPDATE_APPOINTMENT_STATUS", appointmentStatusConfig }],
    })
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", input({ type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" }, config)),
      /only available for appointment automations/,
    )
    const normalized = await validateAutomationConfiguration(prismaClient, "tenant-1", input({ type: "APPOINTMENT_CREATED" }, {
      ...config, filters: [{ source: "CONTACT_TAGS", operator: "EQUALS", tagId: "tag-1" }],
    }))
    assert.equal((normalized.actions[0] as any).appointmentStatusConfig.filters[0].tagId, "tag-1")
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", input({ type: "APPOINTMENT_CREATED" }, {
        ...config, filters: [{ source: "CONTACT_TAGS", operator: "EQUALS", tagId: "other-tenant-tag" }],
      })), /tenant tag/,
    )
    await assert.rejects(
      validateAutomationConfiguration({ ...prismaClient, contactCustomField: { findMany: async () => [{
        id: "sensitive-field", key: "sensitive", fieldType: "TEXT", isActive: true,
        isSensitive: true, isEncrypted: false, options: [],
      }] } }, "tenant-1", input({ type: "APPOINTMENT_CREATED" }, {
        ...config, filters: [{ source: "CONTACT_CUSTOM_FIELD", operator: "EQUALS", customFieldId: "sensitive-field", compareValue: "x" }],
      })), /active, non-sensitive custom field/,
    )
  })

  test("locks the selected appointment, skips unchanged status, and audits a change", async () => {
    const { changeAppointmentStatusInTransaction } = await bookingModule
    const audits: any[] = []
    const locks: string[] = []
    const appointment = {
      id: "appointment-1", contactId: "contact-1", assignedToUserId: "user-1",
      startAt: new Date("2027-01-05T15:00:00.000Z"), endAt: new Date("2027-01-05T15:30:00.000Z"),
      status: "SCHEDULED",
    }
    const tx = {
      $queryRawUnsafe: async (sql: string) => { locks.push(sql); return [{ id: appointment.id }] },
      appointment: {
        findFirst: async ({ where }: any) => where.contactId === appointment.contactId ? { ...appointment } : null,
        update: async ({ data }: any) => Object.assign(appointment, data),
      },
      appointmentAuditLog: { create: async ({ data }: any) => {
        audits.push(data)
        return { id: `audit-${audits.length}`, createdAt: new Date() }
      } },
      automation: { findMany: async () => [] },
    } as any
    const params = {
      tenantId: "tenant-1", contactId: "contact-1", appointmentId: appointment.id,
      actorDisplayName: "Automation · Review flow", status: "CONFIRMED" as const,
    }
    const missing = await changeAppointmentStatusInTransaction(tx, { ...params, contactId: "other-contact" })
    assert.equal(missing.ok, false)
    assert.equal(audits.length, 0)
    const changed = await changeAppointmentStatusInTransaction(tx, params)
    assert.equal(changed.ok, true)
    assert.equal(changed.changed, true)
    assert.equal(appointment.status, "CONFIRMED")
    assert.match(audits[0].message, /Automation · Review flow changed/)
    assert.equal(audits[0].actorUserId, null)
    const unchanged = await changeAppointmentStatusInTransaction(tx, params)
    assert.equal(unchanged.ok, true)
    assert.equal(unchanged.changed, false)
    assert.equal(audits.length, 1)
    assert.equal(locks.length, 3)
  })

  test("rejects a move to Scheduled when calendar availability is missing", async () => {
    const { changeAppointmentStatusInTransaction } = await bookingModule
    let updated = false
    const appointment = {
      id: "appointment-1", contactId: "contact-1", assignedToUserId: "user-1",
      startAt: new Date("2027-01-05T15:00:00.000Z"), endAt: new Date("2027-01-05T15:30:00.000Z"),
      status: "CANCELED",
    }
    const tx = {
      $queryRawUnsafe: async () => [{ id: appointment.id }],
      $queryRaw: async () => [{ value: 1 }],
      appointment: {
        findFirst: async () => ({ ...appointment }),
        findMany: async () => [], count: async () => 0,
        update: async () => { updated = true },
      },
      membership: { findUnique: async () => ({ status: "ACTIVE" }) },
      tenant: { findUnique: async () => ({
        timezone: "UTC", calendarMeetingDurationMinutes: 30, calendarMinimumScheduleNoticeMinutes: 0,
        calendarMaximumBookingsPerDay: null, calendarMaximumBookingsPerSlot: 1,
        calendarPreBufferMinutes: 0, calendarPostBufferMinutes: 0, calendarBufferAvailabilityMode: "BUSY",
      }) },
      calendarAvailabilityRule: { findMany: async () => [] },
      calendarTimeBlock: { findMany: async () => [] },
    } as any
    const result = await changeAppointmentStatusInTransaction(tx, {
      tenantId: "tenant-1", contactId: "contact-1", appointmentId: appointment.id,
      actorDisplayName: "Automation · Review flow", status: "SCHEDULED",
    })
    assert.equal(result.ok, false)
    assert.equal(result.error, "APPOINTMENT_TIME_UNAVAILABLE")
    assert.equal(updated, false)
  })

  test("uses the triggering appointment and continues with a no-op on the original contact", async () => {
    const { executeAutomationSegmentTx } = await automationModule
    const appointment = {
      id: "appointment-1", contactId: "contact-1", assignedToUserId: "user-1",
      startAt: new Date("2027-01-05T15:00:00.000Z"), endAt: new Date("2027-01-05T15:30:00.000Z"),
      status: "SCHEDULED",
    }
    let updates = 0
    const tx = {
      $queryRawUnsafe: async () => [{ id: appointment.id }],
      appointment: {
        findFirst: async ({ where }: any) => where.id === appointment.id && where.contactId === appointment.contactId ? { ...appointment } : null,
        update: async ({ data }: any) => { updates += 1; return Object.assign(appointment, data) },
      },
      appointmentAuditLog: { create: async () => ({ id: "audit-1", createdAt: new Date() }) },
      automation: { findMany: async () => [] },
      automationRun: { updateMany: async () => ({ count: 1 }) },
      automationExecution: { create: async () => undefined },
    } as any
    const actions = [
      { nodeKey: "status-1", type: "UPDATE_APPOINTMENT_STATUS", appointmentStatusConfig: config },
      { nodeKey: "status-2", type: "UPDATE_APPOINTMENT_STATUS", appointmentStatusConfig: config },
    ] as any
    const result = await executeAutomationSegmentTx(tx, {
      run: {
        id: "run-1", tenantId: "tenant-1", automationId: "automation-1", automationName: "Review flow",
        contactId: "contact-1", contactName: "Jane Doe", actorUserId: null, opportunityId: null,
        attemptId: "attempt-1", eventSource: "APPOINTMENT_CREATED", triggerType: "APPOINTMENT_CREATED",
        sourceStageId: null, targetStageId: null, status: "RUNNING", variables: {},
        eventContext: { appointmentId: appointment.id, chainId: "chain-1", chainDepth: 0 },
      } as any,
      actions,
      catalog: {
        fieldMap: new Map(), fieldKeyMap: new Map(), activeStatusIds: new Set(), activeTaskStatusIds: new Set(),
        taskStatusMap: new Map(), activeUserIds: new Set(), tagIds: new Set(), statusMap: new Map(),
        userMap: new Map(), tagMap: new Map(), pipelineMap: new Map(), stageMap: new Map(),
        stagePipelineMap: new Map(), timezone: "UTC",
      } as any,
      startIndex: 0,
      occurredAt: new Date("2026-10-17T15:00:00.000Z"),
    })
    assert.equal(result.status, "SUCCEEDED")
    assert.equal(updates, 1)
    assert.equal(result.logs[0]?.status, "EXECUTED")
    assert.match(result.logs[0]?.details ?? "", /Changed the triggering appointment to Confirmed/)
    assert.match(result.logs[1]?.details ?? "", /already Confirmed/)
  })

  test("skips a live filter miss, then selects the earliest future appointment regardless of status", async () => {
    const { executeAutomationSegmentTx } = await automationModule
    const appointment = {
      id: "canceled-appointment", contactId: "contact-1", assignedToUserId: "user-1",
      startAt: new Date("2027-01-05T15:00:00.000Z"), endAt: new Date("2027-01-05T15:30:00.000Z"),
      status: "CANCELED",
    }
    const selectionOrders: unknown[] = []
    let updates = 0
    const tx = {
      $queryRawUnsafe: async () => [{ id: appointment.id }],
      contact: { findFirst: async () => ({ id: "contact-1", firstName: "Jane", lastName: "Doe", tags: [], customFieldValues: [] }) },
      appointment: {
        findFirst: async ({ where, orderBy }: any) => {
          if (!where.id) { selectionOrders.push(orderBy); return { id: appointment.id } }
          return { ...appointment }
        },
        update: async ({ data }: any) => { updates += 1; return Object.assign(appointment, data) },
      },
      appointmentAuditLog: { create: async () => ({ id: "audit-1", createdAt: new Date() }) },
      automation: { findMany: async () => [] },
      automationRun: { updateMany: async () => ({ count: 1 }) },
      automationExecution: { create: async () => undefined },
    } as any
    const nextConfig = { ...config, targetMode: "NEXT_UPCOMING" as const }
    const result = await executeAutomationSegmentTx(tx, {
      run: {
        id: "run-2", tenantId: "tenant-1", automationId: "automation-1", automationName: "Review flow",
        contactId: "contact-1", contactName: "Jane Doe", actorUserId: null, opportunityId: null,
        attemptId: "attempt-2", eventSource: "CONTACT_CREATED", triggerType: "CONTACT_CREATED",
        sourceStageId: null, targetStageId: null, status: "RUNNING", variables: {}, eventContext: {},
      } as any,
      actions: [
        { nodeKey: "filter-miss", type: "UPDATE_APPOINTMENT_STATUS", appointmentStatusConfig: {
          ...nextConfig, filters: [{ source: "CONTACT_TAGS", operator: "EQUALS", tagId: "tag-1" }],
        } },
        { nodeKey: "next", type: "UPDATE_APPOINTMENT_STATUS", appointmentStatusConfig: nextConfig },
      ] as any,
      catalog: {
        fieldMap: new Map(), fieldKeyMap: new Map(), activeStatusIds: new Set(), activeTaskStatusIds: new Set(),
        taskStatusMap: new Map(), activeUserIds: new Set(), tagIds: new Set(["tag-1"]), statusMap: new Map(),
        userMap: new Map(), tagMap: new Map(), pipelineMap: new Map(), stageMap: new Map(),
        stagePipelineMap: new Map(), timezone: "UTC",
      } as any,
      startIndex: 0,
      occurredAt: new Date("2026-10-17T15:00:00.000Z"),
    })
    assert.equal(result.status, "SUCCEEDED")
    assert.match(result.logs[0]?.details ?? "", /filters did not match/)
    assert.match(result.logs[1]?.details ?? "", /Changed the next upcoming appointment to Confirmed/)
    assert.deepEqual(selectionOrders, [[{ startAt: "asc" }, { id: "asc" }]])
    assert.equal(updates, 1)
  })
})
