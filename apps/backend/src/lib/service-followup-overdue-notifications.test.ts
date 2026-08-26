import assert from "node:assert/strict"
import test from "node:test"

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"

test("recipient resolution prefers the active step assignee, then contact owner, then admins", async () => {
  const { resolveOverdueFollowUpRecipientIds } = await import(
    "./service-followup-overdue-notifications.js"
  )

  assert.deepEqual(
    resolveOverdueFollowUpRecipientIds({
      stepAssigneeUserId: "step-user",
      stepAssigneeIsActive: true,
      contactOwnerUserId: "owner-user",
      contactOwnerIsActive: true,
      tenantAdminUserIds: ["admin-1"],
    }),
    ["step-user"],
  )
  assert.deepEqual(
    resolveOverdueFollowUpRecipientIds({
      stepAssigneeUserId: "disabled-step-user",
      stepAssigneeIsActive: false,
      contactOwnerUserId: "owner-user",
      contactOwnerIsActive: true,
      tenantAdminUserIds: ["admin-1"],
    }),
    ["owner-user"],
  )
  assert.deepEqual(
    resolveOverdueFollowUpRecipientIds({
      stepAssigneeUserId: null,
      stepAssigneeIsActive: false,
      contactOwnerUserId: null,
      contactOwnerIsActive: false,
      tenantAdminUserIds: ["admin-1", "admin-1", "admin-2"],
    }),
    ["admin-1", "admin-2"],
  )
})

test("formats the overdue timestamp in the tenant timezone across daylight saving time", async () => {
  const { formatOverdueFollowUpDueAt } = await import(
    "./service-followup-overdue-notifications.js"
  )

  assert.equal(
    formatOverdueFollowUpDueAt(
      new Date("2026-11-01T07:30:00.000Z"),
      "America/Chicago",
    ),
    "November 1, 2026 at 1:30 AM",
  )
})

test("materializes one notification per due occurrence and claims it atomically", async () => {
  const { materializeOverdueFollowUpNotifications } = await import(
    "./service-followup-overdue-notifications.js"
  )
  const dueAt = new Date("2026-08-24T15:00:00.000Z")
  let claimed = false
  const notifications: Record<string, any>[] = []
  let candidateWhere: Record<string, any> | null = null

  const step = {
    id: "step-1",
    tenantId: "tenant-1",
    title: "Submit application",
    dueAt,
    assignedToUserId: "user-1",
    tenant: { timezone: "America/Chicago" },
    contactService: {
      contactId: "contact-1",
      service: { name: "Medicare Application" },
      contact: {
        firstName: "John",
        middleName: null,
        lastName: "Smith",
        assignedToUserId: "owner-1",
      },
    },
  }

  const prismaClient = {
    contactServiceFollowUpStep: {
      findMany: async (query: Record<string, any>) => {
        candidateWhere = query.where
        return claimed ? [] : [{ id: step.id, tenantId: step.tenantId, dueAt }]
      },
    },
    $transaction: async (callback: (tx: any) => Promise<any>) => callback({
      contactServiceFollowUpStep: {
        findFirst: async () => (claimed ? null : step),
        updateMany: async () => {
          if (claimed) return { count: 0 }
          claimed = true
          return { count: 1 }
        },
      },
      membership: {
        findUnique: async ({ where }: Record<string, any>) => ({
          status: where.userId_tenantId.userId === "user-1" ? "ACTIVE" : "DISABLED",
        }),
        findMany: async () => [],
      },
      notification: {
        create: async ({ data }: Record<string, any>) => {
          notifications.push(data)
          return {
            id: `notification-${notifications.length}`,
            ...data,
            readAt: null,
            createdAt: new Date("2026-08-24T15:00:01.000Z"),
            taskId: null,
            taskReminderId: null,
          }
        },
      },
    }),
  }

  const [first, concurrent] = await Promise.all([
    materializeOverdueFollowUpNotifications({
      now: new Date("2026-08-24T15:00:01.000Z"),
      prismaClient,
    }),
    materializeOverdueFollowUpNotifications({
      now: new Date("2026-08-24T15:00:01.000Z"),
      prismaClient,
    }),
  ])
  const second = await materializeOverdueFollowUpNotifications({
    now: new Date("2026-08-24T15:00:16.000Z"),
    prismaClient,
  })

  assert.equal(first.length + concurrent.length, 1)
  assert.equal(second.length, 0)
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0]?.userId, "user-1")
  assert.equal(notifications[0]?.type, "FOLLOW_UP_OVERDUE")
  assert.equal(notifications[0]?.title, "Follow-up overdue: Submit application")
  assert.match(notifications[0]?.body, /John Smith’s Medicare Application follow-up was due/)
  const capturedWhere = candidateWhere as any
  assert.deepEqual(capturedWhere.status, { in: ["ACTIVE", "POSTPONED"] })
  assert.deepEqual(capturedWhere.contactService.status, {
    in: ["IN_PROGRESS", "PENDING_PAYMENT"],
  })
})

test("leaves an overdue occurrence unclaimed when no recipient is available", async () => {
  const { materializeOverdueFollowUpNotifications } = await import(
    "./service-followup-overdue-notifications.js"
  )
  const dueAt = new Date("2026-08-24T15:00:00.000Z")
  let updateCalls = 0
  const prismaClient = {
    contactServiceFollowUpStep: {
      findMany: async () => [{ id: "step-1", tenantId: "tenant-1", dueAt }],
    },
    $transaction: async (callback: (tx: any) => Promise<any>) => callback({
      contactServiceFollowUpStep: {
        findFirst: async () => ({
          id: "step-1",
          tenantId: "tenant-1",
          title: "Submit",
          dueAt,
          assignedToUserId: null,
          tenant: { timezone: "America/Chicago" },
          contactService: {
            contactId: "contact-1",
            service: { name: "Application" },
            contact: {
              firstName: "John",
              middleName: null,
              lastName: "Smith",
              assignedToUserId: null,
            },
          },
        }),
        updateMany: async () => {
          updateCalls += 1
          return { count: 1 }
        },
      },
      membership: {
        findUnique: async () => null,
        findMany: async () => [],
      },
      notification: {
        create: async () => {
          throw new Error("A notification must not be created without a recipient.")
        },
      },
    }),
  }

  const result = await materializeOverdueFollowUpNotifications({
    now: new Date("2026-08-24T15:00:01.000Z"),
    prismaClient,
  })

  assert.deepEqual(result, [])
  assert.equal(updateCalls, 0)
})
