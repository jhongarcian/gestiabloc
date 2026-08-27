import { type Response, Router } from "express"
import { z } from "zod"

import { prisma } from "../lib/prisma.js"
import {
  getTaskDueDayOffset,
  getTaskPriorityFromDueDate,
  getTenantTimezone,
  isSameLocalDay,
  isCompletedStatusName,
} from "../lib/task-priority.js"
import { createTaskActivity } from "../lib/task-activity.js"
import { createTaskAssignmentNotification } from "../lib/task-notifications.js"
import { ensureDefaultTaskStatuses } from "../lib/tenant-defaults.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"

const router = Router()
const prismaWithTasks = prisma as any

const stripHtmlTags = (value: string) => value.replace(/<[^>]*>/g, " ")
const removeUnsafeControls = (value: string) =>
  value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
const sanitizeSingleLineText = (value: string) =>
  removeUnsafeControls(stripHtmlTags(value)).replace(/\s+/g, " ").trim()
const sanitizeMultilineText = (value: string) =>
  removeUnsafeControls(stripHtmlTags(value))
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim()

const getUserFullName = (user: { name: string; email: string }) =>
  user.name.replace(/\s+/g, " ").trim() || user.email

const TenantPathSchema = z.object({
  tenantId: z.string().trim().min(1),
})

const TenantTaskPathSchema = TenantPathSchema.extend({
  taskId: z.string().trim().min(1),
})

const TenantTaskReminderPathSchema = TenantTaskPathSchema.extend({
  reminderId: z.string().trim().min(1),
})

const TasksListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25, {
      message: "pageSize must be 10 or 25",
    })
    .default(10),
  search: z.string().trim().max(120).optional().default(""),
  statusConfigId: z.string().trim().max(80).optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  assignedToUserId: z.string().trim().max(80).optional(),
  contactId: z.string().trim().min(1).optional(),
})

const CreateTaskReminderSchema = z.object({
  remindAt: z.string().datetime(),
  recipientUserId: z.string().trim().min(1).optional(),
  message: z.string().trim().max(500).nullable().optional(),
})

const TaskMutationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  contactId: z.string().trim().min(1),
  description: z.string().trim().max(4000).nullable().optional(),
  contactServiceId: z.string().trim().min(1).nullable().optional(),
  followUpTemplateId: z.string().trim().min(1).nullable().optional(),
  contactServiceFollowUpStepId: z.string().trim().min(1).nullable().optional(),
  linkedEntityName: z.string().trim().min(1).max(120).nullable().optional(),
  linkedEntityType: z.enum(["SERVICE", "PRODUCT"]).nullable().optional(),
  statusConfigId: z.string().trim().max(80).nullable().optional(),
  assignedToUserId: z.string().trim().min(1).nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  startedAt: z.string().datetime(),
  reminderAt: z.string().datetime().nullable().optional(),
})

const CreateTaskSchema = TaskMutationSchema.superRefine((task, context) => {
  const startedAt = new Date(task.startedAt).getTime()
  const dueDate = task.dueDate ? new Date(task.dueDate).getTime() : null
  const reminderAt = task.reminderAt ? new Date(task.reminderAt).getTime() : null

  if (dueDate !== null && dueDate < startedAt) {
    context.addIssue({
      code: "custom",
      path: ["dueDate"],
      message: "Due date cannot be before the start date.",
    })
  }

  if (reminderAt !== null && dueDate === null) {
    context.addIssue({
      code: "custom",
      path: ["dueDate"],
      message: "Set a due date before adding a reminder.",
    })
  } else if (
    reminderAt !== null &&
    dueDate !== null &&
    dueDate >= startedAt &&
    (reminderAt < startedAt || reminderAt > dueDate)
  ) {
    context.addIssue({
      code: "custom",
      path: ["reminderAt"],
      message: "Reminder must be between the start and due dates.",
    })
  }
})

const UpdateTaskSchema = TaskMutationSchema.partial()

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
      role: true,
      status: true,
    },
  })

  if (!membership || membership.status !== "ACTIVE") {
    res.status(403).json({ error: "TENANT_ACCESS_DENIED" })
    return null
  }

  return membership
}

