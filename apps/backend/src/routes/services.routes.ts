import { type Response, Router } from "express"
import { z } from "zod"

import { prisma } from "../lib/prisma.js"
import {
  executeFollowUpFromStart,
  executeFollowUpFromStep,
  syncContactServiceActiveStep,
} from "../lib/service-followup-execution.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"

const router = Router()
const prismaWithServices = prisma as any

const stripHtmlTags = (value: string) => value.replace(/<[^>]*>/g, " ")
const removeUnsafeControls = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
const sanitizeSingleLineText = (value: string) =>
  removeUnsafeControls(stripHtmlTags(value)).replace(/\s+/g, " ").trim()
const sanitizeMultilineText = (value: string) =>
  removeUnsafeControls(stripHtmlTags(value))
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim()

const TenantPathSchema = z.object({
  tenantId: z.string().min(1),
})

const TenantContactServicePathSchema = TenantPathSchema.extend({
  contactServiceId: z.string().min(1),
})

const TenantContactServicePaymentPathSchema = TenantContactServicePathSchema.extend({
  paymentId: z.string().min(1),
})

const TenantFollowUpStepPathSchema = TenantContactServicePathSchema.extend({
  followUpStepId: z.string().min(1),
})

const TenantContactServiceChecklistItemPathSchema = TenantContactServicePathSchema.extend({
  checklistItemId: z.string().min(1),
})

const ContactServicesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25, {
      message: "pageSize must be 10 or 25",
    })
    .default(10),
  contactId: z.string().trim().min(1).optional(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELED"]).optional(),
})

const FollowUpsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25, {
      message: "pageSize must be 10 or 25",
    })
    .default(10),
  search: z.string().trim().max(200).optional(),
  status: z
    .enum(["PENDING", "ACTIVE", "COMPLETED", "SKIPPED", "POSTPONED"])
    .optional(),
  dueDatePreset: z
    .enum(["OVERDUE", "TODAY", "NEXT_7_DAYS", "NO_DUE_DATE"])
    .optional(),
})

const CreateContactServiceSchema = z.object({
  contactId: z.string().min(1),
  serviceId: z.string().min(1),
  followUpTemplateId: z.string().min(1).optional(),
  purchasedAt: z.string().datetime().nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  totalPriceCents: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  initialPaymentCents: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
})

const CreateContactServicePaymentSchema = z.object({
  amountCents: z.coerce.number().int().min(1).max(1_000_000_000),
  paidAt: z.string().datetime().optional(),
  paymentMethod: z
    .enum(["CASH", "CARD", "CHECK", "TRANSFER", "ACH"])
    .nullable()
    .optional(),
  note: z.string().trim().max(1000).nullable().optional(),
})

const UpdateContactServicePaymentSchema = z.object({
  amountCents: z.coerce.number().int().min(1).max(1_000_000_000).optional(),
  paidAt: z.string().datetime().optional(),
  paymentMethod: z
    .enum(["CASH", "CARD", "CHECK", "TRANSFER", "ACH"])
    .nullable()
    .optional(),
  note: z.string().trim().max(1000).nullable().optional(),
})

const UpdateContactServiceSchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELED"]).optional(),
  startedAt: z.string().datetime().nullable().optional(),
  purchasedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  canceledAt: z.string().datetime().nullable().optional(),
  totalPriceCents: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
})

const CreateContactServiceNoteSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(8000),
})

const UpdateFollowUpStepSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notesTemplate: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "SKIPPED", "POSTPONED"]).optional(),
  availableAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  postponeTo: z.string().datetime().optional(),
  cascadeFutureSteps: z.boolean().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  assignedToUserId: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
})

const CreateFollowUpStepSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notesTemplate: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "SKIPPED", "POSTPONED"]).optional(),
  availableAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assignedToUserId: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
})

const UpdateContactServiceChecklistItemSchema = z.object({
  completed: z.boolean().optional(),
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

function canManageContactServices(membership: {
  role: string
  securityLevel: "LOW" | "MEDIUM" | "MAX"
}) {
  return membership.role === "TENANT_ADMIN" || membership.securityLevel !== "LOW"
}

const DEFAULT_TIMEZONE = "America/Chicago"

function getSafeTimezone(timezone?: string | null) {
  return timezone?.trim() || DEFAULT_TIMEZONE
}

function parseOffsetMinutes(label: string) {
  if (label === "GMT" || label === "UTC") return 0

  const normalized = label.replace("UTC", "GMT")
  const match = normalized.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)
  if (!match) return 0

  const [, sign, hours, minutes] = match
  const total = Number(hours) * 60 + Number(minutes ?? "0")
  return sign === "-" ? -total : total
}

function getOffsetMinutes(timezone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(timezone),
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date)

  const label = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT"
  return parseOffsetMinutes(label)
}

function getTimezoneDayParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)

  const getPart = (type: string, fallback = "") =>
    parts.find((part) => part.type === type)?.value ?? fallback

  return {
    year: Number(getPart("year", "0")),
    month: Number(getPart("month", "1")),
    day: Number(getPart("day", "1")),
  }
}

function zonedDateTimeToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, 0)
  let utcMs = utcGuess

  for (let index = 0; index < 3; index += 1) {
    const offsetMinutes = getOffsetMinutes(timezone, new Date(utcMs))
    const adjusted = utcGuess - offsetMinutes * 60_000
    if (adjusted === utcMs) break
    utcMs = adjusted
  }

  return new Date(utcMs)
}

function getTodayRange(timezone: string) {
  const today = getTimezoneDayParts(new Date(), timezone)
  const start = zonedDateTimeToUtc(timezone, today.year, today.month, today.day, 0, 0, 0)
  const end = zonedDateTimeToUtc(timezone, today.year, today.month, today.day + 1, 0, 0, 0)
  return { start, end }
}

async function summarizeContactServicePayments(
  prismaTx: any,
  tenantId: string,
  contactServiceId: string,
) {
  const [contactService, payments] = await Promise.all([
    prismaTx.contactService.findFirst({
      where: {
        id: contactServiceId,
        tenantId,
      },
      select: {
        id: true,
        totalPriceCents: true,
      },
    }),
    prismaTx.contactServicePayment.findMany({
      where: {
        tenantId,
        contactServiceId,
      },
      select: {
        amountCents: true,
      },
    }),
  ])

  if (!contactService) {
    return null
  }

  const paidCents = payments.reduce(
    (sum: number, payment: { amountCents: number }) => sum + payment.amountCents,
    0,
  )

  return {
    totalPriceCents: contactService.totalPriceCents,
    paidCents,
    remainingCents: Math.max(0, contactService.totalPriceCents - paidCents),
  }
}

