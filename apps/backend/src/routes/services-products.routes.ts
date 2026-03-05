import { type Response, Router } from "express"
import { z } from "zod"

import { prisma } from "../lib/prisma.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"

const router = Router()
const prismaWithLinkedEntities = prisma as any

const TenantPathSchema = z.object({
  tenantId: z.string().min(1),
})

const TenantEntityPathSchema = TenantPathSchema.extend({
  entityId: z.string().min(1),
})

const LinkedEntityTypeSchema = z.enum(["SERVICE", "PRODUCT"])

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25, {
      message: "pageSize must be 10 or 25",
    })
    .default(10),
  search: z.string().trim().max(120).optional().default(""),
  type: LinkedEntityTypeSchema.optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => {
      if (value === "true") return true
      if (value === "false") return false
      return undefined
    }),
})

const OptionsQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
  type: LinkedEntityTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const CreateLinkedEntitySchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: LinkedEntityTypeSchema,
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
})

const UpdateLinkedEntitySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: LinkedEntityTypeSchema.optional(),
  isActive: z.boolean().optional(),
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
      securityLevel: true,
    },
  })

  if (!membership || membership.status !== "ACTIVE") {
    res.status(403).json({ error: "TENANT_ACCESS_DENIED" })
    return null
  }

  return membership
}

function canManageLinkedEntities(membership: {
  role: string
  securityLevel: "LOW" | "MEDIUM" | "MAX"
}) {
  return membership.role === "TENANT_ADMIN" || membership.securityLevel !== "LOW"
}

router.get("/:tenantId/options", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const { q, type, limit } = OptionsQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const items = await prismaWithLinkedEntities.tenantLinkedEntity.findMany({
      where: {
        tenantId,
        isActive: true,
        ...(type ? { type } : {}),
        ...(q
          ? {
              name: {
                contains: q,
                mode: "insensitive" as const,
              },
            }
          : {}),
      },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      take: limit,
      select: {
        id: true,
        name: true,
        type: true,
      },
    })

    return res.json({
      ok: true,
      items: items.map((item: any) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        label: `${item.type === "SERVICE" ? "Service" : "Product"}: ${item.name}`,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const { page, pageSize, search, type, isActive } = ListQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const skip = (page - 1) * pageSize

    const where = {
      tenantId,
      ...(type ? { type } : {}),
      ...(typeof isActive === "boolean" ? { isActive } : {}),
      ...(search
        ? {
            name: {
              contains: search,
              mode: "insensitive" as const,
            },
          }
        : {}),
    }

    const [total, items] = await prisma.$transaction([
      prismaWithLinkedEntities.tenantLinkedEntity.count({ where }),
      prismaWithLinkedEntities.tenantLinkedEntity.findMany({
        where,
        orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          type: true,
          isActive: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ])

    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    return res.json({
      ok: true,
      items,
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
    const payload = CreateLinkedEntitySchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    if (!canManageLinkedEntities(membership)) {
      return res.status(403).json({ error: "INSUFFICIENT_PERMISSIONS" })
    }

    const item = await prismaWithLinkedEntities.tenantLinkedEntity.create({
      data: {
        tenantId,
        name: payload.name,
        type: payload.type,
        isActive: payload.isActive,
        sortOrder: payload.sortOrder ?? 0,
      },
      select: {
        id: true,
        name: true,
        type: true,
        isActive: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return res.status(201).json({
      ok: true,
      item,
    })
  } catch (error) {
    return next(error)
  }
})

router.patch("/:tenantId/:entityId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, entityId } = TenantEntityPathSchema.parse(req.params)
    const payload = UpdateLinkedEntitySchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    if (!canManageLinkedEntities(membership)) {
      return res.status(403).json({ error: "INSUFFICIENT_PERMISSIONS" })
    }

    const existing = await prismaWithLinkedEntities.tenantLinkedEntity.findFirst({
      where: {
        id: entityId,
        tenantId,
      },
      select: { id: true },
    })

    if (!existing) {
      return res.status(404).json({ error: "ENTITY_NOT_FOUND" })
    }

    const item = await prismaWithLinkedEntities.tenantLinkedEntity.update({
      where: { id: entityId },
      data: {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.type !== undefined ? { type: payload.type } : {}),
        ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
        ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
      },
      select: {
        id: true,
        name: true,
        type: true,
        isActive: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return res.json({
      ok: true,
      item,
    })
  } catch (error) {
    return next(error)
  }
})

router.delete("/:tenantId/:entityId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, entityId } = TenantEntityPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    if (!canManageLinkedEntities(membership)) {
      return res.status(403).json({ error: "INSUFFICIENT_PERMISSIONS" })
    }

    const existing = await prismaWithLinkedEntities.tenantLinkedEntity.findFirst({
      where: {
        id: entityId,
        tenantId,
      },
      select: { id: true },
    })

    if (!existing) {
      return res.status(404).json({ error: "ENTITY_NOT_FOUND" })
    }

    await prismaWithLinkedEntities.tenantLinkedEntity.delete({
      where: { id: entityId },
    })

    return res.status(204).send()
  } catch (error) {
    return next(error)
  }
})

export default router