async function getTaskForTenant(tenantId: string, taskId: string) {
  return prismaWithTasks.task.findFirst({
    where: {
      id: taskId,
      tenantId,
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      description: true,
      contactId: true,
      contactServiceId: true,
      followUpTemplateId: true,
      contactServiceFollowUpStepId: true,
      linkedEntityName: true,
      linkedEntityType: true,
      statusConfigId: true,
      assignedToUserId: true,
      dueDate: true,
      startedAt: true,
    },
  })
}

function formatActivityDateTime(value: Date | null) {
  if (!value) return "None"

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(value)
}

async function getUserDisplayName(userId: string | null | undefined) {
  if (!userId) return "Not assigned"

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
    },
  })

  return user?.name?.trim() || user?.email || "Unknown user"
}

async function getStatusDisplayName(tenantId: string, statusConfigId: string | null | undefined) {
  if (!statusConfigId) return "No status"

  const status = await prismaWithTasks.taskStatusConfig.findFirst({
    where: {
      tenantId,
      id: statusConfigId,
    },
    select: {
      name: true,
    },
  })

  return status?.name ?? "No status"
}

async function resolveTaskMutationPayload(
  tenantId: string,
  payload: z.infer<typeof CreateTaskSchema> | z.infer<typeof UpdateTaskSchema>,
) {
  const statusConfigId = payload.statusConfigId ?? null
  let statusName: string | null = null
  const contactId = "contactId" in payload ? payload.contactId ?? null : null
  const contactServiceId = payload.contactServiceId ?? null
  const followUpTemplateId = payload.followUpTemplateId ?? null
  const contactServiceFollowUpStepId = payload.contactServiceFollowUpStepId ?? null
  const assignedToUserId = payload.assignedToUserId ?? null
  const linkedEntityName = payload.linkedEntityName?.trim() || null
  const linkedEntityType = payload.linkedEntityType ?? null
  const dueDate = payload.dueDate ? new Date(payload.dueDate) : null
  const startedAt = payload.startedAt ? new Date(payload.startedAt) : null

  if (dueDate && Number.isNaN(dueDate.getTime())) {
    return { error: "INVALID_DUE_DATE" as const }
  }

  if (startedAt && Number.isNaN(startedAt.getTime())) {
    return { error: "INVALID_START_DATE" as const }
  }

  if (statusConfigId) {
    const status = await prismaWithTasks.taskStatusConfig.findFirst({
      where: {
        id: statusConfigId,
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
      },
    })

    if (!status) {
      return { error: "INVALID_STATUS_CONFIG" as const }
    }

    statusName = status.name
  }

  if (assignedToUserId) {
    const membership = await prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          userId: assignedToUserId,
          tenantId,
        },
      },
      select: {
        id: true,
        status: true,
      },
    })

    if (!membership || membership.status !== "ACTIVE") {
      return { error: "INVALID_ASSIGNEE" as const }
    }
  }

  if (contactId && !contactServiceId) {
    const contact = await prisma.contact.findFirst({
      where: {
        id: contactId,
        tenantId,
      },
      select: {
        id: true,
      },
    })

    if (!contact) {
      return { error: "INVALID_CONTACT" as const }
    }
  }

  let resolvedContactServiceId: string | null = null
  let resolvedFollowUpTemplateId: string | null = null
  let resolvedContactServiceFollowUpStepId: string | null = null

  if (contactServiceId || followUpTemplateId || contactServiceFollowUpStepId) {
    if (!contactServiceId) {
      return { error: "CONTACT_SERVICE_ID_REQUIRED" as const }
    }

    const contactService = await prisma.contactService.findFirst({
      where: {
        id: contactServiceId,
        tenantId,
      },
      select: {
        id: true,
        contactId: true,
        followUpTemplateId: true,
      },
    })

    if (!contactService) {
      return { error: "INVALID_CONTACT_SERVICE" as const }
    }

    if (contactId && contactService.contactId !== contactId) {
      return { error: "CONTACT_SERVICE_CONTACT_MISMATCH" as const }
    }

    if (followUpTemplateId && followUpTemplateId !== contactService.followUpTemplateId) {
      return { error: "INVALID_FOLLOW_UP_TEMPLATE" as const }
    }

    if (contactServiceFollowUpStepId) {
      const followUpStep = await prisma.contactServiceFollowUpStep.findFirst({
        where: {
          id: contactServiceFollowUpStepId,
          tenantId,
          contactServiceId: contactService.id,
        },
        select: {
          id: true,
        },
      })

      if (!followUpStep) {
        return { error: "INVALID_FOLLOW_UP_STEP" as const }
      }

      resolvedContactServiceFollowUpStepId = followUpStep.id
    }

    resolvedContactServiceId = contactService.id
    resolvedFollowUpTemplateId = followUpTemplateId ?? contactService.followUpTemplateId ?? null
  }

  if (linkedEntityName && !linkedEntityType) {
    return { error: "LINKED_ENTITY_TYPE_REQUIRED" as const }
  }

  if (!linkedEntityName && linkedEntityType) {
    return { error: "LINKED_ENTITY_NAME_REQUIRED" as const }
  }

  return {
    contactId,
    contactServiceId: resolvedContactServiceId,
    followUpTemplateId: resolvedFollowUpTemplateId,
    contactServiceFollowUpStepId: resolvedContactServiceFollowUpStepId,
    statusConfigId,
    statusName,
    assignedToUserId,
    linkedEntityName,
    linkedEntityType,
    dueDate,
    startedAt,
  }
}

