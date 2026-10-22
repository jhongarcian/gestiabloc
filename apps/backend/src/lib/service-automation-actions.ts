import { isEnrollmentServiceAction } from "./service-automation-triggers.js"
import { emitServiceAutomationEventTx, updateServiceStatusTx } from "./service-automation-events.js"
import { createHash } from "node:crypto"
import { z } from "zod"
import { Prisma } from "../generated/prisma/index.js"
import { validateAutomationServiceContextTx } from "./automation-service-context.js"
import { ServiceCollectionError } from "./service-configuration-collections.js"
import { serviceConfigurationSelect, resolveServiceConfiguration, lockServiceHierarchyTx } from "./service-configuration-inheritance.js"
import { enrollmentProfessionalOptions, professionalSnapshot, readProfessionalSnapshot } from "./service-enrollment-snapshots.js"
import { resolveContactServiceChecklistTransition, buildContactServiceChecklistActivityData } from "./contact-service-checklist-status.js"
import { serializeEnrolledChecklistItem } from "./service-enrollment-snapshots.js"
import { moveServiceStepTx, supersedeStepWorkTx } from "./service-step-movement.js"
import { completeServiceStepOccurrenceTx } from "./service-step-progression.js"
import { changeServiceStepDeadlineTx, ServiceStepDeadlineScheduleSchema } from "./service-step-deadlines.js"

const nodeKey = z.string().trim().min(1).max(200).optional()
const userConfig = z.object({ assignedToUserId: z.uuid().nullable() }).strict()
const reason = z.string().trim().min(1).max(1000)
export const SERVICE_ACTION_TYPES = ["MOVE_SERVICE_STEP", "COMPLETE_SERVICE_STEP", "SKIP_SERVICE_STEP", "SCHEDULE_SERVICE_STEP", "SET_SERVICE_STEP_OWNER", "SET_SERVICE_COORDINATOR", "SET_SERVICE_PROFESSIONAL", "SET_SERVICE_CHECKLIST_STATUS", "SET_SERVICE_STATUS"] as const
export const ServiceAutomationActionSchema = z.discriminatedUnion("type", [
  z.object({ nodeKey, type: z.literal("MOVE_SERVICE_STEP"), serviceConfig: z.object({ targetSourceStepId: z.uuid(), reason }).strict() }),
  z.object({ nodeKey, type: z.literal("COMPLETE_SERVICE_STEP"), serviceConfig: z.object({}).strict() }),
  z.object({ nodeKey, type: z.literal("SKIP_SERVICE_STEP"), serviceConfig: z.object({ reason }).strict() }),
  z.object({ nodeKey, type: z.literal("SCHEDULE_SERVICE_STEP"), serviceConfig: z.object({ schedule: ServiceStepDeadlineScheduleSchema }).strict() }),
  z.object({ nodeKey, type: z.literal("SET_SERVICE_STEP_OWNER"), serviceConfig: userConfig }),
  z.object({ nodeKey, type: z.literal("SET_SERVICE_COORDINATOR"), serviceConfig: userConfig }),
  z.object({ nodeKey, type: z.literal("SET_SERVICE_PROFESSIONAL"), serviceConfig: z.object({ professionalId: z.uuid().nullable() }).strict() }),
  z.object({ nodeKey, type: z.literal("SET_SERVICE_CHECKLIST_STATUS"), serviceConfig: z.object({ checklistItemId: z.uuid(), status: z.enum(["NOT_RECEIVED", "INFORMED", "MISSING", "RECEIVED"]) }).strict() }),
  z.object({ nodeKey, type: z.literal("SET_SERVICE_STATUS"), serviceConfig: z.object({ status: z.enum(["IN_PROGRESS", "CANCELED"]) }).strict() }),
])
export type ServiceAutomationAction = z.infer<typeof ServiceAutomationActionSchema>
export const isServiceAction = (type: string) => (SERVICE_ACTION_TYPES as readonly string[]).includes(type)
export function isTerminalServiceAction(action: { type: string; serviceConfig?: unknown }) {
  return ["MOVE_SERVICE_STEP", "SKIP_SERVICE_STEP", "COMPLETE_SERVICE_STEP"].includes(action.type)
    || (action.type === "SET_SERVICE_STATUS" && (action.serviceConfig as { status?: string })?.status === "CANCELED")
}

