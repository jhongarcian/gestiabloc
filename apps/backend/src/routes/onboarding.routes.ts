import { Router } from "express"
import { z } from "zod"
import { Prisma } from "../generated/prisma/index.js"

import {
  buildOnboardingStateUpdate,
  ONBOARDING_STEPS,
} from "../lib/onboarding.js"
import { prisma } from "../lib/prisma.js"
import {
  ensureDefaultContactStatuses,
  ensureDefaultTaskStatuses,
  ensureStarterOpportunityPipeline,
} from "../lib/tenant-defaults.js"
import { enforceSameOrigin } from "../lib/security.js"
import { requireAuth } from "../middleware/requireAuth.js"
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js"

const router = Router()

const TenantPathSchema = z.object({
  tenantId: z.string().trim().min(1),
})

const nullableTrimmedString = (max: number) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    },
    z.string().max(max).nullable(),
  )

const nullableEmail = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  },
  z.string().email().max(255).nullable(),
)

const nullableUrl = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value
    const trimmed = value.trim()
    if (!trimmed) return null
    return /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)
      ? trimmed
      : `https://${trimmed}`
  },
  z.string().url().max(255).nullable(),
)

const OnboardingProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: nullableEmail,
  phone: nullableTrimmedString(60),
  website: nullableUrl,
  addressLine1: nullableTrimmedString(255),
  addressLine2: nullableTrimmedString(255),
  city: nullableTrimmedString(120),
  state: nullableTrimmedString(120),
  postalCode: nullableTrimmedString(40),
  country: nullableTrimmedString(120),
  timezone: nullableTrimmedString(100).superRefine((value, ctx) => {
    if (!value) return
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format()
    } catch {
      ctx.addIssue({ code: "custom", message: "Timezone is not supported." })
    }
  }),
})

const WorkflowStageSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(80),
})

const OnboardingWorkflowSchema = z
  .object({
    pipelineId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(80),
    stages: z.array(WorkflowStageSchema).min(1).max(50),
  })
  .superRefine((value, ctx) => {
    const names = value.stages.map((stage) => stage.name.toLocaleLowerCase())
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: "custom",
        path: ["stages"],
        message: "Stage names must be unique within a pipeline.",
      })
    }

    const ids = value.stages.map((stage) => stage.id)
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["stages"],
        message: "Stage identifiers must be unique.",
      })
    }
  })

const OnboardingStateActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("advance"), step: z.enum(ONBOARDING_STEPS) }),
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("dismissChecklist") }),
])

const adminMiddlewares = [
  requireAuth,
  requireTenantAdmin({
    tenantIdLookups: [{ source: "params", key: "tenantId" }],
  }),
] as const

const statusSelect = {
  id: true,
  name: true,
  bgColor: true,
  textColor: true,
  sortOrder: true,
  isActive: true,
  isSystemDefault: true,
} as const

const pipelineSelect = {
  id: true,
  name: true,
  color: true,
  sortOrder: true,
  stages: {
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, sortOrder: true },
  },
} satisfies Prisma.OpportunityPipelineSelect

router.get("/:tenantId", ...adminMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params)

    await ensureDefaultContactStatuses(prisma, tenantId)
    await ensureDefaultTaskStatuses(prisma, tenantId)

    let pipeline = await prisma.opportunityPipeline.findFirst({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: pipelineSelect,
    })

    if (!pipeline) {
      pipeline = await ensureStarterOpportunityPipeline(prisma, tenantId)
    }

    const [tenant, contactStatuses, taskStatuses, serviceCount, memberCount] =
      await Promise.all([
        prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            id: true,
            slug: true,
            name: true,
            email: true,
            phone: true,
            website: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            state: true,
            postalCode: true,
            country: true,
            timezone: true,
            onboardingStatus: true,
            onboardingCurrentStep: true,
            onboardingStartedAt: true,
            onboardingSkippedAt: true,
            onboardingCompletedAt: true,
            onboardingChecklistDismissedAt: true,
          },
        }),
        prisma.contactStatusConfig.findMany({
          where: { tenantId },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: statusSelect,
        }),
        prisma.taskStatusConfig.findMany({
          where: { tenantId },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: statusSelect,
        }),
        prisma.service.count({ where: { tenantId } }),
        prisma.membership.count({
          where: { tenantId, status: "ACTIVE" },
        }),
      ])

    if (!tenant) {
      return res.status(404).json({ error: "TENANT_NOT_FOUND" })
    }

    return res.json({
      ok: true,
      onboarding: {
        status: tenant.onboardingStatus,
        currentStep: tenant.onboardingCurrentStep,
        startedAt: tenant.onboardingStartedAt,
        skippedAt: tenant.onboardingSkippedAt,
        completedAt: tenant.onboardingCompletedAt,
        checklistDismissedAt: tenant.onboardingChecklistDismissedAt,
      },
      profile: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        email: tenant.email,
        phone: tenant.phone,
        website: tenant.website,
        addressLine1: tenant.addressLine1,
        addressLine2: tenant.addressLine2,
        city: tenant.city,
        state: tenant.state,
        postalCode: tenant.postalCode,
        country: tenant.country,
        timezone: tenant.timezone,
      },
      defaults: { contactStatuses, taskStatuses, pipeline },
      readiness: { serviceCount, memberCount },
    })
  } catch (error) {
    return next(error)
  }
})

