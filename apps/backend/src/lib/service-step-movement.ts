import { updateServiceStatusTx } from "./service-automation-events.js"
import { z } from "zod"
import { Prisma } from "../generated/prisma/index.js"
import { ServiceCollectionError } from "./service-configuration-collections.js"
import { createServiceStepOccurrenceTx } from "./service-steps.js"

export const MoveServiceStepSchema = z
  .object({
    requestId: z.uuid(),
    expectedOccurrenceId: z.uuid(),
    reason: z.string().trim().min(1).max(1000),
    kind: z.enum(["MOVE", "SKIP"]),
    targetStepId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.kind === "MOVE") !== Boolean(value.targetStepId)) {
      context.addIssue({
        code: "custom",
        path: ["targetStepId"],
        message: "Select a destination for a move; skipping uses the next saved step.",
      })
    }
  })

// Called with the enrollment lock held. Scoped child workflows are obsolete too;
// unrelated contact workflows and work for other enrollments keep running.
export async function supersedeStepWorkTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contactServiceId: string,
  now: Date,
  reason: string,
  actorUserId: string | null,
  preserveRunId?: string,
) {
  const scope: Prisma.AutomationRunWhereInput = {
    tenantId,
    ...(preserveRunId ? { id: { not: preserveRunId } } : {}),
    AND: [
      { serviceContext: { path: ["contactServiceId"], equals: contactServiceId } },
      { serviceContext: { path: ["serviceStepOccurrenceId"], not: Prisma.JsonNull } },
    ],
  }
  const runs = await tx.automationRun.findMany({
    where: { ...scope, status: { in: ["QUEUED", "RUNNING", "WAITING"] } },
    orderBy: { id: "asc" },
  })
  for (const run of runs) {
    await tx.automationRun.update({
      where: { id: run.id },
      data: {
        status: "EXITED",
        exitedAt: now,
        exitRequestedAt: now,
        exitReasonCode: "SERVICE_STEP_MOVED",
        exitReasonDetails: reason,
        resumeAt: null,
        waitingNodeKey: null,
        waitingNodeExecutionId: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
    await tx.automationNodeExecution.updateMany({
      where: { tenantId, attemptId: run.attemptId, status: { in: ["QUEUED", "WAITING"] } },
      data: {
        status: "SKIPPED",
        reasonCode: "SERVICE_STEP_MOVED",
        details: reason,
        actorUserId,
        occurredAt: now,
      },
    })
    await tx.automationExecution.create({
      data: {
        tenantId,
        automationId: run.automationId,
        automationName: run.automationName,
        triggerType: run.triggerType,
        status: "EXITED",
        contactId: run.contactId,
        opportunityId: run.opportunityId,
        actorUserId,
        serviceContext: run.serviceContext as Prisma.InputJsonValue,
        actionCount: run.cursorIndex,
        errorCode: "SERVICE_STEP_MOVED",
        errorMessage: reason,
      },
    })
  }
  const events = await tx.automationEvent.findMany({
    where: {
      tenantId,
      status: { in: ["QUEUED", "PROCESSING"] },
      AND: [
        { serviceContext: { path: ["contactServiceId"], equals: contactServiceId } },
        { serviceContext: { path: ["serviceStepOccurrenceId"], not: Prisma.JsonNull } },
      ],
    },
    select: { id: true },
  })
  const eventIds = events.map((event) => event.id)
  await tx.automationDispatch.updateMany({
    where: { tenantId, eventId: { in: eventIds }, status: { in: ["QUEUED", "PROCESSING"] } },
    data: {
      status: "CANCELED",
      completedAt: now,
      errorCode: "SERVICE_STEP_MOVED",
      errorMessage: reason,
    },
  })
  await tx.automationNodeExecution.updateMany({
    where: {
      tenantId,
      id: {
        in: (
          await tx.automationDispatch.findMany({
            where: { eventId: { in: eventIds }, errorCode: "SERVICE_STEP_MOVED" },
            select: { triggerExecutionId: true },
          })
        ).map((dispatch) => dispatch.triggerExecutionId),
      },
      status: "QUEUED",
    },
    data: {
      status: "SKIPPED",
      reasonCode: "SERVICE_STEP_MOVED",
      details: reason,
      actorUserId,
      occurredAt: now,
    },
  })
  await tx.automationEvent.updateMany({
    where: { tenantId, id: { in: eventIds } },
    data: { status: "CANCELED", leaseToken: null, leaseExpiresAt: null, completedAt: now },
  })
}

export async function moveServiceStepTx(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof MoveServiceStepSchema> & {
    tenantId: string
    contactServiceId: string
    actorUserId: string | null
    actorName?: string
    automationSource?: Prisma.InputJsonValue
    automationChain?: import("./service-automation-actions.js").ServiceActionChain
    occurredAt?: Date
  },
) {
  const { tenantId, contactServiceId } = input
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "ContactService" WHERE "tenantId"=${tenantId} AND id=${contactServiceId} FOR UPDATE`,
  )
  const enrollment = await tx.contactService.findFirst({
    where: { tenantId, id: contactServiceId },
  })
  if (!enrollment) throw new ServiceCollectionError("CONTACT_SERVICE_NOT_FOUND", 404)
  const previous = await tx.serviceStepMovement.findUnique({
    where: {
      tenantId_contactServiceId_requestId: {
        tenantId,
        contactServiceId,
        requestId: input.requestId,
      },
    },
  })
  if (previous) {
    if (
      previous.kind !== input.kind ||
      previous.fromOccurrenceId !== input.expectedOccurrenceId ||
      (input.kind === "MOVE" && previous.toStepId !== input.targetStepId) ||
      previous.reason !== input.reason
    )
      throw new ServiceCollectionError("STEP_MOVEMENT_KEY_CONFLICT", 409)
    return previous
  }
  if (enrollment.workflowKind !== "SERVICE_STEPS")
    throw new ServiceCollectionError("INVALID_SERVICE_STEP_WORKFLOW", 409)
  if (["CANCELED", "COMPLETED"].includes(enrollment.status))
    throw new ServiceCollectionError("ENROLLMENT_NOT_ACTIVE", 409)
  const steps = await tx.contactServiceStep.findMany({
    where: { tenantId, contactServiceId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  })
  const occurrences = await tx.serviceStepOccurrence.findMany({
    where: { tenantId, contactServiceId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  })
  const current =
    occurrences.find((item) => !item.supersededAt && item.status === "ACTIVE") ??
    occurrences.find(
      (item) =>
        !item.supersededAt && ["WAITING_AUTOMATION", "PAUSED"].includes(item.progressionStatus),
    ) ??
    occurrences[0]
  if (!current || current.id !== input.expectedOccurrenceId)
    throw new ServiceCollectionError("SERVICE_STEP_CHANGED", 409)
  const fromIndex = steps.findIndex((step) => step.id === current.stepId)
  const targetIndex =
    input.kind === "SKIP"
      ? fromIndex + 1
      : steps.findIndex((step) => step.id === input.targetStepId)
  if (fromIndex < 0 || targetIndex < 0)
    throw new ServiceCollectionError("INVALID_ENROLLED_SERVICE_STEP")
  if (input.kind === "SKIP" && current.status !== "ACTIVE")
    throw new ServiceCollectionError("SERVICE_STEP_NOT_ACTIVE", 409)
  if (input.kind === "MOVE" && current.status === "ACTIVE" && targetIndex === fromIndex)
    throw new ServiceCollectionError("SERVICE_STEP_ALREADY_CURRENT", 409)
  const target = steps[targetIndex]
  const now = input.occurredAt ?? new Date()
  const skippedStepIds =
    targetIndex > fromIndex
      ? steps
          .slice(fromIndex, targetIndex)
          .filter((step) => step.id !== current.stepId || current.status === "ACTIVE")
          .map((step) => step.id)
      : []
  await tx.serviceStepOccurrence.updateMany({
    where: { tenantId, contactServiceId, supersededAt: null },
    data: { supersededAt: now },
  })
  await tx.serviceStepOccurrence.updateMany({
    where: {
      tenantId,
      contactServiceId,
      progressionStatus: { in: ["WAITING_AUTOMATION", "PAUSED"] },
    },
    data: { progressionStatus: "SUPERSEDED", progressionMessage: input.reason },
  })
  if (current.status === "ACTIVE")
    await tx.serviceStepOccurrence.update({
      where: { id: current.id },
      data: {
        status: targetIndex > fromIndex ? "SKIPPED" : "CANCELED",
        resolvedAt: now,
        resolutionReason: input.reason,
        progressionStatus: "SUPERSEDED",
      },
    })
  await supersedeStepWorkTx(
    tx,
    tenantId,
    contactServiceId,
    now,
    `Step moved: ${input.reason}`,
    input.actorUserId,
    (input.automationSource as { runId?: string } | undefined)?.runId,
  )
  let destinationId: string | null = null
  if (target) {
    await updateServiceStatusTx(tx, { tenantId, contactServiceId, status: "IN_PROGRESS", completedAt: null, actor: { actorUserId: input.actorUserId, automationSource: input.automationSource }, chain: input.automationChain })
    const destination = await createServiceStepOccurrenceTx(tx, {
      tenantId,
      contactServiceId,
      stepId: target.id,
      entryKey: `movement:${input.requestId}`,
      enteredAt: now,
      enteredByUserId: input.actorUserId,
      automationChain: input.automationChain,
    })
    destinationId = destination.id
  } else {
    // Skipping the final step finishes work, while the payment balance still determines status.
    await tx.serviceStepOccurrence.update({
      where: { id: current.id },
      data: { progressionStatus: "FINISHED", advancedAt: now },
    })
    const paid = await tx.contactServicePayment.aggregate({
      where: { tenantId, contactServiceId },
      _sum: { amountCents: true },
    })
    const settled = (paid._sum.amountCents ?? 0) >= enrollment.totalPriceCents
    await updateServiceStatusTx(tx, { tenantId, contactServiceId, status: settled ? "COMPLETED" : "PENDING_PAYMENT", completedAt: settled ? now : null, actor: { actorUserId: input.actorUserId, automationSource: input.automationSource }, chain: input.automationChain })
  }
  const actor = input.actorUserId ? await tx.user.findUnique({
    where: { id: input.actorUserId },
    select: { name: true, email: true },
  }) : null
  return tx.serviceStepMovement.create({
    data: {
      tenantId,
      contactServiceId,
      requestId: input.requestId,
      kind: input.kind,
      fromOccurrenceId: current.id,
      fromStepId: current.stepId,
      fromStepTitle: steps[fromIndex]!.title,
      toStepId: target?.id ?? null,
      toStepTitle: target?.title ?? null,
      toOccurrenceId: destinationId,
      skippedStepIds,
      reason: input.reason,
      actorUserId: input.actorUserId,
      actorName: input.actorName || actor?.name || actor?.email || "Automation",
      ...(input.automationSource ? { automationSource: input.automationSource } : {}),
      createdAt: now,
    },
  })
}
