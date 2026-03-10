import { type Response, Router } from "express"
import { z } from "zod"

import { prisma } from "../lib/prisma.js"
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

const TenantFollowUpStepPathSchema = TenantContactServicePathSchema.extend({
  followUpStepId: z.string().min(1),
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
  paymentMethod: z.string().trim().max(120).nullable().optional(),
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

const UpdateFollowUpStepSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notesTemplate: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "SKIPPED"]).optional(),
  availableAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  assignedToUserId: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
})

const CreateFollowUpStepSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notesTemplate: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "SKIPPED"]).optional(),
  availableAt: z.string().datetime().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assignedToUserId: z.string().trim().min(1).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
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
    },
  })

  if (!membership || membership.status !== "ACTIVE") {
    res.status(403).json({ error: "TENANT_ACCESS_DENIED" })
    return null
  }

  return membership
}

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

    const [total, items] = await prisma.$transaction([
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
              status: true,
              availableAt: true,
              dueAt: true,
              completedAt: true,
              assignedToUserId: true,
              sortOrder: true,
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
        },
      }),
    ])

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
          followUpSteps: item.followUpSteps,
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
          followUpTemplates: {
            where: { isPublished: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              steps: {
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                select: {
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

    const purchasedAt = payload.purchasedAt ? new Date(payload.purchasedAt) : new Date()
    const startedAt = payload.startedAt ? new Date(payload.startedAt) : new Date()
    const totalPriceCents = payload.totalPriceCents ?? service.basePriceCents
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

      if (payload.initialPaymentCents && payload.initialPaymentCents > 0) {
        await prismaTx.contactServicePayment.create({
          data: {
            tenantId,
            contactServiceId: contactService.id,
            amountCents: payload.initialPaymentCents,
            paidAt: purchasedAt,
            paymentMethod: null,
            note: "Initial payment",
            recordedById: authed.user.id,
          },
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
              title: step.title,
              notesTemplate: step.notesTemplate,
              status: index === 0 ? "ACTIVE" : "PENDING",
              availableAt: dueAt,
              dueAt,
              sortOrder: step.sortOrder,
            }
          }),
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

      const payments = await prismaWithServices.contactServicePayment.findMany({
        where: {
          tenantId,
          contactServiceId,
        },
        select: {
          amountCents: true,
        },
      })

      const totalPaidCents = payments.reduce(
        (sum: number, entry: { amountCents: number }) => sum + entry.amountCents,
        0,
      )

      if (totalPaidCents >= contactService.totalPriceCents) {
        await prismaWithServices.contactService.update({
          where: { id: contactServiceId },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
          },
        })
      }

      return res.status(201).json({
        ok: true,
        payment,
        summary: {
          totalPriceCents: contactService.totalPriceCents,
          paidCents: totalPaidCents,
          remainingCents: Math.max(0, contactService.totalPriceCents - totalPaidCents),
        },
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
          ...(payload.totalPriceCents !== undefined
            ? { totalPriceCents: payload.totalPriceCents }
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
        },
      })

      if (!existing) {
        return res.status(404).json({ error: "FOLLOW_UP_STEP_NOT_FOUND" })
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

      const updated = await prismaWithServices.contactServiceFollowUpStep.update({
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
        },
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
