import { prisma } from "./prisma.js"
import {
  emitNotificationCreated,
  type RealtimeNotificationPayload,
} from "./realtime.js"

const prismaWithNotifications = prisma as any

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

type MaterializeTaskNotificationsOptions = {
  tenantId?: string
  userId?: string
}

type CreateTaskAssignmentNotificationInput = {
  tenantId: string
  taskId: string
  taskName: string
  assignedToUserId: string
  actorName: string
}

export function serializeNotification(
  notification: typeof notificationSelect extends never ? never : any,
): RealtimeNotificationPayload {
  return {
    id: notification.id,
    tenantId: notification.tenantId,
    userId: notification.userId,
    contactId: notification.contactId ?? null,
    type: notification.type,
    title: notification.title,
    body: notification.body ?? null,
    readAt: notification.readAt?.toISOString?.() ?? null,
    createdAt:
      typeof notification.createdAt === "string"
        ? notification.createdAt
        : notification.createdAt.toISOString(),
    taskId: notification.taskId ?? null,
    taskReminderId: notification.taskReminderId ?? null,
  }
}

export async function createTaskAssignmentNotification({
  tenantId,
  taskId,
  taskName,
  assignedToUserId,
  actorName,
}: CreateTaskAssignmentNotificationInput) {
  const notification = await prismaWithNotifications.notification.create({
    data: {
      tenantId,
      userId: assignedToUserId,
      taskId,
      type: "TASK_ASSIGNED",
      title: `Task assigned: ${taskName}`,
      body: `${actorName} assigned this task to you.`,
    },
    select: notificationSelect,
  })

  const serialized = serializeNotification(notification)
  emitNotificationCreated(serialized.userId, serialized)
  return serialized
}

export async function materializeDueTaskReminderNotifications({
  tenantId,
  userId,
}: MaterializeTaskNotificationsOptions = {}) {
  const now = new Date()

  const dueReminders = await prismaWithNotifications.taskReminder.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      ...(userId ? { recipientUserId: userId } : {}),
      canceledAt: null,
      notifiedAt: null,
      remindAt: {
        lte: now,
      },
    },
    orderBy: [{ remindAt: "asc" }],
    select: {
      id: true,
      tenantId: true,
      taskId: true,
      recipientUserId: true,
      message: true,
      task: {
        select: {
          name: true,
        },
      },
    },
  })

  const createdNotifications: RealtimeNotificationPayload[] = []

  for (const reminder of dueReminders) {
    const created = await prisma.$transaction(async (tx) => {
      const claim = await (tx as any).taskReminder.updateMany({
        where: {
          id: reminder.id,
          canceledAt: null,
          notifiedAt: null,
        },
        data: {
          notifiedAt: now,
        },
      })

      if (!claim.count) {
        return null
      }

      const notification = await (tx as any).notification.upsert({
        where: {
          taskReminderId: reminder.id,
        },
        update: {},
        create: {
          tenantId: reminder.tenantId,
          userId: reminder.recipientUserId,
          taskId: reminder.taskId,
          taskReminderId: reminder.id,
          type: "TASK_REMINDER",
          title: `Task reminder: ${reminder.task.name}`,
          body: reminder.message?.trim() || "A task reminder is now due.",
        },
        select: notificationSelect,
      })

      return serializeNotification(notification)
    })

    if (!created) continue

    createdNotifications.push(created)
    emitNotificationCreated(created.userId, created)
  }

  return createdNotifications
}

export async function materializeDueTaskNotifications({
  tenantId,
  userId,
}: MaterializeTaskNotificationsOptions = {}) {
  const now = new Date()

  const dueTasks = await prismaWithNotifications.task.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      ...(userId ? { assignedToUserId: userId } : {}),
      assignedToUserId: {
        ...(userId ? { equals: userId } : { not: null }),
      },
      dueDate: {
        lte: now,
      },
    },
    orderBy: [{ dueDate: "asc" }],
    select: {
      id: true,
      tenantId: true,
      assignedToUserId: true,
      dueDate: true,
      name: true,
    },
  })

  const createdNotifications: RealtimeNotificationPayload[] = []

  for (const task of dueTasks) {
    if (!task.assignedToUserId || !task.dueDate) continue

    const eventKey = `task-due:${task.id}:${task.assignedToUserId}:${task.dueDate.toISOString()}`

    let created: RealtimeNotificationPayload | null = null

    try {
      const notification = await prismaWithNotifications.notification.create({
        data: {
          tenantId: task.tenantId,
          userId: task.assignedToUserId,
          taskId: task.id,
          eventKey,
          type: "TASK_DUE",
          title: `Task due: ${task.name}`,
          body: "This task is now due.",
        },
        select: notificationSelect,
      })

      created = serializeNotification(notification)
    } catch (error) {
      if (
        !(
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        )
      ) {
        throw error
      }
    }

    if (!created) continue

    createdNotifications.push(created)
    emitNotificationCreated(created.userId, created)
  }

  return createdNotifications
}

export async function materializeTaskNotifications(
  options: MaterializeTaskNotificationsOptions = {},
) {
  const [reminderNotifications, dueNotifications] = await Promise.all([
    materializeDueTaskReminderNotifications(options),
    materializeDueTaskNotifications(options),
  ])

  return [...reminderNotifications, ...dueNotifications]
}