// Catalogs use effective configuration; execution resolves stable IDs against saved enrollment records.
export async function serviceActionCatalog(tx: Prisma.TransactionClient, tenantId: string) {
  const offerings = await tx.service.findMany({
    where: { tenantId, kind: "OFFERING", isActive: true, parentService: { isActive: true } },
    select: serviceConfigurationSelect,
    orderBy: { name: "asc" },
  })
  const activeUsers = new Set((await tx.membership.findMany({ where: { tenantId, status: "ACTIVE" }, select: { userId: true } })).map(member => member.userId))
  return offerings.map(offering => {
    const effective = resolveServiceConfiguration(offering)
    return { id: offering.id, name: offering.name, serviceGroupId: offering.parentServiceId,
      steps: effective.steps.map(step => ({ id: step.id, name: step.title })),
      checklistItems: effective.checklistItems.map(item => ({ id: item.id, name: item.label })),
      professionals: effective.professionals.filter(item => item.kind !== "INTERNAL_USER" || Boolean(item.userId && activeUsers.has(item.userId))).map(item => ({ id: item.id, name: item.externalProfessionalName || item.user?.name || item.user?.email || "Professional" })),
    }
  })
}
export type ServiceActionCatalog = Awaited<ReturnType<typeof serviceActionCatalog>>
export function serviceActionOptions(catalog: ServiceActionCatalog, sourceStepId: string, offeringId?: string | null) {
  const eligible = catalog.filter(offering => (!offeringId || offering.id === offeringId) && offering.steps.some(step => step.id === sourceStepId))
  const common = (key: "steps" | "checklistItems" | "professionals") => (eligible[0]?.[key] ?? []).filter(item => eligible.every(offering => offering[key].some(option => option.id === item.id)))
  return { steps: common("steps"), checklistItems: common("checklistItems"), professionals: common("professionals") }
}
export function validateServiceActionSelection(action: ServiceAutomationAction, options: ReturnType<typeof serviceActionOptions>, activeUserIds: Set<string>) {
  const valid = action.type === "MOVE_SERVICE_STEP" ? options.steps.some(item => item.id === action.serviceConfig.targetSourceStepId)
    : action.type === "SET_SERVICE_CHECKLIST_STATUS" ? options.checklistItems.some(item => item.id === action.serviceConfig.checklistItemId)
    : action.type === "SET_SERVICE_PROFESSIONAL" ? !action.serviceConfig.professionalId || options.professionals.some(item => item.id === action.serviceConfig.professionalId)
    : action.type === "SET_SERVICE_STEP_OWNER" || action.type === "SET_SERVICE_COORDINATOR" ? !action.serviceConfig.assignedToUserId || activeUserIds.has(action.serviceConfig.assignedToUserId) : true
  if (!valid) throw new ServiceCollectionError("INVALID_SERVICE_ACTION_SELECTION")
}

export type ServiceActionActor = { actorUserId: string | null; actorName?: string; automationSource?: Prisma.InputJsonValue }
export type ServiceActionChain = { chainId?: string | null; parentEventId?: string | null; chainDepth?: number; sourceAutomationId?: string | null; sourceAutomationName?: string | null; sourceNodeKey?: string | null }
export async function lockServiceActionEnrollment(tx: Prisma.TransactionClient, tenantId: string, contactServiceId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ContactService" WHERE "tenantId"=${tenantId} AND id=${contactServiceId} FOR UPDATE`)
  const enrollment = await tx.contactService.findFirst({ where: { tenantId, id: contactServiceId } })
  if (!enrollment) throw new ServiceCollectionError("CONTACT_SERVICE_NOT_FOUND", 404)
  if (enrollment.workflowKind !== "SERVICE_STEPS") throw new ServiceCollectionError("INVALID_SERVICE_STEP_WORKFLOW", 409)
  return enrollment
}