async function reconcileContactServiceCompletionFromFollowUps(
  prismaTx: any,
  tenantId: string,
  contactServiceId: string,
) {
  const contactService = await prismaTx.contactService.findFirst({
    where: {
      id: contactServiceId,
      tenantId,
    },
    select: {
      id: true,
      status: true,
      completedAt: true,
    },
  })

  if (!contactService || contactService.status === "CANCELED") {
    return contactService
  }

  const followUpSteps = await prismaTx.contactServiceFollowUpStep.findMany({
    where: {
      tenantId,
      contactServiceId,
    },
    select: {
      status: true,
      completedAt: true,
    },
  })

  const hasSteps = followUpSteps.length > 0
  const allStepsCompleted = hasSteps
    ? followUpSteps.every(
        (step: { status: string | null; completedAt: Date | null }) =>
          step.status === "COMPLETED" ||
          step.status === "SKIPPED" ||
          Boolean(step.completedAt),
      )
    : false

  if (allStepsCompleted) {
    if (contactService.status !== "COMPLETED") {
      return prismaTx.contactService.update({
        where: { id: contactServiceId },
        data: {
          status: "COMPLETED",
          completedAt: contactService.completedAt ?? new Date(),
        },
        select: {
          id: true,
          status: true,
          completedAt: true,
        },
      })
    }

    return contactService
  }

  if (contactService.status === "COMPLETED") {
    return prismaTx.contactService.update({
      where: { id: contactServiceId },
      data: {
        status: "IN_PROGRESS",
        completedAt: null,
      },
      select: {
        id: true,
        status: true,
        completedAt: true,
      },
    })
  }

  return contactService
}

