import { Prisma } from "../generated/prisma/index.js"

import { AutomationActionInputSchema } from "./opportunity-automations.js"
import {
  getAutomationActionLabel,
  getContactDisplayName,
} from "./automation-node-executions.js"

const WAITING_RUN_PAGE_SIZE = 10

type WaitingRunErrorCode =
  | "AUTOMATION_NOT_FOUND"
  | "WAIT_NODE_NOT_FOUND"
  | "WAITING_RUN_NOT_FOUND"
  | "AUTOMATION_RUN_NOT_WAITING"

export class AutomationWaitingRunError extends Error {
  constructor(
    public code: WaitingRunErrorCode,
    public status: 404 | 409,
    message: string,
  ) {
    super(message)
  }
}

async function ensureAutomation(prismaClient: any, tenantId: string, automationId: string) {
  const automation = await prismaClient.automation.findUnique({
    where: { tenantId_id: { tenantId, id: automationId } },
    select: { id: true },
  })
  if (!automation) {
    throw new AutomationWaitingRunError(
      "AUTOMATION_NOT_FOUND",
      404,
      "The automation is no longer available.",
    )
  }
}

async function ensureWaitNode(
  prismaClient: any,
  tenantId: string,
  automationId: string,
  nodeKey: string,
) {
  await ensureAutomation(prismaClient, tenantId, automationId)
  const action = await prismaClient.automationAction.findFirst({
    where: { tenantId, automationId, nodeKey, type: "WAIT" },
    select: { nodeKey: true },
  })
  if (!action) {
    throw new AutomationWaitingRunError(
      "WAIT_NODE_NOT_FOUND",
      404,
      "The saved Wait action is no longer available.",
    )
  }
  return action
}