export async function mutateEnrolledServiceTx(tx: Prisma.TransactionClient, input: {
  tenantId: string; contactServiceId: string; occurrenceId?: string | null; stepId?: string | null
  actor: ServiceActionActor; action: ServiceAutomationAction; requestId: string; chain?: ServiceActionChain
}) {
  const { tenantId, contactServiceId, action, actor } = input
  const enrollment = await lockServiceActionEnrollment(tx, tenantId, contactServiceId)
  if ((input.occurrenceId || action.type === "SET_SERVICE_STEP_OWNER" || action.type === "SET_SERVICE_COORDINATOR") && ["CANCELED", "COMPLETED"].includes(enrollment.status)) throw new ServiceCollectionError("ENROLLMENT_NOT_ACTIVE", 409)
  const occurrence = input.occurrenceId ? await tx.serviceStepOccurrence.findFirst({ where: { tenantId, contactServiceId, id: input.occurrenceId } }) : null
  if (input.occurrenceId && (!occurrence || occurrence.supersededAt || (action.type !== "COMPLETE_SERVICE_STEP" && occurrence.status !== "ACTIVE" && !["WAITING_AUTOMATION", "PAUSED"].includes(occurrence.progressionStatus)))) throw new ServiceCollectionError("SERVICE_STEP_CHANGED", 409)
  let previous: unknown = null
  let next: unknown = null
  let previousLabel: string | null = null
  let nextLabel: string | null = null
  if (action.type === "MOVE_SERVICE_STEP" || action.type === "SKIP_SERVICE_STEP") {
    if (!occurrence) throw new ServiceCollectionError("SERVICE_STEP_OCCURRENCE_REQUIRED")
    const target = action.type === "MOVE_SERVICE_STEP" ? await tx.contactServiceStep.findFirst({ where: { tenantId, contactServiceId, sourceStepId: action.serviceConfig.targetSourceStepId } }) : null
    if (action.type === "MOVE_SERVICE_STEP" && !target) throw new ServiceCollectionError("INVALID_ENROLLED_SERVICE_STEP")
    const movement = await moveServiceStepTx(tx, { tenantId, contactServiceId, requestId: input.requestId, expectedOccurrenceId: occurrence.id,
      kind: action.type === "MOVE_SERVICE_STEP" ? "MOVE" : "SKIP", targetStepId: target?.id, reason: action.serviceConfig.reason, ...actor, automationChain: input.chain })
    return { details: `Step ${action.type === "MOVE_SERVICE_STEP" ? "moved" : "skipped"}: ${movement.reason}`, terminal: true, changed: true }
  }
  if (action.type === "COMPLETE_SERVICE_STEP") {
    if (!occurrence) throw new ServiceCollectionError("SERVICE_STEP_OCCURRENCE_REQUIRED")
    await completeServiceStepOccurrenceTx(tx, { tenantId, contactServiceId, occurrenceId: occurrence.id, actorUserId: actor.actorUserId, automationChain: input.chain })
    if (occurrence.status !== "COMPLETED") await tx.serviceFollowUpExecutionLog.create({ data: {
      tenantId, contactServiceId, contactId: enrollment.contactId, actorUserId: actor.actorUserId,
      eventType: action.type, title: "Step completed", details: `${actor.actorName ?? "Staff"} completed the triggering step entry.`,
      payload: { previous: occurrence.status, next: "COMPLETED", occurrenceId: occurrence.id, stepId: occurrence.stepId, automationSource: actor.automationSource ?? null },
    } })
    return { details: occurrence.status === "COMPLETED" ? "Step was already completed." : "Step completed; completion automations will handle advancement.", terminal: true, changed: occurrence.status !== "COMPLETED" }
  }
  if (action.type === "SCHEDULE_SERVICE_STEP") {
    if (!occurrence) throw new ServiceCollectionError("SERVICE_STEP_OCCURRENCE_REQUIRED")
    const result = await changeServiceStepDeadlineTx(tx, { tenantId, contactServiceId, occurrenceId: occurrence.id, ...actor, requestId: input.requestId, expectedDeadlineRevision: occurrence.deadlineRevision, schedule: action.serviceConfig.schedule })
    return { details: `Step deadline: ${result.dueAt.toISOString()}`, changed: result.deadlineRevision !== occurrence.deadlineRevision, terminal: false }
  }
  if (action.type === "SET_SERVICE_STEP_OWNER" || action.type === "SET_SERVICE_COORDINATOR") {
    const userId = action.serviceConfig.assignedToUserId
    if (userId && !await tx.membership.findFirst({ where: { tenantId, userId, status: "ACTIVE" } })) throw new ServiceCollectionError("INVALID_ASSIGNEE")
    if (action.type === "SET_SERVICE_STEP_OWNER") {
      const step = await tx.contactServiceStep.findFirst({ where: { tenantId, contactServiceId, id: input.stepId ?? occurrence?.stepId ?? "" } })
      if (!step) throw new ServiceCollectionError("INVALID_ENROLLED_SERVICE_STEP")
      previous = step.assignedToUserId; next = userId
      if (previous !== next) await tx.contactServiceStep.update({ where: { id: step.id }, data: { assignedToUserId: userId } })
    } else {
      const unfinished = await tx.serviceStepOccurrence.count({ where: { tenantId, contactServiceId, supersededAt: null, OR: [{ status: "ACTIVE" }, { progressionStatus: { in: ["WAITING_AUTOMATION", "PAUSED"] } }] } })
      if (!unfinished) throw new ServiceCollectionError("FOLLOW_UP_COORDINATOR_LOCKED", 409)
      previous = enrollment.followUpCoordinatorUserId; next = userId
      if (previous !== next) await tx.contactService.update({ where: { id: contactServiceId }, data: { followUpCoordinatorUserId: userId } })
    }
  } else if (action.type === "SET_SERVICE_PROFESSIONAL") {
    // All callers lock the enrollment before configuration, including manual controls.
    await lockServiceHierarchyTx(tx, tenantId, enrollment.serviceId)
    const options = await enrollmentProfessionalOptions(tx, tenantId, enrollment.configurationSnapshot, [])
    previous = enrollment.assignedProfessionalId; next = action.serviceConfig.professionalId
    const previousProfessional = readProfessionalSnapshot(enrollment.assignedProfessionalSnapshot)
    previousLabel = previousProfessional?.externalProfessionalName || previousProfessional?.user?.name || previousProfessional?.user?.email || "Unassigned"
    const nextProfessional = options.find(option => option.id === next)
    nextLabel = nextProfessional?.externalProfessionalName || nextProfessional?.user?.name || nextProfessional?.user?.email || "Unassigned"
    if (previous !== next) {
      const professional = options.find(option => option.id === next)
      if (professional?.kind === "INTERNAL_USER" && professional.userId && !await tx.membership.findFirst({ where: { tenantId, userId: professional.userId, status: "ACTIVE" } })) throw new ServiceCollectionError("INVALID_ASSIGNED_SERVICE_PROFESSIONAL")
      if (next && !professional) throw new ServiceCollectionError("INVALID_ASSIGNED_SERVICE_PROFESSIONAL")
      await tx.contactService.update({ where: { id: contactServiceId }, data: { assignedProfessionalId: next as string | null, assignedProfessionalSnapshot: professional ? professionalSnapshot(professional) : Prisma.DbNull } })
    }
  } else if (action.type === "SET_SERVICE_CHECKLIST_STATUS") {
    const item = await tx.contactServiceChecklistItem.findFirst({ where: { tenantId, contactServiceId, checklistItemId: action.serviceConfig.checklistItemId }, include: { checklistItem: true } })
    if (!item) throw new ServiceCollectionError("CONTACT_SERVICE_CHECKLIST_ITEM_NOT_FOUND", 404)
    previous = item.status; next = action.serviceConfig.status
    const transition = resolveContactServiceChecklistTransition({ currentStatus: item.status, currentCompletedAt: item.completedAt, nextStatus: action.serviceConfig.status, now: new Date() })
    if (transition.changed) {
      await tx.contactServiceChecklistItem.update({ where: { id: item.id }, data: { status: action.serviceConfig.status, completedAt: transition.completedAt } })
      await tx.contactServiceChecklistActivity.create({ data: { ...buildContactServiceChecklistActivityData({ tenantId, contactServiceId, contactServiceChecklistItemId: item.id, itemLabel: serializeEnrolledChecklistItem(item).label, previousStatus: item.status, status: action.serviceConfig.status, actorUserId: actor.actorUserId }) } })
      await emitServiceAutomationEventTx(tx, { tenantId, contactServiceId, triggerType: "SERVICE_CHECKLIST_STATUS_CHANGED", recordId: item.id, checklistItemId: item.checklistItemId, itemLabel: serializeEnrolledChecklistItem(item).label, previous: { status: item.status, completedAt: item.completedAt }, next: { status: action.serviceConfig.status, completedAt: transition.completedAt }, actor, chain: input.chain })
    }
  } else if (action.type === "SET_SERVICE_STATUS") {
    previous = enrollment.status; next = action.serviceConfig.status
    if (["COMPLETED", "CANCELED"].includes(enrollment.status) && previous !== next) throw new ServiceCollectionError("SERVICE_STATUS_IS_DERIVED", 409)
    if (next === "IN_PROGRESS") {
      if (!await tx.serviceStepOccurrence.count({ where: { tenantId, contactServiceId, supersededAt: null, OR: [{ status: "ACTIVE" }, { progressionStatus: { in: ["WAITING_AUTOMATION", "PAUSED"] } }] } })) throw new ServiceCollectionError("SERVICE_STATUS_IS_DERIVED", 409)
    } else if (previous !== next) {
      const now = new Date()
      await tx.serviceStepOccurrence.updateMany({ where: { tenantId, contactServiceId, supersededAt: null }, data: { supersededAt: now, progressionStatus: "SUPERSEDED" } })
      await tx.serviceStepOccurrence.updateMany({ where: { tenantId, contactServiceId, status: "ACTIVE" }, data: { status: "CANCELED", resolvedAt: now, resolutionReason: actor.actorName ?? "Service canceled" } })
      await supersedeStepWorkTx(tx, tenantId, contactServiceId, now, "Service canceled", actor.actorUserId, (actor.automationSource as { runId?: string } | undefined)?.runId)
    }
    if (previous !== next) await updateServiceStatusTx(tx, { tenantId, contactServiceId, status: action.serviceConfig.status, canceledAt: next === "CANCELED" ? new Date() : null, completedAt: null, actor, chain: input.chain })
  }
  const changed = previous !== next
  if (changed && (action.type === "SET_SERVICE_STEP_OWNER" || action.type === "SET_SERVICE_COORDINATOR")) {
    const users = await tx.user.findMany({ where: { id: { in: [previous, next].filter((value): value is string => typeof value === "string") } }, select: { id: true, name: true, email: true } })
    const label = (value: unknown) => users.find(user => user.id === value)?.name || users.find(user => user.id === value)?.email || "Unassigned"
    previousLabel = label(previous); nextLabel = label(next)
  }
  if (changed) await tx.serviceFollowUpExecutionLog.create({ data: {
    tenantId, contactServiceId, contactId: enrollment.contactId, actorUserId: actor.actorUserId,
    eventType: action.type, title: ({ SET_SERVICE_STEP_OWNER: "Step owner updated", SET_SERVICE_COORDINATOR: "Coordinator updated", SET_SERVICE_PROFESSIONAL: "Professional updated", SET_SERVICE_CHECKLIST_STATUS: "Checklist item updated", SET_SERVICE_STATUS: "Service status updated" } as Record<string, string>)[action.type] ?? "Service updated",
    details: `${actor.actorName ?? "Staff"}: ${previousLabel ?? String(previous ?? "Unassigned")} → ${nextLabel ?? String(next ?? "Unassigned")}`,
    payload: { previous: previous as Prisma.InputJsonValue, next: next as Prisma.InputJsonValue, stepId: input.stepId ?? occurrence?.stepId ?? null, occurrenceId: occurrence?.id ?? null, automationSource: actor.automationSource ?? null },
  } })
  return { details: changed ? `${action.type.toLowerCase().replaceAll("_", " ")} updated.` : "Already set; no change was needed.", changed, terminal: isTerminalServiceAction(action) }
}

