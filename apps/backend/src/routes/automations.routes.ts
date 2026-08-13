import { Router } from "express"
import { z } from "zod"

import {
  AutomationConfigurationError,
  AutomationUpsertSchema,
  getAutomationOperatorsForFieldType,
  validateAutomationConfiguration,
} from "../lib/opportunity-automations.js"
import { prisma } from "../lib/prisma.js"
import { enforceSameOrigin } from "../lib/security.js"
import { requireAuth } from "../middleware/requireAuth.js"
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js"

const router = Router()
const prismaWithAutomations = prisma as any

const TenantPathSchema = z.object({ tenantId: z.string().trim().min(1) })
const AutomationPathSchema = TenantPathSchema.extend({
  automationId: z.string().trim().min(1),
})
const ExecutionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  automationId: z.string().trim().min(1).optional(),
  status: z.enum(["SUCCEEDED", "FAILED"]).optional(),
})
const ReorderSchema = z.object({
  automationIds: z.array(z.string().trim().min(1)).min(1).max(200),
})

const readMiddlewares = [
  requireAuth,
  requireTenantAdmin({ tenantIdLookups: [{ source: "params", key: "tenantId" }] }),
] as const
const writeMiddlewares = [
  requireAuth,
  requireTenantAdmin({
    tenantIdLookups: [
      { source: "params", key: "tenantId" },
      { source: "body", key: "tenantId" },
    ],
  }),
] as const

const automationInclude = {
  conditions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  actions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  executions: { orderBy: { createdAt: "desc" }, take: 1 },
} as const

