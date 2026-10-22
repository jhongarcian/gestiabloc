import { readSavedServiceAutomations } from "./service-automation-snapshots.js"
import { Prisma } from "../generated/prisma/index.js"
import { getServiceTransactionPaymentState } from "./service-transactions.js"
import { EnrollmentServiceTriggerSchema, matchesServiceEventTrigger, type ServiceEventSnapshot } from "./service-automation-triggers.js"
import type { ServiceActionActor, ServiceActionChain } from "./service-automation-actions.js"

export async function emitServiceAutomationEventTx(tx: Prisma.TransactionClient, input: {
  tenantId: string; contactServiceId: string
  triggerType: "SERVICE_ENROLLED" | "SERVICE_STATUS_CHANGED" | "SERVICE_CHECKLIST_STATUS_CHANGED" | "SERVICE_PAYMENT_CHANGED"
  previous?: Record<string, unknown> | null; next?: Record<string, unknown> | null
  recordId?: string; checklistItemId?: string; itemLabel?: string
  change?: "ADDED" | "UPDATED" | "REMOVED"; isInitialPayment?: boolean
  actor?: ServiceActionActor; chain?: ServiceActionChain
}) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ContactService" WHERE "tenantId"=${input.tenantId} AND id=${input.contactServiceId} FOR UPDATE`)
  const enrollment = await tx.contactService.findFirst({ where: { tenantId: input.tenantId, id: input.contactServiceId }, include: { service: { include: { parentService: true } } } })
  if (!enrollment || enrollment.workflowKind !== "SERVICE_STEPS") return null
  const saved = enrollment.configurationSnapshot as Record<string, any> | null
  const group = saved?.service?.parentService ?? enrollment.service.parentService
  if (!group?.id) throw new Error("The enrolled sub-service has no service group.")
  const updated = await tx.contactService.update({ where: { id: enrollment.id }, data: { automationEventRevision: { increment: 1 } }, select: { automationEventRevision: true } })
  const paid = await tx.contactServicePayment.aggregate({ where: { tenantId: input.tenantId, contactServiceId: enrollment.id }, _sum: { amountCents: true } })
  const paidCents = paid._sum.amountCents ?? 0
  const snapshot: ServiceEventSnapshot = JSON.parse(JSON.stringify({
    schemaVersion: 1, revision: updated.automationEventRevision, occurredAt: new Date().toISOString(),
    serviceGroupId: group.id, serviceGroupName: group.name,
    serviceOfferingId: enrollment.serviceId, serviceOfferingName: saved?.service?.name ?? enrollment.service.name,
    contactServiceId: enrollment.id, recordId: input.recordId ?? null, checklistItemId: input.checklistItemId ?? null, itemLabel: input.itemLabel ?? null,
    change: input.change ?? null, isInitialPayment: input.isInitialPayment ?? false,
    previous: input.previous ?? null, next: input.next ?? null,
    financials: { totalPriceCents: enrollment.totalPriceCents, paidCents, remainingCents: Math.max(0, enrollment.totalPriceCents - paidCents), paymentState: getServiceTransactionPaymentState(enrollment.totalPriceCents, paidCents), currency: enrollment.currency },
    automationSource: input.actor?.automationSource ?? (input.chain?.sourceAutomationId ? { automationId: input.chain.sourceAutomationId, automationName: input.chain.sourceAutomationName, nodeKey: input.chain.sourceNodeKey } : null),
  }))
  const savedAutomations = readSavedServiceAutomations(enrollment.configurationSnapshot)
  const ids = savedAutomations ? [] : await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "Automation" WHERE "tenantId"=${input.tenantId} AND "serviceGroupId"=${group.id} AND "triggerType"=${input.triggerType}::"AutomationTriggerType" AND "isEnabled"=true AND ("serviceOfferingId" IS NULL OR "serviceOfferingId"=${enrollment.serviceId}) ORDER BY id FOR SHARE`)
  const candidates = savedAutomations ? savedAutomations.definitions.filter(item => item.isEnabled && item.triggerType === input.triggerType) : await tx.automation.findMany({ where: { tenantId: input.tenantId, id: { in: ids.map(row => row.id) } }, select: { id: true, triggerType: true, serviceGroupId: true, serviceOfferingId: true, serviceTriggerConfig: true } })
  const automationIds = candidates.filter(candidate => {
    const parsed = EnrollmentServiceTriggerSchema.safeParse({ type: candidate.triggerType, serviceGroupId: candidate.serviceGroupId, serviceOfferingId: candidate.serviceOfferingId, serviceTriggerConfig: candidate.serviceTriggerConfig })
    return parsed.success && matchesServiceEventTrigger(parsed.data, snapshot)
  }).map(candidate => candidate.id)
  const { queueEnrollmentServiceAutomationEvent } = await import("./automation-event-queue.js")
  return queueEnrollmentServiceAutomationEvent(tx, {
    tenantId: input.tenantId, contactId: enrollment.contactId, actorUserId: input.actor?.actorUserId ?? null,
    ...input.chain, serviceEventSnapshot: snapshot, automationIds,
    serviceContext: { contactServiceId: enrollment.id, serviceId: enrollment.serviceId, contactServiceStepId: null, serviceStepId: null, serviceStepOccurrenceId: null },
    causationKey: `service-change:${input.tenantId}:${enrollment.id}:${snapshot.revision}`,
  }, input.triggerType)
}

export async function updateServiceStatusTx(tx: Prisma.TransactionClient, input: {
  tenantId: string; contactServiceId: string; status: "IN_PROGRESS" | "PENDING_PAYMENT" | "COMPLETED" | "CANCELED"
  completedAt?: Date | null; canceledAt?: Date | null; actor?: ServiceActionActor; chain?: ServiceActionChain
}) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ContactService" WHERE "tenantId"=${input.tenantId} AND id=${input.contactServiceId} FOR UPDATE`)
  const before = await tx.contactService.findFirstOrThrow({ where: { tenantId: input.tenantId, id: input.contactServiceId } })
  const after = await tx.contactService.update({ where: { id: before.id }, data: { status: input.status, ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}), ...(input.canceledAt !== undefined ? { canceledAt: input.canceledAt } : {}) } })
  if (before.status !== after.status) await emitServiceAutomationEventTx(tx, { ...input, triggerType: "SERVICE_STATUS_CHANGED", previous: { status: before.status }, next: { status: after.status } })
  return after
}
