import { type Response, Router } from "express"
import { z } from "zod"

import {
  buildAppointmentSlots,
  createAppointmentAtomically,
  evaluateAvailability,
  getDefaultRange,
  getSafeCalendarBufferMode,
  getSafeCalendarSlotDuration,
  getSafeTimezone,
  listCalendarBlockOccurrences,
  updateAppointmentAtomically,
} from "../lib/appointment-booking.js"
import { prisma } from "../lib/prisma.js"
import { enforceSameOrigin } from "../lib/security.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"

const router = Router()

const TenantPathSchema = z.object({
  tenantId: z.string().trim().min(1),
})

const TenantAppointmentPathSchema = TenantPathSchema.extend({
  appointmentId: z.string().trim().min(1),
})

const TenantContactPathSchema = TenantPathSchema.extend({
  contactId: z.string().trim().min(1),
})

const commaSeparatedIdsField = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item).split(","))
      .map((item) => item.trim())
      .filter(Boolean)
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return []
}, z.array(z.string().trim().min(1)).max(100)).optional().default([])

const CalendarQuerySchema = z.object({
  view: z.enum(["month", "week", "day", "list"]).optional().default("week"),
  assignedToUserId: z.string().trim().min(1).optional(),
  assignedToUserIds: commaSeparatedIdsField,
  groupIds: commaSeparatedIdsField,
  filterMode: z.enum(["users", "groups"]).optional().default("users"),
  contactId: z.string().trim().min(1).optional(),
  serviceId: z.string().trim().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
}).superRefine((value, ctx) => {
  const hasUserSelection =
    Boolean(value.assignedToUserId) || (value.assignedToUserIds?.length ?? 0) > 0
  const hasGroupSelection = (value.groupIds?.length ?? 0) > 0

  if (value.filterMode === "users" && hasGroupSelection) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["groupIds"],
      message: "Group filters are only allowed in groups mode.",
    })
  }

  if (value.filterMode === "groups" && hasUserSelection) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assignedToUserIds"],
      message: "User filters are only allowed in users mode.",
    })
  }
})

const CalendarSlotsQuerySchema = z.object({
  assignedToUserId: z.string().trim().min(1),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  appointmentId: z.string().trim().min(1).optional(),
})

const optionalStringField = (max: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }, z.string().max(max).nullable().optional())

const AvailabilityRequestSchema = z.object({
  assignedToUserId: z.string().trim().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  appointmentId: z.string().trim().min(1).optional(),
})

const CreateAppointmentSchema = z.object({
  contactId: z.string().trim().min(1),
  serviceId: optionalStringField(80),
  assignedToUserId: z.string().trim().min(1),
  title: optionalStringField(160),
  notes: optionalStringField(4000),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  isAllDay: z.boolean().optional().default(false),
})

const UpdateAppointmentSchema = z
  .object({
    contactId: z.string().trim().min(1).optional(),
    serviceId: optionalStringField(80),
    assignedToUserId: z.string().trim().min(1).optional(),
    title: optionalStringField(160),
    notes: optionalStringField(4000),
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    isAllDay: z.boolean().optional(),
    status: z
      .enum(["SCHEDULED", "CONFIRMED", "SHOW", "NO_SHOW", "CANCELED"])
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "At least one field must be updated.",
      })
    }
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
      role: true,
      status: true,
      securityLevel: true,
    },
  })

  if (!membership || membership.status !== "ACTIVE") {
    res.status(403).json({ error: "TENANT_ACCESS_DENIED" })
    return null
  }

  return membership
}

function canViewAppointmentAuditLogs(membership: {
  securityLevel: "LOW" | "MEDIUM" | "MAX"
}) {
  return membership.securityLevel === "MAX"
}

function getActorDisplayName(user: {
  name?: string | null
  email?: string | null
}) {
  return user.name?.trim() || user.email || "Unknown user"
}

