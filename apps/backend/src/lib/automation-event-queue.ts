import { lockServiceStepRuntimeTx } from "./service-step-runtime.js"
import { settleServiceStepCompletionEventTx } from "./service-step-progression.js"
import { randomUUID } from "node:crypto"
import { Prisma } from "../generated/prisma/index.js"

import {
  AutomationServiceContextError,
  readAutomationServiceContext,
  automationServiceContextData,
  validateAutomationServiceContextTx,
  assertAutomationServiceContextRetry,
  type AutomationServiceContext,
} from "./automation-service-context.js"
import { contactSnapshotsDiffer, matchesContactChangeRules, type ContactChangeSnapshot } from "./contact-change-rules.js"
import { birthdayLocalClock, isBirthdayOnLocalDate, isBirthdayReminderDue } from "./automation-birthday.js"

import {
  AutomationExecutionError,
  CONTACT_AUTOMATION_SNAPSHOT_SELECT,
  automationTriggerCandidateWhere,
  automationActionSnapshot,
  evaluateAutomationConditions,
  evaluateAutomationAppointmentConditions,
  evaluateAutomationTaskConditions,
  evaluateAutomationTrigger,
  executeAutomationSegmentTx,
  flattenAutomationActionTree,
  getAutomationRuntimeCatalog,
  kickAutomationRunWorker,
  parseActionSnapshot,
  type OpportunityAutomationEvent,
  type OpportunityAutomationTransition,
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
    ...automationServiceContextData(params.event),
    attemptId: params.dispatch.attemptId,
    eventSource: params.dispatch.triggerType,
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
  await validateAutomationServiceContextTx(prismaTx, event)
  if (!event.targetStageId) {
    throw new Error("An opportunity automation event requires a target stage.")
  }
  if (event.causationKey) {
    const existingEvent = await prismaTx.automationEvent.findUnique({
      where: { causationKey: event.causationKey },
      include: { dispatches: { select: { decision: true } } },
    })
    if (existingEvent) {
      assertAutomationServiceContextRetry(existingEvent, event)
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
      pipelineId: event.pipelineId,
      ...automationTriggerCandidateWhere(event),
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

  const needsContactFields = automations.some((automation: any) =>
    automation.conditions.some((condition: any) => condition.source === "CONTACT_FIELD"),
  )

  const [contact, catalog] = await Promise.all([
    prismaTx.contact.findFirst({
      where: { tenantId: event.tenantId, id: event.contactId },
      select: needsContactFields ? CONTACT_AUTOMATION_SNAPSHOT_SELECT : {
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
    kind: event.triggerType === "OPPORTUNITY_CREATED"
      ? "CREATED" as const
      : event.triggerType === "OPPORTUNITY_STAGE_CHANGED"
        ? "STAGE_CHANGED" as const
        : "CHANGED" as const,
    opportunityKey: event.opportunityId,
    pipelineId: event.pipelineId,
    sourceStageId: event.sourceStageId,
    targetStageId: event.targetStageId,
    sourceResult: event.sourceResult ?? null,
    targetResult: event.targetResult ?? null,
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
      targetResult: automation.targetResult,
      decision: "RUN" as const,
      decisionDetails: evaluateAutomationTrigger(automation, event, catalog).details,
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
      ...automationServiceContextData(event),
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
      sourceResult: event.sourceResult ?? null,
      targetResult: event.targetResult ?? null,
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
      ...automationServiceContextData(event),
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

export type ContactCreatedAutomationEvent = {
  serviceContext?: AutomationServiceContext | null
  tenantId: string
  contactId: string
  actorUserId: string | null
  chainId?: string | null
  parentEventId?: string | null
  chainDepth?: number
  sourceAutomationId?: string | null
  sourceAutomationName?: string | null
  sourceNodeKey?: string | null
  causationKey?: string | null
}

export type TaskAddedAutomationEvent = ContactCreatedAutomationEvent & { taskId: string }
export type TaskCompletedAutomationEvent = ContactCreatedAutomationEvent & { taskId: string; causationKey: string; completedAt: Date }
export type AppointmentCreatedAutomationEvent = ContactCreatedAutomationEvent & { appointmentId: string }
export type AppointmentStatusChangedAutomationEvent = ContactCreatedAutomationEvent & {
  appointmentId: string
  previousStatus: string
  status: string
  changedAt: Date
  causationKey: string
}
export type BirthdayReminderAutomationEvent = ContactCreatedAutomationEvent & {
  automationId: string
  occurrenceYear: number
  localDate: string
  timezone: string
  scheduledLocalTime: string
  clockAt: Date
}

export async function loadContactChangeSnapshot(prismaTx: any, tenantId: string, contactId: string): Promise<ContactChangeSnapshot | null> {
  if (typeof prismaTx.$queryRawUnsafe === "function") {
    await prismaTx.$queryRawUnsafe('SELECT id FROM "Contact" WHERE "tenantId" = $1 AND id = $2 FOR UPDATE', tenantId, contactId)
  }
  return prismaTx.contact.findFirst({
    where: { tenantId, id: contactId },
    select: CONTACT_AUTOMATION_SNAPSHOT_SELECT,
  })
}

export async function captureContactChangeSnapshot(prismaTx: any, tenantId: string, contactId: string): Promise<ContactChangeSnapshot | null> {
  // Only snapshot contacts when a published contact change or tag automation can use the change.
  // Some lightweight execution clients do not expose the automation catalog.
  if (typeof prismaTx.automation?.count !== "function") return null
  const enabledCount = await prismaTx.automation.count({
    where: { tenantId, isEnabled: true, triggerType: { in: ["CONTACT_CHANGED", "CONTACT_TAG"] } },
  })
  if (enabledCount === 0) return null
  return loadContactChangeSnapshot(prismaTx, tenantId, contactId)
}

export type ContactChangedAutomationEvent = ContactCreatedAutomationEvent & {
  before: ContactChangeSnapshot
  transitionHistory?: OpportunityAutomationTransition[]
}

export async function queueContactChangedAutomationEvent(
  prismaTx: any,
  event: ContactChangedAutomationEvent,
): Promise<QueuedAutomationResult> {
  await validateAutomationServiceContextTx(prismaTx, event)
  const noMatch: QueuedAutomationResult = {
    automationEventId: null,
    automationStatus: "NOT_APPLICABLE",
    queuedAutomationCount: 0,
    matchedCount: 0,
    executedCount: 0,
    contactDeleted: false,
  }
  const after = await loadContactChangeSnapshot(prismaTx, event.tenantId, event.contactId)
  if (!after || !contactSnapshotsDiffer(event.before, after)) return noMatch
  if ((event.chainDepth ?? 0) > 20) throw new Error("This contact update exceeded the maximum automation chain depth.")
  if (event.causationKey) {
    const existing = await prismaTx.automationEvent.findUnique({
      where: { causationKey: event.causationKey },
      include: { dispatches: { select: { decision: true } } },
    })
    if (existing) assertAutomationServiceContextRetry(existing, event)
    if (existing) return {
      automationEventId: existing.id,
      automationStatus: "QUEUED",
      queuedAutomationCount: existing.dispatches.length,
      matchedCount: existing.dispatches.filter((item: any) => item.decision === "RUN").length,
      executedCount: existing.completedCount,
      contactDeleted: false,
    }
  }
  const automations = await prismaTx.automation.findMany({
    where: { tenantId: event.tenantId, isEnabled: true, triggerType: { in: ["CONTACT_CHANGED", "CONTACT_TAG"] } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      changeRules: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      conditions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      actions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  })
  if (automations.length === 0) return noMatch
  const catalog = await getAutomationRuntimeCatalog(prismaTx, event.tenantId)
  const matches = automations.filter((automation: any) =>
    matchesContactChangeRules(automation.changeRules, event.before, after) &&
    evaluateAutomationConditions(automation, { valueCents: null }, after, catalog).matches,
  )
  if (matches.length === 0) return noMatch
  const eventId = randomUUID()
  const occurredAt = new Date()
  const contactName = getContactDisplayName(after)
  const dispatches = matches.map((automation: any, automationOrder: number) => ({
    id: randomUUID(),
    tenantId: event.tenantId,
    eventId,
    automationId: automation.id,
    automationSnapshotId: automation.id,
    automationName: automation.name,
    automationOrder,
    triggerType: automation.triggerType as "CONTACT_CHANGED" | "CONTACT_TAG",
    sourceStageId: null,
    targetStageId: null,
    targetResult: null,
    decision: "RUN" as const,
    decisionDetails: automation.triggerType === "CONTACT_TAG"
      ? "The selected tag change and contact filters matched."
      : "The selected contact changes and filters matched.",
    actionSnapshot: automation.actions.map(automationActionSnapshot),
    attemptId: randomUUID(),
    triggerExecutionId: randomUUID(),
  }))
  await prismaTx.automationEvent.create({ data: {
    id: eventId,
    tenantId: event.tenantId,
    contactId: event.contactId,
    contactName,
    opportunityId: null,
    ...automationServiceContextData(event),
    opportunitySnapshotId: null,
    actorUserId: event.actorUserId,
    actorName: event.actorUserId ? catalog.userMap.get(event.actorUserId) ?? null : null,
    triggerType: "CONTACT_CHANGED",
    pipelineId: null,
    pipelineName: null,
    sourceStageId: null,
    sourceStageName: null,
    targetStageId: null,
    targetStageName: null,
    sourceResult: null,
    targetResult: null,
    valueCents: null,
    chainId: event.chainId ?? eventId,
    parentEventId: event.parentEventId ?? null,
    chainDepth: event.chainDepth ?? 0,
    transitionHistory: event.transitionHistory ?? [],
    sourceAutomationId: event.sourceAutomationId ?? null,
    sourceAutomationName: event.sourceAutomationName ?? null,
    sourceNodeKey: event.sourceNodeKey ?? null,
    causationKey: event.causationKey ?? null,
    dispatchCount: dispatches.length,
  } })
  await prismaTx.automationDispatch.createMany({ data: dispatches })
  await prismaTx.automationNodeExecution.createMany({ data: dispatches.map((dispatch: any) => ({
    id: dispatch.triggerExecutionId,
    tenantId: event.tenantId,
    automationId: dispatch.automationId,
    automationName: dispatch.automationName,
    contactId: event.contactId,
    contactName,
    actorUserId: event.actorUserId,
    processId: null,
    opportunityId: null,
    ...automationServiceContextData(event),
    attemptId: dispatch.attemptId,
    eventSource: dispatch.triggerType,
    nodeKind: "TRIGGER" as const,
    nodeOrder: 0,
    nodeKey: dispatch.triggerType,
    nodeLabel: getAutomationTriggerLabel(dispatch.triggerType),
    status: "QUEUED" as const,
    reasonCode: "AUTOMATION_QUEUED",
    details: "Queued for automation processing.",
    occurredAt,
  })) })
  return { ...noMatch, automationEventId: eventId, automationStatus: "QUEUED", queuedAutomationCount: dispatches.length, matchedCount: dispatches.length }
}

async function queueContactSnapshotAutomationEvent(
  prismaTx: any,
  event: ContactCreatedAutomationEvent & { taskId?: string; appointmentId?: string; completedAt?: Date; previousStatus?: string; status?: string; changedAt?: Date; automationId?: string; automationIds?: string[]; serviceStepId?: string; serviceOfferingId?: string; occurrenceYear?: number; localDate?: string; timezone?: string; scheduledLocalTime?: string; clockAt?: Date },
  triggerType: "SERVICE_STEP_ENTERED" | "SERVICE_STEP_COMPLETED" | "CONTACT_CREATED" | "CONTACT_NOTE_ADDED" | "TASK_ADDED" | "TASK_COMPLETED" | "APPOINTMENT_CREATED" | "APPOINTMENT_STATUS_CHANGED" | "BIRTHDAY_REMINDER",
): Promise<QueuedAutomationResult> {
  await validateAutomationServiceContextTx(prismaTx, event)
  if (triggerType !== "CONTACT_CREATED" && typeof prismaTx.automation?.findMany !== "function") return {
    automationEventId: null,
    automationStatus: "NOT_APPLICABLE",
    queuedAutomationCount: 0,
    matchedCount: 0,
    executedCount: 0,
    contactDeleted: false,
  }
  const isTaskEvent = triggerType === "TASK_ADDED" || triggerType === "TASK_COMPLETED"
  if (isTaskEvent && event.taskId && typeof prismaTx.$queryRawUnsafe === "function") {
    await prismaTx.$queryRawUnsafe('SELECT id FROM "Task" WHERE "tenantId" = $1 AND id = $2 FOR UPDATE', event.tenantId, event.taskId)
  }
  if (event.causationKey && (triggerType === "CONTACT_CREATED" || typeof prismaTx.automationEvent?.findUnique === "function")) {
    const existing = await prismaTx.automationEvent.findUnique({
      where: { causationKey: event.causationKey },
      include: { dispatches: { select: { decision: true } } },
    })
    if (existing) assertAutomationServiceContextRetry(existing, event)
    if (existing) return {
      automationEventId: existing.id,
      automationStatus: "QUEUED",
      queuedAutomationCount: existing.dispatches.length,
      matchedCount: existing.dispatches.filter((item: any) => item.decision === "RUN").length,
      executedCount: existing.completedCount,
      contactDeleted: false,
    }
  }
  const foundAutomations = await prismaTx.automation.findMany({
    where: { tenantId: event.tenantId, isEnabled: true, triggerType, ...(event.automationId ? { id: event.automationId } : event.automationIds ? { id: { in: event.automationIds } } : {}), ...(event.serviceStepId ? { serviceStepId: event.serviceStepId, OR: [{ serviceOfferingId: null }, { serviceOfferingId: event.serviceOfferingId }] } : {}) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      conditions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      actions: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  })
  const automations = foundAutomations.filter((automation: any) => automation.triggerType === triggerType && (!["SERVICE_STEP_ENTERED", "SERVICE_STEP_COMPLETED"].includes(triggerType) || automation.actions.length > 0))
  if (automations.length === 0) return {
    automationEventId: null,
    automationStatus: "NOT_APPLICABLE",
    queuedAutomationCount: 0,
    matchedCount: 0,
    executedCount: 0,
    contactDeleted: false,
  }
  const [contact, catalog] = await Promise.all([
    prismaTx.contact.findFirst({
      where: { tenantId: event.tenantId, id: event.contactId },
      select: CONTACT_AUTOMATION_SNAPSHOT_SELECT,
    }),
    getAutomationRuntimeCatalog(prismaTx, event.tenantId),
  ])
  if (!contact && triggerType === "BIRTHDAY_REMINDER") return {
    automationEventId: null, automationStatus: "NOT_APPLICABLE", queuedAutomationCount: 0,
    matchedCount: 0, executedCount: 0, contactDeleted: false,
  }
  if (!contact) throw new Error("Contact not found while queuing automation.")
  if (triggerType === "BIRTHDAY_REMINDER") {
    const current = birthdayLocalClock(event.clockAt!, event.timezone!)
    if (automations[0]?.birthdayLocalTime !== event.scheduledLocalTime || contact.deceasedAt || current.localDate !== event.localDate || !isBirthdayOnLocalDate(contact.dateOfBirth, current.year, current.month, current.day) || !isBirthdayReminderDue(current.localTime, event.scheduledLocalTime!)) return {
      automationEventId: null, automationStatus: "NOT_APPLICABLE", queuedAutomationCount: 0,
      matchedCount: 0, executedCount: 0, contactDeleted: false,
    }
  }
  const task = isTaskEvent && event.taskId
    ? await prismaTx.task.findFirst({
        where: { tenantId: event.tenantId, id: event.taskId, contactId: event.contactId },
        select: { id: true, name: true, description: true, statusConfigId: true, assignedToUserId: true, startedAt: true, dueDate: true, priority: true, linkedEntityName: true, linkedEntityType: true },
      })
    : null
  if (isTaskEvent && !task) throw new Error("Task not found while queuing automation.")
  const taskSnapshot = task ? {
    ...task,
    startedAt: task.startedAt?.toISOString() ?? null,
    dueDate: task.dueDate?.toISOString() ?? null,
    ...(triggerType === "TASK_COMPLETED" ? { completedAt: event.completedAt?.toISOString() ?? new Date().toISOString() } : {}),
  } : null
  const isAppointmentEvent = triggerType === "APPOINTMENT_CREATED" || triggerType === "APPOINTMENT_STATUS_CHANGED"
  const appointment = isAppointmentEvent && event.appointmentId
    ? await prismaTx.appointment.findFirst({
        where: { tenantId: event.tenantId, id: event.appointmentId, contactId: event.contactId },
        select: { id: true, title: true, notes: true, serviceId: true, bookedByUserId: true, assignedToUserId: true, startAt: true, endAt: true, isAllDay: true, status: true, createdAt: true, service: { select: { name: true } } },
      })
    : null
  if (isAppointmentEvent && !appointment) throw new Error("Appointment not found while queuing automation.")
  if (triggerType === "APPOINTMENT_STATUS_CHANGED" && appointment?.status !== event.status) throw new Error("Appointment status changed before queuing automation.")
  const appointmentSnapshot = appointment ? {
    id: appointment.id,
    title: appointment.title,
    notes: appointment.notes,
    serviceId: appointment.serviceId,
    serviceName: appointment.service?.name ?? null,
    bookedByUserId: appointment.bookedByUserId,
    assignedToUserId: appointment.assignedToUserId,
    startAt: appointment.startAt.toISOString(),
    endAt: appointment.endAt.toISOString(),
    isAllDay: appointment.isAllDay,
    status: appointment.status,
    createdAt: appointment.createdAt.toISOString(),
    ...(triggerType === "APPOINTMENT_STATUS_CHANGED" ? {
      previousStatus: event.previousStatus,
      changedAt: event.changedAt?.toISOString(),
    } : {}),
  } : null
  const matches = automations.filter((automation: any) =>
    automation.triggerType === triggerType &&
    evaluateAutomationConditions({ ...automation, conditions: automation.conditions.filter((condition: any) => condition.source !== "TASK_FIELD" && condition.source !== "APPOINTMENT_FIELD") }, { valueCents: null }, contact, catalog).matches &&
    (triggerType !== "TASK_ADDED" || evaluateAutomationTaskConditions(automation, taskSnapshot!).matches) &&
    (triggerType !== "APPOINTMENT_CREATED" || evaluateAutomationAppointmentConditions(automation, appointmentSnapshot!).matches) &&
    (triggerType !== "APPOINTMENT_STATUS_CHANGED" || automation.appointmentTargetStatus === event.status),
  )
  if (matches.length === 0) return {
    automationEventId: null,
    automationStatus: "NOT_APPLICABLE",
    queuedAutomationCount: 0,
    matchedCount: 0,
    executedCount: 0,
    contactDeleted: false,
  }
  if (triggerType === "BIRTHDAY_REMINDER") {
    const owned = await prismaTx.automationBirthdayClaim.createManyAndReturn({
      data: [{ tenantId: event.tenantId, automationId: event.automationId, contactId: event.contactId, occurrenceYear: event.occurrenceYear, localDate: event.localDate }],
      skipDuplicates: true,
      select: { contactId: true },
    })
    if (owned.length === 0) return {
      automationEventId: null, automationStatus: "NOT_APPLICABLE", queuedAutomationCount: 0,
      matchedCount: 0, executedCount: 0, contactDeleted: false,
    }
  }
  const eventId = randomUUID()
  const chainId = event.chainId ?? eventId
  const chainDepth = event.chainDepth ?? 0
  const claimedAutomationIds = new Set<string>()
  if (triggerType !== "CONTACT_CREATED" && chainDepth <= 20) {
    const claimable = matches
      .filter((automation: any) => automation.id !== event.sourceAutomationId)
      .sort((left: any, right: any) => left.id.localeCompare(right.id))
    if (claimable.length > 0) {
      const ownedClaims = await prismaTx.automationTriggerChainClaim.createManyAndReturn({
        data: claimable.map((automation: any) => ({
          tenantId: event.tenantId,
          chainId,
          automationId: automation.id,
        })),
        skipDuplicates: true,
        select: { automationId: true },
      })
      for (const claim of ownedClaims) claimedAutomationIds.add(claim.automationId)
    }
  }
  const occurredAt = new Date()
  const contactName = getContactDisplayName(contact)
  const dispatches = matches.map((automation: any, automationOrder: number) => ({
    id: randomUUID(),
    tenantId: event.tenantId,
    eventId,
    automationId: automation.id,
    automationSnapshotId: automation.id,
    automationName: automation.name,
    automationOrder,
    triggerType,
    sourceStageId: null,
    targetStageId: null,
    targetResult: null,
    decision: triggerType !== "CONTACT_CREATED" && !claimedAutomationIds.has(automation.id)
      ? "SKIP_TRIGGER" as const
      : "RUN" as const,
    decisionDetails: (triggerType === "SERVICE_STEP_ENTERED" || triggerType === "SERVICE_STEP_COMPLETED")
      ? `The enrollment ${triggerType === "SERVICE_STEP_COMPLETED" ? "completed" : "entered"} this service step and the contact filters matched.`
      : triggerType !== "CONTACT_CREATED"
      ? chainDepth > 20
        ? `Skipped: the automation chain reached its maximum depth. The ${triggerType === "CONTACT_NOTE_ADDED" ? "note was saved" : triggerType === "TASK_ADDED" ? "task was saved" : triggerType === "TASK_COMPLETED" ? "task remains completed" : isAppointmentEvent ? "appointment was saved" : "birthday reminder was saved"}.`
        : automation.id === event.sourceAutomationId
          ? `Skipped: this automation ${triggerType === "TASK_COMPLETED" ? "completed the task" : triggerType === "TASK_ADDED" ? "created the task" : triggerType === "APPOINTMENT_CREATED" ? "created the appointment" : triggerType === "APPOINTMENT_STATUS_CHANGED" ? "changed the appointment status" : triggerType === "CONTACT_NOTE_ADDED" ? "created the note" : "started the reminder"} and cannot restart itself.`
          : claimedAutomationIds.has(automation.id)
            ? `${triggerType === "TASK_COMPLETED" ? "A task was completed" : triggerType === "TASK_ADDED" ? "A task was added" : triggerType === "APPOINTMENT_CREATED" ? "An appointment was created" : triggerType === "APPOINTMENT_STATUS_CHANGED" ? "An appointment status changed" : triggerType === "CONTACT_NOTE_ADDED" ? "A note was added" : "The birthday reminder is due"} and the filters matched.`
            : "Skipped: this automation already ran for this automation chain."
      : "The contact matched the creation filters.",
    actionSnapshot: automation.actions.map(automationActionSnapshot),
    attemptId: randomUUID(),
    triggerExecutionId: randomUUID(),
  }))
  await prismaTx.automationEvent.create({ data: {
    id: eventId,
    tenantId: event.tenantId,
    contactId: event.contactId,
    contactName,
    opportunityId: null,
    ...automationServiceContextData(event),
    opportunitySnapshotId: null,
    taskId: taskSnapshot?.id ?? null,
    taskSnapshot: taskSnapshot ?? undefined,
    appointmentId: appointmentSnapshot?.id ?? null,
    appointmentSnapshot: appointmentSnapshot ?? undefined,
    contactSnapshot: triggerType === "APPOINTMENT_STATUS_CHANGED" ? {
      fields: Object.fromEntries(Object.entries(contact)
        .filter(([key]) => !["tags", "customFieldValues", "servicingAgentMembership", "additionalAgentMembership"].includes(key))
        .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])),
      tagIds: contact.tags.map((item: { tagId: string }) => item.tagId),
      customFieldValues: contact.customFieldValues
        .filter((item: { fieldId: string }) => catalog.fieldMap.has(item.fieldId))
        .map((item: { fieldId: string; value: unknown }) => ({ fieldId: item.fieldId, value: item.value })),
    } : undefined,
    birthdaySnapshot: triggerType === "BIRTHDAY_REMINDER" ? {
      dateOfBirth: contact.dateOfBirth.toISOString().slice(0, 10),
      localDate: event.localDate,
      timezone: event.timezone,
      scheduledLocalTime: event.scheduledLocalTime,
    } : undefined,
    actorUserId: event.actorUserId,
    actorName: event.actorUserId ? catalog.userMap.get(event.actorUserId) ?? null : null,
    triggerType,
    pipelineId: null,
    pipelineName: null,
    sourceStageId: null,
    sourceStageName: null,
    targetStageId: null,
    targetStageName: null,
    sourceResult: null,
    targetResult: null,
    valueCents: null,
    chainId,
    parentEventId: event.parentEventId ?? null,
    chainDepth: event.chainDepth ?? 0,
    transitionHistory: [],
    sourceAutomationId: event.sourceAutomationId ?? null,
    sourceAutomationName: event.sourceAutomationName ?? null,
    sourceNodeKey: event.sourceNodeKey ?? null,
    causationKey: event.causationKey ?? null,
    dispatchCount: dispatches.length,
  } })
  await prismaTx.automationDispatch.createMany({ data: dispatches })
  await prismaTx.automationNodeExecution.createMany({ data: dispatches.map((dispatch: any) => ({
    id: dispatch.triggerExecutionId,
    tenantId: event.tenantId,
    automationId: dispatch.automationId,
    automationName: dispatch.automationName,
    contactId: event.contactId,
    contactName,
    actorUserId: event.actorUserId,
    processId: null,
    opportunityId: null,
    ...automationServiceContextData(event),
    attemptId: dispatch.attemptId,
    eventSource: triggerType,
    nodeKind: "TRIGGER" as const,
    nodeOrder: 0,
    nodeKey: triggerType,
    nodeLabel: getAutomationTriggerLabel(triggerType),
    status: "QUEUED" as const,
    reasonCode: "AUTOMATION_QUEUED",
    details: "Queued for automation processing.",
    occurredAt,
  })) })
  return {
    automationEventId: eventId,
    automationStatus: "QUEUED",
    queuedAutomationCount: dispatches.length,
    matchedCount: dispatches.filter((dispatch: any) => dispatch.decision === "RUN").length,
    executedCount: 0,
    contactDeleted: false,
  }
}

async function queueServiceStepAutomationEvent(
  tx: any,
  event: ContactCreatedAutomationEvent & { serviceContext: AutomationServiceContext },
  triggerType: "SERVICE_STEP_ENTERED" | "SERVICE_STEP_COMPLETED",
): Promise<QueuedAutomationResult> {
  await validateAutomationServiceContextTx(tx, event)
  const context = event.serviceContext
  if (!context.serviceStepId || !context.contactServiceStepId || !context.serviceStepOccurrenceId) {
    throw new AutomationServiceContextError()
  }
  // Lock all matching configurations in a stable order before pinning their actions.
  const lockedAutomations: Array<{ id: string }> = await tx.$queryRaw(Prisma.sql`SELECT id FROM "Automation" WHERE "tenantId"=${event.tenantId} AND "serviceStepId"=${context.serviceStepId} AND "triggerType"=${triggerType}::"AutomationTriggerType" AND "isEnabled"=true AND ("serviceOfferingId" IS NULL OR "serviceOfferingId"=${context.serviceId}) ORDER BY id FOR SHARE`)
  return queueContactSnapshotAutomationEvent(tx, {
    ...event,
    automationIds: lockedAutomations.map((automation) => automation.id),
    serviceStepId: context.serviceStepId,
    serviceOfferingId: context.serviceId,
    causationKey: `service-step-${triggerType === "SERVICE_STEP_ENTERED" ? "entry" : "completion"}:${event.tenantId}:${context.serviceStepOccurrenceId}`,
  }, triggerType)
}

export const queueServiceStepEnteredAutomationEvent = (tx: any, event: ContactCreatedAutomationEvent & { serviceContext: AutomationServiceContext }) => queueServiceStepAutomationEvent(tx, event, "SERVICE_STEP_ENTERED")
export const queueServiceStepCompletedAutomationEvent = (tx: any, event: ContactCreatedAutomationEvent & { serviceContext: AutomationServiceContext }) => queueServiceStepAutomationEvent(tx, event, "SERVICE_STEP_COMPLETED")

export function queueContactCreatedAutomationEvent(prismaTx: any, event: ContactCreatedAutomationEvent) {
  return queueContactSnapshotAutomationEvent(prismaTx, event, "CONTACT_CREATED")
}

export function queueContactNoteAddedAutomationEvent(prismaTx: any, event: ContactCreatedAutomationEvent): Promise<QueuedAutomationResult> {
  return queueContactSnapshotAutomationEvent(prismaTx, event, "CONTACT_NOTE_ADDED")
}

export function queueTaskAddedAutomationEvent(prismaTx: any, event: TaskAddedAutomationEvent): Promise<QueuedAutomationResult> {
  return queueContactSnapshotAutomationEvent(prismaTx, { ...event, causationKey: event.causationKey ?? `task:${event.taskId}:added` }, "TASK_ADDED")
}

export function queueTaskCompletedAutomationEvent(prismaTx: any, event: TaskCompletedAutomationEvent): Promise<QueuedAutomationResult> {
  return queueContactSnapshotAutomationEvent(prismaTx, event, "TASK_COMPLETED")
}

export function queueAppointmentCreatedAutomationEvent(prismaTx: any, event: AppointmentCreatedAutomationEvent): Promise<QueuedAutomationResult> {
  return queueContactSnapshotAutomationEvent(prismaTx, { ...event, causationKey: event.causationKey ?? `appointment:${event.appointmentId}:created` }, "APPOINTMENT_CREATED")
}

export function queueAppointmentStatusChangedAutomationEvent(prismaTx: any, event: AppointmentStatusChangedAutomationEvent): Promise<QueuedAutomationResult> {
  return queueContactSnapshotAutomationEvent(prismaTx, event, "APPOINTMENT_STATUS_CHANGED")
}

export function queueBirthdayReminderAutomationEvent(prismaTx: any, event: BirthdayReminderAutomationEvent): Promise<QueuedAutomationResult> {
  return queueContactSnapshotAutomationEvent(prismaTx, {
    ...event,
    causationKey: `birthday:${event.tenantId}:${event.automationId}:${event.contactId}:${event.occurrenceYear}`,
  }, "BIRTHDAY_REMINDER")
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
    const serviceState = await lockServiceStepRuntimeTx(prismaTx, event)
    if (serviceState?.superseded) {
      await prismaTx.automationDispatch.updateMany({ where: { id: dispatch.id, status: { in: ["QUEUED", "PROCESSING"] } }, data: { status: "CANCELED", completedAt: new Date(), errorCode: "SERVICE_STEP_MOVED", errorMessage: "The enrollment moved to another step." } })
      await prismaTx.automationNodeExecution.updateMany({ where: { id: dispatch.triggerExecutionId, status: "QUEUED" }, data: { status: "SKIPPED", reasonCode: "SERVICE_STEP_MOVED", details: "The enrollment moved to another step." } })
      return { terminal: true, contactDeleted: false, queuedRunCount: 0 }
    }
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
        ...automationServiceContextData(event),
        attemptId: dispatch.attemptId,
        dispatchId: dispatch.id,
        eventSource: dispatch.triggerType,
        triggerType: dispatch.triggerType,
        sourceStageId: event.sourceStageId,
        targetStageId: event.targetStageId,
        sourceResult: event.sourceResult,
        targetResult: event.targetResult,
        actionSnapshot: actions,
        cursorIndex: 0,
        eventContext: {
          pipelineId: event.pipelineId,
          valueCents: event.valueCents,
          sourceStageId: event.sourceStageId,
          targetStageId: event.targetStageId,
          sourceResult: event.sourceResult,
          targetResult: event.targetResult,
          occurredAt: event.createdAt instanceof Date ? event.createdAt.toISOString() : String(event.createdAt),
          eventId: event.id,
          appointmentId: event.appointmentId,
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
    const { kickAutomationEventWorker } = await import("./automation-event-worker.js")
    kickAutomationEventWorker()
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
    const serviceState = await lockServiceStepRuntimeTx(prismaTx, dispatch.event)
    if (serviceState?.superseded) return
    let actions: RuntimeAutomationAction[] = []
    try {
      actions = parseActionSnapshot(dispatch.actionSnapshot)
    } catch {
      // The dispatch itself still needs a terminal audit record when its snapshot is corrupt.
    }
    const message = error instanceof Error ? error.message : "The automation could not be completed."
    const executionError = error instanceof AutomationExecutionError ? error : null
    const failureCode = executionError?.code ?? (error instanceof AutomationServiceContextError ? error.code : "AUTOMATION_EXECUTION_FAILED")
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
            ...automationServiceContextData(dispatch.event),
            attemptId: dispatch.attemptId,
            eventSource: dispatch.triggerType,
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
        ...automationServiceContextData(dispatch.event),
        attemptId: dispatch.attemptId,
        dispatchId: dispatch.id,
        eventSource: dispatch.triggerType,
        triggerType: dispatch.triggerType,
        sourceStageId: dispatch.event.sourceStageId,
        targetStageId: dispatch.event.targetStageId,
        sourceResult: dispatch.event.sourceResult,
        targetResult: dispatch.event.targetResult,
        actionSnapshot: actions,
        cursorIndex: Math.max(0, executionError?.actionIndex ?? 0),
        cursorPath: executionError?.cursorPath ?? null,
        branchDecisions: executionError?.branchDecisions ?? {},
        eventContext: {
          pipelineId: dispatch.event.pipelineId,
          valueCents: dispatch.event.valueCents,
          sourceStageId: dispatch.event.sourceStageId,
          targetStageId: dispatch.event.targetStageId,
          sourceResult: dispatch.event.sourceResult,
          targetResult: dispatch.event.targetResult,
          occurredAt: dispatch.event.createdAt instanceof Date
            ? dispatch.event.createdAt.toISOString()
            : String(dispatch.event.createdAt),
          eventId: dispatch.event.id,
          appointmentId: dispatch.event.appointmentId,
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
    if (dispatch.triggerType === "SERVICE_STEP_COMPLETED") await settleServiceStepCompletionEventTx(prismaTx, {
      tenantId: dispatch.tenantId, eventId: dispatch.event.id, status: "FAILED", message,
    })
    await prismaTx.automationExecution.create({
      data: {
        tenantId: dispatch.tenantId,
        automationId: dispatch.automationId,
        automationName: dispatch.automationName,
        triggerType: dispatch.triggerType,
        status: "FAILED",
        opportunityId: dispatch.event.opportunityId,
        ...automationServiceContextData(dispatch.event),
        contactId: dispatch.event.contactId,
        sourceStageId: dispatch.event.sourceStageId,
        targetStageId: dispatch.event.targetStageId,
        sourceResult: dispatch.event.sourceResult,
        targetResult: dispatch.event.targetResult,
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
      serviceContext: true,
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
    serviceContext: readAutomationServiceContext(event.serviceContext),
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
