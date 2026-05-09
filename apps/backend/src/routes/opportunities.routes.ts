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

const StageCardsPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 5 || value === 10 || value === 25, {
      message: "pageSize must be 5, 10, or 25",
    })
    .default(10),
})

const CreateOpportunitySchema = z.object({
  contactId: z.string().trim().min(1),
  pipelineId: z.string().trim().min(1),
})

const MoveOpportunitySchema = z.object({
  stageId: z.string().trim().min(1),
})

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

router.get("/:tenantId/pipelines", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    if (!(await requireActiveMembership(authed, res, tenantId))) return

    const items = await prisma.opportunityPipeline.findMany({
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
            opportunities: true,
          },
        },
      },
    })

    return res.json({
      ok: true,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        color: item.color,
        sortOrder: item.sortOrder,
        stageCount: item._count.stages,
        opportunityCount: item._count.opportunities,
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
    const { pageSize } = StageCardsPaginationSchema.parse(req.query)

    if (!(await requireActiveMembership(authed, res, tenantId))) return

    const pipeline = await prisma.opportunityPipeline.findUnique({
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
            _count: {
              select: {
                opportunities: true,
              },
            },
            opportunities: {
              orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
              take: pageSize,
              select: opportunityCardSelect,
            },
          },
        },
      },
    })

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
          count: stage._count.opportunities,
          cards: stage.opportunities.map(serializeOpportunityCard),
          pagination: {
            page: 1,
            pageSize,
            total: stage._count.opportunities,
            totalPages: Math.max(1, Math.ceil(stage._count.opportunities / pageSize)),
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
      const { page, pageSize } = StageCardsPaginationSchema.parse(req.query)

      if (!(await requireActiveMembership(authed, res, tenantId))) return

      const stage = await prisma.opportunityPipelineStage.findUnique({
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
          _count: {
            select: {
              opportunities: true,
            },
          },
          opportunities: {
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: opportunityCardSelect,
          },
        },
      })

      if (!stage || stage.pipelineId !== pipelineId) {
        return res.status(404).json({ error: "PIPELINE_STAGE_NOT_FOUND" })
      }

      return res.json({
        ok: true,
        stage: {
          id: stage.id,
          name: stage.name,
          sortOrder: stage.sortOrder,
          count: stage._count.opportunities,
        },
        items: stage.opportunities.map(serializeOpportunityCard),
        pagination: {
          page,
          pageSize,
          total: stage._count.opportunities,
          totalPages: Math.max(1, Math.ceil(stage._count.opportunities / pageSize)),
        },
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
    const payload = MoveOpportunitySchema.parse(req.body)

    if (!(await requireActiveMembership(authed, res, tenantId))) return

    const [existing, targetStage] = await Promise.all([
      prisma.contactOpportunity.findUnique({
        where: {
          tenantId_id: {
            tenantId,
            id: opportunityId,
          },
        },
        select: {
          id: true,
          pipelineId: true,
        },
      }),
      prisma.opportunityPipelineStage.findUnique({
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
      }),
    ])

    if (!existing) {
      return res.status(404).json({ error: "OPPORTUNITY_NOT_FOUND" })
    }

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
  } catch (error) {
    return next(error)
  }
})

export default router