function serializeAppointmentItem(
  item: {
    id: string
    title: string
    notes: string | null
    startAt: Date
    endAt: Date
    assignedToUserId: string | null
    status: string
    contactId: string
    serviceId: string | null
    contact: {
      firstName: string
      lastName: string
      email: string | null
      phone: string | null
    }
    assignedTo: {
      name: string | null
      email: string | null
      image: string | null
      memberships: Array<{
        calendarColor: string | null
      }>
    } | null
    service: {
      name: string
    } | null
  },
) {
  return {
    id: item.id,
    title: item.title,
    startAt: item.startAt.toISOString(),
    endAt: item.endAt.toISOString(),
    assignedToUserId: item.assignedToUserId,
    assignedToLabel:
      item.assignedTo?.name?.trim() || item.assignedTo?.email || "Unassigned",
    assignedToImage: item.assignedTo?.image ?? null,
    assignedToColor: item.assignedTo?.memberships[0]?.calendarColor ?? null,
    contactId: item.contactId,
    contactName: `${item.contact.firstName} ${item.contact.lastName}`.trim(),
    contactEmail: item.contact.email ?? null,
    contactPhone: item.contact.phone ?? null,
    serviceId: item.serviceId,
    serviceName: item.service?.name ?? null,
    status: item.status,
    notes: item.notes ?? null,
  }
}

function serializeAuditLog(
  log: {
    id: string
    action: string
    actorDisplayName: string
    message: string
    createdAt: Date
  },
) {
  return {
    id: log.id,
    action: log.action,
    actorDisplayName: log.actorDisplayName,
    message: log.message,
    createdAt: log.createdAt.toISOString(),
  }
}

function serializeCalendarBlockOccurrence(item: {
  id: string
  title: string
  startsAt: Date
  endsAt: Date
  isAllDay: boolean
}) {
  return {
    id: item.id,
    title: item.title,
    startsAt: item.startsAt.toISOString(),
    endsAt: item.endsAt.toISOString(),
    isAllDay: item.isAllDay,
  }
}

function minutesToTimeInput(minutes: number) {
  const normalized = Math.max(0, Math.min(minutes, 24 * 60))
  const hour = Math.floor(normalized / 60)
  const minute = normalized % 60
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function buildWeeklyAvailabilityFromRules(
  rules: Array<{
    dayOfWeek: number
    startTimeMinutes: number
    endTimeMinutes: number
    isActive: boolean
  }>,
) {
  const rulesByDay = new Map(rules.map((rule) => [rule.dayOfWeek, rule]))
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const rule = rulesByDay.get(dayOfWeek)
    return {
      dayOfWeek,
      enabled: Boolean(rule?.isActive),
      startTime: rule ? minutesToTimeInput(rule.startTimeMinutes) : "09:00",
      endTime: rule ? minutesToTimeInput(rule.endTimeMinutes) : "17:00",
    }
  })
}

async function ensureActiveAssignee(tenantId: string, userId: string) {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_tenantId: {
        userId,
        tenantId,
      },
    },
    select: {
      userId: true,
      status: true,
      calendarEnabled: true,
      calendarColor: true,
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  })

  if (!membership || membership.status !== "ACTIVE" || !membership.calendarEnabled) {
    return null
  }

  return membership
}

function getUniqueIds(values: string[]) {
  return values.filter((value, index, items) => items.indexOf(value) === index)
}