router.get("/:tenantId/follow-ups", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const { page, pageSize, search, status, dueDatePreset } = FollowUpsListQuerySchema.parse(
      req.query,
    )

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    })

    const tenantTimezone = getSafeTimezone(tenant?.timezone)
    const now = new Date()
    const todayRange = getTodayRange(tenantTimezone)
    const nextSevenDaysEnd = new Date(todayRange.end.getTime() + 6 * 24 * 60 * 60 * 1000)
    const skip = (page - 1) * pageSize

    const preferredCurrentStepStatuses = status
      ? [status]
      : ["ACTIVE", "POSTPONED", "PENDING", "COMPLETED", "SKIPPED"]
    const searchableValue = search?.trim()
    const currentStepStatusClause = status
      ? { status }
      : { status: { in: preferredCurrentStepStatuses } }

    const currentStepWhere =
      dueDatePreset === "OVERDUE"
        ? {
            ...currentStepStatusClause,
            dueAt: { lt: now },
          }
        : dueDatePreset === "TODAY"
          ? {
              ...currentStepStatusClause,
              dueAt: { gte: todayRange.start, lt: todayRange.end },
            }
          : dueDatePreset === "NEXT_7_DAYS"
            ? {
                ...currentStepStatusClause,
                dueAt: { gte: todayRange.start, lt: nextSevenDaysEnd },
              }
            : dueDatePreset === "NO_DUE_DATE"
              ? {
                  ...currentStepStatusClause,
                  dueAt: null,
                }
              : {
                  ...currentStepStatusClause,
                }

    const where = {
      tenantId,
      status: {
        in: ["PENDING", "IN_PROGRESS"] as const,
      },
      followUpSteps: {
        some: {
          ...currentStepWhere,
          ...(searchableValue
            ? {
                OR: [
                  { title: { contains: searchableValue, mode: "insensitive" as const } },
                  { note: { contains: searchableValue, mode: "insensitive" as const } },
                ],
              }
            : {}),
        },
      },
      ...(searchableValue
        ? {
            OR: [
              { service: { name: { contains: searchableValue, mode: "insensitive" as const } } },
              {
                contact: {
                  OR: [
                    { firstName: { contains: searchableValue, mode: "insensitive" as const } },
                    { middleName: { contains: searchableValue, mode: "insensitive" as const } },
                    { lastName: { contains: searchableValue, mode: "insensitive" as const } },
                    { phone: { contains: searchableValue, mode: "insensitive" as const } },
                  ],
                },
              },
            ],
          }
        : {}),
    }

    const [total, services] = await prisma.$transaction([
      prismaWithServices.contactService.count({ where }),
      prismaWithServices.contactService.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          service: {
            select: {
              id: true,
              name: true,
            },
          },
          contact: {
            select: {
              id: true,
              firstName: true,
              middleName: true,
              lastName: true,
              phone: true,
            },
          },
          followUpTemplate: {
            select: {
              id: true,
              name: true,
            },
          },
          followUpSteps: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              title: true,
              status: true,
              availableAt: true,
              dueAt: true,
              completedAt: true,
              assignedToUserId: true,
              note: true,
              sortOrder: true,
              assignedTo: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
    ])

    const summaryServices = await prismaWithServices.contactService.findMany({
      where: {
        tenantId,
        status: {
          in: ["PENDING", "IN_PROGRESS"] as const,
        },
        followUpSteps: {
          some: {
            status: "ACTIVE",
          },
        },
      },
      select: {
        id: true,
        followUpSteps: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            status: true,
            dueAt: true,
            completedAt: true,
          },
        },
      },
    })

    const [servicesInProgress, overdueEnrollments, dueToday] = await Promise.all([
      prismaWithServices.contactService.findMany({
        where: {
          tenantId,
          status: {
            in: ["PENDING", "IN_PROGRESS"] as const,
          },
          followUpSteps: {
            some: {
              status: "ACTIVE",
            },
          },
        },
        select: {
          id: true,
        },
      }),
      prismaWithServices.contactServiceFollowUpStep.count({
        where: {
          tenantId,
          dueAt: { lt: now },
          status: "ACTIVE",
          contactService: {
            tenantId,
            status: {
              in: ["PENDING", "IN_PROGRESS"] as const,
            },
          },
        },
      }),
      prismaWithServices.contactServiceFollowUpStep.count({
        where: {
          tenantId,
          dueAt: { gte: todayRange.start, lt: todayRange.end },
          status: "ACTIVE",
          contactService: {
            tenantId,
            status: {
              in: ["PENDING", "IN_PROGRESS"] as const,
            },
          },
        },
      }),
    ])

    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const averageProgress = summaryServices.length
      ? Math.round(
          summaryServices.reduce((sum: number, service: any) => {
            const totalSteps = service.followUpSteps.length
            if (!totalSteps) return sum

            const completedSteps = service.followUpSteps.filter(
              (step: any) => step.status === "COMPLETED" || step.status === "SKIPPED",
            ).length

            return sum + Math.round((completedSteps / totalSteps) * 100)
          }, 0) / summaryServices.length,
        )
      : 0

    return res.json({
      ok: true,
      items: services.map((service: any) => {
        const currentStep =
          preferredCurrentStepStatuses
            .map(
              (currentStatus) =>
                service.followUpSteps.find((step: any) => step.status === currentStatus) ?? null,
            )
            .find(Boolean) ?? null
        const totalSteps = service.followUpSteps.length
        const completedSteps = service.followUpSteps.filter(
          (step: any) => step.status === "COMPLETED" || step.status === "SKIPPED",
        ).length
        const remainingSteps = Math.max(0, totalSteps - completedSteps)

        return {
          id: service.id,
          status: service.status,
          contactId: service.contact.id,
          contactName: [service.contact.firstName, service.contact.middleName, service.contact.lastName]
            .filter(Boolean)
            .join(" "),
          phoneNumber: service.contact.phone ?? null,
          serviceId: service.service.id,
          serviceName: service.service.name,
          followUpTemplateId: service.followUpTemplate?.id ?? null,
          followUpTemplateName: service.followUpTemplate?.name ?? null,
          currentStep: currentStep
            ? {
                id: currentStep.id,
                title: currentStep.title,
                status: currentStep.status,
                availableAt: currentStep.availableAt,
                dueAt: currentStep.dueAt,
                completedAt: currentStep.completedAt,
                assignedToUserId: currentStep.assignedToUserId,
                assignedToName:
                  currentStep.assignedTo?.name?.trim() || currentStep.assignedTo?.email || null,
                note: currentStep.note,
                sortOrder: currentStep.sortOrder,
              }
            : null,
          progress: {
            completedCount: completedSteps,
            totalCount: totalSteps,
            remainingCount: remainingSteps,
            completionPercentage: totalSteps
              ? Math.round((completedSteps / totalSteps) * 100)
              : 0,
          },
          overdue:
            Boolean(currentStep?.dueAt) &&
            currentStep.status === "ACTIVE" &&
            new Date(currentStep.dueAt).getTime() < now.getTime(),
        }
      }),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
      summary: {
        servicesInProgress: servicesInProgress.length,
        overdueEnrollments,
        dueToday,
        averageProgress,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/contact-services", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const { page, pageSize, contactId, status } = ContactServicesListQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const skip = (page - 1) * pageSize

    const where = {
      tenantId,
      ...(contactId ? { contactId } : {}),
      ...(status ? { status } : {}),
    }

    let [total, items] = await prisma.$transaction([
      prismaWithServices.contactService.count({ where }),
      prismaWithServices.contactService.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          startedAt: true,
          purchasedAt: true,
          completedAt: true,
          canceledAt: true,
          totalPriceCents: true,
          currency: true,
          allowPartialPayments: true,
          notes: true,
          contact: {
            select: {
              firstName: true,
              middleName: true,
              lastName: true,
            },
          },
          service: {
            select: {
              id: true,
              name: true,
              description: true,
              basePriceCents: true,
              checklistItems: {
                select: {
                  id: true,
                  label: true,
                  description: true,
                  isRequired: true,
                  sortOrder: true,
                },
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
            },
          },
          followUpTemplate: {
            select: {
              id: true,
              name: true,
            },
          },
          payments: {
            select: {
              amountCents: true,
            },
          },
          followUpSteps: {
            select: {
              id: true,
              title: true,
              notesTemplate: true,
              status: true,
              availableAt: true,
              dueAt: true,
              completedAt: true,
              assignedToUserId: true,
              note: true,
              sortOrder: true,
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          checklistItems: {
            select: {
              id: true,
              checklistItemId: true,
              completedAt: true,
              checklistItem: {
                select: {
                  id: true,
                  label: true,
                  description: true,
                  isRequired: true,
                  sortOrder: true,
                },
              },
            },
            orderBy: [
              { checklistItem: { sortOrder: "asc" } },
              { createdAt: "asc" },
            ],
          },
        },
      }),
    ])

    const syncResults = await prisma.$transaction(async (tx) => {
      const prismaTx = tx as any
      const activatedIds: string[] = []
      let checklistBackfilled = false
      for (const item of items) {
        const activatedId = await syncContactServiceActiveStep({
          prismaTx,
          tenantId,
          contactServiceId: item.id,
        })
        if (activatedId) activatedIds.push(activatedId)

        const serviceChecklistItemIds = (item.service?.checklistItems ?? []).map(
          (checklistItem: { id: string }) => checklistItem.id,
        )
        const existingChecklistItemIds = new Set(
          (item.checklistItems ?? []).map(
            (checklistItem: { checklistItemId: string }) => checklistItem.checklistItemId,
          ),
        )
        const missingChecklistItemIds = serviceChecklistItemIds.filter(
          (checklistItemId: string) => !existingChecklistItemIds.has(checklistItemId),
        )

        if (missingChecklistItemIds.length) {
          await prismaTx.contactServiceChecklistItem.createMany({
            data: missingChecklistItemIds.map((checklistItemId: string) => ({
              tenantId,
              contactServiceId: item.id,
              checklistItemId,
            })),
            skipDuplicates: true,
          })
          checklistBackfilled = true
        }
      }
      return { activatedIds, checklistBackfilled }
    })

    if (syncResults.activatedIds.length > 0 || syncResults.checklistBackfilled) {
      items = await prismaWithServices.contactService.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          startedAt: true,
          purchasedAt: true,
          completedAt: true,
          canceledAt: true,
          totalPriceCents: true,
          currency: true,
          allowPartialPayments: true,
          notes: true,
          contact: {
            select: {
              firstName: true,
              middleName: true,
              lastName: true,
            },
          },
          service: {
            select: {
              id: true,
              name: true,
              description: true,
              basePriceCents: true,
              checklistItems: {
                select: {
                  id: true,
                  label: true,
                  description: true,
                  isRequired: true,
                  sortOrder: true,
                },
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              },
            },
          },
          followUpTemplate: {
            select: {
              id: true,
              name: true,
            },
          },
          payments: {
            select: {
              amountCents: true,
            },
          },
          followUpSteps: {
            select: {
              id: true,
              title: true,
              notesTemplate: true,
              status: true,
              availableAt: true,
              dueAt: true,
              completedAt: true,
              assignedToUserId: true,
              note: true,
              sortOrder: true,
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          checklistItems: {
            select: {
              id: true,
              checklistItemId: true,
              completedAt: true,
              checklistItem: {
                select: {
                  id: true,
                  label: true,
                  description: true,
                  isRequired: true,
                  sortOrder: true,
                },
              },
            },
            orderBy: [
              { checklistItem: { sortOrder: "asc" } },
              { createdAt: "asc" },
            ],
          },
        },
      })
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    return res.json({
      ok: true,
      items: items.map((item: any) => {
        const paidCents = item.payments.reduce(
          (sum: number, payment: { amountCents: number }) => sum + payment.amountCents,
          0,
        )

        return {
          id: item.id,
          status: item.status,
          startedAt: item.startedAt,
          purchasedAt: item.purchasedAt,
          completedAt: item.completedAt,
          canceledAt: item.canceledAt,
          totalPriceCents: item.totalPriceCents,
          paidCents,
          remainingCents: Math.max(0, item.totalPriceCents - paidCents),
          currency: item.currency,
          allowPartialPayments: item.allowPartialPayments,
          notes: item.notes,
          contactName: [item.contact?.firstName, item.contact?.middleName, item.contact?.lastName]
            .filter(Boolean)
            .join(" "),
          service: item.service,
          followUpTemplate: item.followUpTemplate,
          followUpSteps: item.followUpSteps,
          checklistItems: item.checklistItems.map((checklistItem: any) => ({
            id: checklistItem.id,
            checklistItemId: checklistItem.checklistItemId,
            completedAt: checklistItem.completedAt,
            label: checklistItem.checklistItem?.label ?? "",
            description: checklistItem.checklistItem?.description ?? null,
            isRequired: Boolean(checklistItem.checklistItem?.isRequired),
            sortOrder: checklistItem.checklistItem?.sortOrder ?? 0,
          })),
        }
      }),
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

router.post("/:tenantId/contact-services", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = CreateContactServiceSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const [contact, service] = await Promise.all([
      prisma.contact.findFirst({
        where: {
          id: payload.contactId,
          tenantId,
        },
        select: { id: true },
      }),
      prismaWithServices.service.findFirst({
        where: {
          id: payload.serviceId,
          tenantId,
        },
        select: {
          id: true,
          basePriceCents: true,
          currency: true,
          allowPartialPayments: true,
          checklistItems: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: { id: true },
          },
          followUpTemplates: {
            where: { isPublished: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              steps: {
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                select: {
                  templateNodeId: true,
                  title: true,
                  notesTemplate: true,
                  dueDaysFromStart: true,
                  sortOrder: true,
                },
              },
            },
          },
          followUpTemplateSteps: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              templateNodeId: true,
              title: true,
              notesTemplate: true,
              dueDaysFromStart: true,
              sortOrder: true,
            },
          },
        },
      }),
    ])

    if (!contact) {
      return res.status(400).json({ error: "INVALID_CONTACT" })
    }

    if (!service) {
      return res.status(400).json({ error: "INVALID_SERVICE" })
    }

    const selectedPublishedTemplate = payload.followUpTemplateId
      ? service.followUpTemplates.find((item: any) => item.id === payload.followUpTemplateId) ?? null
      : service.followUpTemplates[0] ?? null
    if (payload.followUpTemplateId && !selectedPublishedTemplate) {
      return res.status(400).json({ error: "INVALID_FOLLOW_UP_TEMPLATE" })
    }
    const templateStepsForEnrollment =
      selectedPublishedTemplate?.steps?.length
        ? selectedPublishedTemplate.steps
        : service.followUpTemplateSteps
    if (payload.followUpTemplateId && !templateStepsForEnrollment.length) {
      return res.status(400).json({ error: "FOLLOW_UP_TEMPLATE_HAS_NO_STEPS" })
    }

    const purchasedAt = payload.purchasedAt ? new Date(payload.purchasedAt) : new Date()
    const startedAt = payload.startedAt ? new Date(payload.startedAt) : new Date()
    const totalPriceCents = service.basePriceCents
    const initialPaymentCents = payload.initialPaymentCents ?? 0

    if (initialPaymentCents < 0 || initialPaymentCents > totalPriceCents) {
      return res.status(400).json({ error: "INVALID_INITIAL_PAYMENT" })
    }

    if (initialPaymentCents > 0 && initialPaymentCents < totalPriceCents && !service.allowPartialPayments) {
      return res.status(400).json({ error: "SERVICE_DOES_NOT_ALLOW_PARTIAL_PAYMENTS" })
    }
    const sanitizedServiceNotes =
      payload.notes && payload.notes.trim().length
        ? sanitizeMultilineText(payload.notes)
        : null

    const created = await prisma.$transaction(async (tx) => {
      const prismaTx = tx as any

      const contactService = await prismaTx.contactService.create({
        data: {
          tenantId,
          contactId: payload.contactId,
          serviceId: payload.serviceId,
          followUpTemplateId: selectedPublishedTemplate?.id ?? null,
          status: "IN_PROGRESS",
          startedAt,
          purchasedAt,
          totalPriceCents,
          currency: service.currency,
          allowPartialPayments: service.allowPartialPayments,
          notes: sanitizedServiceNotes,
        },
        select: {
          id: true,
        },
      })

      if (initialPaymentCents > 0) {
        await prismaTx.contactServicePayment.create({
          data: {
            tenantId,
            contactServiceId: contactService.id,
            amountCents: initialPaymentCents,
            paidAt: purchasedAt,
            paymentMethod: null,
            note: "Initial payment",
            recordedById: authed.user.id,
          },
        })
      }

      if (service.checklistItems.length) {
        await prismaTx.contactServiceChecklistItem.createMany({
          data: service.checklistItems.map((item: { id: string }) => ({
            tenantId,
            contactServiceId: contactService.id,
            checklistItemId: item.id,
          })),
        })
      }

      if (templateStepsForEnrollment.length) {
        await prismaTx.contactServiceFollowUpStep.createMany({
          data: templateStepsForEnrollment.map((step: any, index: number) => {
            const dueAt = new Date(startedAt)
            dueAt.setDate(dueAt.getDate() + step.dueDaysFromStart)

            return {
              tenantId,
              contactServiceId: contactService.id,
              templateNodeId: step.templateNodeId ?? null,
              title: step.title,
              notesTemplate: step.notesTemplate,
              status: index === 0 ? "ACTIVE" : "PENDING",
              availableAt: index === 0 ? startedAt : dueAt,
              dueAt,
              sortOrder: step.sortOrder,
            }
          }),
        })
      }

      if (selectedPublishedTemplate?.id) {
        await executeFollowUpFromStart({
          prismaTx,
          tenantId,
          contactServiceId: contactService.id,
          actorUserId: authed.user.id,
          ignoreWaitNodes: true,
        })
      }

      return contactService
    })

    return res.status(201).json({
      ok: true,
      contactService: created,
    })
  } catch (error) {
    return next(error)
  }
})

