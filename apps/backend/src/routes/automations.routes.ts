import { Router } from "express"
import { z } from "zod"

import { Prisma } from "../generated/prisma/index.js"

import {
  AutomationConfigurationError,
  AutomationUpsertSchema,
  getAutomationOperatorsForFieldType,
  validateAutomationConfiguration,
} from "../lib/opportunity-automations.js"
import {
  CONTACT_TEMPLATE_DATE_FORMATS,
  CONTACT_TEMPLATE_PHONE_FORMATS,
  CONTACT_TEMPLATE_REGULAR_FIELDS,
} from "../lib/contact-templates.js"
import { prisma } from "../lib/prisma.js"
import { enforceSameOrigin } from "../lib/security.js"
import { ensureDefaultTaskStatuses } from "../lib/tenant-defaults.js"
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
  status: z.enum(["SUCCEEDED", "FAILED", "EXITED"]).optional(),
})
const AutomationContactsQuerySchema = z.object({
  search: z.string().trim().max(120).default(""),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
})
const AutomationExecutionLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(
    (value) => value === 10 || value === 25 || value === 50,
    { message: "pageSize must be 10, 25, or 50" },
  ).default(10),
  search: z.string().trim().max(120).default(""),
  status: z.enum(["EXECUTED", "SKIPPED", "FAILED", "WAITING"]).optional(),
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
      nodeKey: action.nodeKey,
      type: action.type,
      customFieldId: action.customFieldId,
      statusConfigId: action.statusConfigId,
      assignedUserId: action.assignedUserId,
      tagId: action.tagId,
      value: action.value,
      waitConfig: action.waitConfig,
      noteTitle: action.noteTitle,
      noteBody: action.noteBody,
      taskConfig: action.taskConfig,
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
    await ensureDefaultTaskStatuses(prismaWithAutomations, tenantId)
    const [pipelines, customFields, statuses, taskStatuses, tags, memberships, services] = await Promise.all([
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
          key: true,
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
      prismaWithAutomations.taskStatusConfig.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, bgColor: true, textColor: true, isSystemDefault: true },
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
      prismaWithAutomations.service.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
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
        templateFields: {
          contact: CONTACT_TEMPLATE_REGULAR_FIELDS,
          dateFormats: CONTACT_TEMPLATE_DATE_FORMATS,
          phoneFormats: CONTACT_TEMPLATE_PHONE_FORMATS,
        },
        statuses,
        taskStatuses,
        tags,
        services,
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

router.get("/:tenantId/automations/:automationId/execution-logs", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId, automationId } = AutomationPathSchema.parse(req.params)
    const query = AutomationExecutionLogsQuerySchema.parse(req.query)
    const automation = await prismaWithAutomations.automation.findUnique({
      where: { tenantId_id: { tenantId, id: automationId } },
      select: { id: true },
    })
    if (!automation) return res.status(404).json({ error: "AUTOMATION_NOT_FOUND" })

    const where = {
      tenantId,
      automationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { contactName: { contains: query.search, mode: "insensitive" } }
        : {}),
    }
    const [total, records] = await Promise.all([
      prismaWithAutomations.automationNodeExecution.count({ where }),
      prismaWithAutomations.automationNodeExecution.findMany({
        where,
        orderBy: [
          { occurredAt: "desc" },
          { attemptId: "desc" },
          { nodeOrder: "asc" },
          { id: "asc" },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          attemptId: true,
          eventSource: true,
          contactId: true,
          contactName: true,
          contact: { select: { id: true } },
          nodeKind: true,
          nodeOrder: true,
          nodeKey: true,
          nodeLabel: true,
          status: true,
          details: true,
          occurredAt: true,
        },
      }),
    ])

    return res.json({
      ok: true,
      items: records.map((record: any) => ({
        id: record.id,
        attemptId: record.attemptId,
        eventSource: record.eventSource,
        contact: {
          id: record.contact?.id ?? null,
          name: record.contactName,
        },
        node: {
          kind: record.nodeKind,
          key: record.nodeKey,
          label: record.nodeLabel,
          index: record.nodeKind === "ACTION" ? record.nodeOrder : null,
        },
        status: record.status,
        details: record.details,
        occurredAt: record.occurredAt,
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/automations/:automationId/contacts", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId, automationId } = AutomationPathSchema.parse(req.params)
    const query = AutomationContactsQuerySchema.parse(req.query)
    const automation = await prismaWithAutomations.automation.findUnique({
      where: { tenantId_id: { tenantId, id: automationId } },
      select: { id: true },
    })
    if (!automation) return res.status(404).json({ error: "AUTOMATION_NOT_FOUND" })

    const searchPattern = `%${query.search}%`
    const searchClause = query.search
      ? Prisma.sql`AND (
          CONCAT_WS(' ', contact."firstName", contact."middleName", contact."lastName") ILIKE ${searchPattern}
          OR COALESCE(contact."email", '') ILIKE ${searchPattern}
          OR COALESCE(contact."phone", '') ILIKE ${searchPattern}
        )`
      : Prisma.sql``
    const enrolledContacts = Prisma.sql`
      FROM (
        SELECT
          entered_contact."contactId" AS "contactId",
          MIN(entered_contact."firstEnteredAt") AS "firstEnteredAt"
        FROM (
          SELECT
            enrollment."contactId" AS "contactId",
            MIN(enrollment."createdAt") AS "firstEnteredAt"
          FROM "AutomationProcessContact" enrollment
          INNER JOIN "AutomationProcess" process
            ON process."id" = enrollment."processId"
            AND process."tenantId" = ${tenantId}
            AND process."automationId" = ${automationId}
          WHERE enrollment."tenantId" = ${tenantId}
            AND enrollment."status" = 'SUCCEEDED'::"AutomationProcessContactStatus"
          GROUP BY enrollment."contactId"

          UNION ALL

          SELECT
            node_execution."contactId" AS "contactId",
            MIN(node_execution."occurredAt") AS "firstEnteredAt"
          FROM "AutomationNodeExecution" node_execution
          WHERE node_execution."tenantId" = ${tenantId}
            AND node_execution."automationId" = ${automationId}
            AND node_execution."contactId" IS NOT NULL
            AND node_execution."nodeKind" = 'TRIGGER'::"AutomationNodeKind"
            AND node_execution."status" = 'EXECUTED'::"AutomationNodeExecutionStatus"
          GROUP BY node_execution."contactId"
        ) entered_contact
        GROUP BY entered_contact."contactId"
      ) enrolled_contact
      INNER JOIN "Contact" contact
        ON contact."id" = enrolled_contact."contactId"
        AND contact."tenantId" = ${tenantId}
      LEFT JOIN (
        SELECT
          execution."contactId" AS "contactId",
          COUNT(*)::int AS "executionCount",
          MAX(execution."createdAt") AS "lastExecutedAt",
          (ARRAY_AGG(execution."status"::text ORDER BY execution."createdAt" DESC))[1] AS "lastStatus"
        FROM "AutomationExecution" execution
        WHERE execution."tenantId" = ${tenantId}
          AND execution."automationId" = ${automationId}
          AND execution."contactId" IS NOT NULL
        GROUP BY execution."contactId"
      ) execution_contact
        ON execution_contact."contactId" = enrolled_contact."contactId"
      WHERE TRUE
      ${searchClause}
    `
    type AutomationContactCountRow = { total: bigint }
    type AutomationContactRow = {
      contactId: string
      firstName: string
      middleName: string | null
      lastName: string
      email: string | null
      phone: string | null
      executionCount: number | null
      firstEnteredAt: Date
      lastExecutedAt: Date | null
      lastStatus: "SUCCEEDED" | "FAILED" | "EXITED" | null
    }
    const skip = (query.page - 1) * query.pageSize
    const [countRows, rows] = await prisma.$transaction([
      prisma.$queryRaw<AutomationContactCountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS total
        ${enrolledContacts}
      `),
      prisma.$queryRaw<AutomationContactRow[]>(Prisma.sql`
        SELECT
          enrolled_contact."contactId" AS "contactId",
          contact."firstName" AS "firstName",
          contact."middleName" AS "middleName",
          contact."lastName" AS "lastName",
          contact."email" AS email,
          contact."phone" AS phone,
          COALESCE(execution_contact."executionCount", 0)::int AS "executionCount",
          enrolled_contact."firstEnteredAt" AS "firstEnteredAt",
          execution_contact."lastExecutedAt" AS "lastExecutedAt",
          execution_contact."lastStatus" AS "lastStatus"
        ${enrolledContacts}
        ORDER BY enrolled_contact."firstEnteredAt" DESC, enrolled_contact."contactId" ASC
        LIMIT ${query.pageSize}
        OFFSET ${skip}
      `),
    ])
    const totalCount = Number(countRows[0]?.total ?? 0)
    const totalPages = Math.max(1, Math.ceil(totalCount / query.pageSize))

    return res.json({
      ok: true,
      items: rows.map((row) => ({
        contact: {
          id: row.contactId,
          name: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" "),
          email: row.email,
          phoneNumber: row.phone,
        },
        firstEnteredAt: row.firstEnteredAt,
        lastExecutedAt: row.lastExecutedAt,
        executionCount: row.executionCount ?? 0,
        lastStatus: row.lastStatus,
      })),
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
      totalCount,
      totalPages,
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