async function validateCalendarFilters(
  tenantId: string,
  query: z.infer<typeof CalendarQuerySchema>,
) {
  const selectedUserIds = getUniqueIds([
    ...(query.assignedToUserIds ?? []),
    ...(query.assignedToUserId ? [query.assignedToUserId] : []),
  ])
  const selectedGroupIds = getUniqueIds(query.groupIds ?? [])

  const [memberships, groups, service, contact] = await Promise.all([
    selectedUserIds.length > 0
      ? prisma.membership.findMany({
          where: {
            tenantId,
            status: "ACTIVE",
            calendarEnabled: true,
            userId: { in: selectedUserIds },
          },
          select: {
            userId: true,
          },
        })
      : Promise.resolve([]),
    selectedGroupIds.length > 0
      ? prisma.calendarStaffGroup.findMany({
          where: {
            tenantId,
            id: { in: selectedGroupIds },
          },
          select: {
            id: true,
          },
        })
      : Promise.resolve([]),
    query.serviceId
      ? prisma.service.findFirst({
          where: {
            tenantId,
            id: query.serviceId,
          },
          select: {
            id: true,
          },
        })
      : Promise.resolve(null),
    query.contactId
      ? prisma.contact.findFirst({
          where: {
            tenantId,
            id: query.contactId,
          },
          select: {
            id: true,
          },
        })
      : Promise.resolve(null),
  ])

  if (selectedUserIds.length > 0 && memberships.length !== selectedUserIds.length) {
    return {
      ok: false as const,
      status: 404,
      error: "CALENDAR_FILTER_USER_NOT_FOUND",
    }
  }

  if (selectedGroupIds.length > 0 && groups.length !== selectedGroupIds.length) {
    return {
      ok: false as const,
      status: 404,
      error: "CALENDAR_FILTER_GROUP_NOT_FOUND",
    }
  }

  if (query.serviceId && !service) {
    return {
      ok: false as const,
      status: 404,
      error: "CALENDAR_FILTER_SERVICE_NOT_FOUND",
    }
  }

  if (query.contactId && !contact) {
    return {
      ok: false as const,
      status: 404,
      error: "CALENDAR_FILTER_CONTACT_NOT_FOUND",
    }
  }

  let resolvedAssignedToUserIds: string[] = []
  if (query.filterMode === "groups" && selectedGroupIds.length > 0) {
    const groupMembers = await prisma.calendarStaffGroupMember.findMany({
      where: {
        tenantId,
        groupId: {
          in: selectedGroupIds,
        },
        membership: {
          is: {
            status: "ACTIVE",
            calendarEnabled: true,
          },
        },
      },
      select: {
        userId: true,
      },
    })

    resolvedAssignedToUserIds = getUniqueIds(groupMembers.map((item) => item.userId))
  } else if (selectedUserIds.length > 0) {
    resolvedAssignedToUserIds = selectedUserIds
  }

  return {
    ok: true as const,
    selectedUserIds,
    selectedGroupIds,
    resolvedAssignedToUserIds,
  }
}

