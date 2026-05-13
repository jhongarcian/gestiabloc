import { type Response, Router } from "express"
import { z } from "zod"

import { prisma } from "../lib/prisma.js"
import { enforceSameOrigin } from "../lib/security.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"

const router = Router()

const TenantPathSchema = z.object({
  tenantId: z.string().trim().min(1),
})

const TenantPipelinePathSchema = TenantPathSchema.extend({
  pipelineId: z.string().trim().min(1),
})

const TenantStagePathSchema = TenantPipelinePathSchema.extend({
  stageId: z.string().trim().min(1),
})

const TenantOpportunityPathSchema = TenantPathSchema.extend({
  opportunityId: z.string().trim().min(1),
})

const TenantContactPathSchema = TenantPathSchema.extend({
  contactId: z.string().trim().min(1),
})

function sanitizeSearchQuery(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeSearchValue(value: string | null | undefined) {
  return sanitizeSearchQuery(value ?? "").toLocaleLowerCase()
}

function getSearchTokens(value: string | null | undefined) {
  return normalizeSearchValue(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
}

function normalizePhoneSearchValue(value: string | null | undefined) {
  return (value ?? "").replace(/\D+/g, "")
}

function buildStartsWithClauses(
  fields: string[],
  value: string,
  options?: { broad?: boolean },
) {
  const normalizedValue = normalizeSearchValue(value)
  if (!normalizedValue) return []

  const values = options?.broad
    ? [...new Set([normalizedValue, ...getSearchTokens(normalizedValue)])]
    : [normalizedValue]

  return fields.flatMap((field) =>
    [...new Set(values)].map((candidate) => ({
      [field]: { startsWith: candidate, mode: "insensitive" as const },
    })),
  )
}

function buildOpportunityContactSearchWhere(query: string) {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) return undefined

  const queryTokens = getSearchTokens(query)
  const hasPhoneLikeQuery = normalizePhoneSearchValue(query).length >= 3
  const nameTokens = queryTokens.filter((token) => /[a-z]/i.test(token))

  if (!hasPhoneLikeQuery && nameTokens.length >= 2) {
    const firstToken = nameTokens[0]!
    const lastToken = nameTokens[nameTokens.length - 1]!
    const middleTokens = nameTokens.slice(1, -1)

    const andClauses: Array<Record<string, unknown>> = [
      {
        OR: buildStartsWithClauses(["firstName", "middleName"], firstToken, {
          broad: true,
        }),
      },
      {
        OR:
          nameTokens.length === 2
            ? buildStartsWithClauses(["lastName", "middleName"], lastToken)
            : buildStartsWithClauses(["lastName"], lastToken),
      },
    ]

    for (const token of middleTokens) {
      andClauses.push({
        OR: buildStartsWithClauses(["middleName"], token),
      })
    }

    return { AND: andClauses }
  }

  const singleTokenTerms = [...new Set([normalizedQuery, ...queryTokens].filter(Boolean))]

  return {
    OR: singleTokenTerms.flatMap((term) => [
      ...buildStartsWithClauses(["firstName", "middleName", "lastName"], term, {
        broad: true,
      }),
      { phone: { contains: term, mode: "insensitive" as const } },
    ]),
  }
}

const parseCsvIds = (value: string | undefined | null): string[] => {
  if (!value || typeof value !== "string") return []
  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
}

const CustomFieldFilterSchema = z.object({
  fieldId: z.string().trim().min(1),
  type: z.enum(["text", "number", "currency", "date", "select", "multi_select", "checkbox"]),
  text: z.string().trim().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  dateFrom: z.string().trim().optional(),
  dateTo: z.string().trim().optional(),
  values: z.array(z.string()).optional(),
  checked: z.boolean().optional(),
})

const OpportunityBoardQuerySchema = z.object({
  search: z.preprocess(
    (value) => (typeof value === "string" ? sanitizeSearchQuery(value) : value),
    z.string().max(120).optional().default(""),
  ),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 5 || value === 10 || value === 25, {
      message: "pageSize must be 5, 10, or 25",
    })
    .default(10),
  tagIds: z.string().trim().max(2000).optional().default(""),
  statusConfigIds: z.string().trim().max(2000).optional().default(""),
  assignedToUserIds: z.string().trim().max(2000).optional().default(""),
  customFieldFilters: z
    .preprocess((value) => {
      if (typeof value === "string") {
        try {
          return JSON.parse(value)
        } catch {
          return []
        }
      }
      return value
    }, z.array(CustomFieldFilterSchema))
    .optional()
    .default([]),
})

