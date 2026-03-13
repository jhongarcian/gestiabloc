import { type Response, Router } from "express"
import { z } from "zod"

import { prisma } from "../lib/prisma.js"
import {
  materializeTaskNotifications,
  serializeNotification,
} from "../lib/task-notifications.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"

const router = Router()
const prismaWithNotifications = prisma as any

const TenantPathSchema = z.object({
  tenantId: z.string().min(1),
})

const NotificationPathSchema = TenantPathSchema.extend({
  notificationId: z.string().min(1),
})

const NotificationsQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25, {
      message: "pageSize must be 10 or 25",
    })
    .default(10),
})

async function requireActiveMembership(
  req: AuthedRequest,
  res: Response,
  tenantId: string,
) {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_tenantId: {
        userId: req.user.id,
        tenantId,
      },
    },
    select: {
      id: true,
      status: true,
    },
  })

  if (!membership || membership.status !== "ACTIVE") {
    res.status(403).json({ error: "TENANT_ACCESS_DENIED" })
    return null
  }

  return membership
}

router.get("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const { unreadOnly, page, pageSize } = NotificationsQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    await materializeTaskNotifications({
      tenantId,
      userId: authed.user.id,
    })

    const skip = (page - 1) * pageSize
    const where = {
      tenantId,
      userId: authed.user.id,
      ...(unreadOnly ? { readAt: null } : {}),
    }

    const [total, notifications, unreadCount] = await prisma.$transaction([
      prismaWithNotifications.notification.count({ where }),
      prismaWithNotifications.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip,
        take: pageSize,
        select: {
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
        },
      }),
      prismaWithNotifications.notification.count({
        where: {
          tenantId,
          userId: authed.user.id,
          readAt: null,
        },
      }),
    ])

    return res.json({
      ok: true,
      items: notifications.map((notification: any) => {
        const item = serializeNotification(notification)
        return {
          id: item.id,
          type: item.type,
          title: item.title,
          body: item.body,
          readAt: item.readAt,
          createdAt: item.createdAt,
          contactId: item.contactId,
          taskId: item.taskId,
          taskReminderId: item.taskReminderId,
        }
      }),
      unreadCount,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.patch("/:tenantId/:notificationId/read", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, notificationId } = NotificationPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const notification = await prismaWithNotifications.notification.findFirst({
      where: {
        id: notificationId,
        tenantId,
        userId: authed.user.id,
      },
      select: {
        id: true,
      },
    })

    if (!notification) {
      return res.status(404).json({ error: "NOTIFICATION_NOT_FOUND" })
    }

    const updated = await prismaWithNotifications.notification.update({
      where: {
        id: notification.id,
      },
      data: {
        readAt: new Date(),
      },
      select: {
        id: true,
        readAt: true,
      },
    })

    return res.json({
      ok: true,
      notification: updated,
    })
  } catch (error) {
    return next(error)
  }
})

router.delete(
  "/:tenantId/:notificationId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, notificationId } = NotificationPathSchema.parse(req.params)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const notification = await prismaWithNotifications.notification.findFirst({
        where: {
          id: notificationId,
          tenantId,
          userId: authed.user.id,
        },
        select: {
          id: true,
        },
      })

      if (!notification) {
        return res.status(404).json({ error: "NOTIFICATION_NOT_FOUND" })
      }

      await prismaWithNotifications.notification.delete({
        where: {
          id: notification.id,
        },
      })

      return res.json({ ok: true })
    } catch (error) {
      return next(error)
    }
  },
)

router.patch("/:tenantId/read-all", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const now = new Date()

    const result = await prismaWithNotifications.notification.updateMany({
      where: {
        tenantId,
        userId: authed.user.id,
        readAt: null,
      },
      data: {
        readAt: now,
      },
    })

    return res.json({
      ok: true,
      updatedCount: result.count,
      readAt: now.toISOString(),
    })
  } catch (error) {
    return next(error)
  }
})

router.delete("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const result = await prismaWithNotifications.notification.deleteMany({
      where: {
        tenantId,
        userId: authed.user.id,
      },
    })

    return res.json({
      ok: true,
      deletedCount: result.count,
    })
  } catch (error) {
    return next(error)
  }
})

export default router