router.get("/:tenantId/meta", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const [tenant, users, services, groups, tenantAvailabilityRules] = await prisma.$transaction([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          calendarAppointmentSlotMinutes: true,
          calendarMeetingDurationMinutes: true,
          calendarMinimumScheduleNoticeMinutes: true,
          calendarMaximumBookingsPerDay: true,
          calendarMaximumBookingsPerSlot: true,
          calendarPreBufferMinutes: true,
          calendarPostBufferMinutes: true,
          calendarBufferAvailabilityMode: true,
        },
      }),
      prisma.membership.findMany({
        where: {
          tenantId,
          status: "ACTIVE",
          calendarEnabled: true,
        },
        orderBy: [{ user: { name: "asc" } }],
        select: {
          userId: true,
          role: true,
          calendarColor: true,
          user: {
            select: {
              name: true,
              email: true,
              image: true,
            },
          },
        },
      }),
      prisma.service.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.calendarStaffGroup.findMany({
        where: {
          tenantId,
        },
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          name: true,
          description: true,
          members: {
            orderBy: [{ userId: "asc" }],
            select: {
              userId: true,
              membership: {
                select: {
                  calendarColor: true,
                  user: {
                    select: {
                      name: true,
                      email: true,
                      image: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.calendarAvailabilityRule.findMany({
        where: {
          tenantId,
          scope: "TENANT",
          kind: "OPEN",
          userId: null,
        },
        orderBy: [{ dayOfWeek: "asc" }],
        select: {
          dayOfWeek: true,
          startTimeMinutes: true,
          endTimeMinutes: true,
          isActive: true,
        },
      }),
    ])

    return res.json({
      ok: true,
      settings: {
        meetingIntervalMinutes: getSafeCalendarSlotDuration(
          tenant?.calendarAppointmentSlotMinutes,
        ),
        meetingDurationMinutes: getSafeCalendarSlotDuration(
          tenant?.calendarMeetingDurationMinutes,
        ),
        minimumScheduleNoticeMinutes:
          tenant?.calendarMinimumScheduleNoticeMinutes ?? 0,
        maximumBookingsPerDay: tenant?.calendarMaximumBookingsPerDay ?? null,
        maximumBookingsPerSlot: tenant?.calendarMaximumBookingsPerSlot ?? 1,
        preBufferMinutes: tenant?.calendarPreBufferMinutes ?? 0,
        postBufferMinutes: tenant?.calendarPostBufferMinutes ?? 0,
        bufferAvailabilityMode: getSafeCalendarBufferMode(
          tenant?.calendarBufferAvailabilityMode,
        ),
      },
      availability: {
        weeklyAvailability: buildWeeklyAvailabilityFromRules(tenantAvailabilityRules),
      },
      filters: {
        users: users.map((item) => ({
          id: item.userId,
          label: item.user.name?.trim() || item.user.email,
          email: item.user.email,
          role: item.role,
          image: item.user.image ?? null,
          color: item.calendarColor ?? null,
        })),
        groups: groups.map((group) => ({
          id: group.id,
          name: group.name,
          description: group.description ?? null,
          memberUserIds: group.members.map((member) => member.userId),
          members: group.members.map((member) => ({
            userId: member.userId,
            label:
              member.membership.user.name?.trim() || member.membership.user.email,
            email: member.membership.user.email,
            image: member.membership.user.image ?? null,
            color: member.membership.calendarColor ?? null,
          })),
        })),
        services,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/slots", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const query = CalendarSlotsQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const assignee = await ensureActiveAssignee(tenantId, query.assignedToUserId)
    if (!assignee) {
      return res.status(404).json({ error: "ASSIGNEE_NOT_FOUND" })
    }

    const data = await buildAppointmentSlots(prisma, {
      tenantId,
      assignedToUserId: query.assignedToUserId,
      localDate: query.date,
      appointmentId: query.appointmentId,
    })

    return res.json({
      ok: true,
      timezone: data.timezone,
      meetingIntervalMinutes: data.meetingIntervalMinutes,
      meetingDurationMinutes: data.meetingDurationMinutes,
      bookingRules: data.bookingRules,
      assignee: {
        id: assignee.userId,
        label: assignee.user.name?.trim() || assignee.user.email,
      },
      date: query.date,
      slots: data.slots,
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/item/:appointmentId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, appointmentId } = TenantAppointmentPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const appointment = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        tenantId,
      },
      select: {
        id: true,
        title: true,
        notes: true,
        startAt: true,
        endAt: true,
        assignedToUserId: true,
        status: true,
        contactId: true,
        serviceId: true,
        contact: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        assignedTo: {
          select: {
            name: true,
            email: true,
            image: true,
            memberships: {
              where: {
                tenantId,
              },
              select: {
                calendarColor: true,
              },
              take: 1,
            },
          },
        },
        service: {
          select: {
            name: true,
          },
        },
      },
    })

    if (!appointment) {
      return res.status(404).json({ error: "APPOINTMENT_NOT_FOUND" })
    }

    const canViewLogs = canViewAppointmentAuditLogs(membership)
    const auditLogs = canViewLogs
      ? await prisma.appointmentAuditLog.findMany({
          where: {
            tenantId,
            appointmentId,
          },
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            action: true,
            actorDisplayName: true,
            message: true,
            createdAt: true,
          },
        })
      : []

    return res.json({
      ok: true,
      item: serializeAppointmentItem(appointment),
      canViewAuditLogs: canViewLogs,
      auditLogs: auditLogs.map(serializeAuditLog),
    })
  } catch (error) {
    return next(error)
  }
})

router.get(
  "/:tenantId/:appointmentId/audit",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, appointmentId } = TenantAppointmentPathSchema.parse(req.params)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (!canViewAppointmentAuditLogs(membership)) {
        return res.status(403).json({ error: "APPOINTMENT_AUDIT_ACCESS_DENIED" })
      }

      const appointment = await prisma.appointment.findFirst({
        where: {
          id: appointmentId,
          tenantId,
        },
        select: {
          id: true,
        },
      })

      if (!appointment) {
        return res.status(404).json({ error: "APPOINTMENT_NOT_FOUND" })
      }

      const auditLogs = await prisma.appointmentAuditLog.findMany({
        where: {
          tenantId,
          appointmentId,
        },
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          action: true,
          actorDisplayName: true,
          message: true,
          createdAt: true,
        },
      })

      return res.json({
        ok: true,
        items: auditLogs.map(serializeAuditLog),
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.get("/:tenantId/contact/:contactId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, contactId } = TenantContactPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

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
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
    }

    const items = await prisma.appointment.findMany({
      where: {
        tenantId,
        contactId,
      },
      orderBy: [{ startAt: "desc" }],
      select: {
        id: true,
        title: true,
        notes: true,
        startAt: true,
        endAt: true,
        assignedToUserId: true,
        status: true,
        contactId: true,
        serviceId: true,
        contact: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        assignedTo: {
          select: {
            name: true,
            email: true,
            image: true,
            memberships: {
              where: {
                tenantId,
              },
              select: {
                calendarColor: true,
              },
              take: 1,
            },
          },
        },
        service: {
          select: {
            name: true,
          },
        },
      },
    })

    return res.json({
      ok: true,
      canViewAuditLogs: canViewAppointmentAuditLogs(membership),
      items: items.map(serializeAppointmentItem),
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const query = CalendarQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    })

    const timezone = getSafeTimezone(tenant?.timezone)
    const defaultRange = getDefaultRange(timezone)
    const rangeStart = query.from ? new Date(query.from) : defaultRange.start
    const rangeEnd = query.to ? new Date(query.to) : defaultRange.end
    const validatedFilters = await validateCalendarFilters(tenantId, query)

    if (!validatedFilters.ok) {
      return res.status(validatedFilters.status).json({
        error: validatedFilters.error,
      })
    }

    const {
      selectedUserIds,
      selectedGroupIds,
      resolvedAssignedToUserIds,
    } = validatedFilters

    const shouldReturnEmptyForGroupSelection =
      query.filterMode === "groups" &&
      selectedGroupIds.length > 0 &&
      resolvedAssignedToUserIds.length === 0

    const [items, blockedPeriods] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          tenantId,
          ...(shouldReturnEmptyForGroupSelection
            ? {
                assignedToUserId: "__NO_MATCH__",
              }
            : resolvedAssignedToUserIds.length > 0
            ? {
                assignedToUserId: {
                  in: resolvedAssignedToUserIds,
                },
              }
            : {}),
          ...(query.contactId ? { contactId: query.contactId } : {}),
          ...(query.serviceId ? { serviceId: query.serviceId } : {}),
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
        orderBy: [{ startAt: "asc" }],
        select: {
          id: true,
          title: true,
          notes: true,
          startAt: true,
          endAt: true,
          assignedToUserId: true,
          status: true,
          contactId: true,
          serviceId: true,
          contact: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          assignedTo: {
            select: {
              name: true,
              email: true,
              image: true,
              memberships: {
                where: {
                  tenantId,
                },
                select: {
                  calendarColor: true,
                },
                take: 1,
              },
            },
          },
          service: {
            select: {
              name: true,
            },
          },
        },
      }),
      listCalendarBlockOccurrences(prisma, {
        tenantId,
        timezone,
        rangeStart,
        rangeEnd,
        scope: "TENANT",
      }),
    ])

    return res.json({
      ok: true,
      items: items.map(serializeAppointmentItem),
      blockedPeriods: blockedPeriods.map(serializeCalendarBlockOccurrence),
      range: {
        from: rangeStart.toISOString(),
        to: rangeEnd.toISOString(),
      },
      filters: {
        view: query.view,
        filterMode: query.filterMode,
        assignedToUserId: selectedUserIds[0] ?? null,
        assignedToUserIds: selectedUserIds,
        groupIds: selectedGroupIds,
        contactId: query.contactId ?? null,
        serviceId: query.serviceId ?? null,
      },
      emptyState: {
        title: "No appointments yet",
        description:
          "Create the first appointment to start filling the calendar.",
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId/availability", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = AvailabilityRequestSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const startAt = new Date(payload.startAt)
    const endAt = new Date(payload.endAt)

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      return res.status(400).json({ error: "INVALID_APPOINTMENT_DATE" })
    }

    if (endAt <= startAt) {
      return res.status(400).json({ error: "INVALID_APPOINTMENT_RANGE" })
    }

    const assignee = await ensureActiveAssignee(tenantId, payload.assignedToUserId)
    if (!assignee) {
      return res.status(404).json({ error: "ASSIGNEE_NOT_FOUND" })
    }

    const availability = await evaluateAvailability(prisma, {
      tenantId,
      assignedToUserId: payload.assignedToUserId,
      startAt,
      endAt,
      appointmentId: payload.appointmentId,
    })

    return res.json({
      ok: true,
      available: availability.available,
      timezone: availability.timezone,
      assignee: {
        id: assignee.userId,
        label: assignee.user.name?.trim() || assignee.user.email,
      },
      reasons: availability.reasons,
      windows: availability.windows,
      conflicts: availability.conflicts,
    })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = CreateAppointmentSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const startAt = new Date(payload.startAt)
    const endAt = new Date(payload.endAt)

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      return res.status(400).json({ error: "INVALID_APPOINTMENT_DATE" })
    }

    if (endAt <= startAt) {
      return res.status(400).json({ error: "INVALID_APPOINTMENT_RANGE" })
    }

    const [contact, service, assignee] = await Promise.all([
      prisma.contact.findFirst({
        where: {
          id: payload.contactId,
          tenantId,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      }),
      payload.serviceId
        ? prisma.service.findFirst({
            where: {
              id: payload.serviceId,
              tenantId,
            },
            select: {
              id: true,
              name: true,
            },
          })
        : Promise.resolve(null),
      ensureActiveAssignee(tenantId, payload.assignedToUserId),
    ])

    if (!contact) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
    }

    if (payload.serviceId && !service) {
      return res.status(404).json({ error: "SERVICE_NOT_FOUND" })
    }

    if (!assignee) {
      return res.status(404).json({ error: "ASSIGNEE_NOT_FOUND" })
    }

    const defaultTitleBase = `${contact.firstName} ${contact.lastName}`.trim()
    const title = payload.title?.trim()
      ? payload.title.trim()
      : service?.name
        ? `${service.name} with ${defaultTitleBase}`
        : `Appointment with ${defaultTitleBase}`

    const bookingResult = await createAppointmentAtomically({
      tenantId,
      contactId: payload.contactId,
      serviceId: payload.serviceId ?? null,
      bookedByUserId: authed.user.id,
      actorDisplayName: getActorDisplayName(authed.user),
      assignedToUserId: payload.assignedToUserId,
      assignedToLabel: assignee.user.name?.trim() || assignee.user.email,
      title,
      notes: payload.notes ?? null,
      startAt,
      endAt,
      isAllDay: payload.isAllDay,
    })

    if (!bookingResult.ok) {
      return res.status(409).json({
        error: "APPOINTMENT_TIME_UNAVAILABLE",
        availability: bookingResult.availability,
      })
    }

    return res.status(201).json({
      ok: true,
      item: {
        ...bookingResult.appointment,
        startAt: bookingResult.appointment.startAt.toISOString(),
        endAt: bookingResult.appointment.endAt.toISOString(),
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.patch("/:tenantId/:appointmentId", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const authed = req as AuthedRequest
    const { tenantId, appointmentId } = TenantAppointmentPathSchema.parse(req.params)
    const payload = UpdateAppointmentSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const existingAppointment = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        tenantId,
      },
      select: {
        id: true,
        contactId: true,
        serviceId: true,
        assignedToUserId: true,
        title: true,
        notes: true,
        startAt: true,
        endAt: true,
        isAllDay: true,
        status: true,
      },
    })

    if (!existingAppointment) {
      return res.status(404).json({ error: "APPOINTMENT_NOT_FOUND" })
    }

    if (
      payload.status &&
      payload.status !== "SCHEDULED"
    ) {
      const updatedAppointment = await prisma.$transaction(async (tx) => {
        const updated = await tx.appointment.update({
          where: {
            id: appointmentId,
          },
          data: {
            status: payload.status,
          },
          select: {
            id: true,
            title: true,
            startAt: true,
            endAt: true,
            status: true,
            assignedToUserId: true,
            contactId: true,
            serviceId: true,
          },
        })

        if (
          payload.status === "CANCELED" &&
          existingAppointment.status !== "CANCELED"
        ) {
          await tx.appointmentAuditLog.create({
            data: {
              tenantId,
              appointmentId,
              actorUserId: authed.user.id,
              actorDisplayName: getActorDisplayName(authed.user),
              action: "CANCELED",
              message: `${getActorDisplayName(authed.user)} canceled this appointment.`,
            },
          })
        }

        return updated
      })

      return res.json({
        ok: true,
        item: {
          ...updatedAppointment,
          startAt: updatedAppointment.startAt.toISOString(),
          endAt: updatedAppointment.endAt.toISOString(),
        },
      })
    }

    const nextContactId = payload.contactId ?? existingAppointment.contactId
    const nextServiceId =
      payload.serviceId !== undefined ? payload.serviceId : existingAppointment.serviceId
    const nextAssignedToUserId =
      payload.assignedToUserId ?? existingAppointment.assignedToUserId
    const nextStartAt = payload.startAt ? new Date(payload.startAt) : existingAppointment.startAt
    const nextEndAt = payload.endAt ? new Date(payload.endAt) : existingAppointment.endAt
    const nextIsAllDay = payload.isAllDay ?? existingAppointment.isAllDay

    if (!nextAssignedToUserId) {
      return res.status(400).json({ error: "ASSIGNEE_NOT_FOUND" })
    }

    if (Number.isNaN(nextStartAt.getTime()) || Number.isNaN(nextEndAt.getTime())) {
      return res.status(400).json({ error: "INVALID_APPOINTMENT_DATE" })
    }

    if (nextEndAt <= nextStartAt) {
      return res.status(400).json({ error: "INVALID_APPOINTMENT_RANGE" })
    }

    const [contact, service, assignee] = await Promise.all([
      prisma.contact.findFirst({
        where: {
          id: nextContactId,
          tenantId,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      }),
      nextServiceId
        ? prisma.service.findFirst({
            where: {
              id: nextServiceId,
              tenantId,
            },
            select: {
              id: true,
              name: true,
            },
          })
        : Promise.resolve(null),
      ensureActiveAssignee(tenantId, nextAssignedToUserId),
    ])

    if (!contact) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
    }

    if (nextServiceId && !service) {
      return res.status(404).json({ error: "SERVICE_NOT_FOUND" })
    }

    if (!assignee) {
      return res.status(404).json({ error: "ASSIGNEE_NOT_FOUND" })
    }

    const defaultTitleBase = `${contact.firstName} ${contact.lastName}`.trim()
    const nextTitle = payload.title?.trim()
      ? payload.title.trim()
      : payload.title === null
        ? service?.name
          ? `${service.name} with ${defaultTitleBase}`
          : `Appointment with ${defaultTitleBase}`
        : existingAppointment.title

    const updateResult = await updateAppointmentAtomically({
      appointmentId,
      tenantId,
      actorUserId: authed.user.id,
      actorDisplayName: getActorDisplayName(authed.user),
      contactId: nextContactId,
      serviceId: nextServiceId ?? null,
      assignedToUserId: nextAssignedToUserId,
      assignedToLabel: assignee.user.name?.trim() || assignee.user.email,
      title: nextTitle,
      notes: payload.notes !== undefined ? payload.notes ?? null : existingAppointment.notes,
      startAt: nextStartAt,
      endAt: nextEndAt,
      isAllDay: nextIsAllDay,
    })

    if (!updateResult.ok) {
      if (updateResult.error === "APPOINTMENT_NOT_FOUND") {
        return res.status(404).json({ error: "APPOINTMENT_NOT_FOUND" })
      }

      return res.status(409).json({
        error: "APPOINTMENT_TIME_UNAVAILABLE",
        availability: updateResult.availability,
      })
    }

    return res.json({
      ok: true,
      item: {
        ...updateResult.appointment,
        startAt: updateResult.appointment.startAt.toISOString(),
        endAt: updateResult.appointment.endAt.toISOString(),
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.delete("/:tenantId/:appointmentId", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const authed = req as AuthedRequest
    const { tenantId, appointmentId } = TenantAppointmentPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    await prisma.appointment.deleteMany({
      where: {
        id: appointmentId,
        tenantId,
      },
    })

    return res.json({ ok: true })
  } catch (error) {
    return next(error)
  }
})

export default router