const StageCardsPaginationSchema = z.object({
  search: z.preprocess(
    (value) => (typeof value === "string" ? sanitizeSearchQuery(value) : value),
    z.string().max(120).optional().default(""),
  ),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 5 || value === 10 || value === 25, {
      message: "pageSize must be 5, 10, or 25",
    })
    .default(10),
  tagIds: z.string().trim().max(2000).optional().default(""),
  statusConfigIds: z.string().trim().max(2000).optional().default(""),
  assignedToUserIds: z.string().trim().max(2000).optional().default(""),
  customFieldFilters: z
    .preprocess((value) => {
      if (typeof value === "string") {
        try {
          return JSON.parse(value)
        } catch {
          return []
        }
      }
      return value
    }, z.array(CustomFieldFilterSchema))
    .optional()
    .default([]),
})

const CreateOpportunitySchema = z.object({
  contactId: z.string().trim().min(1),
  pipelineId: z.string().trim().min(1),
  valueCents: z.coerce.number().int().min(0).default(0),
})

const MoveOpportunitySchema = z
  .object({
  stageId: z.string().trim().min(1),
  })
  .strict()

const CloseOpportunitySchema = z
  .object({
    result: z.enum(["WON", "LOST"]),
  })
  .strict()

const UpdateOpportunitySchema = z.union([MoveOpportunitySchema, CloseOpportunitySchema])

async function requireActiveMembership(
  authed: AuthedRequest,
  res: Response,
  tenantId: string,
) {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_tenantId: {
        userId: authed.user.id,
        tenantId,
      },
    },
  })

  if (!membership || membership.status !== "ACTIVE") {
    res.status(403).json({ error: "FORBIDDEN" })
    return null
  }

  return membership
}

function buildContactFullName(contact: {
  firstName: string
  middleName: string | null
  lastName: string
}) {
  return [contact.firstName, contact.middleName, contact.lastName]
    .filter(Boolean)
    .join(" ")
    .trim()
}

const opportunityCardSelect = {
  id: true,
  tenantId: true,
  contactId: true,
  pipelineId: true,
  stageId: true,
  valueCents: true,
  result: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  contact: {
    select: {
      id: true,
      firstName: true,
      middleName: true,
      lastName: true,
      email: true,
      phone: true,
      assignedToMembership: {
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
      },
    },
  },
} as const

function serializeOpportunityCard(
  opportunity: {
    id: string
    tenantId: string
    contactId: string
    pipelineId: string
    stageId: string
    valueCents: number
    result: "OPEN" | "WON" | "LOST"
    closedAt: Date | null
    createdAt: Date
    updatedAt: Date
    contact: {
      id: string
      firstName: string
      middleName: string | null
      lastName: string
      email: string | null
      phone: string | null
      assignedToMembership: {
        userId: string
        user: {
          name: string
          email: string
          image: string | null
        }
      } | null
    }
  },
) {
  return {
    id: opportunity.id,
    tenantId: opportunity.tenantId,
    contactId: opportunity.contactId,
    pipelineId: opportunity.pipelineId,
    stageId: opportunity.stageId,
    valueCents: opportunity.valueCents,
    result: opportunity.result,
    closedAt: opportunity.closedAt,
    createdAt: opportunity.createdAt,
    updatedAt: opportunity.updatedAt,
    contact: {
      id: opportunity.contact.id,
      fullName: buildContactFullName(opportunity.contact),
      email: opportunity.contact.email ?? null,
      phoneNumber: opportunity.contact.phone ?? null,
    },
    assignedTo: opportunity.contact.assignedToMembership
      ? {
          userId: opportunity.contact.assignedToMembership.userId,
          name: opportunity.contact.assignedToMembership.user.name,
          email: opportunity.contact.assignedToMembership.user.email,
          image: opportunity.contact.assignedToMembership.user.image ?? null,
        }
      : null,
  }
}

