import { randomUUID } from "node:crypto"

import {
  AutomationExecutionError,
  automationActionSnapshot,
  evaluateAutomationConditions,
  evaluateAutomationTrigger,
  executeAutomationSegmentTx,
  flattenAutomationActionTree,
  getAutomationRuntimeCatalog,
  kickAutomationRunWorker,
  parseActionSnapshot,
  type OpportunityAutomationEvent,
  type RuntimeAutomationAction,
} from "./opportunity-automations.js"
import {
  getAutomationActionNodeLabel,
  getAutomationTriggerLabel,
  getContactDisplayName,
  type AutomationNodeLogData,
} from "./automation-node-executions.js"

export type QueuedAutomationResult = {
  automationEventId: string | null
  automationStatus: "QUEUED" | "NOT_APPLICABLE"
  queuedAutomationCount: number
  matchedCount: number
  executedCount: number
  contactDeleted: false
}

function actionLogs(params: {
  event: any
  dispatch: any
  actions: RuntimeAutomationAction[]
  status: "SKIPPED" | "FAILED"
  reasonCode: string
  details: string
}) {
  return flattenAutomationActionTree(params.actions).map(({ action, nodeOrder, branchPath }) => ({
    tenantId: params.dispatch.tenantId,
    automationId: params.dispatch.automationId,
    automationName: params.dispatch.automationName,
    contactId: params.event.contactId,
    contactName: params.event.contactName,
    actorUserId: params.event.actorUserId,
    processId: null,
    opportunityId: params.event.opportunityId,
    attemptId: params.dispatch.attemptId,
    eventSource: params.event.triggerType,
    nodeKind: "ACTION" as const,
    nodeOrder,
    nodeKey: action.nodeKey,
    nodeLabel: getAutomationActionNodeLabel(action),
    status: params.status,
    reasonCode: params.reasonCode,
    details: params.details,
    branchPath,
    occurredAt: new Date(),
  }))
}

