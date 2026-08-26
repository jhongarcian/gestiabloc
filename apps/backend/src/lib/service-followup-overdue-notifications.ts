import { prisma } from "./prisma.js"
import { emitNotificationCreated, type RealtimeNotificationPayload } from "./realtime.js"
import { serializeNotification } from "./task-notifications.js"

const DEFAULT_TIMEZONE = "America/Chicago"

const notificationSelect = {
  id: true,
  tenantId: true,
  userId: true,
  contactId: true,
  type: true,
  title: true,
  body: true,
  readAt: true,
  createdAt: true,
  taskId: true,
  taskReminderId: true,
} as const

type MaterializeOverdueFollowUpNotificationsOptions = {
  now?: Date
  prismaClient?: any
}

export function resolveOverdueFollowUpRecipientIds(params: {
  stepAssigneeUserId?: string | null
  stepAssigneeIsActive: boolean
  contactOwnerUserId?: string | null
  contactOwnerIsActive: boolean
  tenantAdminUserIds: string[]
}) {
  if (params.stepAssigneeUserId && params.stepAssigneeIsActive) {
    return [params.stepAssigneeUserId]
  }
  if (params.contactOwnerUserId && params.contactOwnerIsActive) {
    return [params.contactOwnerUserId]
  }
  return [...new Set(params.tenantAdminUserIds)]
}

export function formatOverdueFollowUpDueAt(dueAt: Date, timezone?: string | null) {
  const requestedTimezone = timezone?.trim() || DEFAULT_TIMEZONE
  let safeTimezone = requestedTimezone
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: safeTimezone }).format(dueAt)
  } catch {
    safeTimezone = DEFAULT_TIMEZONE
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone,
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(dueAt)
}

async function activeMembershipForUser(
  prismaClient: any,
  tenantId: string,
  userId?: string | null,
) {
  if (!userId) return false
  const membership = await prismaClient.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { status: true },
  })
  return membership?.status === "ACTIVE"
}

export async function materializeOverdueFollowUpNotifications({
  now = new Date(),
  prismaClient = prisma as any,
}: MaterializeOverdueFollowUpNotificationsOptions = {}) {
  const candidates = await prismaClient.contactServiceFollowUpStep.findMany({
    where: {
      status: { in: ["ACTIVE", "POSTPONED"] },
      completedAt: null,
      dueAt: { lte: now },
      overdueNotifiedDueAt: null,
      contactService: {
        status: { in: ["IN_PROGRESS", "PENDING_PAYMENT"] },
      },
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, tenantId: true, dueAt: true },
  })

  const createdNotifications: RealtimeNotificationPayload[] = []

  for (const candidate of candidates) {
    if (!candidate.dueAt) continue

    const notifications = await prismaClient.$transaction(async (tx: any) => {
      const step = await tx.contactServiceFollowUpStep.findFirst({
        where: {
          id: candidate.id,
          tenantId: candidate.tenantId,
          status: { in: ["ACTIVE", "POSTPONED"] },
          completedAt: null,
          dueAt: candidate.dueAt,
          overdueNotifiedDueAt: null,
          contactService: {
            status: { in: ["IN_PROGRESS", "PENDING_PAYMENT"] },
          },
        },
        select: {
          id: true,
          tenantId: true,
          title: true,
          dueAt: true,
          assignedToUserId: true,
          tenant: { select: { timezone: true } },
          contactService: {
            select: {
              contactId: true,
              service: { select: { name: true } },
              contact: {
                select: {
                  firstName: true,
                  middleName: true,
                  lastName: true,
                  assignedToUserId: true,
                },
              },
            },
          },
        },
      })
      if (!step?.dueAt) return []

      const stepAssigneeIsActive = await activeMembershipForUser(
        tx,
        step.tenantId,
        step.assignedToUserId,
      )
      const contactOwnerUserId = step.contactService.contact.assignedToUserId
      const contactOwnerIsActive = stepAssigneeIsActive
        ? false
        : await activeMembershipForUser(tx, step.tenantId, contactOwnerUserId)

      let tenantAdminUserIds: string[] = []
      if (!stepAssigneeIsActive && !contactOwnerIsActive) {
        const admins = await tx.membership.findMany({
          where: {
            tenantId: step.tenantId,
            status: "ACTIVE",
            role: "TENANT_ADMIN",
          },
          select: { userId: true },
        })
        tenantAdminUserIds = admins.map((admin: { userId: string }) => admin.userId)
      }

      const recipientUserIds = resolveOverdueFollowUpRecipientIds({
        stepAssigneeUserId: step.assignedToUserId,
        stepAssigneeIsActive,
        contactOwnerUserId,
        contactOwnerIsActive,
        tenantAdminUserIds,
      })
      if (!recipientUserIds.length) return []

      const claimed = await tx.contactServiceFollowUpStep.updateMany({
        where: {
          id: step.id,
          tenantId: step.tenantId,
          status: { in: ["ACTIVE", "POSTPONED"] },
          completedAt: null,
          dueAt: step.dueAt,
          overdueNotifiedDueAt: null,
          contactService: {
            status: { in: ["IN_PROGRESS", "PENDING_PAYMENT"] },
          },
        },
        data: {
          overdueNotifiedAt: now,
          overdueNotifiedDueAt: step.dueAt,
        },
      })
      if (!claimed.count) return []

      const contactName = [
        step.contactService.contact.firstName,
        step.contactService.contact.middleName,
        step.contactService.contact.lastName,
      ]
        .filter(Boolean)
        .join(" ")
        .trim() || "Contact"
      const dueLabel = formatOverdueFollowUpDueAt(step.dueAt, step.tenant.timezone)
      const title = `Follow-up overdue: ${step.title}`
      const body = `${contactName}’s ${step.contactService.service.name} follow-up was due ${dueLabel}.`

      const created: RealtimeNotificationPayload[] = []
      for (const recipientUserId of recipientUserIds) {
        const notification = await tx.notification.create({
          data: {
            tenantId: step.tenantId,
            userId: recipientUserId,
            contactId: step.contactService.contactId,
            eventKey: `follow-up-overdue:${step.id}:${recipientUserId}:${step.dueAt.toISOString()}`,
            type: "FOLLOW_UP_OVERDUE",
            title,
            body,
          },
          select: notificationSelect,
        })
        created.push(serializeNotification(notification))
      }
      return created
    })

    for (const notification of notifications) {
      createdNotifications.push(notification)
      emitNotificationCreated(notification.userId, notification)
    }
  }

  return createdNotifications
}