router.patch("/:tenantId/profile", ...adminMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = OnboardingProfileSchema.parse(req.body)

    const profile = await prisma.tenant.update({
      where: { id: tenantId },
      data: payload,
      select: {
        id: true,
        slug: true,
        name: true,
        email: true,
        phone: true,
        website: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        timezone: true,
      },
    })

    return res.json({ ok: true, profile })
  } catch (error) {
    return next(error)
  }
})

router.patch("/:tenantId/workflow", ...adminMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = OnboardingWorkflowSchema.parse(req.body)

    const existing = await prisma.opportunityPipeline.findUnique({
      where: { tenantId_id: { tenantId, id: payload.pipelineId } },
      select: pipelineSelect,
    })

    if (!existing) {
      return res.status(404).json({ error: "PIPELINE_NOT_FOUND" })
    }

    const existingIds = new Set(existing.stages.map((stage) => stage.id))
    const payloadIds = new Set(payload.stages.map((stage) => stage.id))
    if (
      existingIds.size !== payloadIds.size ||
      [...existingIds].some((id) => !payloadIds.has(id))
    ) {
      return res.status(400).json({ error: "PIPELINE_STAGES_CANNOT_BE_ADDED_OR_REMOVED" })
    }

    const duplicate = await prisma.opportunityPipeline.findFirst({
      where: {
        tenantId,
        id: { not: payload.pipelineId },
        name: { equals: payload.name, mode: "insensitive" },
      },
      select: { id: true },
    })
    if (duplicate) {
      return res.status(409).json({ error: "PIPELINE_NAME_ALREADY_EXISTS" })
    }

    const pipeline = await prisma.$transaction(async (tx) => {
      await tx.opportunityPipeline.update({
        where: { tenantId_id: { tenantId, id: payload.pipelineId } },
        data: { name: payload.name },
      })

      for (const stage of payload.stages) {
        await tx.opportunityPipelineStage.update({
          where: { tenantId_id: { tenantId, id: stage.id } },
          data: { name: `__onboarding_${stage.id}` },
        })
      }

      for (const stage of payload.stages) {
        await tx.opportunityPipelineStage.update({
          where: { tenantId_id: { tenantId, id: stage.id } },
          data: { name: stage.name },
        })
      }

      return tx.opportunityPipeline.findUniqueOrThrow({
        where: { tenantId_id: { tenantId, id: payload.pipelineId } },
        select: pipelineSelect,
      })
    })

    return res.json({ ok: true, pipeline })
  } catch (error) {
    return next(error)
  }
})

router.patch("/:tenantId/state", ...adminMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const { tenantId } = TenantPathSchema.parse(req.params)
    const action = OnboardingStateActionSchema.parse(req.body)

    const current = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        onboardingStatus: true,
        onboardingCurrentStep: true,
        onboardingStartedAt: true,
      },
    })
    if (!current) {
      return res.status(404).json({ error: "TENANT_NOT_FOUND" })
    }

    const update = buildOnboardingStateUpdate(
      {
        status: current.onboardingStatus,
        currentStep: current.onboardingCurrentStep,
        startedAt: current.onboardingStartedAt,
      },
      action,
    )

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: update,
      select: {
        onboardingStatus: true,
        onboardingCurrentStep: true,
        onboardingStartedAt: true,
        onboardingSkippedAt: true,
        onboardingCompletedAt: true,
        onboardingChecklistDismissedAt: true,
      },
    })

    return res.json({
      ok: true,
      onboarding: {
        status: tenant.onboardingStatus,
        currentStep: tenant.onboardingCurrentStep,
        startedAt: tenant.onboardingStartedAt,
        skippedAt: tenant.onboardingSkippedAt,
        completedAt: tenant.onboardingCompletedAt,
        checklistDismissedAt: tenant.onboardingChecklistDismissedAt,
      },
    })
  } catch (error) {
    return next(error)
  }
})

export default router