export async function queueOpportunityAutomationEvent(
  prismaTx: any,
  event: OpportunityAutomationEvent,
): Promise<QueuedAutomationResult> {
  if (!event.targetStageId) {
    throw new Error("An opportunity automation event requires a target stage.")
  }
  if (event.causationKey) {
    const existingEvent = await prismaTx.automationEvent.findUnique({
      where: { causationKey: event.causationKey },
      include: { dispatches: { select: { decision: true } } },
    })
    if (existingEvent) {
      return {
        automationEventId: existingEvent.id,
        automationStatus: "QUEUED",
        queuedAutomationCount: existingEvent.dispatches.length,
        matchedCount: existingEvent.dispatches.filter((dispatch: any) => dispatch.decision === "RUN").length,
        executedCount: existingEvent.completedCount,
        contactDeleted: false,
      }
    }
  }
  const automations = await prismaTx.automation.findMany({
    where: {
      tenantId: event.tenantId,
      isEnabled: true,
      triggerType: event.triggerType,
      pipelineId: event.pipelineId,
      ...(event.triggerType === "OPPORTUNITY_STAGE_CHANGED"
        ? { targetStageId: event.targetStageId }
        : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      conditions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      actions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  })
  if (automations.length === 0) {
    return {
      automationEventId: null,
      automationStatus: "NOT_APPLICABLE",
      queuedAutomationCount: 0,
      matchedCount: 0,
      executedCount: 0,
      contactDeleted: false,
    }
  }

  const [contact, catalog] = await Promise.all([
    prismaTx.contact.findFirst({
      where: { tenantId: event.tenantId, id: event.contactId },
      select: {
        firstName: true,
        middleName: true,
        lastName: true,
        statusConfigId: true,
        assignedToUserId: true,
        tags: { select: { tagId: true } },
        customFieldValues: { select: { fieldId: true, value: true } },
      },
    }),
    getAutomationRuntimeCatalog(prismaTx, event.tenantId),
  ])
  if (!contact) throw new Error("Contact not found while queuing automation.")

  const contactName = getContactDisplayName(contact)
  const eventId = randomUUID()
  const chainId = event.chainId ?? eventId
  const chainDepth = event.chainDepth ?? 0
  const transitionHistory = event.transitionHistory ?? [{
    kind: event.triggerType === "OPPORTUNITY_CREATED" ? "CREATED" as const : "STAGE_CHANGED" as const,
    opportunityKey: event.opportunityId,
    pipelineId: event.pipelineId,
    sourceStageId: event.sourceStageId,
    targetStageId: event.targetStageId,
  }]
  const occurredAt = new Date()
  const matchingAutomations = automations.filter((automation: any) => {
    const trigger = evaluateAutomationTrigger(automation, event, catalog)
    if (!trigger.matches) return false
    return evaluateAutomationConditions(automation, event, contact, catalog).matches
  })
  if (matchingAutomations.length === 0) {
    return {
      automationEventId: null,
      automationStatus: "NOT_APPLICABLE",
      queuedAutomationCount: 0,
      matchedCount: 0,
      executedCount: 0,
      contactDeleted: false,
    }
  }

  const dispatches = matchingAutomations.map((automation: any, automationOrder: number) => {
    const actions = automation.actions.map(automationActionSnapshot)
    return {
      id: randomUUID(),
      tenantId: event.tenantId,
      eventId,
      automationId: automation.id,
      automationSnapshotId: automation.id,
      automationName: automation.name,
      automationOrder,
      triggerType: automation.triggerType,
      sourceStageId: automation.sourceStageId,
      targetStageId: automation.targetStageId,
      decision: "RUN" as const,
      decisionDetails: "The opportunity event matched this trigger.",
      actionSnapshot: actions,
      attemptId: randomUUID(),
      triggerExecutionId: randomUUID(),
    }
  })

  await prismaTx.automationEvent.create({
    data: {
      id: eventId,
      tenantId: event.tenantId,
      contactId: event.contactId,
      contactName,
      opportunityId: event.opportunityId,
      opportunitySnapshotId: event.opportunityId,
      actorUserId: event.actorUserId,
      actorName: event.actorUserId ? catalog.userMap.get(event.actorUserId) ?? null : null,
      triggerType: event.triggerType,
      pipelineId: event.pipelineId,
      pipelineName: catalog.pipelineMap.get(event.pipelineId) ?? "Pipeline",
      sourceStageId: event.sourceStageId,
      sourceStageName: event.sourceStageId
        ? catalog.stageMap.get(event.sourceStageId) ?? "Stage"
        : null,
      targetStageId: event.targetStageId,
      targetStageName: catalog.stageMap.get(event.targetStageId) ?? "Stage",
      valueCents: event.valueCents,
      chainId,
      parentEventId: event.parentEventId ?? null,
      chainDepth,
      transitionHistory,
      sourceAutomationId: event.sourceAutomationId ?? null,
      sourceAutomationName: event.sourceAutomationName ?? null,
      sourceNodeKey: event.sourceNodeKey ?? null,
      causationKey: event.causationKey ?? null,
      dispatchCount: dispatches.length,
    },
  })
  await prismaTx.automationDispatch.createMany({ data: dispatches })
  await prismaTx.automationNodeExecution.createMany({
    data: dispatches.map((dispatch: any) => ({
      id: dispatch.triggerExecutionId,
      tenantId: event.tenantId,
      automationId: dispatch.automationId,
      automationName: dispatch.automationName,
      contactId: event.contactId,
      contactName,
      actorUserId: event.actorUserId,
      processId: null,
      opportunityId: event.opportunityId,
      attemptId: dispatch.attemptId,
      eventSource: event.triggerType,
      nodeKind: "TRIGGER" as const,
      nodeOrder: 0,
      nodeKey: dispatch.triggerType,
      nodeLabel: getAutomationTriggerLabel(dispatch.triggerType),
      status: "QUEUED" as const,
      reasonCode: "AUTOMATION_QUEUED",
      details: "Queued for automation processing.",
      occurredAt,
    })),
  })

  return {
    automationEventId: eventId,
    automationStatus: "QUEUED",
    queuedAutomationCount: dispatches.length,
    matchedCount: dispatches.length,
    executedCount: 0,
    contactDeleted: false,
  }
}

async function createSideEffects(prismaTx: any, params: {
  tenantId: string
  dispatchId: string
  notificationIds: string[]
  fileCleanupCandidates: Array<{ id: string; tenantId: string; key: string }>
}) {
  const rows = [
    ...params.notificationIds.map((notificationId) => ({
      tenantId: params.tenantId,
      type: "NOTIFICATION_DELIVERY" as const,
      idempotencyKey: `automation-dispatch:${params.dispatchId}:notification:${notificationId}`,
      payload: { notificationId },
    })),
    ...params.fileCleanupCandidates.map((file) => ({
      tenantId: params.tenantId,
      type: "FILE_DELETE" as const,
      idempotencyKey: `automation-dispatch:${params.dispatchId}:file:${file.id}`,
      payload: { fileId: file.id, key: file.key },
    })),
  ]
  if (rows.length > 0) {
    await prismaTx.automationSideEffect.createMany({ data: rows, skipDuplicates: true })
  }
}

async function cancelRemainingDispatches(prismaTx: any, event: any, afterOrder: number) {
  const remaining = await prismaTx.automationDispatch.findMany({
    where: { eventId: event.id, automationOrder: { gt: afterOrder }, status: "QUEUED" },
    orderBy: { automationOrder: "asc" },
  })
  for (const dispatch of remaining) {
    let actions: RuntimeAutomationAction[] = []
    try {
      actions = parseActionSnapshot(dispatch.actionSnapshot)
    } catch {
      // Preserve a readable terminal dispatch even when a persisted snapshot is corrupt.
    }
    await prismaTx.automationNodeExecution.update({
      where: { id: dispatch.triggerExecutionId },
      data: {
        contactId: null,
        status: "SKIPPED",
        reasonCode: "CONTACT_DELETED",
        details: "Skipped because an earlier automation deleted the contact.",
        occurredAt: new Date(),
      },
    })
    const logs = actionLogs({
      event: { ...event, contactId: null, opportunityId: null },
      dispatch,
      actions,
      status: "SKIPPED",
      reasonCode: "CONTACT_DELETED",
      details: "Skipped because an earlier automation deleted the contact.",
    })
    if (logs.length > 0) await prismaTx.automationNodeExecution.createMany({ data: logs })
    await prismaTx.automationDispatch.update({
      where: { id: dispatch.id },
      data: { status: "CANCELED", completedAt: new Date() },
    })
  }
}

export async function claimQueuedAutomationDispatch(
  prismaTx: any,
  dispatch: { id: string; startedAt?: Date | null },
  now: Date,
) {
  const claimed = await prismaTx.automationDispatch.updateMany({
    where: { id: dispatch.id, status: "QUEUED" },
    data: { status: "PROCESSING", startedAt: dispatch.startedAt ?? now },
  })
  return claimed.count === 1
}

async function processDispatch(prismaClient: any, eventId: string, dispatchId: string) {
  const transactionStartedAt = Date.now()
  const result = await prismaClient.$transaction(async (prismaTx: any) => {
    const dispatch = await prismaTx.automationDispatch.findUnique({
      where: { id: dispatchId },
      include: { event: true },
    })
    if (!dispatch || dispatch.eventId !== eventId) return { terminal: true, contactDeleted: false, queuedRunCount: 0 }
    if (["COMPLETED", "FAILED", "SKIPPED", "CANCELED"].includes(dispatch.status)) {
      return { terminal: true, contactDeleted: false, queuedRunCount: 0 }
    }
    const event = dispatch.event
    const actions = parseActionSnapshot(dispatch.actionSnapshot)
    const now = new Date()
    if (!await claimQueuedAutomationDispatch(prismaTx, dispatch, now)) {
      return { terminal: true, contactDeleted: false, queuedRunCount: 0 }
    }

    if (!event.contactId) {
      await prismaTx.automationNodeExecution.update({
        where: { id: dispatch.triggerExecutionId },
        data: {
          contactId: null,
          status: "SKIPPED",
          reasonCode: "CONTACT_UNAVAILABLE",
          details: "Skipped because the contact is no longer available.",
          occurredAt: now,
        },
      })
      const logs = actionLogs({
        event,
        dispatch,
        actions,
        status: "SKIPPED",
        reasonCode: "CONTACT_UNAVAILABLE",
        details: "Skipped because the contact is no longer available.",
      })
      if (logs.length > 0) await prismaTx.automationNodeExecution.createMany({ data: logs })
      await prismaTx.automationDispatch.update({
        where: { id: dispatch.id },
        data: { status: "CANCELED", completedAt: now },
      })
      return { terminal: true, contactDeleted: false, queuedRunCount: 0 }
    }

    if (dispatch.decision !== "RUN") {
      const filterMismatch = dispatch.decision === "SKIP_FILTERS"
      await prismaTx.automationNodeExecution.update({
        where: { id: dispatch.triggerExecutionId },
        data: {
          status: filterMismatch ? "EXECUTED" : "SKIPPED",
          reasonCode: filterMismatch ? null : "TRIGGER_NOT_MATCHED",
          details: dispatch.decisionDetails,
          occurredAt: now,
        },
      })
      const logs = actionLogs({
        event,
        dispatch,
        actions,
        status: "SKIPPED",
        reasonCode: filterMismatch ? "FILTERS_NOT_MET" : "TRIGGER_NOT_MET",
        details: filterMismatch
          ? dispatch.decisionDetails ?? "The contact did not match the trigger filters."
          : `Skipped because the automation trigger did not match. ${dispatch.decisionDetails ?? ""}`.trim(),
      })
      if (logs.length > 0) await prismaTx.automationNodeExecution.createMany({ data: logs })
      await prismaTx.automationDispatch.update({
        where: { id: dispatch.id },
        data: { status: "SKIPPED", completedAt: now },
      })
      return { terminal: true, contactDeleted: false, queuedRunCount: 0 }
    }

    await prismaTx.automationNodeExecution.update({
      where: { id: dispatch.triggerExecutionId },
      data: {
        status: "EXECUTED",
        reasonCode: null,
        details: dispatch.decisionDetails ?? "The opportunity event matched this trigger.",
        occurredAt: now,
      },
    })
    const run = await prismaTx.automationRun.create({
      data: {
        tenantId: dispatch.tenantId,
        automationId: dispatch.automationId,
        automationName: dispatch.automationName,
        contactId: event.contactId,
        contactName: event.contactName,
        actorUserId: event.actorUserId,
        opportunityId: event.opportunityId,
        attemptId: dispatch.attemptId,
        dispatchId: dispatch.id,
        eventSource: event.triggerType,
        triggerType: event.triggerType,
        sourceStageId: event.sourceStageId,
        targetStageId: event.targetStageId,
        actionSnapshot: actions,
        cursorIndex: 0,
        eventContext: {
          pipelineId: event.pipelineId,
          valueCents: event.valueCents,
          sourceStageId: event.sourceStageId,
          targetStageId: event.targetStageId,
          occurredAt: event.createdAt instanceof Date ? event.createdAt.toISOString() : String(event.createdAt),
          eventId: event.id,
          chainId: event.chainId,
          chainDepth: event.chainDepth,
          transitionHistory: event.transitionHistory,
        },
        status: "RUNNING",
      },
    })
    const catalog = await getAutomationRuntimeCatalog(prismaTx, dispatch.tenantId)
    const result = await executeAutomationSegmentTx(prismaTx, {
      run,
      actions,
      catalog,
      startIndex: 0,
      occurredAt: now,
      queueOpportunityEvent: queueOpportunityAutomationEvent,
    })
    if (result.logs.length > 0) {
      await prismaTx.automationNodeExecution.createMany({ data: result.logs })
    }
    await createSideEffects(prismaTx, {
      tenantId: dispatch.tenantId,
      dispatchId: dispatch.id,
      notificationIds: result.notificationIds,
      fileCleanupCandidates: result.fileCleanupCandidates,
    })
    await prismaTx.automationDispatch.update({
      where: { id: dispatch.id },
      data: { status: "COMPLETED", completedAt: now },
    })
    if (result.contactDeleted) {
      await cancelRemainingDispatches(prismaTx, event, dispatch.automationOrder)
    }
    return { terminal: true, contactDeleted: result.contactDeleted, queuedRunCount: result.queuedRunCount }
  }, { maxWait: 5_000, timeout: 20_000 })
  console.info(JSON.stringify({
    metric: "automation_segment_transaction",
    eventId,
    dispatchId,
    durationMs: Date.now() - transactionStartedAt,
  }))
  if (result.queuedRunCount > 0) {
    kickAutomationRunWorker({ queueOpportunityEvent: queueOpportunityAutomationEvent })
  }
  return result
}

function isTransientQueueError(error: unknown) {
  if (error instanceof AutomationExecutionError) {
    return error.code === "OPPORTUNITY_CHANGED_CONCURRENTLY"
  }
  const value = error as { code?: string; message?: string }
  if (["P1001", "P1008", "P1017", "P2028", "P2034"].includes(value?.code ?? "")) return true
  return /deadlock|serializ|connection.*(?:closed|reset|terminated)|timed? out|expired transaction/i.test(
    value?.message ?? "",
  )
}

async function recordDispatchFailure(prismaClient: any, dispatchId: string, error: unknown) {
  await prismaClient.$transaction(async (prismaTx: any) => {
    const dispatch = await prismaTx.automationDispatch.findUnique({
      where: { id: dispatchId },
      include: { event: true },
    })
    if (!dispatch || ["COMPLETED", "FAILED", "SKIPPED", "CANCELED"].includes(dispatch.status)) return
    let actions: RuntimeAutomationAction[] = []
    try {
      actions = parseActionSnapshot(dispatch.actionSnapshot)
    } catch {
      // The dispatch itself still needs a terminal audit record when its snapshot is corrupt.
    }
    const message = error instanceof Error ? error.message : "The automation could not be completed."
    const executionError = error instanceof AutomationExecutionError ? error : null
    const failureCode = executionError?.code ?? "AUTOMATION_EXECUTION_FAILED"
    const logs = executionError?.nodeExecutions.length
      ? executionError.nodeExecutions
      : actions.length > 0
        ? actionLogs({
          event: dispatch.event,
          dispatch,
          actions,
          status: "FAILED",
          reasonCode: failureCode,
          details: message.slice(0, 500),
        })
        : [{
            tenantId: dispatch.tenantId,
            automationId: dispatch.automationId,
            automationName: dispatch.automationName,
            contactId: dispatch.event.contactId,
            contactName: dispatch.event.contactName,
            actorUserId: dispatch.event.actorUserId,
            processId: null,
            opportunityId: dispatch.event.opportunityId,
            attemptId: dispatch.attemptId,
            eventSource: dispatch.event.triggerType,
            nodeKind: "ACTION" as const,
            nodeOrder: 1,
            nodeKey: "invalid-action-snapshot",
            nodeLabel: "Automation action",
            status: "FAILED" as const,
            reasonCode: "INVALID_ACTION_SNAPSHOT",
            details: message.slice(0, 500),
            occurredAt: new Date(),
          }]
    const now = new Date()
    const failedStep = executionError
      ? flattenAutomationActionTree(actions).find((step) => step.nodeOrder - 1 === executionError.actionIndex)
      : null
    await prismaTx.automationNodeExecution.update({
      where: { id: dispatch.triggerExecutionId },
      data: {
        status: "EXECUTED",
        reasonCode: null,
        details: dispatch.decisionDetails ?? "The opportunity event matched this trigger.",
        occurredAt: now,
      },
    })
    if (logs.length > 0) await prismaTx.automationNodeExecution.createMany({ data: logs })
    await prismaTx.automationRun.upsert({
      where: { dispatchId: dispatch.id },
      create: {
        tenantId: dispatch.tenantId,
        automationId: dispatch.automationId,
        automationName: dispatch.automationName,
        contactId: dispatch.event.contactId,
        contactName: dispatch.event.contactName,
        actorUserId: dispatch.event.actorUserId,
        opportunityId: dispatch.event.opportunityId,
        attemptId: dispatch.attemptId,
        dispatchId: dispatch.id,
        eventSource: dispatch.event.triggerType,
        triggerType: dispatch.event.triggerType,
        sourceStageId: dispatch.event.sourceStageId,
        targetStageId: dispatch.event.targetStageId,
        actionSnapshot: actions,
        cursorIndex: Math.max(0, executionError?.actionIndex ?? 0),
        cursorPath: executionError?.cursorPath ?? null,
        branchDecisions: executionError?.branchDecisions ?? {},
        eventContext: {
          pipelineId: dispatch.event.pipelineId,
          valueCents: dispatch.event.valueCents,
          sourceStageId: dispatch.event.sourceStageId,
          targetStageId: dispatch.event.targetStageId,
          occurredAt: dispatch.event.createdAt instanceof Date
            ? dispatch.event.createdAt.toISOString()
            : String(dispatch.event.createdAt),
          eventId: dispatch.event.id,
          chainId: dispatch.event.chainId,
          chainDepth: dispatch.event.chainDepth,
          transitionHistory: dispatch.event.transitionHistory,
        },
        status: "FAILED",
        failureNodeKey: failedStep?.action.nodeKey ?? actions[executionError?.actionIndex ?? 0]?.nodeKey ?? null,
        failureCode,
        failureMessage: message.slice(0, 500),
        failedAt: now,
      },
      update: {
        status: "FAILED",
        cursorPath: executionError?.cursorPath ?? undefined,
        branchDecisions: executionError?.branchDecisions ?? undefined,
        failureCode,
        failureMessage: message.slice(0, 500),
        failedAt: now,
      },
    })
    await prismaTx.automationExecution.create({
      data: {
        tenantId: dispatch.tenantId,
        automationId: dispatch.automationId,
        automationName: dispatch.automationName,
        triggerType: dispatch.event.triggerType,
        status: "FAILED",
        opportunityId: dispatch.event.opportunityId,
        contactId: dispatch.event.contactId,
        sourceStageId: dispatch.event.sourceStageId,
        targetStageId: dispatch.event.targetStageId,
        actorUserId: dispatch.event.actorUserId,
        actionCount: Math.max(0, executionError?.actionIndex ?? 0),
        errorCode: failureCode,
        errorMessage: message.slice(0, 500),
      },
    })
    await prismaTx.automationDispatch.update({
      where: { id: dispatch.id },
      data: {
        status: "FAILED",
        errorCode: "AUTOMATION_EXECUTION_FAILED",
        errorMessage: message.slice(0, 500),
        completedAt: now,
      },
    })
  }, { maxWait: 5_000, timeout: 20_000 })
}

async function refreshEventProgress(prismaClient: any, eventId: string, leaseToken: string) {
  const grouped = await prismaClient.automationDispatch.groupBy({
    by: ["status"],
    where: { eventId },
    _count: { _all: true },
  })
  const counts = new Map<string, number>(
    grouped.map((item: any) => [String(item.status), Number(item._count._all)]),
  )
  const queued = (counts.get("QUEUED") ?? 0) + (counts.get("PROCESSING") ?? 0)
  const completedCount = counts.get("COMPLETED") ?? 0
  const skippedCount = (counts.get("SKIPPED") ?? 0) + (counts.get("CANCELED") ?? 0)
  const failedCount = counts.get("FAILED") ?? 0
  const now = new Date()
  const status = queued > 0
    ? "PROCESSING"
    : failedCount > 0
      ? (completedCount + skippedCount > 0 ? "COMPLETED_WITH_ERRORS" : "FAILED")
      : "COMPLETED"
  await prismaClient.automationEvent.updateMany({
    where: { id: eventId, leaseToken },
    data: {
      status,
      completedCount,
      skippedCount,
      failedCount,
      cursor: completedCount + skippedCount + failedCount,
      leaseToken: queued > 0 ? leaseToken : null,
      leaseExpiresAt: queued > 0 ? new Date(now.getTime() + 120_000) : null,
      completedAt: queued > 0 ? null : now,
    },
  })
  return { status, completedCount, skippedCount, failedCount }
}

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000]

export async function processClaimedAutomationEvent(
  prismaClient: any,
  params: { eventId: string; leaseToken: string },
) {
  const event = await prismaClient.automationEvent.findUnique({
    where: { id: params.eventId },
    include: { dispatches: { orderBy: { automationOrder: "asc" } } },
  })
  if (!event || event.leaseToken !== params.leaseToken || event.status !== "PROCESSING") return

  for (const dispatch of event.dispatches) {
    if (["COMPLETED", "FAILED", "SKIPPED", "CANCELED"].includes(dispatch.status)) continue
    await prismaClient.automationEvent.updateMany({
      where: { id: event.id, leaseToken: params.leaseToken, status: "PROCESSING" },
      data: { leaseExpiresAt: new Date(Date.now() + 120_000) },
    })
    try {
      const result = await processDispatch(prismaClient, event.id, dispatch.id)
      if (result?.contactDeleted) break
    } catch (error) {
      const nextAttempt = dispatch.attemptCount + 1
      if (isTransientQueueError(error) && nextAttempt <= RETRY_DELAYS_MS.length) {
        const availableAt = new Date(Date.now() + RETRY_DELAYS_MS[nextAttempt - 1]!)
        console.warn(JSON.stringify({
          metric: "automation_dispatch_retry",
          eventId: event.id,
          dispatchId: dispatch.id,
          tenantId: event.tenantId,
          attempt: nextAttempt,
          availableAt: availableAt.toISOString(),
        }))
        await prismaClient.$transaction([
          prismaClient.automationDispatch.update({
            where: { id: dispatch.id },
            data: { status: "QUEUED", attemptCount: nextAttempt, errorMessage: String((error as Error)?.message ?? error).slice(0, 500) },
          }),
          prismaClient.automationEvent.updateMany({
            where: { id: event.id, leaseToken: params.leaseToken },
            data: {
              status: "QUEUED",
              availableAt,
              attemptCount: { increment: 1 },
              leaseToken: null,
              leaseExpiresAt: null,
              lastError: String((error as Error)?.message ?? error).slice(0, 500),
            },
          }),
        ])
        return
      }
      await recordDispatchFailure(prismaClient, dispatch.id, error)
    }
  }

  return refreshEventProgress(prismaClient, event.id, params.leaseToken)
}

export async function getAutomationEventStatus(prismaClient: any, tenantId: string, eventId: string) {
  const event = await prismaClient.automationEvent.findFirst({
    where: { id: eventId, tenantId },
    select: {
      id: true,
      status: true,
      dispatchCount: true,
      completedCount: true,
      skippedCount: true,
      failedCount: true,
      createdAt: true,
      processingStartedAt: true,
      completedAt: true,
      dispatches: { select: { status: true } },
    },
  })
  if (!event) return null
  const running = event.dispatches.filter((item: any) => item.status === "PROCESSING").length
  const queued = event.dispatches.filter((item: any) => item.status === "QUEUED").length
  const completed = event.dispatches.filter((item: any) => item.status === "COMPLETED").length
  const skipped = event.dispatches.filter((item: any) => item.status === "SKIPPED" || item.status === "CANCELED").length
  const failed = event.dispatches.filter((item: any) => item.status === "FAILED").length
  return {
    id: event.id,
    status: event.status,
    total: event.dispatchCount,
    queued,
    running,
    completed,
    skipped,
    failed,
    createdAt: event.createdAt,
    processingStartedAt: event.processingStartedAt,
    completedAt: event.completedAt,
  }
}