function buildOpenOpportunityWhere(
  params: {
    tenantId: string
    pipelineId?: string
    stageId?: string
    search?: string
    tagIds?: string[]
    statusConfigIds?: string[]
    assignedToUserIds?: string[]
    customFieldFilters?: Array<{
      fieldId: string
      type: string
      text?: string
      min?: number
      max?: number
      dateFrom?: string
      dateTo?: string
      values?: string[]
      checked?: boolean
    }>
  },
) {
  const contactWhere = buildOpportunityContactSearchWhere(params.search ?? "")

  const tagIds = params.tagIds ?? []
  const statusConfigIds = params.statusConfigIds ?? []
  const assignedToUserIds = params.assignedToUserIds ?? []
  const customFieldFilters = params.customFieldFilters ?? []

  const contactFilters: Record<string, unknown> = {}

  if (tagIds.length > 0) {
    contactFilters.tags = {
      some: {
        tagId: {
          in: tagIds,
        },
      },
    }
  }

  if (statusConfigIds.length > 0) {
    contactFilters.statusConfigId = {
      in: statusConfigIds,
    }
  }

  if (assignedToUserIds.length > 0) {
    contactFilters.assignedToUserId = {
      in: assignedToUserIds,
    }
  }

  if (customFieldFilters.length > 0) {
    const customFieldConditions = customFieldFilters
      .map((filter) => {
        switch (filter.type) {
          case "text": {
            if (!filter.text) return null
            return {
              fieldId: filter.fieldId,
              value: {
                string_contains: filter.text,
              },
            }
          }
          case "number":
          case "currency": {
            const conditions: Array<Record<string, unknown>> = []
            if (filter.min !== undefined) {
              conditions.push({
                fieldId: filter.fieldId,
                value: { gte: filter.min },
              })
            }
            if (filter.max !== undefined) {
              conditions.push({
                fieldId: filter.fieldId,
                value: { lte: filter.max },
              })
            }
            return conditions.length > 0 ? { AND: conditions } : null
          }
          case "date": {
            const conditions: Array<Record<string, unknown>> = []
            if (filter.dateFrom) {
              conditions.push({
                fieldId: filter.fieldId,
                value: { gte: filter.dateFrom },
              })
            }
            if (filter.dateTo) {
              conditions.push({
                fieldId: filter.fieldId,
                value: { lte: filter.dateTo },
              })
            }
            return conditions.length > 0 ? { AND: conditions } : null
          }
          case "select":
          case "radio": {
            if (!filter.values || filter.values.length === 0) return null
            return {
              fieldId: filter.fieldId,
              value: { equals: filter.values[0] },
            }
          }
          case "multi_select": {
            if (!filter.values || filter.values.length === 0) return null
            return {
              fieldId: filter.fieldId,
              value: {
                array_contains: filter.values,
              },
            }
          }
          case "checkbox": {
            if (filter.checked === undefined) return null
            return {
              fieldId: filter.fieldId,
              value: { equals: filter.checked },
            }
          }
          default:
            return null
        }
      })
      .filter(Boolean)

    if (customFieldConditions.length > 0) {
      contactFilters.customFieldValues = {
        some: {
          OR: customFieldConditions,
        },
      }
    }
  }

  const hasContactFilters = Object.keys(contactFilters).length > 0

  return {
    tenantId: params.tenantId,
    result: "OPEN" as const,
    ...(params.pipelineId ? { pipelineId: params.pipelineId } : {}),
    ...(params.stageId ? { stageId: params.stageId } : {}),
    contact: {
      ...contactWhere,
      ...(hasContactFilters ? contactFilters : {}),
    },
  }
}

async function getPipelineOpportunityCounts(tenantId: string) {
  const counts = await prisma.contactOpportunity.groupBy({
    by: ["pipelineId"],
    where: {
      tenantId,
      result: "OPEN",
    },
    _count: {
      _all: true,
    },
  })

  return new Map(counts.map((item) => [item.pipelineId, item._count._all]))
}