export async function getAutomationWaitNodeCounts(
  prismaClient: any,
  params: { tenantId: string; automationId: string },
) {
  await ensureAutomation(prismaClient, params.tenantId, params.automationId)
  const actions = await prismaClient.automationAction.findMany({
    where: {
      tenantId: params.tenantId,
      automationId: params.automationId,
      type: "WAIT",
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { nodeKey: true },
  })
  const nodeKeys = actions.map((action: { nodeKey: string }) => action.nodeKey)
  if (nodeKeys.length === 0) return []

  const groups = await prismaClient.automationRun.groupBy({
    by: ["waitingNodeKey"],
    where: {
      tenantId: params.tenantId,
      automationId: params.automationId,
      status: "WAITING",
      waitingNodeKey: { in: nodeKeys },
    },
    _count: { _all: true },
  })
  const countByNodeKey = new Map<string, number>(
    groups
      .filter((group: { waitingNodeKey: string | null }) => Boolean(group.waitingNodeKey))
      .map((group: { waitingNodeKey: string | null; _count: { _all: number } }) => [
        group.waitingNodeKey!,
        group._count._all,
      ]),
  )
  return nodeKeys.map((nodeKey: string) => ({
    nodeKey,
    count: countByNodeKey.get(nodeKey) ?? 0,
  }))
}

export async function getAutomationWaitingRuns(
  prismaClient: any,
  params: {
    tenantId: string
    automationId: string
    nodeKey: string
    page: number
  },
) {
  await ensureWaitNode(prismaClient, params.tenantId, params.automationId, params.nodeKey)
  const where = {
    tenantId: params.tenantId,
    automationId: params.automationId,
    waitingNodeKey: params.nodeKey,
    status: "WAITING",
  }
  const total = await prismaClient.automationRun.count({ where })
  const totalPages = Math.max(1, Math.ceil(total / WAITING_RUN_PAGE_SIZE))
  const page = Math.min(Math.max(1, params.page), totalPages)
  const offset = (page - 1) * WAITING_RUN_PAGE_SIZE
  const orderedRows = typeof prismaClient.$queryRaw === "function"
    ? await prismaClient.$queryRaw(Prisma.sql`
        SELECT run."id"
        FROM "AutomationRun" AS run
        LEFT JOIN "AutomationNodeExecution" AS wait_log
          ON wait_log."tenantId" = run."tenantId"
          AND wait_log."id" = run."waitingNodeExecutionId"
        WHERE run."tenantId" = ${params.tenantId}
          AND run."automationId" = ${params.automationId}
          AND run."waitingNodeKey" = ${params.nodeKey}
          AND run."status" = 'WAITING'
        ORDER BY
          run."resumeAt" ASC NULLS LAST,
          COALESCE(wait_log."createdAt", run."updatedAt") ASC,
          run."id" ASC
        OFFSET ${offset}
        LIMIT ${WAITING_RUN_PAGE_SIZE}
      `) as Array<{ id: string }>
    : null
  const orderedRunIds = orderedRows?.map((row) => row.id) ?? null
  const runs = await prismaClient.automationRun.findMany({
    where: orderedRunIds ? { ...where, id: { in: orderedRunIds } } : where,
    ...(orderedRunIds
      ? {}
      : {
          orderBy: [
            { resumeAt: "asc" },
            { updatedAt: "asc" },
            { id: "asc" },
          ],
          skip: offset,
          take: WAITING_RUN_PAGE_SIZE,
        }),
    select: {
      id: true,
      contactId: true,
      contactName: true,
      waitingNodeExecutionId: true,
      resumeAt: true,
      updatedAt: true,
      contact: {
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          phone: true,
        },
      },
    },
  })
  const runOrder = orderedRunIds
    ? new Map(orderedRunIds.map((runId, index) => [runId, index]))
    : null
  const sortedRuns = runOrder
    ? [...runs].sort((left, right) => (runOrder.get(left.id) ?? 0) - (runOrder.get(right.id) ?? 0))
    : runs
  const executionIds = sortedRuns
    .map((run: { waitingNodeExecutionId: string | null }) => run.waitingNodeExecutionId)
    .filter((id: string | null): id is string => Boolean(id))
  const executions = executionIds.length > 0
    ? await prismaClient.automationNodeExecution.findMany({
        where: { tenantId: params.tenantId, id: { in: executionIds } },
        select: { id: true, createdAt: true },
      })
    : []
  const enteredAtByExecutionId = new Map<string, Date>(
    executions.map((execution: { id: string; createdAt: Date }) => [execution.id, execution.createdAt]),
  )

  return {
    items: sortedRuns.map((run: any) => ({
      runId: run.id,
      contact: {
        id: run.contact?.id ?? run.contactId,
        name: run.contact ? getContactDisplayName(run.contact) : run.contactName,
        phoneNumber: run.contact?.phone ?? null,
      },
      enteredAt: run.waitingNodeExecutionId
        ? enteredAtByExecutionId.get(run.waitingNodeExecutionId) ?? run.updatedAt
        : run.updatedAt,
      nextActionAt: run.resumeAt,
    })),
    pagination: {
      page,
      pageSize: WAITING_RUN_PAGE_SIZE,
      total,
      totalPages,
    },
  }
}

function parsePinnedActions(value: unknown) {
  const parsed = AutomationActionInputSchema.array().max(20).safeParse(value)
  if (!parsed.success) return []
  return parsed.data.filter(
    (action): action is typeof action & { nodeKey: string } => Boolean(action.nodeKey),
  )
}

