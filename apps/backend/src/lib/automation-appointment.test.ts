import assert from "node:assert/strict"
import { describe, test } from "node:test"

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"

const automationModule = import("./opportunity-automations.js")
const appointmentModule = import("./automation-appointment.js")
const bookingModule = import("./appointment-booking.js")

const config = {
  actionName: "Book review",
  titleTemplate: "Review with {contact.name}",
  notesTemplate: "",
  assignee: { mode: "SPECIFIC_USER" as const, userId: "user-active" },
  linkedService: { id: "service-1", nameSnapshot: "Stale name" },
  startAt: { source: { type: "RELATIVE_DATE" as const, amount: 1, unit: "DAYS" as const }, time: "09:00" },
}

describe("Create appointment action", () => {
  test("validates required details, tenant references, and earlier date values", async () => {
    const { AutomationUpsertSchema, validateAutomationConfiguration } = await automationModule
    const { AutomationAppointmentConfigSchema } = await appointmentModule
    assert.equal(AutomationAppointmentConfigSchema.safeParse(config).success, true)
    assert.equal(AutomationAppointmentConfigSchema.safeParse({ ...config, actionName: " " }).success, false)
    assert.equal(AutomationAppointmentConfigSchema.safeParse({ ...config, titleTemplate: "" }).success, false)
    assert.equal(AutomationAppointmentConfigSchema.safeParse({ ...config, startAt: { ...config.startAt, time: "25:00" } }).success, false)

    const prismaClient = {
      opportunityPipeline: { findUnique: async () => ({ id: "pipeline-1", stages: [] }) },
      contactCustomField: { findMany: async () => [] },
      contactStatusConfig: { findMany: async () => [] },
      membership: { findMany: async () => [{ userId: "user-active", status: "ACTIVE" }] },
      tenantTag: { findMany: async () => [] },
      service: { findMany: async () => [{ id: "service-1", name: "Current service", isActive: true }] },
    }
    const createInput = (actions: unknown[]) => AutomationUpsertSchema.parse({
      name: "Appointment flow",
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions,
    })
    const normalized = await validateAutomationConfiguration(prismaClient, "tenant-1", createInput([
      { type: "CREATE_APPOINTMENT", appointmentConfig: config },
    ]))
    assert.equal((normalized.actions[0] as any).appointmentConfig.linkedService.nameSnapshot, "Current service")

    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", createInput([{
        type: "CREATE_APPOINTMENT",
        appointmentConfig: { ...config, assignee: { mode: "SPECIFIC_USER", userId: "user-disabled" } },
      }])),
      /active appointment assignee/,
    )
    const automationValueAction = {
      type: "CREATE_APPOINTMENT",
      appointmentConfig: { ...config, startAt: { source: { type: "AUTOMATION_VALUE", key: "review_date" }, time: "09:00" } },
    }
    await assert.rejects(
      validateAutomationConfiguration(prismaClient, "tenant-1", createInput([automationValueAction])),
      /earlier date value/,
    )
    const calculatedDate = {
      type: "MATH_OPERATION",
      mathOperationConfig: {
        mode: "DATE", source: { type: "CONTACT_FIELD", key: "lead_date" },
        operation: "ADD", amount: 1, unit: "DAYS", outputKey: "review_date",
      },
    }
    const withEarlierDate = await validateAutomationConfiguration(prismaClient, "tenant-1", createInput([calculatedDate, automationValueAction]))
    assert.equal((withEarlierDate.actions[1] as any).appointmentConfig.startAt.source.key, "review_date")
  })

  test("resolves local dates and rejects missing automation values and nonexistent local times", async () => {
    const { resolveAutomationAppointmentStart } = await appointmentModule
    const base = {
      tenantId: "tenant-1", contactId: "contact-1", tenantTimezone: "America/Chicago",
      occurredAt: new Date("2027-03-13T15:00:00.000Z"), automationValues: { review_date: "2027-03-15" },
    }
    const relative = await resolveAutomationAppointmentStart({}, {
      ...base, startAt: { source: { type: "RELATIVE_DATE", amount: 2, unit: "DAYS" }, time: "09:00" },
    })
    assert.equal(relative.toISOString(), "2027-03-15T14:00:00.000Z")
    const fromValue = await resolveAutomationAppointmentStart({}, {
      ...base, startAt: { source: { type: "AUTOMATION_VALUE", key: "review_date" }, time: "09:00" },
    })
    assert.equal(fromValue.toISOString(), relative.toISOString())
    await assert.rejects(
      resolveAutomationAppointmentStart({}, { ...base, automationValues: {}, startAt: { source: { type: "AUTOMATION_VALUE", key: "review_date" }, time: "09:00" } }),
      /missing or invalid/,
    )
    await assert.rejects(
      resolveAutomationAppointmentStart({}, { ...base, startAt: { source: { type: "SPECIFIC_DATE", date: "2027-03-14", timezone: "America/Chicago" }, time: "02:30" } }),
      /does not exist/,
    )
  })

  test("books and audits in the supplied transaction, then rejects an occupied slot", async () => {
    const { createAppointmentInTransaction } = await bookingModule
    const startAt = new Date("2027-01-05T15:00:00.000Z")
    const endAt = new Date("2027-01-05T15:30:00.000Z")
    const appointments: any[] = []
    const auditLogs: any[] = []
    const lockKeys: string[] = []
    const rules = [
      { scope: "TENANT", userId: null, kind: "OPEN", dayOfWeek: 2, startTimeMinutes: 9 * 60, endTimeMinutes: 17 * 60, label: null },
      { scope: "USER", userId: "user-active", kind: "OPEN", dayOfWeek: 2, startTimeMinutes: 9 * 60, endTimeMinutes: 17 * 60, label: null },
    ]
    const tx = {
      $queryRaw: async (_parts: TemplateStringsArray, _namespace: string, key: string) => { lockKeys.push(key); return [{ value: 1 }] },
      tenant: { findUnique: async () => ({
        timezone: "UTC", calendarMeetingDurationMinutes: 30, calendarMinimumScheduleNoticeMinutes: 0,
        calendarMaximumBookingsPerDay: null, calendarMaximumBookingsPerSlot: 1,
        calendarPreBufferMinutes: 0, calendarPostBufferMinutes: 0, calendarBufferAvailabilityMode: "BUSY",
      }) },
      calendarAvailabilityRule: { findMany: async () => rules },
      calendarTimeBlock: { findMany: async () => [] },
      appointment: {
        findMany: async () => appointments,
        count: async () => appointments.length,
        create: async ({ data }: any) => {
          const item = { ...data, id: `appointment-${appointments.length + 1}` }
          appointments.push(item)
          return item
        },
      },
      appointmentAuditLog: { create: async ({ data }: any) => { auditLogs.push(data); return data } },
      automation: { findMany: async () => [] },
    } as any
    const params = {
      tenantId: "tenant-1", contactId: "contact-1", serviceId: null, bookedByUserId: null,
      actorDisplayName: "Automation · Follow up", assignedToUserId: "user-active",
      assignedToLabel: "Jane", title: "Review", notes: null, startAt, endAt, isAllDay: false,
    }
    const first = await createAppointmentInTransaction(tx, params)
    assert.equal(first.ok, true)
    assert.equal(appointments[0].bookedByUserId, null)
    assert.match(auditLogs[0].message, /Automation · Follow up/)
    assert.deepEqual(lockKeys, ["tenant-1:2027-01-05:assignee:user-active", "tenant-1:2027-01-05:contact:contact-1"])
    const second = await createAppointmentInTransaction(tx, params)
    assert.equal(second.ok, false)
    assert.equal(appointments.length, 1)
  })

  test("uses the live assignee and continues later actions on the original contact", async () => {
    const { executeAutomationSegmentTx } = await automationModule
    let assignedToUserId: string | null = null
    let statusConfigId = "active"
    let booked: Record<string, any> | null = null
    const actions = [
      { nodeKey: "assign", type: "SET_CONTACT_ASSIGNEE", assignedUserId: "user-active" },
      { nodeKey: "book", type: "CREATE_APPOINTMENT", appointmentConfig: {
        actionName: "Book review", titleTemplate: "Review with {contact.name}", notesTemplate: "Bring policy documents",
        assignee: { mode: "CONTACT_ASSIGNEE" }, linkedService: null,
        startAt: { source: { type: "SPECIFIC_DATE", date: "2027-01-05", timezone: "UTC" }, time: "09:00" },
      } },
      { nodeKey: "status", type: "SET_CONTACT_STATUS", statusConfigId: "follow-up" },
    ] as any
    const tx = {
      $queryRaw: async () => [{ value: 1 }],
      contact: {
        findFirst: async () => ({
          id: "contact-1", firstName: "Taylor", lastName: "Reed", middleName: null,
          assignedToUserId, email: "taylor@example.com", tags: [], customFieldValues: [],
        }),
        update: async ({ where, data }: any) => {
          assert.equal(where.id, "contact-1")
          if ("assignedToUserId" in data) assignedToUserId = data.assignedToUserId
          if ("statusConfigId" in data) statusConfigId = data.statusConfigId
        },
      },
      contactCustomField: { findMany: async () => [] },
      membership: { findUnique: async () => ({ status: "ACTIVE", user: { name: "Jane Smith", email: "jane@example.com" } }) },
      tenant: { findUnique: async () => ({
        timezone: "UTC", calendarMeetingDurationMinutes: 30, calendarMinimumScheduleNoticeMinutes: 0,
        calendarMaximumBookingsPerDay: null, calendarMaximumBookingsPerSlot: 1,
        calendarPreBufferMinutes: 0, calendarPostBufferMinutes: 0, calendarBufferAvailabilityMode: "BUSY",
      }) },
      calendarAvailabilityRule: { findMany: async () => [
        { scope: "TENANT", userId: null, kind: "OPEN", dayOfWeek: 2, startTimeMinutes: 540, endTimeMinutes: 1020, label: null },
        { scope: "USER", userId: "user-active", kind: "OPEN", dayOfWeek: 2, startTimeMinutes: 540, endTimeMinutes: 1020, label: null },
      ] },
      calendarTimeBlock: { findMany: async () => [] },
      appointment: {
        findMany: async () => [], count: async () => 0,
        create: async ({ data }: any) => { booked = data; return { id: "appointment-1", ...data } },
      },
      appointmentAuditLog: { create: async () => undefined },
      automation: { findMany: async () => [] },
      automationRun: { updateMany: async () => ({ count: 1 }) },
      automationExecution: { create: async () => undefined },
    }
    const result = await executeAutomationSegmentTx(tx, {
      run: {
        id: "run-1", tenantId: "tenant-1", automationId: "automation-1", automationName: "Review workflow",
        contactId: "contact-1", contactName: "Taylor Reed", actorUserId: null, opportunityId: null,
        attemptId: "attempt-1", eventSource: "CONTACT_CREATED", triggerType: "CONTACT_CREATED",
        sourceStageId: null, targetStageId: null, status: "RUNNING", variables: {}, eventContext: {},
      } as any,
      actions,
      catalog: {
        fieldMap: new Map(), fieldKeyMap: new Map(), activeStatusIds: new Set(["active", "follow-up"]),
        activeTaskStatusIds: new Set(), taskStatusMap: new Map(), activeUserIds: new Set(["user-active"]),
        tagIds: new Set(), statusMap: new Map(), userMap: new Map(), tagMap: new Map(),
        pipelineMap: new Map(), stageMap: new Map(), stagePipelineMap: new Map(), timezone: "UTC",
      } as any,
      startIndex: 0,
      occurredAt: new Date("2026-10-17T15:00:00.000Z"),
    })
    assert.equal(result.status, "SUCCEEDED")
    assert.equal(assignedToUserId, "user-active")
    assert.equal(statusConfigId, "follow-up")
    assert.equal((booked as Record<string, any> | null)?.contactId, "contact-1")
    assert.equal((booked as Record<string, any> | null)?.bookedByUserId, null)
    assert.equal((booked as Record<string, any> | null)?.assignedToUserId, "user-active")
    assert.equal((booked as Record<string, any> | null)?.title, "Review with Taylor Reed")
    assert.equal((booked as Record<string, any> | null)?.notes, "Bring policy documents")
    assert.equal((booked as Record<string, any> | null)?.endAt.toISOString(), "2027-01-05T09:30:00.000Z")
    assert.equal(result.logs[1]?.status, "EXECUTED")
    assert.match(result.logs[1]?.details ?? "", /Created appointment “Review with Taylor Reed” for Jane Smith/)
    assert.equal(result.logs[2]?.status, "EXECUTED")
  })
})