function actionRequestId(runId: string, nodeKey: string) {
  const hex = createHash("sha256").update(`${runId}:${nodeKey}`).digest("hex")
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`
}
export async function executeServiceActionTx(tx: Prisma.TransactionClient, input: {
  tenantId: string; contactId: string; runId: string; automationId: string | null; automationName: string
  actorUserId: string | null; action: ServiceAutomationAction & { nodeKey: string }; eventContext?: unknown
}) {
  const run = await tx.automationRun.findFirst({ where: { id: input.runId, tenantId: input.tenantId, contactId: input.contactId } })
  if (!run) throw new ServiceCollectionError("INVALID_SERVICE_CONTEXT")
  const context = await validateAutomationServiceContextTx(tx, run)
  if (!context) throw new ServiceCollectionError("INVALID_SERVICE_CONTEXT")
  if (!context.serviceStepOccurrenceId && !isEnrollmentServiceAction(input.action.type)) throw new ServiceCollectionError("SERVICE_STEP_OCCURRENCE_REQUIRED")
  await lockServiceActionEnrollment(tx, input.tenantId, context.contactServiceId)
  const key = { tenantId: input.tenantId, runId: input.runId, nodeKey: input.action.nodeKey }
  const previous = await tx.serviceAutomationActionResult.findUnique({ where: { tenantId_runId_nodeKey: key } })
  if (previous) return previous.result as { details: string; changed: boolean; terminal: boolean }
  const event = input.eventContext as ServiceActionChain & { eventId?: string }
  const depth = (event?.chainDepth ?? 0) + 1
  if (depth > 20) throw new ServiceCollectionError("SERVICE_AUTOMATION_CHAIN_LIMIT")
  const chainId = event?.chainId ?? input.runId
  let transitionKey: string | null = null
  if (input.action.type === "MOVE_SERVICE_STEP") transitionKey = `MOVE:${context.serviceStepId}:${input.action.serviceConfig.targetSourceStepId}`
  else if (input.action.type === "SKIP_SERVICE_STEP") {
    const steps = await tx.contactServiceStep.findMany({ where: { tenantId: input.tenantId, contactServiceId: context.contactServiceId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] })
    const next = steps[steps.findIndex(step => step.id === context.contactServiceStepId) + 1]
    transitionKey = `MOVE:${context.serviceStepId}:${next?.sourceStepId ?? "END"}`
  } else if (input.action.type === "COMPLETE_SERVICE_STEP") {
    const entry = await tx.serviceStepOccurrence.findFirst({ where: { tenantId: input.tenantId, contactServiceId: context.contactServiceId, id: context.serviceStepOccurrenceId! }, select: { status: true } })
    if (entry?.status === "ACTIVE") transitionKey = `COMPLETE:${context.serviceStepId}`
  }
  if (transitionKey && await tx.serviceAutomationActionResult.findFirst({ where: {
    tenantId: input.tenantId, contactServiceId: context.contactServiceId,
    AND: [{ result: { path: ["chainId"], equals: chainId } }, { result: { path: ["transitionKey"], equals: transitionKey } }],
  } })) throw new ServiceCollectionError("SERVICE_AUTOMATION_TRANSITION_LOOP", 409)
  const result = await mutateEnrolledServiceTx(tx, {
    tenantId: input.tenantId, contactServiceId: context.contactServiceId, occurrenceId: context.serviceStepOccurrenceId,
    action: input.action, requestId: actionRequestId(input.runId, input.action.nodeKey),
    actor: { actorUserId: null, actorName: `Automation: ${input.automationName}`, automationSource: { automationId: input.automationId, automationName: input.automationName, runId: input.runId, nodeKey: input.action.nodeKey } },
    chain: { chainId, parentEventId: event?.eventId, chainDepth: depth, sourceAutomationId: input.automationId, sourceAutomationName: input.automationName, sourceNodeKey: input.action.nodeKey },
  })
  await tx.serviceAutomationActionResult.create({ data: { ...key, contactServiceId: context.contactServiceId, occurrenceId: context.serviceStepOccurrenceId, result: { ...result, chainId, transitionKey } } })
  return result
}
