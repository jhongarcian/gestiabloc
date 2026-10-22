import { Prisma } from "../generated/prisma/index.js"
import { ServiceCollectionError } from "./service-configuration-collections.js"
import { canChangeServiceFollowUpStepAssignee } from "./service-followup-step-permissions.js"
import { buildFollowUpStepResolutionUpdate } from "./service-followup-ownership.js"

export async function lockSavedFollowUpEnrollment(tx: Prisma.TransactionClient, tenantId: string, contactServiceId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; workflowKind: string }>>(Prisma.sql`
    SELECT id, "workflowKind" FROM "ContactService" WHERE "tenantId"=${tenantId} AND id=${contactServiceId} FOR UPDATE
  `)
  if (!rows[0]) throw new ServiceCollectionError("CONTACT_SERVICE_NOT_FOUND", 404)
  if (rows[0].workflowKind === "SERVICE_STEPS") throw new ServiceCollectionError("SERVICE_STEP_CONTROLS_REQUIRED", 409)
  return tx.contactService.findFirstOrThrow({ where: { tenantId, id: contactServiceId } })
}

// Retained manual records have no graph, cursor, executable actions, or background runner.
export async function syncContactServiceActiveStep(input: { prismaTx: Prisma.TransactionClient; tenantId: string; contactServiceId: string }) {
  const { prismaTx: tx, tenantId, contactServiceId } = input
  const rows = await tx.$queryRaw<Array<{ workflowKind: string; status: string }>>(Prisma.sql`
    SELECT "workflowKind", status FROM "ContactService" WHERE "tenantId"=${tenantId} AND id=${contactServiceId} FOR UPDATE
  `)
  if (!rows[0] || rows[0].workflowKind === "SERVICE_STEPS" || ["COMPLETED", "CANCELED"].includes(rows[0].status)) return null
  const first = await tx.contactServiceFollowUpStep.findFirst({
    where: { tenantId, contactServiceId, status: { in: ["PENDING", "ACTIVE", "POSTPONED"] } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  })
  if (!first || first.status !== "PENDING" || (first.availableAt && first.availableAt > new Date())) return null
  await tx.contactServiceFollowUpStep.update({ where: { id: first.id }, data: { status: "ACTIVE" } })
  return first.id
}

type SavedStepPatch = {
  title?: string; notesTemplate?: string | null; note?: string | null; sortOrder?: number
  status?: "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED" | "POSTPONED"
  action?: "REOPEN"; assignedToUserId?: string | null; availableAt?: string | null
  dueAt?: string | null; completedAt?: string | null; postponeTo?: string; cascadeFutureSteps?: boolean
}

export async function patchSavedFollowUpTx(tx: Prisma.TransactionClient, input: {
  tenantId: string; contactServiceId: string; stepId: string; actorUserId: string; patch: SavedStepPatch
}) {
  const { tenantId, contactServiceId, stepId, actorUserId, patch } = input
  const enrollment = await lockSavedFollowUpEnrollment(tx, tenantId, contactServiceId)
  if (enrollment.status === "CANCELED") throw new ServiceCollectionError("ENROLLMENT_NOT_ACTIVE", 409)
  const steps = await tx.contactServiceFollowUpStep.findMany({ where: { tenantId, contactServiceId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }] })
  const step = steps.find(item => item.id === stepId)
  if (!step) throw new ServiceCollectionError("FOLLOW_UP_STEP_NOT_FOUND", 404)
  if (patch.assignedToUserId !== undefined && patch.assignedToUserId !== step.assignedToUserId) {
    if (!canChangeServiceFollowUpStepAssignee(step.status)) throw new ServiceCollectionError("FOLLOW_UP_STEP_ASSIGNEE_LOCKED", 409)
    if (patch.assignedToUserId && !await tx.membership.findFirst({ where: { tenantId, userId: patch.assignedToUserId, status: "ACTIVE" } })) throw new ServiceCollectionError("INVALID_ASSIGNEE")
  }
  const reopening = patch.action === "REOPEN"
  if (reopening) {
    if (!["COMPLETED", "SKIPPED", "POSTPONED"].includes(step.status)) throw new ServiceCollectionError("STEP_REOPEN_NOT_ALLOWED", 409)
    if (["CONDITION_SKIPPED", "FLOW_SKIPPED"].includes(step.resolutionSource ?? "")) throw new ServiceCollectionError("AUTO_SKIPPED_STEP_CANNOT_REOPEN", 409)
    if (steps.some(item => item.sortOrder > step.sortOrder && ["COMPLETED", "SKIPPED"].includes(item.status))) throw new ServiceCollectionError("STEP_REOPEN_BLOCKED_BY_LATER_COMPLETED_STEPS", 409)
  }
  const status = reopening ? "ACTIVE" : patch.status ?? (patch.completedAt ? "COMPLETED" : patch.postponeTo ? "POSTPONED" : step.status)
  if (!reopening && ["COMPLETED", "SKIPPED"].includes(step.status) && status !== step.status) throw new ServiceCollectionError("STEP_REOPEN_REQUIRED", 409)
  const first = steps.find(item => !["COMPLETED", "SKIPPED"].includes(item.status))
  if (!reopening && status !== step.status && ["ACTIVE", "COMPLETED", "SKIPPED", "POSTPONED"].includes(status) && first?.id !== step.id) throw new ServiceCollectionError("FOLLOW_UP_STEP_NOT_CURRENT", 409)
  const now = new Date()
  const data: Prisma.ContactServiceFollowUpStepUpdateInput = {}
  for (const key of ["title", "notesTemplate", "note", "sortOrder", "assignedToUserId"] as const) {
    if (patch[key] !== undefined) {
      if (key === "assignedToUserId") data.assignedTo = patch[key] ? { connect: { id: patch[key] } } : { disconnect: true }
      else Object.assign(data, { [key]: patch[key] })
    }
  }
  for (const key of ["availableAt", "dueAt"] as const) if (patch[key] !== undefined) data[key] = patch[key] ? new Date(patch[key]) : null
  if (patch.postponeTo) {
    const date = new Date(patch.postponeTo)
    if (date <= now) throw new ServiceCollectionError("INVALID_POSTPONE_DATE")
    data.availableAt = date
    data.dueAt = date
    if (patch.cascadeFutureSteps !== false) {
      const delta = date.getTime() - (step.dueAt ?? step.availableAt ?? now).getTime()
      for (const future of steps.filter(item => item.sortOrder > step.sortOrder && ["PENDING", "ACTIVE"].includes(item.status))) await tx.contactServiceFollowUpStep.update({ where: { id: future.id }, data: {
          overdueNotifiedAt: null, overdueNotifiedDueAt: null,
          ...(future.availableAt ? { availableAt: new Date(future.availableAt.getTime() + delta) } : {}),
          ...(future.dueAt ? { dueAt: new Date(future.dueAt.getTime() + delta) } : {}),
        } })
    }
  }
  if (data.dueAt !== undefined && (data.dueAt instanceof Date ? data.dueAt.getTime() : null) !== step.dueAt?.getTime()) {
    data.overdueNotifiedAt = null
    data.overdueNotifiedDueAt = null
  }
  if (reopening || status !== step.status) {
    data.status = status
    data.completedAt = status === "COMPLETED" ? patch.completedAt ? new Date(patch.completedAt) : now : null
    data.resolutionSource = status === "COMPLETED" ? "USER_COMPLETED" : status === "SKIPPED" ? "USER_SKIPPED" : null
    data.resolutionReason = ["COMPLETED", "SKIPPED"].includes(status) ? patch.note ?? null : null
    Object.assign(data, buildFollowUpStepResolutionUpdate({ action: patch.action, nextStatus: status, actorUserId, now }))
    if (reopening) await tx.contactServiceFollowUpStep.updateMany({ where: { tenantId, contactServiceId, id: { not: step.id }, status: "ACTIVE" }, data: { status: "PENDING" } })
  }
  const changed = Object.entries(data).some(([key, value]) => key === "assignedTo" ? patch.assignedToUserId !== step.assignedToUserId : JSON.stringify(value) !== JSON.stringify(step[key as keyof typeof step]))
  const include = { assignedTo: { select: { id: true, name: true, email: true, image: true } }, resolvedBy: { select: { id: true, name: true, email: true, image: true } } }
  if (!changed) return tx.contactServiceFollowUpStep.findUniqueOrThrow({ where: { id: step.id }, include })
  const updated = await tx.contactServiceFollowUpStep.update({ where: { id: step.id }, data, include: { assignedTo: { select: { id: true, name: true, email: true, image: true } }, resolvedBy: { select: { id: true, name: true, email: true, image: true } } } })
  await tx.contactService.update({ where: { id: contactServiceId }, data: { status: "IN_PROGRESS", completedAt: null } })
  await syncContactServiceActiveStep({ prismaTx: tx, tenantId, contactServiceId })
  const auditStep = (value: typeof step) => ({
    title: value.title, notesTemplate: value.notesTemplate, note: value.note, sortOrder: value.sortOrder,
    status: value.status, availableAt: value.availableAt?.toISOString() ?? null, dueAt: value.dueAt?.toISOString() ?? null,
    completedAt: value.completedAt?.toISOString() ?? null, assignedToUserId: value.assignedToUserId,
    resolvedByUserId: value.resolvedByUserId, resolvedAt: value.resolvedAt?.toISOString() ?? null,
    resolutionSource: value.resolutionSource, resolutionReason: value.resolutionReason,
  })
  await tx.serviceFollowUpExecutionLog.create({ data: {
      tenantId, contactServiceId, contactId: enrollment.contactId, actorUserId, stepId: step.id,
      eventType: "SAVED_FOLLOW_UP_UPDATED", title: `Saved step updated: ${step.title}`,
      payload: { previousStatus: step.status, status: updated.status, previousAssigneeId: step.assignedToUserId, assignedToUserId: updated.assignedToUserId, before: auditStep(step), after: auditStep(updated) },
    } })
  return updated
}