export async function exitAutomationWaitingRun(
  prismaClient: any,
  params: {
    tenantId: string
    automationId: string
    nodeKey: string
    runId: string
    actorUserId: string
    actorDisplayName: string
    occurredAt?: Date
  },
) {
  return prismaClient.$transaction(async (transaction: any) => {
    await ensureWaitNode(transaction, params.tenantId, params.automationId, params.nodeKey)
    const run = await transaction.automationRun.findFirst({
      where: {
        id: params.runId,
        tenantId: params.tenantId,
        automationId: params.automationId,
        waitingNodeKey: params.nodeKey,
      },
    })
    if (!run) {
      throw new AutomationWaitingRunError(
        "WAITING_RUN_NOT_FOUND",
        404,
        "The waiting automation run was not found.",
      )
    }
    if (run.status !== "WAITING") {
      throw new AutomationWaitingRunError(
        "AUTOMATION_RUN_NOT_WAITING",
        409,
        "This contact has already continued. Refresh the waiting list.",
      )
    }

    const occurredAt = params.occurredAt ?? new Date()
    const claimed = await transaction.automationRun.updateMany({
      where: {
        id: run.id,
        tenantId: params.tenantId,
        automationId: params.automationId,
        waitingNodeKey: params.nodeKey,
        status: "WAITING",
      },
      data: {
        status: "EXITED",
        resumeAt: null,
        waitingNodeKey: null,
        waitingNodeExecutionId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        exitedAt: occurredAt,
      },
    })
    if (claimed.count !== 1) {
      throw new AutomationWaitingRunError(
        "AUTOMATION_RUN_NOT_WAITING",
        409,
        "This contact has already continued. Refresh the waiting list.",
      )
    }

    const waitDetails = `Wait ended early because the contact was removed from this automation by ${params.actorDisplayName}.`
    const waitLogUpdate = await transaction.automationNodeExecution.updateMany({
      where: {
        tenantId: params.tenantId,
        attemptId: run.attemptId,
        nodeKey: params.nodeKey,
        status: "WAITING",
      },
      data: {
        status: "EXECUTED",
        reasonCode: "CONTACT_REMOVED_FROM_AUTOMATION",
        details: waitDetails,
        actorUserId: params.actorUserId,
        occurredAt,
      },
    })

    const actions = parsePinnedActions(run.actionSnapshot)
    const waitingActionIndex = Math.max(0, run.cursorIndex - 1)
    const waitingAction = actions[waitingActionIndex]
    if (waitLogUpdate.count === 0) {
      await transaction.automationNodeExecution.create({
        data: {
          tenantId: params.tenantId,
          automationId: params.automationId,
          automationName: run.automationName,
          contactId: run.contactId,
          contactName: run.contactName,
          actorUserId: params.actorUserId,
          processId: null,
          opportunityId: run.opportunityId,
          attemptId: run.attemptId,
          eventSource: run.eventSource,
          nodeKind: "ACTION",
          nodeOrder: run.cursorIndex,
          nodeKey: params.nodeKey,
          nodeLabel: getAutomationActionLabel(waitingAction?.type ?? "WAIT"),
          status: "EXECUTED",
          reasonCode: "CONTACT_REMOVED_FROM_AUTOMATION",
          details: waitDetails,
          occurredAt,
        },
      })
    }

    const remainingLogs = actions.slice(run.cursorIndex).map((action, offset) => ({
      tenantId: params.tenantId,
      automationId: params.automationId,
      automationName: run.automationName,
      contactId: run.contactId,
      contactName: run.contactName,
      actorUserId: params.actorUserId,
      processId: null,
      opportunityId: run.opportunityId,
      attemptId: run.attemptId,
      eventSource: run.eventSource,
      nodeKind: "ACTION" as const,
      nodeOrder: run.cursorIndex + offset + 1,
      nodeKey: action.nodeKey,
      nodeLabel: getAutomationActionLabel(action.type),
      status: "SKIPPED" as const,
      reasonCode: "CONTACT_REMOVED_FROM_AUTOMATION",
      details: "Skipped because the contact was removed from this automation while waiting.",
      occurredAt,
    }))
    if (remainingLogs.length > 0) {
      await transaction.automationNodeExecution.createMany({ data: remainingLogs })
    }

    await transaction.automationExecution.create({
      data: {
        tenantId: params.tenantId,
        automationId: params.automationId,
        automationName: run.automationName,
        triggerType: run.triggerType,
        status: "EXITED",
        opportunityId: run.opportunityId,
        contactId: run.contactId,
        sourceStageId: run.sourceStageId,
        targetStageId: run.targetStageId,
        actorUserId: params.actorUserId,
        actionCount: run.cursorIndex,
      },
    })

    return { runId: run.id, status: "EXITED" as const, exitedAt: occurredAt }
  })
}