router.get(
  "/:tenantId/contact-services/:contactServiceId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const fetchItem = async () =>
        prismaWithServices.contactService.findFirst({
          where: {
            id: contactServiceId,
            tenantId,
          },
          select: {
            id: true,
            contactId: true,
            status: true,
            startedAt: true,
            purchasedAt: true,
            completedAt: true,
            canceledAt: true,
            totalPriceCents: true,
            currency: true,
            allowPartialPayments: true,
            notes: true,
            contact: {
              select: {
                firstName: true,
                middleName: true,
                lastName: true,
              },
            },
            service: {
              select: {
                id: true,
                name: true,
                description: true,
                basePriceCents: true,
                checklistItems: {
                  select: {
                    id: true,
                    label: true,
                    description: true,
                    isRequired: true,
                    sortOrder: true,
                  },
                  orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                },
              },
            },
            followUpTemplate: {
              select: {
                id: true,
                name: true,
              },
            },
            payments: {
              select: {
                id: true,
                amountCents: true,
                paidAt: true,
                paymentMethod: true,
                note: true,
                recordedBy: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
              orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
            },
            serviceNotes: {
              select: {
                id: true,
                title: true,
                body: true,
                createdAt: true,
                createdBy: {
                  select: {
                    id: true,
                    name: true,
                    image: true,
                  },
                },
              },
              orderBy: [{ createdAt: "desc" }],
            },
            followUpSteps: {
              select: {
                id: true,
                title: true,
                notesTemplate: true,
                status: true,
                availableAt: true,
                dueAt: true,
                completedAt: true,
                assignedToUserId: true,
                note: true,
                sortOrder: true,
              },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            },
            checklistItems: {
              select: {
                id: true,
                checklistItemId: true,
                completedAt: true,
                checklistItem: {
                  select: {
                    id: true,
                    label: true,
                    description: true,
                    isRequired: true,
                    sortOrder: true,
                  },
                },
              },
              orderBy: [
                { checklistItem: { sortOrder: "asc" } },
                { createdAt: "asc" },
              ],
            },
          },
        })

      let item = await fetchItem()

      if (!item) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const syncResult = await prisma.$transaction(async (tx) => {
        const prismaTx = tx as any
        const activatedId = await syncContactServiceActiveStep({
          prismaTx,
          tenantId,
          contactServiceId: item.id,
        })

        const serviceChecklistItemIds = (item.service?.checklistItems ?? []).map(
          (checklistItem: { id: string }) => checklistItem.id,
        )
        const existingChecklistItemIds = new Set(
          (item.checklistItems ?? []).map(
            (checklistItem: { checklistItemId: string }) => checklistItem.checklistItemId,
          ),
        )
        const missingChecklistItemIds = serviceChecklistItemIds.filter(
          (checklistItemId: string) => !existingChecklistItemIds.has(checklistItemId),
        )

        if (missingChecklistItemIds.length) {
          await prismaTx.contactServiceChecklistItem.createMany({
            data: missingChecklistItemIds.map((checklistItemId: string) => ({
              tenantId,
              contactServiceId: item.id,
              checklistItemId,
            })),
            skipDuplicates: true,
          })
        }

        return {
          activatedId,
          checklistBackfilled: missingChecklistItemIds.length > 0,
        }
      })

      if (syncResult.activatedId || syncResult.checklistBackfilled) {
        item = await fetchItem()
      }

      if (!item) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const paidCents = item.payments.reduce(
        (sum: number, payment: { amountCents: number }) => sum + payment.amountCents,
        0,
      )

      return res.json({
        ok: true,
        contactService: {
          id: item.id,
          contactId: item.contactId,
          status: item.status,
          startedAt: item.startedAt,
          purchasedAt: item.purchasedAt,
          completedAt: item.completedAt,
          canceledAt: item.canceledAt,
          totalPriceCents: item.totalPriceCents,
          paidCents,
          remainingCents: Math.max(0, item.totalPriceCents - paidCents),
          currency: item.currency,
          allowPartialPayments: item.allowPartialPayments,
          notes: item.notes,
          contactName: [item.contact?.firstName, item.contact?.middleName, item.contact?.lastName]
            .filter(Boolean)
            .join(" "),
          service: item.service,
          followUpTemplate: item.followUpTemplate,
          payments: item.payments,
          serviceNotes: item.serviceNotes,
          followUpSteps: item.followUpSteps,
          checklistItems: item.checklistItems.map((checklistItem: any) => ({
            id: checklistItem.id,
            checklistItemId: checklistItem.checklistItemId,
            completedAt: checklistItem.completedAt,
            label: checklistItem.checklistItem?.label ?? "",
            description: checklistItem.checklistItem?.description ?? null,
            isRequired: Boolean(checklistItem.checklistItem?.isRequired),
            sortOrder: checklistItem.checklistItem?.sortOrder ?? 0,
          })),
        },
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.post(
  "/:tenantId/contact-services/:contactServiceId/notes",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
      const payload = CreateContactServiceNoteSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const existing = await prismaWithServices.contactService.findFirst({
        where: {
          id: contactServiceId,
          tenantId,
        },
        select: {
          id: true,
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const note = await prismaWithServices.contactServiceNote.create({
        data: {
          tenantId,
          contactServiceId,
          createdById: authed.user.id,
          title: sanitizeSingleLineText(payload.title),
          body: sanitizeMultilineText(payload.body),
        },
        select: {
          id: true,
          title: true,
          body: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      })

      return res.status(201).json({
        ok: true,
        note,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.post(
  "/:tenantId/contact-services/:contactServiceId/payments",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
      const payload = CreateContactServicePaymentSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (!canManageContactServices(membership)) {
        return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
      }

      const contactService = await prismaWithServices.contactService.findFirst({
        where: {
          id: contactServiceId,
          tenantId,
        },
        select: {
          id: true,
          totalPriceCents: true,
        },
      })

      if (!contactService) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const existingPayments = await prismaWithServices.contactServicePayment.findMany({
        where: {
          tenantId,
          contactServiceId,
        },
        select: {
          amountCents: true,
        },
      })

      const currentPaidCents = existingPayments.reduce(
        (sum: number, payment: { amountCents: number }) => sum + payment.amountCents,
        0,
      )

      if (currentPaidCents + payload.amountCents > contactService.totalPriceCents) {
        return res.status(400).json({ error: "PAYMENT_EXCEEDS_SERVICE_TOTAL" })
      }

      const payment = await prismaWithServices.contactServicePayment.create({
        data: {
          tenantId,
          contactServiceId,
          amountCents: payload.amountCents,
          paidAt: payload.paidAt ? new Date(payload.paidAt) : new Date(),
          paymentMethod:
            payload.paymentMethod && payload.paymentMethod.trim().length
              ? sanitizeSingleLineText(payload.paymentMethod)
              : null,
          note:
            payload.note && payload.note.trim().length
              ? sanitizeMultilineText(payload.note)
              : null,
          recordedById: authed.user.id,
        },
        select: {
          id: true,
          amountCents: true,
          paidAt: true,
          paymentMethod: true,
          note: true,
          recordedById: true,
        },
      })

      const summary = await summarizeContactServicePayments(
        prismaWithServices,
        tenantId,
        contactServiceId,
      )
      await reconcileContactServiceCompletionFromFollowUps(
        prismaWithServices,
        tenantId,
        contactServiceId,
      )

      return res.status(201).json({
        ok: true,
        payment,
        summary,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.patch(
  "/:tenantId/contact-services/:contactServiceId/payments/:paymentId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId, paymentId } =
        TenantContactServicePaymentPathSchema.parse(req.params)
      const payload = UpdateContactServicePaymentSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (!canManageContactServices(membership)) {
        return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
      }

      if (Object.keys(payload).length === 0) {
        return res.status(400).json({ error: "NO_CHANGES_PROVIDED" })
      }

      const existing = await prismaWithServices.contactServicePayment.findFirst({
        where: {
          id: paymentId,
          tenantId,
          contactServiceId,
        },
        select: {
          id: true,
          amountCents: true,
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "CONTACT_SERVICE_PAYMENT_NOT_FOUND" })
      }

      const contactService = await prismaWithServices.contactService.findFirst({
        where: {
          id: contactServiceId,
          tenantId,
        },
        select: {
          totalPriceCents: true,
        },
      })

      if (!contactService) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const otherPayments = await prismaWithServices.contactServicePayment.findMany({
        where: {
          tenantId,
          contactServiceId,
          id: { not: paymentId },
        },
        select: {
          amountCents: true,
        },
      })

      const otherPaidCents = otherPayments.reduce(
        (sum: number, payment: { amountCents: number }) => sum + payment.amountCents,
        0,
      )
      const nextAmountCents = payload.amountCents ?? existing.amountCents

      if (otherPaidCents + nextAmountCents > contactService.totalPriceCents) {
        return res.status(400).json({ error: "PAYMENT_EXCEEDS_SERVICE_TOTAL" })
      }

      const payment = await prismaWithServices.contactServicePayment.update({
        where: { id: paymentId },
        data: {
          ...(payload.amountCents !== undefined ? { amountCents: payload.amountCents } : {}),
          ...(payload.paidAt !== undefined ? { paidAt: new Date(payload.paidAt) } : {}),
          ...(payload.paymentMethod !== undefined
            ? {
                paymentMethod:
                  payload.paymentMethod && payload.paymentMethod.trim().length
                    ? sanitizeSingleLineText(payload.paymentMethod)
                    : null,
              }
            : {}),
          ...(payload.note !== undefined
            ? {
                note:
                  payload.note && payload.note.trim().length
                    ? sanitizeMultilineText(payload.note)
                    : null,
              }
            : {}),
        },
        select: {
          id: true,
          amountCents: true,
          paidAt: true,
          paymentMethod: true,
          note: true,
          recordedById: true,
        },
      })

      const summary = await summarizeContactServicePayments(
        prismaWithServices,
        tenantId,
        contactServiceId,
      )
      await reconcileContactServiceCompletionFromFollowUps(
        prismaWithServices,
        tenantId,
        contactServiceId,
      )

      return res.json({
        ok: true,
        payment,
        summary,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.delete(
  "/:tenantId/contact-services/:contactServiceId/payments/:paymentId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId, paymentId } =
        TenantContactServicePaymentPathSchema.parse(req.params)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (!canManageContactServices(membership)) {
        return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
      }

      const existing = await prismaWithServices.contactServicePayment.findFirst({
        where: {
          id: paymentId,
          tenantId,
          contactServiceId,
        },
        select: {
          id: true,
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "CONTACT_SERVICE_PAYMENT_NOT_FOUND" })
      }

      await prismaWithServices.contactServicePayment.delete({
        where: { id: paymentId },
      })

      const summary = await summarizeContactServicePayments(
        prismaWithServices,
        tenantId,
        contactServiceId,
      )
      await reconcileContactServiceCompletionFromFollowUps(
        prismaWithServices,
        tenantId,
        contactServiceId,
      )

      return res.json({
        ok: true,
        summary,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.patch(
  "/:tenantId/contact-services/:contactServiceId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
      const payload = UpdateContactServiceSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (Object.keys(payload).length === 0) {
        return res.status(400).json({ error: "NO_CHANGES_PROVIDED" })
      }

      if (!canManageContactServices(membership)) {
        return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
      }

      const existing = await prismaWithServices.contactService.findFirst({
        where: {
          id: contactServiceId,
          tenantId,
        },
        select: {
          id: true,
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const statusUpdate =
        payload.status === undefined
          ? {}
          : payload.status === "COMPLETED"
            ? {
                status: "COMPLETED" as const,
                completedAt: payload.completedAt ? new Date(payload.completedAt) : new Date(),
                canceledAt: null,
              }
            : payload.status === "CANCELED"
              ? {
                  status: "CANCELED" as const,
                  canceledAt: payload.canceledAt ? new Date(payload.canceledAt) : new Date(),
                  completedAt: null,
                }
              : {
                  status: payload.status,
                  completedAt: null,
                  canceledAt: null,
                }

      const updated = await prismaWithServices.contactService.update({
        where: { id: contactServiceId },
        data: {
          ...statusUpdate,
          ...(payload.startedAt !== undefined
            ? { startedAt: payload.startedAt ? new Date(payload.startedAt) : null }
            : {}),
          ...(payload.purchasedAt !== undefined
            ? { purchasedAt: payload.purchasedAt ? new Date(payload.purchasedAt) : null }
            : {}),
          ...(payload.notes !== undefined
            ? {
                notes:
                  payload.notes && payload.notes.trim().length
                    ? sanitizeMultilineText(payload.notes)
                    : null,
              }
            : {}),
        },
        select: {
          id: true,
          status: true,
          startedAt: true,
          purchasedAt: true,
          completedAt: true,
          canceledAt: true,
          totalPriceCents: true,
          notes: true,
        },
      })

      return res.json({
        ok: true,
        contactService: updated,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.delete(
  "/:tenantId/contact-services/:contactServiceId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (!canManageContactServices(membership)) {
        return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
      }

      const existing = await prismaWithServices.contactService.findFirst({
        where: {
          id: contactServiceId,
          tenantId,
        },
        select: {
          id: true,
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      await prismaWithServices.contactService.delete({
        where: { id: contactServiceId },
      })

      return res.json({ ok: true })
    } catch (error) {
      return next(error)
    }
  },
)

router.patch(
  "/:tenantId/contact-services/:contactServiceId/checklist-items/:checklistItemId",
  requireAuth,
  async (req, res, next) => {
    try {
      const { tenantId, contactServiceId, checklistItemId } =
        TenantContactServiceChecklistItemPathSchema.parse(req.params)
      const payload = UpdateContactServiceChecklistItemSchema.parse(req.body)

      const membership = await requireActiveMembership(req as AuthedRequest, res, tenantId)
      if (!membership) return

      if (payload.completed === undefined) {
        return res.status(400).json({ error: "NO_CHANGES_PROVIDED" })
      }

      const existing = await prismaWithServices.contactServiceChecklistItem.findFirst({
        where: {
          id: checklistItemId,
          tenantId,
          contactServiceId,
        },
        select: {
          id: true,
          checklistItemId: true,
          completedAt: true,
          checklistItem: {
            select: {
              id: true,
              label: true,
              description: true,
              isRequired: true,
              sortOrder: true,
            },
          },
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "CONTACT_SERVICE_CHECKLIST_ITEM_NOT_FOUND" })
      }

      const updated = await prismaWithServices.contactServiceChecklistItem.update({
        where: { id: checklistItemId },
        data: {
          completedAt: payload.completed ? new Date() : null,
        },
        select: {
          id: true,
          checklistItemId: true,
          completedAt: true,
          checklistItem: {
            select: {
              id: true,
              label: true,
              description: true,
              isRequired: true,
              sortOrder: true,
            },
          },
        },
      })

      return res.json({
        ok: true,
        checklistItem: {
          id: updated.id,
          checklistItemId: updated.checklistItemId,
          completedAt: updated.completedAt,
          label: updated.checklistItem?.label ?? "",
          description: updated.checklistItem?.description ?? null,
          isRequired: Boolean(updated.checklistItem?.isRequired),
          sortOrder: updated.checklistItem?.sortOrder ?? 0,
        },
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.patch(
  "/:tenantId/contact-services/:contactServiceId/follow-up-steps/:followUpStepId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId, followUpStepId } = TenantFollowUpStepPathSchema.parse(
        req.params,
      )
      const payload = UpdateFollowUpStepSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (payload.assignedToUserId) {
        const assigneeMembership = await prisma.membership.findUnique({
          where: {
            userId_tenantId: {
              userId: payload.assignedToUserId,
              tenantId,
            },
          },
          select: {
            status: true,
          },
        })

        if (!assigneeMembership || assigneeMembership.status !== "ACTIVE") {
          return res.status(400).json({ error: "INVALID_ASSIGNEE" })
        }
      }

      const existing = await prismaWithServices.contactServiceFollowUpStep.findFirst({
        where: {
          id: followUpStepId,
          tenantId,
          contactServiceId,
        },
        select: {
          id: true,
          status: true,
          completedAt: true,
          dueAt: true,
          availableAt: true,
          sortOrder: true,
          templateNodeId: true,
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "FOLLOW_UP_STEP_NOT_FOUND" })
      }
      if (
        existing.status !== "ACTIVE" &&
        (payload.status !== undefined || payload.postponeTo !== undefined)
      ) {
        return res.status(409).json({ error: "STEP_STATUS_LOCKED_UNTIL_ACTIVE" })
      }

      const statusUpdate =
        payload.status === undefined
          ? payload.completedAt === undefined
            ? {}
            : payload.completedAt
              ? {
                  status: "COMPLETED" as const,
                  completedAt: new Date(payload.completedAt),
                }
              : {
                  status: existing.status === "SKIPPED" ? "SKIPPED" : "ACTIVE",
                  completedAt: null,
                }
          : payload.status === "COMPLETED"
            ? {
                status: "COMPLETED" as const,
                completedAt: payload.completedAt ? new Date(payload.completedAt) : new Date(),
              }
            : {
                status: payload.status,
                completedAt: null,
              }

      const postponeToDate = payload.postponeTo ? new Date(payload.postponeTo) : null
      if (payload.postponeTo && Number.isNaN(postponeToDate?.getTime() ?? NaN)) {
        return res.status(400).json({ error: "INVALID_POSTPONE_DATE" })
      }

      let updated: any
      await prisma.$transaction(async (tx) => {
        const prismaTx = tx as any

        updated = await prismaTx.contactServiceFollowUpStep.update({
          where: {
            id: followUpStepId,
          },
          data: {
            ...(payload.title !== undefined ? { title: sanitizeSingleLineText(payload.title) } : {}),
            ...(payload.notesTemplate !== undefined
              ? {
                  notesTemplate:
                    payload.notesTemplate && payload.notesTemplate.trim().length
                      ? sanitizeMultilineText(payload.notesTemplate)
                      : null,
                }
              : {}),
            ...statusUpdate,
            ...(payload.availableAt !== undefined
              ? { availableAt: payload.availableAt ? new Date(payload.availableAt) : null }
              : {}),
            ...(payload.dueAt !== undefined
              ? { dueAt: payload.dueAt ? new Date(payload.dueAt) : null }
              : {}),
            ...(postponeToDate ? { dueAt: postponeToDate } : {}),
            ...(payload.assignedToUserId !== undefined
              ? { assignedToUserId: payload.assignedToUserId || null }
              : {}),
            ...(payload.note !== undefined
              ? {
                  note:
                    payload.note && payload.note.trim().length
                      ? sanitizeMultilineText(payload.note)
                      : null,
                }
              : {}),
            ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
          },
          select: {
            id: true,
            title: true,
            notesTemplate: true,
            status: true,
            availableAt: true,
            dueAt: true,
            completedAt: true,
            assignedToUserId: true,
            note: true,
            sortOrder: true,
            templateNodeId: true,
          },
        })

        const contactServiceRecord = await prismaTx.contactService.findUnique({
          where: { id: contactServiceId },
          select: {
            contactId: true,
            followUpTemplateId: true,
          },
        })

        if (
          contactServiceRecord?.followUpTemplateId &&
          (payload.status !== undefined || payload.completedAt !== undefined || payload.postponeTo !== undefined)
        ) {
          await prismaTx.serviceFollowUpExecutionLog.create({
            data: {
              tenantId,
              templateId: contactServiceRecord.followUpTemplateId,
              contactServiceId,
              contactId: contactServiceRecord.contactId,
              actorUserId: authed.user.id,
              flowNodeId: updated.templateNodeId ?? null,
              stepId: updated.id,
              eventType: "STEP_STATUS_UPDATED",
              title: `Updated step status: ${updated.title}`,
              details: `Step moved to ${updated.status.toLowerCase().replace(/_/g, " ")}.`,
              payload: {
                status: updated.status,
                dueAt: updated.dueAt,
                completedAt: updated.completedAt,
                postponeTo: payload.postponeTo ?? null,
              },
            },
          })
        }

        if (updated.status === "ACTIVE") {
          await prismaTx.contactServiceFollowUpStep.updateMany({
            where: {
              tenantId,
              contactServiceId,
              id: { not: followUpStepId },
              status: "ACTIVE",
            },
            data: {
              status: "PENDING",
            },
          })
        }

        if (postponeToDate && existing.dueAt) {
          const shiftMs = postponeToDate.getTime() - existing.dueAt.getTime()
          const shouldCascade = payload.cascadeFutureSteps !== false

          if (shouldCascade && shiftMs !== 0) {
            const futureSteps = await prismaTx.contactServiceFollowUpStep.findMany({
              where: {
                tenantId,
                contactServiceId,
                sortOrder: { gt: existing.sortOrder },
                status: { in: ["PENDING", "ACTIVE"] },
              },
              orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
              select: {
                id: true,
                dueAt: true,
                availableAt: true,
              },
            })

            for (const futureStep of futureSteps) {
              await prismaTx.contactServiceFollowUpStep.update({
                where: { id: futureStep.id },
                data: {
                  ...(futureStep.dueAt
                    ? { dueAt: new Date(futureStep.dueAt.getTime() + shiftMs) }
                    : {}),
                  ...(futureStep.availableAt
                    ? { availableAt: new Date(futureStep.availableAt.getTime() + shiftMs) }
                    : {}),
                },
              })
            }
          }
        }

        if (
          existing.status === "ACTIVE" &&
          (updated.status === "COMPLETED" || updated.status === "SKIPPED")
        ) {
          await executeFollowUpFromStep({
            prismaTx,
            tenantId,
            contactServiceId,
            completedStepId: followUpStepId,
            completedStepSortOrder: existing.sortOrder,
            completedStepTemplateNodeId: existing.templateNodeId,
            actorUserId: authed.user.id,
            ignoreWaitNodes: true,
          })
          await syncContactServiceActiveStep({
            prismaTx,
            tenantId,
            contactServiceId,
          })
        }
      })

      return res.json({
        ok: true,
        followUpStep: updated,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.post(
  "/:tenantId/contact-services/:contactServiceId/follow-up-steps",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId } = TenantContactServicePathSchema.parse(req.params)
      const payload = CreateFollowUpStepSchema.parse(req.body)

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      if (payload.assignedToUserId) {
        const assigneeMembership = await prisma.membership.findUnique({
          where: {
            userId_tenantId: {
              userId: payload.assignedToUserId,
              tenantId,
            },
          },
          select: {
            status: true,
          },
        })

        if (!assigneeMembership || assigneeMembership.status !== "ACTIVE") {
          return res.status(400).json({ error: "INVALID_ASSIGNEE" })
        }
      }

      const contactService = await prismaWithServices.contactService.findFirst({
        where: {
          id: contactServiceId,
          tenantId,
        },
        select: {
          id: true,
        },
      })

      if (!contactService) {
        return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
      }

      const maxSortOrder = await prismaWithServices.contactServiceFollowUpStep.findFirst({
        where: {
          tenantId,
          contactServiceId,
        },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      })
      const hasActiveStep = await prismaWithServices.contactServiceFollowUpStep.findFirst({
        where: {
          tenantId,
          contactServiceId,
          status: "ACTIVE",
        },
        select: { id: true },
      })

      const nextStatus = payload.status ?? (hasActiveStep ? "PENDING" : "ACTIVE")
      const nextDueAt = payload.dueAt ? new Date(payload.dueAt) : null
      const nextAvailableAt =
        payload.availableAt !== undefined
          ? payload.availableAt
            ? new Date(payload.availableAt)
            : null
          : nextStatus === "ACTIVE"
            ? new Date()
            : nextDueAt

      const created = await prismaWithServices.contactServiceFollowUpStep.create({
        data: {
          tenantId,
          contactServiceId,
          title: sanitizeSingleLineText(payload.title),
          notesTemplate:
            payload.notesTemplate && payload.notesTemplate.trim().length
              ? sanitizeMultilineText(payload.notesTemplate)
              : null,
          status: nextStatus,
          availableAt: nextAvailableAt,
          dueAt: nextDueAt,
          completedAt: nextStatus === "COMPLETED" ? new Date() : null,
          assignedToUserId: payload.assignedToUserId || null,
          note:
            payload.note && payload.note.trim().length
              ? sanitizeMultilineText(payload.note)
              : null,
          sortOrder: payload.sortOrder ?? (maxSortOrder?.sortOrder ?? 0) + 10,
        },
        select: {
          id: true,
          title: true,
          notesTemplate: true,
          status: true,
          availableAt: true,
          dueAt: true,
          completedAt: true,
          assignedToUserId: true,
          note: true,
          sortOrder: true,
        },
      })

      return res.status(201).json({
        ok: true,
        followUpStep: created,
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.delete(
  "/:tenantId/contact-services/:contactServiceId/follow-up-steps/:followUpStepId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, contactServiceId, followUpStepId } = TenantFollowUpStepPathSchema.parse(
        req.params,
      )

      const membership = await requireActiveMembership(authed, res, tenantId)
      if (!membership) return

      const existing = await prismaWithServices.contactServiceFollowUpStep.findFirst({
        where: {
          id: followUpStepId,
          tenantId,
          contactServiceId,
        },
        select: {
          id: true,
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "FOLLOW_UP_STEP_NOT_FOUND" })
      }

      await prismaWithServices.contactServiceFollowUpStep.delete({
        where: { id: followUpStepId },
      })

      return res.json({ ok: true })
    } catch (error) {
      return next(error)
    }
  },
)

export default router