async function getPipelineStageSummaries(
  tenantId: string,
  pipelineId: string,
  search: string,
  filters?: {
    tagIds?: string[]
    statusConfigIds?: string[]
    assignedToUserIds?: string[]
    customFieldFilters?: Array<{ fieldId: string; value: string }>
  },
) {
  const summaries = await prisma.contactOpportunity.groupBy({
    by: ["stageId"],
    where: buildOpenOpportunityWhere({
      tenantId,
      pipelineId,
      search,
      ...filters,
    }),
    _count: {
      _all: true,
    },
    _sum: {
      valueCents: true,
    },
  })

  return new Map(
    summaries.map((item) => [
      item.stageId,
      {
        count: item._count._all,
        totalValueCents: item._sum.valueCents ?? 0,
      },
    ]),
  )
}

router.get("/:tenantId/pipelines", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    if (!(await requireActiveMembership(authed, res, tenantId))) return

    const [items, opportunityCounts] = await Promise.all([
      prisma.opportunityPipeline.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          color: true,
          sortOrder: true,
          _count: {
            select: {
              stages: true,
            },
          },
        },
      }),
      getPipelineOpportunityCounts(tenantId),
    ])

    return res.json({
      ok: true,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        color: item.color,
        sortOrder: item.sortOrder,
        stageCount: item._count.stages,
        opportunityCount: opportunityCounts.get(item.id) ?? 0,
      })),
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/pipelines/:pipelineId/board", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, pipelineId } = TenantPipelinePathSchema.parse(req.params)
    const {
      pageSize,
      search,
      tagIds: tagIdsRaw,
      statusConfigIds: statusConfigIdsRaw,
      assignedToUserIds: assignedToUserIdsRaw,
      customFieldFilters,
    } = OpportunityBoardQuerySchema.parse(req.query)

    const tagIds = parseCsvIds(tagIdsRaw)
    const statusConfigIds = parseCsvIds(statusConfigIdsRaw)
    const assignedToUserIds = parseCsvIds(assignedToUserIdsRaw)

    if (!(await requireActiveMembership(authed, res, tenantId))) return

    const filters = {
      tagIds,
      statusConfigIds,
      assignedToUserIds,
      customFieldFilters,
    }

    const [pipeline, stageSummaries] = await Promise.all([
      prisma.opportunityPipeline.findUnique({
      where: {
        tenantId_id: {
          tenantId,
          id: pipelineId,
        },
      },
      select: {
        id: true,
        name: true,
        color: true,
        sortOrder: true,
        stages: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            sortOrder: true,
            opportunities: {
              where: buildOpenOpportunityWhere({
                tenantId,
                pipelineId,
                search,
                ...filters,
              }),
              orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
              take: pageSize,
              select: opportunityCardSelect,
            },
          },
        },
      },
      }),
      getPipelineStageSummaries(tenantId, pipelineId, search, filters),
    ])

    if (!pipeline) {
      return res.status(404).json({ error: "PIPELINE_NOT_FOUND" })
    }

    return res.json({
      ok: true,
      pipeline: {
        id: pipeline.id,
        name: pipeline.name,
        color: pipeline.color,
        sortOrder: pipeline.sortOrder,
        stages: pipeline.stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          sortOrder: stage.sortOrder,
          count: stageSummaries.get(stage.id)?.count ?? 0,
          totalValueCents: stageSummaries.get(stage.id)?.totalValueCents ?? 0,
          cards: stage.opportunities.map(serializeOpportunityCard),
          pagination: {
            page: 1,
            pageSize,
            total: stageSummaries.get(stage.id)?.count ?? 0,
            totalPages: Math.max(1, Math.ceil((stageSummaries.get(stage.id)?.count ?? 0) / pageSize)),
          },
        })),
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get(
  "/:tenantId/pipelines/:pipelineId/stages/:stageId",
  requireAuth,
  async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      const { tenantId, pipelineId, stageId } = TenantStagePathSchema.parse(req.params)
      const {
        page,
        pageSize,
        search,
        tagIds: tagIdsRaw,
        statusConfigIds: statusConfigIdsRaw,
        assignedToUserIds: assignedToUserIdsRaw,
        customFieldFilters,
      } = StageCardsPaginationSchema.parse(req.query)

      const tagIds = parseCsvIds(tagIdsRaw)
      const statusConfigIds = parseCsvIds(statusConfigIdsRaw)
      const assignedToUserIds = parseCsvIds(assignedToUserIdsRaw)

      if (!(await requireActiveMembership(authed, res, tenantId))) return

      const filters = {
        tagIds,
        statusConfigIds,
        assignedToUserIds,
        customFieldFilters,
      }

      const [stage, stageSummary] = await Promise.all([
        prisma.opportunityPipelineStage.findUnique({
        where: {
          tenantId_id: {
            tenantId,
            id: stageId,
          },
        },
        select: {
          id: true,
          name: true,
          sortOrder: true,
          pipelineId: true,
          opportunities: {
            where: buildOpenOpportunityWhere({
              tenantId,
              pipelineId,
              stageId,
              search,
              ...filters,
            }),
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: opportunityCardSelect,
          },
        },
        }),
        prisma.contactOpportunity.aggregate({
          where: buildOpenOpportunityWhere({
            tenantId,
            pipelineId,
            stageId,
            search,
            ...filters,
          }),
          _count: {
            _all: true,
          },
          _sum: {
            valueCents: true,
          },
        }),
      ])

      if (!stage || stage.pipelineId !== pipelineId) {
        return res.status(404).json({ error: "PIPELINE_STAGE_NOT_FOUND" })
      }

      return res.json({
        ok: true,
        stage: {
          id: stage.id,
          name: stage.name,
          sortOrder: stage.sortOrder,
          count: stageSummary._count._all,
          totalValueCents: stageSummary._sum.valueCents ?? 0,
        },
        items: stage.opportunities.map(serializeOpportunityCard),
        pagination: {
          page,
          pageSize,
          total: stageSummary._count._all,
          totalPages: Math.max(1, Math.ceil(stageSummary._count._all / pageSize)),
        },
      })
    } catch (error) {
      return next(error)
    }
  },
)

