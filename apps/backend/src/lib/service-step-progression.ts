import { Prisma } from "../generated/prisma/index.js"
import { ServiceCollectionError } from "./service-configuration-collections.js"
import { createServiceStepOccurrenceTx } from "./service-steps.js"
import { resolveAutomationServiceContextTx } from "./automation-service-context.js"

async function lockEnrollment(tx: Prisma.TransactionClient, tenantId: string, id: string) {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "ContactService" WHERE "tenantId"=${tenantId} AND id=${id} FOR UPDATE`,
  )
  const enrollment = await tx.contactService.findFirst({ where: { tenantId, id } })
  if (!enrollment) throw new ServiceCollectionError("CONTACT_SERVICE_NOT_FOUND", 404)
  return enrollment
}

// Payment changes use the same enrollment lock as completion and advancement.
export async function reconcileServiceStepEnrollmentTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contactServiceId: string,
) {
  const enrollment = await lockEnrollment(tx, tenantId, contactServiceId)
  if (enrollment.workflowKind !== "SERVICE_STEPS" || enrollment.status === "CANCELED")
    return enrollment
  if (
    await tx.serviceStepOccurrence.findFirst({
      where: {
        tenantId,
        contactServiceId,
        supersededAt: null,
        OR: [{ status: "ACTIVE" }, { progressionStatus: { in: ["WAITING_AUTOMATION", "PAUSED"] } }],
      },
      select: { id: true },
    })
  )
    return enrollment
  const last = await tx.contactServiceStep.findFirst({
    where: { tenantId, contactServiceId },
    orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
    include: { occurrences: { orderBy: { occurrenceNumber: "desc" }, take: 1 } },
  })
  if (last?.occurrences[0]?.progressionStatus !== "FINISHED") return enrollment
  const payments = await tx.contactServicePayment.aggregate({
    where: { tenantId, contactServiceId },
    _sum: { amountCents: true },
  })
  const paid = (payments._sum.amountCents ?? 0) >= enrollment.totalPriceCents
  const status = paid ? "COMPLETED" : "PENDING_PAYMENT"
  if (enrollment.status === status && Boolean(enrollment.completedAt) === paid) return enrollment
  return tx.contactService.update({
    where: { id: contactServiceId, tenantId },
    data: {
      status,
      completedAt: paid ? (enrollment.completedAt ?? new Date()) : null,
    },
  })
}

async function advanceTx(
  tx: Prisma.TransactionClient,
  occurrence: Awaited<ReturnType<typeof tx.serviceStepOccurrence.findFirstOrThrow>>,
  now: Date,
) {
  const { tenantId, contactServiceId } = occurrence
  const enrollment = await lockEnrollment(tx, tenantId, contactServiceId)
  const current = await tx.serviceStepOccurrence.findFirstOrThrow({
    where: { tenantId, id: occurrence.id },
  })
  if (
    current.supersededAt ||
    current.status !== "COMPLETED" ||
    current.progressionStatus !== "WAITING_AUTOMATION"
  )
    return current
  const newer = await tx.serviceStepOccurrence.findFirst({
    where: {
      tenantId,
      contactServiceId,
      id: { not: current.id },
      OR: [{ status: "ACTIVE" }, { enteredAt: { gt: current.enteredAt } }],
    },
    select: { id: true },
  })
  if (enrollment.status === "CANCELED" || enrollment.status === "COMPLETED" || newer) {
    return tx.serviceStepOccurrence.update({
      where: { id: current.id },
      data: {
        progressionStatus: "PAUSED",
        progressionMessage:
          "The enrollment changed before this workflow finished. Review its current step before continuing.",
      },
    })
  }
  const steps = await tx.contactServiceStep.findMany({
    where: { tenantId, contactServiceId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  })
  const next = steps[steps.findIndex((step) => step.id === current.stepId) + 1]
  if (next) {
    await createServiceStepOccurrenceTx(tx, {
      tenantId,
      contactServiceId,
      stepId: next.id,
      entryKey: `after:${current.id}`,
      enteredAt: now,
      enteredByUserId: current.completedByUserId,
    })
  }
  const updated = await tx.serviceStepOccurrence.update({
    where: { id: current.id },
    data: {
      progressionStatus: next ? "ADVANCED" : "FINISHED",
      advancedAt: now,
      progressionMessage: null,
    },
  })
  if (!next) await reconcileServiceStepEnrollmentTx(tx, tenantId, contactServiceId)
  return updated
}

export async function completeServiceStepOccurrenceTx(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string
    contactServiceId: string
    occurrenceId: string
    actorUserId: string
    occurredAt?: Date
  },
) {
  const { tenantId, contactServiceId } = input
  const enrollment = await lockEnrollment(tx, tenantId, contactServiceId)
  if (enrollment.workflowKind !== "SERVICE_STEPS")
    throw new ServiceCollectionError("INVALID_SERVICE_STEP_WORKFLOW", 409)
  const occurrence = await tx.serviceStepOccurrence.findFirst({
    where: { tenantId, contactServiceId, id: input.occurrenceId },
  })
  if (!occurrence) throw new ServiceCollectionError("SERVICE_STEP_OCCURRENCE_NOT_FOUND", 404)
  // Completed retries return their saved result, including a waiting or paused workflow.
  if (occurrence.status === "COMPLETED") return occurrence
  if (enrollment.status === "CANCELED" || enrollment.status === "COMPLETED")
    throw new ServiceCollectionError("ENROLLMENT_NOT_ACTIVE", 409)
  if (occurrence.status !== "ACTIVE")
    throw new ServiceCollectionError("SERVICE_STEP_NOT_ACTIVE", 409)
  const now = input.occurredAt ?? new Date()
  const context = await resolveAutomationServiceContextTx(tx, {
    tenantId,
    contactId: enrollment.contactId,
    contactServiceId,
    contactServiceStepId: occurrence.stepId,
    serviceStepOccurrenceId: occurrence.id,
  })
  const { queueServiceStepCompletedAutomationEvent } = await import("./automation-event-queue.js")
  const queued = await queueServiceStepCompletedAutomationEvent(tx, {
    tenantId,
    contactId: enrollment.contactId,
    actorUserId: input.actorUserId,
    serviceContext: context,
  })
  const completed = await tx.serviceStepOccurrence.update({
    where: { id: occurrence.id },
    data: {
      status: "COMPLETED",
      resolvedAt: now,
      completedByUserId: input.actorUserId,
      completionEventId: queued.automationEventId,
      progressionStatus: "WAITING_AUTOMATION",
    },
  })
  // A filtered-out workflow has no actions to finish and queues no event.
  return queued.matchedCount > 0 ? completed : advanceTx(tx, completed, now)
}

// Only the linked root event may release progression; independent child workflows cannot do so.
export async function settleServiceStepCompletionEventTx(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string
    eventId: string
    status: "SUCCEEDED" | "FAILED" | "EXITED"
    message?: string | null
    occurredAt?: Date
  },
) {
  const occurrence = await tx.serviceStepOccurrence.findFirst({
    where: { tenantId: input.tenantId, completionEventId: input.eventId },
  })
  if (!occurrence) return
  await lockEnrollment(tx, input.tenantId, occurrence.contactServiceId)
  if (input.status === "SUCCEEDED") {
    const dispatches = await tx.automationDispatch.findMany({
      where: { tenantId: input.tenantId, eventId: input.eventId, decision: "RUN" },
      select: { status: true, run: { select: { status: true } } },
    })
    if (
      dispatches.some(
        (dispatch) =>
          dispatch.status === "FAILED" ||
          dispatch.status === "CANCELED" ||
          ["FAILED", "EXITED"].includes(dispatch.run?.status ?? ""),
      )
    ) {
      input = {
        ...input,
        status: "FAILED",
        message:
          "A completion automation stopped before finishing. Review its execution log before continuing.",
      }
    } else {
      if (!dispatches.length || dispatches.some((dispatch) => dispatch.run?.status !== "SUCCEEDED"))
        return
      return advanceTx(tx, occurrence, input.occurredAt ?? new Date())
    }
  }
  await tx.serviceStepOccurrence.updateMany({
    where: {
      id: occurrence.id,
      tenantId: input.tenantId,
      status: "COMPLETED",
      progressionStatus: "WAITING_AUTOMATION",
    },
    data: {
      progressionStatus: "PAUSED",
      progressionMessage: (
        input.message ||
        (input.status === "FAILED"
          ? "The completion workflow failed. Review its execution log before continuing."
          : "The completion workflow stopped before finishing. Review its execution log before continuing.")
      ).slice(0, 500),
    },
  })
}

export async function settleServiceStepCompletionRunTx(
  tx: Prisma.TransactionClient,
  runId: string,
) {
  const run = await tx.automationRun.findUnique({
    where: { id: runId },
    include: { dispatch: true },
  })
  if (
    !run ||
    run.eventSource !== "SERVICE_STEP_COMPLETED" ||
    !run.dispatch ||
    !["SUCCEEDED", "FAILED", "EXITED"].includes(run.status)
  )
    return
  return settleServiceStepCompletionEventTx(tx, {
    tenantId: run.tenantId,
    eventId: run.dispatch.eventId,
    status: run.status as "SUCCEEDED" | "FAILED" | "EXITED",
    message: run.failureMessage || run.exitReasonDetails,
  })
}