router.get("/:tenantId/statuses", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    await ensureDefaultTaskStatuses(prismaWithTasks, tenantId)

    const statuses = await prismaWithTasks.taskStatusConfig.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        isActive: true,
      },
    })

    return res.json({
      ok: true,
      items: statuses,
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/assignees", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const assignees = await prisma.membership.findMany({
      where: {
        tenantId,
        status: "ACTIVE",
      },
      orderBy: [{ user: { name: "asc" } }],
      select: {
        userId: true,
        user: {
          select: {
            name: true,
            email: true,
            image: true,
          },
        },
      },
    })

    return res.json({
      ok: true,
      items: assignees.map((assignee) => ({
        value: assignee.userId,
        label: getUserFullName(assignee.user),
        email: assignee.user.email,
        image: assignee.user.image ?? null,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/summary", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const tenantTimezone = await getTenantTimezone(tenantId)
    const tasks = await prismaWithTasks.task.findMany({
      where: { tenantId },
      select: {
        dueDate: true,
        priority: true,
        assignedToUserId: true,
        updatedAt: true,
        statusConfig: {
          select: {
            name: true,
          },
        },
      },
    })

    const summary = tasks.reduce(
      (acc: any, task: any) => {
        acc.totalTasks += 1
        const isCompleted = isCompletedStatusName(task.statusConfig?.name)

        const offset = getTaskDueDayOffset(task.dueDate, tenantTimezone)
        if (!isCompleted && offset !== null && offset < 0) {
          acc.overdueTasks += 1
        }
        if (!isCompleted && offset === 0) {
          acc.dueToday += 1
        }
        if (!isCompleted && offset !== null && offset >= 0 && offset <= 7) {
          acc.dueThisWeek += 1
        }
        if (!isCompleted && task.priority === "HIGH") {
          acc.highPriorityTasks += 1
        }
        if (!isCompleted && !task.assignedToUserId) {
          acc.unassignedTasks += 1
        }
        if (isCompleted && isSameLocalDay(task.updatedAt, new Date(), tenantTimezone)) {
          acc.completedToday += 1
        }

        if (!isCompleted && task.assignedToUserId === authed.user.id && task.priority) {
          acc.myPriorityCounts[task.priority] += 1
        }

        return acc
      },
      {
        totalTasks: 0,
        overdueTasks: 0,
        dueToday: 0,
        dueThisWeek: 0,
        highPriorityTasks: 0,
        unassignedTasks: 0,
        completedToday: 0,
        myPriorityCounts: {
          HIGH: 0,
          MEDIUM: 0,
          LOW: 0,
        },
      },
    )

    return res.json({
      ok: true,
      summary,
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const {
      page,
      pageSize,
      search,
      statusConfigId,
      priority,
      assignedToUserId,
      contactId,
    } = TasksListQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const skip = (page - 1) * pageSize
    const assignedToUserIdFilter =
      assignedToUserId === "ALL" ? "" : assignedToUserId

    const where = {
      tenantId,
      ...(contactId ? { contactId } : {}),
      ...(statusConfigId ? { statusConfigId } : {}),
      ...(priority ? { priority } : {}),
      ...(assignedToUserIdFilter
        ? assignedToUserIdFilter === "__UNASSIGNED__"
          ? { assignedToUserId: null }
          : {
              assignedToUserId: assignedToUserIdFilter,
              assignedToMembership: {
                is: {
                  status: "ACTIVE" as const,
                },
              },
            }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              {
                description: { contains: search, mode: "insensitive" as const },
              },
              {
                linkedEntityName: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
              {
                contact: {
                  OR: [
                    {
                      firstName: {
                        contains: search,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      middleName: {
                        contains: search,
                        mode: "insensitive" as const,
                      },
                    },
                    {
                      lastName: {
                        contains: search,
                        mode: "insensitive" as const,
                      },
                    },
                  ],
                },
              },
              {
                assignedToMembership: {
                  user: {
                    name: { contains: search, mode: "insensitive" as const },
                  },
                },
              },
            ],
          }
        : {}),
    }

    const [total, tasks] = await prisma.$transaction([
      prismaWithTasks.task.count({ where }),
      prismaWithTasks.task.findMany({
        where,
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          description: true,
          assignedToUserId: true,
          priority: true,
          dueDate: true,
          startedAt: true,
          linkedEntityName: true,
          linkedEntityType: true,
          contact: {
            select: {
              firstName: true,
              middleName: true,
              lastName: true,
            },
          },
          assignedToMembership: {
            select: {
              user: {
                select: {
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
          },
          statusConfig: {
            select: {
              id: true,
              name: true,
              bgColor: true,
              textColor: true,
            },
          },
        },
      }),
    ])

    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    return res.json({
      ok: true,
      items: tasks.map((task: any) => ({
        id: task.id,
        name: task.name,
        description: task.description ?? null,
        assignedToUserId: task.assignedToUserId ?? null,
        priority: task.priority ?? null,
        dueDate: task.dueDate,
        assignedPersonName: task.assignedToMembership?.user
          ? getUserFullName(task.assignedToMembership.user)
          : null,
        assignedPersonImage: task.assignedToMembership?.user?.image ?? null,
        startedAt: task.startedAt,
        status: task.statusConfig?.name ?? "Unassigned",
        statusConfigId: task.statusConfig?.id ?? null,
        statusBgColor: task.statusConfig?.bgColor ?? null,
        statusTextColor: task.statusConfig?.textColor ?? null,
        contactName: task.contact
          ? [task.contact.firstName, task.contact.middleName, task.contact.lastName]
              .filter(Boolean)
              .join(" ")
          : null,
        linkedEntityName: task.linkedEntityName ?? null,
        linkedEntityType: task.linkedEntityType ?? null,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = CreateTaskSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const reminderAt = payload.reminderAt ? new Date(payload.reminderAt) : null

    if (reminderAt && Number.isNaN(reminderAt.getTime())) {
      return res.status(400).json({ error: "INVALID_REMINDER_DATE" })
    }

    const resolvedPayload = await resolveTaskMutationPayload(tenantId, payload)
    if ("error" in resolvedPayload) {
      return res.status(400).json({ error: resolvedPayload.error })
    }
    const tenantTimezone = await getTenantTimezone(tenantId)

    const {
      contactId,
      contactServiceId,
      followUpTemplateId,
      contactServiceFollowUpStepId,
      statusConfigId,
      statusName,
      assignedToUserId,
      linkedEntityName,
      linkedEntityType,
      dueDate,
      startedAt,
    } =
      resolvedPayload

    const task = await prisma.$transaction(async (tx) => {
      const prismaTx = tx as any

      const createdTask = await prismaTx.task.create({
        data: {
          tenantId,
          contactId,
          contactServiceId,
          followUpTemplateId,
          contactServiceFollowUpStepId,
          priority: getTaskPriorityFromDueDate(
            dueDate,
            tenantTimezone,
            isCompletedStatusName(statusName),
          ),
          name: sanitizeSingleLineText(payload.name),
          description: payload.description ? sanitizeMultilineText(payload.description) : null,
          linkedEntityName: linkedEntityName ? sanitizeSingleLineText(linkedEntityName) : null,
          linkedEntityType,
          statusConfigId,
          assignedToUserId,
          dueDate,
          startedAt,
        },
        select: {
          id: true,
          name: true,
          assignedToUserId: true,
        },
      })

      await createTaskActivity({
        prismaClient: prismaTx,
        tenantId,
        taskId: createdTask.id,
        actorUserId: authed.user.id,
        type: "CREATED",
        title: "Task created",
        details: `Created by ${authed.user.name?.trim() || authed.user.email || "a teammate"}.`,
      })

      if (reminderAt) {
        const recipientMembership = await tx.membership.findUnique({
          where: {
            userId_tenantId: {
              userId:
                createdTask.assignedToUserId ?? assignedToUserId ?? authed.user.id,
              tenantId,
            },
          },
          select: {
            id: true,
            userId: true,
            status: true,
          },
        })

        if (recipientMembership?.status === "ACTIVE") {
          await prismaTx.taskReminder.create({
            data: {
              tenantId,
              taskId: createdTask.id,
              recipientUserId: recipientMembership.userId,
              membershipId: recipientMembership.id,
              createdById: authed.user.id,
              remindAt: reminderAt,
            },
          })

          await createTaskActivity({
            prismaClient: prismaTx,
            tenantId,
            taskId: createdTask.id,
            actorUserId: authed.user.id,
            type: "REMINDER_CREATED",
            title: "Reminder scheduled",
            details: `Reminder set for ${formatActivityDateTime(reminderAt)}.`,
          })
        }
      }

      return createdTask
    })

    if (task.assignedToUserId) {
      await createTaskAssignmentNotification({
        tenantId,
        taskId: task.id,
        taskName: task.name,
        assignedToUserId: task.assignedToUserId,
        actorName: authed.user.name?.trim() || authed.user.email || "A teammate",
      })
    }

    return res.status(201).json({
      ok: true,
      task,
    })
  } catch (error) {
    return next(error)
  }
})

router.patch("/:tenantId/:taskId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, taskId } = TenantTaskPathSchema.parse(req.params)
    const payload = UpdateTaskSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const existingTask = await getTaskForTenant(tenantId, taskId)
    if (!existingTask) {
      return res.status(404).json({ error: "TASK_NOT_FOUND" })
    }

    const mergedPayload = {
      name: payload.name ?? existingTask.name,
      contactId:
        payload.contactId === undefined
          ? existingTask.contactId
          : payload.contactId,
      contactServiceId:
        payload.contactServiceId === undefined
          ? existingTask.contactServiceId
          : payload.contactServiceId,
      followUpTemplateId:
        payload.followUpTemplateId === undefined
          ? existingTask.followUpTemplateId
          : payload.followUpTemplateId,
      contactServiceFollowUpStepId:
        payload.contactServiceFollowUpStepId === undefined
          ? existingTask.contactServiceFollowUpStepId
          : payload.contactServiceFollowUpStepId,
      description:
        payload.description === undefined
          ? existingTask.description
          : payload.description,
      statusConfigId:
        payload.statusConfigId === undefined
          ? existingTask.statusConfigId
          : payload.statusConfigId,
      assignedToUserId:
        payload.assignedToUserId === undefined
          ? existingTask.assignedToUserId
          : payload.assignedToUserId,
      linkedEntityName:
        payload.linkedEntityName === undefined
          ? existingTask.linkedEntityName
          : payload.linkedEntityName,
      linkedEntityType:
        payload.linkedEntityType === undefined
          ? existingTask.linkedEntityType
          : payload.linkedEntityType,
      dueDate:
        payload.dueDate === undefined
          ? existingTask.dueDate?.toISOString() ?? null
          : payload.dueDate,
      startedAt:
        payload.startedAt === undefined
          ? existingTask.startedAt?.toISOString() ?? null
          : payload.startedAt,
      reminderAt: payload.reminderAt,
    }

    const resolvedPayload = await resolveTaskMutationPayload(tenantId, mergedPayload)
    if ("error" in resolvedPayload) {
      return res.status(400).json({ error: resolvedPayload.error })
    }
    const tenantTimezone = await getTenantTimezone(tenantId)

    const reminderAt = payload.reminderAt ? new Date(payload.reminderAt) : null

    if (reminderAt && Number.isNaN(reminderAt.getTime())) {
      return res.status(400).json({ error: "INVALID_REMINDER_DATE" })
    }

    const [
      previousAssigneeLabel,
      nextAssigneeLabel,
      previousStatusLabel,
      nextStatusLabel,
    ] = await Promise.all([
      getUserDisplayName(existingTask.assignedToUserId),
      getUserDisplayName(resolvedPayload.assignedToUserId),
      getStatusDisplayName(tenantId, existingTask.statusConfigId),
      getStatusDisplayName(tenantId, resolvedPayload.statusConfigId),
    ])

    const task = await prisma.$transaction(async (tx) => {
      const prismaTx = tx as any

      const updatedTask = await prismaTx.task.update({
        where: { id: existingTask.id },
        data: {
          name: sanitizeSingleLineText(mergedPayload.name),
          description: mergedPayload.description ? sanitizeMultilineText(mergedPayload.description) : null,
          contactId: resolvedPayload.contactId,
          contactServiceId: resolvedPayload.contactServiceId,
          followUpTemplateId: resolvedPayload.followUpTemplateId,
          contactServiceFollowUpStepId: resolvedPayload.contactServiceFollowUpStepId,
          linkedEntityName:
            resolvedPayload.linkedEntityName
              ? sanitizeSingleLineText(resolvedPayload.linkedEntityName)
              : null,
          linkedEntityType: resolvedPayload.linkedEntityType,
          statusConfigId: resolvedPayload.statusConfigId,
          assignedToUserId: resolvedPayload.assignedToUserId,
          priority: getTaskPriorityFromDueDate(
            resolvedPayload.dueDate,
            tenantTimezone,
            isCompletedStatusName(resolvedPayload.statusName),
          ),
          dueDate: resolvedPayload.dueDate,
          startedAt: resolvedPayload.startedAt,
        },
        select: {
          id: true,
          name: true,
          assignedToUserId: true,
        },
      })

      if (
        sanitizeSingleLineText(mergedPayload.name) !== existingTask.name ||
        (mergedPayload.description ? sanitizeMultilineText(mergedPayload.description) : null) !==
          (existingTask.description?.trim() || null) ||
        (resolvedPayload.linkedEntityName
          ? sanitizeSingleLineText(resolvedPayload.linkedEntityName)
          : null) !==
          (existingTask.linkedEntityName ?? null) ||
        (resolvedPayload.linkedEntityType ?? null) !==
          (existingTask.linkedEntityType ?? null)
      ) {
        await createTaskActivity({
          prismaClient: prismaTx,
          tenantId,
          taskId: existingTask.id,
          actorUserId: authed.user.id,
          type: "UPDATED",
          title: "Task details updated",
        })
      }

      if (existingTask.statusConfigId !== resolvedPayload.statusConfigId) {
        await createTaskActivity({
          prismaClient: prismaTx,
          tenantId,
          taskId: existingTask.id,
          actorUserId: authed.user.id,
          type: "STATUS_CHANGED",
          title: "Status changed",
          details: `${previousStatusLabel} -> ${nextStatusLabel}`,
        })
      }

      if (existingTask.assignedToUserId !== resolvedPayload.assignedToUserId) {
        await createTaskActivity({
          prismaClient: prismaTx,
          tenantId,
          taskId: existingTask.id,
          actorUserId: authed.user.id,
          type: "ASSIGNEE_CHANGED",
          title: "Assignee changed",
          details: `${previousAssigneeLabel} -> ${nextAssigneeLabel}`,
        })
      }

      if (
        (existingTask.dueDate?.getTime() ?? null) !==
        (resolvedPayload.dueDate?.getTime() ?? null)
      ) {
        await createTaskActivity({
          prismaClient: prismaTx,
          tenantId,
          taskId: existingTask.id,
          actorUserId: authed.user.id,
          type: "DUE_DATE_CHANGED",
          title: "Due date changed",
          details: `${formatActivityDateTime(existingTask.dueDate)} -> ${formatActivityDateTime(resolvedPayload.dueDate)}`,
        })
      }

      if (
        (existingTask.startedAt?.getTime() ?? null) !==
        (resolvedPayload.startedAt?.getTime() ?? null)
      ) {
        await createTaskActivity({
          prismaClient: prismaTx,
          tenantId,
          taskId: existingTask.id,
          actorUserId: authed.user.id,
          type: "START_DATE_CHANGED",
          title: "Start date changed",
          details: `${formatActivityDateTime(existingTask.startedAt)} -> ${formatActivityDateTime(resolvedPayload.startedAt)}`,
        })
      }

      if (reminderAt) {
        const recipientMembership = await tx.membership.findUnique({
          where: {
            userId_tenantId: {
              userId: updatedTask.assignedToUserId ?? authed.user.id,
              tenantId,
            },
          },
          select: {
            id: true,
            userId: true,
            status: true,
          },
        })

        if (recipientMembership?.status === "ACTIVE") {
          await prismaTx.taskReminder.create({
            data: {
              tenantId,
              taskId: existingTask.id,
              recipientUserId: recipientMembership.userId,
              membershipId: recipientMembership.id,
              createdById: authed.user.id,
              remindAt: reminderAt,
            },
          })

          await createTaskActivity({
            prismaClient: prismaTx,
            tenantId,
            taskId: existingTask.id,
            actorUserId: authed.user.id,
            type: "REMINDER_CREATED",
            title: "Reminder scheduled",
            details: `Reminder set for ${formatActivityDateTime(reminderAt)}.`,
          })
        }
      }

      return updatedTask
    })

    const assigneeChanged = existingTask.assignedToUserId !== task.assignedToUserId
    if (assigneeChanged && task.assignedToUserId) {
      await createTaskAssignmentNotification({
        tenantId,
        taskId: task.id,
        taskName: task.name,
        assignedToUserId: task.assignedToUserId,
        actorName: authed.user.name?.trim() || authed.user.email || "A teammate",
      })
    }

    return res.json({
      ok: true,
      task,
    })
  } catch (error) {
    return next(error)
  }
})

router.delete("/:tenantId/:taskId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, taskId } = TenantTaskPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const existingTask = await getTaskForTenant(tenantId, taskId)
    if (!existingTask) {
      return res.status(404).json({ error: "TASK_NOT_FOUND" })
    }

    await prismaWithTasks.task.delete({
      where: {
        id: existingTask.id,
      },
    })

    return res.json({ ok: true })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/:taskId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, taskId } = TenantTaskPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const task = await prismaWithTasks.task.findFirst({
      where: {
        id: taskId,
        tenantId,
      },
      select: {
        id: true,
        name: true,
        description: true,
        assignedToUserId: true,
        priority: true,
        dueDate: true,
        startedAt: true,
        linkedEntityName: true,
        linkedEntityType: true,
        contact: {
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
            email: true,
            phone: true,
            dateOfBirth: true,
          },
        },
        assignedToMembership: {
          select: {
            user: {
              select: {
                name: true,
              },
            },
          },
        },
        statusConfig: {
          select: {
            id: true,
            name: true,
            bgColor: true,
            textColor: true,
          },
        },
        reminders: {
          where: {
            canceledAt: null,
          },
          orderBy: [{ remindAt: "asc" }],
          select: {
            id: true,
            remindAt: true,
            message: true,
            notifiedAt: true,
            recipient: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            createdBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        activities: {
          orderBy: [{ createdAt: "desc" }],
          take: 20,
          select: {
            id: true,
            type: true,
            title: true,
            details: true,
            createdAt: true,
            actor: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    })

    if (!task) {
      return res.status(404).json({ error: "TASK_NOT_FOUND" })
    }

    return res.json({
      ok: true,
      task: {
        id: task.id,
        name: task.name,
        description: task.description ?? null,
        assignedToUserId: task.assignedToUserId ?? null,
        priority: task.priority ?? null,
        dueDate: task.dueDate,
        startedAt: task.startedAt,
        assignedPersonName: task.assignedToMembership?.user?.name ?? null,
        status: task.statusConfig?.name ?? "Unassigned",
        statusConfigId: task.statusConfig?.id ?? null,
        statusBgColor: task.statusConfig?.bgColor ?? null,
        statusTextColor: task.statusConfig?.textColor ?? null,
        contactName: task.contact
          ? [task.contact.firstName, task.contact.middleName, task.contact.lastName]
              .filter(Boolean)
              .join(" ")
          : null,
        contact: task.contact
          ? {
              id: task.contact.id,
              fullName: [
                task.contact.firstName,
                task.contact.middleName,
                task.contact.lastName,
              ]
                .filter(Boolean)
                .join(" "),
              email: task.contact.email ?? null,
              phoneNumber: task.contact.phone ?? null,
              dateOfBirth: task.contact.dateOfBirth ?? null,
            }
          : null,
        linkedEntityName: task.linkedEntityName ?? null,
        linkedEntityType: task.linkedEntityType ?? null,
        reminders: task.reminders.map((reminder: any) => ({
          id: reminder.id,
          remindAt: reminder.remindAt,
          message: reminder.message ?? null,
          notifiedAt: reminder.notifiedAt ?? null,
          recipient: reminder.recipient,
          createdBy: reminder.createdBy,
        })),
        activities: task.activities.map((activity: any) => ({
          id: activity.id,
          type: activity.type,
          title: activity.title,
          details: activity.details ?? null,
          createdAt: activity.createdAt,
          actor: activity.actor
            ? {
                id: activity.actor.id,
                name: activity.actor.name,
                email: activity.actor.email,
              }
            : null,
        })),
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId/:taskId/reminders", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, taskId } = TenantTaskPathSchema.parse(req.params)
    const payload = CreateTaskReminderSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const task = await getTaskForTenant(tenantId, taskId)
    if (!task) {
      return res.status(404).json({ error: "TASK_NOT_FOUND" })
    }

    const recipientUserId = payload.recipientUserId ?? task.assignedToUserId ?? authed.user.id
    const remindAt = new Date(payload.remindAt)

    if (Number.isNaN(remindAt.getTime())) {
      return res.status(400).json({ error: "INVALID_REMINDER_DATE" })
    }

    const recipientMembership = await prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          userId: recipientUserId,
          tenantId,
        },
      },
      select: {
        id: true,
        status: true,
      },
    })

    if (!recipientMembership || recipientMembership.status !== "ACTIVE") {
      return res.status(400).json({ error: "INVALID_REMINDER_RECIPIENT" })
    }

    const reminder = await prismaWithTasks.taskReminder.create({
      data: {
        tenantId,
        taskId,
        recipientUserId,
        membershipId: recipientMembership.id,
        createdById: authed.user.id,
        remindAt,
        message: payload.message?.trim() || null,
      },
      select: {
        id: true,
        remindAt: true,
        message: true,
        notifiedAt: true,
        recipient: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    await createTaskActivity({
      prismaClient: prismaWithTasks,
      tenantId,
      taskId,
      actorUserId: authed.user.id,
      type: "REMINDER_CREATED",
      title: "Reminder scheduled",
      details: `Reminder set for ${formatActivityDateTime(reminder.remindAt)}.`,
    })

    return res.status(201).json({
      ok: true,
      reminder: {
        id: reminder.id,
        remindAt: reminder.remindAt,
        message: reminder.message ?? null,
        notifiedAt: reminder.notifiedAt ?? null,
        recipient: reminder.recipient,
        createdBy: reminder.createdBy,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.delete(
  "/:tenantId/:taskId/reminders/:reminderId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, taskId, reminderId } = TenantTaskReminderPathSchema.parse(
        req.params,
      )

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const reminder = await prismaWithTasks.taskReminder.findFirst({
        where: {
          id: reminderId,
          taskId,
          tenantId,
          canceledAt: null,
        },
        select: {
          id: true,
          remindAt: true,
        },
      })

      if (!reminder) {
        return res.status(404).json({ error: "TASK_REMINDER_NOT_FOUND" })
      }

      await prisma.$transaction([
        prismaWithTasks.taskReminder.update({
          where: { id: reminder.id },
          data: {
            canceledAt: new Date(),
          },
        }),
        prismaWithTasks.notification.deleteMany({
          where: {
            taskReminderId: reminder.id,
          },
        }),
        prismaWithTasks.taskActivity.create({
          data: {
            tenantId,
            taskId,
            actorUserId: authed.user.id,
            type: "REMINDER_CANCELED",
            title: "Reminder canceled",
            details: `Reminder for ${formatActivityDateTime(reminder.remindAt)} was canceled.`,
          },
        }),
      ])

      return res.json({ ok: true })
    } catch (error) {
      return next(error)
    }
  },
)

export default router