router.get("/:tenantId/filters", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    if (!(await requireActiveMembership(authed, res, tenantId))) return

    const [statuses, tags, assignees, customFields] = await Promise.all([
      prisma.contactStatusConfig.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          bgColor: true,
          textColor: true,
        },
      }),
      prisma.tenantTag.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          bgColor: true,
          textColor: true,
        },
      }),
      prisma.membership.findMany({
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
      }),
      prisma.contactCustomField.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        select: {
          id: true,
          key: true,
          label: true,
          fieldType: true,
          options: true,
        },
      }),
    ])

    return res.json({
      ok: true,
      filters: {
        statuses: statuses.map((status) => ({
          id: status.id,
          name: status.name,
          bgColor: status.bgColor,
          textColor: status.textColor,
        })),
        tags: tags.map((tag) => ({
          id: tag.id,
          name: tag.name,
          bgColor: tag.bgColor,
          textColor: tag.textColor,
        })),
        assignees: assignees.map((membership) => ({
          userId: membership.userId,
          name: membership.user.name,
          email: membership.user.email,
          image: membership.user.image,
        })),
        customFields: customFields.map((field) => ({
          id: field.id,
          key: field.key,
          label: field.label,
          fieldType: field.fieldType,
          options: Array.isArray(field.options) ? field.options : [],
        })),
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/contact/:contactId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, contactId } = TenantContactPathSchema.parse(req.params)

    if (!(await requireActiveMembership(authed, res, tenantId))) return

    const [contact, items] = await Promise.all([
      prisma.contact.findFirst({
        where: { id: contactId, tenantId },
        select: { id: true },
      }),
      prisma.contactOpportunity.findMany({
        where: {
          tenantId,
          contactId,
        },
        orderBy: [{ updatedAt: "desc" }],
        select: {
          id: true,
          pipelineId: true,
          stageId: true,
          valueCents: true,
          result: true,
          closedAt: true,
          updatedAt: true,
          pipeline: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
          stage: {
            select: {
              id: true,
              name: true,
              sortOrder: true,
            },
          },
        },
      }),
    ])

    if (!contact) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
    }

    return res.json({
      ok: true,
      items: items.map((item) => ({
        id: item.id,
        pipelineId: item.pipelineId,
        stageId: item.stageId,
        valueCents: item.valueCents,
        result: item.result,
        closedAt: item.closedAt,
        updatedAt: item.updatedAt,
        pipeline: item.pipeline,
        stage: item.stage,
      })),
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
    const payload = CreateOpportunitySchema.parse(req.body)

    if (!(await requireActiveMembership(authed, res, tenantId))) return

    const [contact, pipeline] = await Promise.all([
      prisma.contact.findFirst({
        where: { id: payload.contactId, tenantId },
        select: { id: true },
      }),
      prisma.opportunityPipeline.findUnique({
        where: {
          tenantId_id: {
            tenantId,
            id: payload.pipelineId,
          },
        },
        select: {
          id: true,
          stages: {
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            take: 1,
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ])

    if (!contact) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
    }

    if (!pipeline) {
      return res.status(404).json({ error: "PIPELINE_NOT_FOUND" })
    }

    const firstStage = pipeline.stages[0]
    if (!firstStage) {
      return res.status(400).json({ error: "PIPELINE_HAS_NO_STAGES" })
    }

    const existing = await prisma.contactOpportunity.findFirst({
      where: {
        tenantId,
        contactId: payload.contactId,
        pipelineId: payload.pipelineId,
      },
      select: { id: true },
    })

    if (existing) {
      return res.status(409).json({ error: "OPPORTUNITY_ALREADY_EXISTS" })
    }

    const created = await prisma.contactOpportunity.create({
      data: {
        tenantId,
        contactId: payload.contactId,
        pipelineId: payload.pipelineId,
        stageId: firstStage.id,
        valueCents: payload.valueCents,
        result: "OPEN",
      },
      select: opportunityCardSelect,
    })

    return res.status(201).json({
      ok: true,
      opportunity: serializeOpportunityCard(created),
      stage: firstStage,
    })
  } catch (error) {
    return next(error)
  }
})

router.patch("/:tenantId/:opportunityId", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const authed = req as AuthedRequest
    const { tenantId, opportunityId } = TenantOpportunityPathSchema.parse(req.params)
    const payload = UpdateOpportunitySchema.parse(req.body)

    if (!(await requireActiveMembership(authed, res, tenantId))) return

    const existing = await prisma.contactOpportunity.findUnique({
        where: {
          tenantId_id: {
            tenantId,
            id: opportunityId,
          },
        },
        select: {
          id: true,
          pipelineId: true,
          result: true,
        },
      })

    if (!existing) {
      return res.status(404).json({ error: "OPPORTUNITY_NOT_FOUND" })
    }

    if (existing.result !== "OPEN") {
      return res.status(409).json({ error: "OPPORTUNITY_CLOSED" })
    }

    if ("stageId" in payload) {
      const targetStage = await prisma.opportunityPipelineStage.findUnique({
        where: {
          tenantId_id: {
            tenantId,
            id: payload.stageId,
          },
        },
        select: {
          id: true,
          name: true,
          pipelineId: true,
        },
      })

      if (!targetStage || targetStage.pipelineId !== existing.pipelineId) {
        return res.status(400).json({ error: "PIPELINE_STAGE_MISMATCH" })
      }

      const updated = await prisma.contactOpportunity.update({
        where: {
          tenantId_id: {
            tenantId,
            id: opportunityId,
          },
        },
        data: {
          stageId: targetStage.id,
        },
        select: opportunityCardSelect,
      })

      return res.json({
        ok: true,
        opportunity: serializeOpportunityCard(updated),
        stage: targetStage,
      })
    }

    const updated = await prisma.contactOpportunity.update({
      where: {
        tenantId_id: {
          tenantId,
          id: opportunityId,
        },
      },
      data: {
        result: payload.result,
        closedAt: new Date(),
      },
      select: opportunityCardSelect,
    })

    return res.json({
      ok: true,
      opportunity: serializeOpportunityCard(updated),
    })
  } catch (error) {
    return next(error)
  }
})

export default router