function serializeAutomation(record: any) {
  return {
    id: record.id,
    name: record.name,
    isEnabled: record.isEnabled,
    sortOrder: record.sortOrder,
    trigger:
      record.triggerType === "OPPORTUNITY_CREATED"
        ? { type: record.triggerType, pipelineId: record.pipelineId }
        : {
            type: record.triggerType,
            pipelineId: record.pipelineId,
            sourceStageId: record.sourceStageId,
            targetStageId: record.targetStageId,
          },
    conditions: record.conditions.map((condition: any) => ({
      id: condition.id,
      source: condition.source,
      operator: condition.operator,
      customFieldId: condition.customFieldId,
      statusConfigId: condition.statusConfigId,
      assignedUserId: condition.assignedUserId,
      tagId: condition.tagId,
      compareValue: condition.compareValue,
    })),
    actions: record.actions.map((action: any) => ({
      id: action.id,
      type: action.type,
      customFieldId: action.customFieldId,
      statusConfigId: action.statusConfigId,
      assignedUserId: action.assignedUserId,
      tagId: action.tagId,
      value: action.value,
    })),
    lastExecution: record.executions?.[0]
      ? {
          id: record.executions[0].id,
          status: record.executions[0].status,
          createdAt: record.executions[0].createdAt,
          errorMessage: record.executions[0].errorMessage,
        }
      : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function handleConfigurationError(error: unknown, res: any) {
  if (!(error instanceof AutomationConfigurationError)) return false
  res.status(error.status).json({ error: error.code, message: error.message })
  return true
}

router.get("/:tenantId/automations/catalog", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params)
    const [pipelines, customFields, statuses, tags, memberships] = await Promise.all([
      prismaWithAutomations.opportunityPipeline.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          color: true,
          stages: {
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: { id: true, name: true },
          },
        },
      }),
      prismaWithAutomations.contactCustomField.findMany({
        where: { tenantId, isActive: true, isEncrypted: false, isSensitive: false },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
        select: {
          id: true,
          label: true,
          fieldType: true,
          isRequired: true,
          options: true,
        },
      }),
      prismaWithAutomations.contactStatusConfig.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, bgColor: true, textColor: true },
      }),
      prismaWithAutomations.tenantTag.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, bgColor: true, textColor: true },
      }),
      prismaWithAutomations.membership.findMany({
        where: { tenantId, status: "ACTIVE" },
        orderBy: { user: { name: "asc" } },
        select: { userId: true, user: { select: { name: true, email: true } } },
      }),
    ])

    return res.json({
      ok: true,
      catalog: {
        pipelines,
        customFields: customFields.map((field: any) => ({
          ...field,
          options: Array.isArray(field.options) ? field.options : [],
          operators: getAutomationOperatorsForFieldType(field.fieldType),
        })),
        statuses,
        tags,
        users: memberships.map((item: any) => ({
          id: item.userId,
          name: item.user.name,
          email: item.user.email,
        })),
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/automation-executions", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params)
    const { page, pageSize, automationId, status } = ExecutionQuerySchema.parse(req.query)
    const where = {
      tenantId,
      ...(automationId ? { automationId } : {}),
      ...(status ? { status } : {}),
    }
    const [total, items] = await Promise.all([
      prismaWithAutomations.automationExecution.count({ where }),
      prismaWithAutomations.automationExecution.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return res.json({
      ok: true,
      items,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    return next(error)
  }
})

router.patch("/:tenantId/automations/reorder", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const { tenantId } = TenantPathSchema.parse(req.params)
    const { automationIds } = ReorderSchema.parse(req.body)
    const records = await prismaWithAutomations.automation.findMany({
      where: { tenantId, id: { in: automationIds } },
      select: { id: true },
    })
    if (records.length !== automationIds.length) {
      return res.status(404).json({ error: "AUTOMATION_NOT_FOUND" })
    }
    await prismaWithAutomations.$transaction(
      automationIds.map((id, index) =>
        prismaWithAutomations.automation.update({
          where: { tenantId_id: { tenantId, id } },
          data: { sortOrder: (index + 1) * 10 },
        }),
      ),
    )
    return res.json({ ok: true })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/automations", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params)
    const items = await prismaWithAutomations.automation.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: automationInclude,
    })
    return res.json({ ok: true, items: items.map(serializeAutomation) })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/automations/:automationId", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId, automationId } = AutomationPathSchema.parse(req.params)
    const record = await prismaWithAutomations.automation.findUnique({
      where: { tenantId_id: { tenantId, id: automationId } },
      include: automationInclude,
    })
    if (!record) return res.status(404).json({ error: "AUTOMATION_NOT_FOUND" })
    return res.json({ ok: true, automation: serializeAutomation(record) })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId/automations", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = AutomationUpsertSchema.parse(req.body)
    const normalized = await validateAutomationConfiguration(prismaWithAutomations, tenantId, payload)
    const max = await prismaWithAutomations.automation.findFirst({
      where: { tenantId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    })
    const record = await prismaWithAutomations.automation.create({
      data: {
        tenantId,
        name: normalized.name,
        isEnabled: normalized.isEnabled,
        triggerType: normalized.triggerType,
        pipelineId: normalized.pipelineId,
        sourceStageId: normalized.sourceStageId,
        targetStageId: normalized.targetStageId,
        sortOrder: (max?.sortOrder ?? 0) + 10,
        conditions: { create: normalized.conditions },
        actions: { create: normalized.actions },
      },
      include: automationInclude,
    })
    return res.status(201).json({ ok: true, automation: serializeAutomation(record) })
  } catch (error) {
    if (handleConfigurationError(error, res)) return
    return next(error)
  }
})

router.patch("/:tenantId/automations/:automationId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const { tenantId, automationId } = AutomationPathSchema.parse(req.params)
    const payload = AutomationUpsertSchema.parse(req.body)
    const existing = await prismaWithAutomations.automation.findUnique({
      where: { tenantId_id: { tenantId, id: automationId } },
      select: { id: true },
    })
    if (!existing) return res.status(404).json({ error: "AUTOMATION_NOT_FOUND" })
    const normalized = await validateAutomationConfiguration(prismaWithAutomations, tenantId, payload)
    const record = await prismaWithAutomations.$transaction(async (tx: any) => {
      await Promise.all([
        tx.automationCondition.deleteMany({ where: { tenantId, automationId } }),
        tx.automationAction.deleteMany({ where: { tenantId, automationId } }),
      ])
      return tx.automation.update({
        where: { tenantId_id: { tenantId, id: automationId } },
        data: {
          name: normalized.name,
          isEnabled: normalized.isEnabled,
          triggerType: normalized.triggerType,
          pipelineId: normalized.pipelineId,
          sourceStageId: normalized.sourceStageId,
          targetStageId: normalized.targetStageId,
          conditions: { create: normalized.conditions },
          actions: { create: normalized.actions },
        },
        include: automationInclude,
      })
    })
    return res.json({ ok: true, automation: serializeAutomation(record) })
  } catch (error) {
    if (handleConfigurationError(error, res)) return
    return next(error)
  }
})

router.delete("/:tenantId/automations/:automationId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const { tenantId, automationId } = AutomationPathSchema.parse(req.params)
    const existing = await prismaWithAutomations.automation.findUnique({
      where: { tenantId_id: { tenantId, id: automationId } },
      select: { id: true },
    })
    if (!existing) return res.status(404).json({ error: "AUTOMATION_NOT_FOUND" })
    await prismaWithAutomations.automation.delete({ where: { tenantId_id: { tenantId, id: automationId } } })
    return res.json({ ok: true })
  } catch (error) {
    return next(error)
  }
})

export default router
