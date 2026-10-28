import { randomUUID } from "node:crypto"
import { z } from "zod"
import { Prisma } from "../generated/prisma/index.js"
import { ServiceCollectionError } from "./service-configuration-collections.js"
import {
  automationServiceContextData,
  validateAutomationServiceContextTx,
} from "./automation-service-context.js"

const unitMs = { SECONDS: 1000, MINUTES: 60000, HOURS: 3600000, DAYS: 86400000 } as const
const maxWaitMs = 3650 * unitMs.DAYS
const waitTarget = z.object({
  runId: z.uuid(),
  waitingNodeExecutionId: z.uuid(),
  expectedResumeAt: z.iso.datetime({ offset: true }),
})
export const ContinueServiceStepWaitSchema = waitTarget.strict()
export const RescheduleServiceStepWaitSchema = waitTarget
  .extend({
    schedule: z.discriminatedUnion("mode", [
      z
        .object({
          mode: z.literal("DURATION"),
          amount: z.number().int().min(1).max(315360000),
          unit: z.enum(["SECONDS", "MINUTES", "HOURS", "DAYS"]),
        })
        .strict()
        .refine((value) => value.amount * unitMs[value.unit] <= maxWaitMs, {
          message: "The wait must be ten years or less.",
          path: ["amount"],
        }),
      z
        .object({ mode: z.literal("FIXED_DATE"), dateTime: z.iso.datetime({ offset: true }) })
        .strict(),
    ]),
  })
  .strict()

type Scope = { tenantId: string; contactServiceId: string; occurrenceId: string }

async function findOccurrence(client: Prisma.TransactionClient, input: Scope) {
  const occurrence = await client.serviceStepOccurrence.findFirst({
    where: {
      tenantId: input.tenantId,
      contactServiceId: input.contactServiceId,
      id: input.occurrenceId,
    },
  })
  if (!occurrence) throw new ServiceCollectionError("SERVICE_STEP_OCCURRENCE_NOT_FOUND", 404)
  return occurrence
}

function runScope(input: Scope, eventId: string) {
  return {
    tenantId: input.tenantId,
    eventSource: "SERVICE_STEP_COMPLETED" as const,
    dispatch: { eventId, event: { tenantId: input.tenantId } },
  }
}

function serializeWait(run: {
  id: string
  automationId: string | null
  automationName?: string
  resumeAt: Date | null
  waitingNodeExecutionId: string | null
  status: string
}) {
  if (!run.resumeAt || !run.waitingNodeExecutionId) return null
  return {
    runId: run.id,
    automationId: run.automationId,
    automationName: run.automationName,
    waitingNodeExecutionId: run.waitingNodeExecutionId,
    resumeAt: run.resumeAt,
    status: run.status as "WAITING" | "RUNNING",
  }
}

export async function getServiceStepCompletionWaits(
  client: Prisma.TransactionClient,
  input: Scope,
) {
  const occurrence = await findOccurrence(client, input)
  if (occurrence.progressionStatus !== "WAITING_AUTOMATION" || !occurrence.completionEventId)
    return []
  const runs = await client.automationRun.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    where: {
      ...runScope(input, occurrence.completionEventId),
      status: { in: ["WAITING", "RUNNING"] },
      waitingNodeExecutionId: { not: null },
      exitRequestedAt: null,
    },
  })
  return runs.map(serializeWait).filter((wait) => wait !== null)
}

export async function getServiceStepCompletionWait(client: Prisma.TransactionClient, input: Scope) {
  return (await getServiceStepCompletionWaits(client, input))[0] ?? null
}

export async function changeServiceStepCompletionWaitTx(
  tx: Prisma.TransactionClient,
  input: Scope & {
    actorUserId: string
    change:
      | ({ type: "CONTINUE" } & z.infer<typeof ContinueServiceStepWaitSchema>)
      | ({ type: "RESCHEDULE" } & z.infer<typeof RescheduleServiceStepWaitSchema>)
    occurredAt?: Date
  },
) {
  const occurrence = await findOccurrence(tx, input)
  if (!occurrence.completionEventId)
    throw new ServiceCollectionError("COMPLETION_WAIT_CHANGED", 409)
  const where = { ...runScope(input, occurrence.completionEventId), id: input.change.runId }
  const initialRun = await tx.automationRun.findFirst({ where, select: { id: true } })
  if (!initialRun) throw new ServiceCollectionError("COMPLETION_WAIT_NOT_FOUND", 404)
  // Enrollment first, then run, matching movement and worker transactions.
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "ContactService" WHERE "tenantId"=${input.tenantId} AND id=${input.contactServiceId} FOR UPDATE`,
  )
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "AutomationRun" WHERE "tenantId"=${input.tenantId} AND id=${initialRun.id} FOR UPDATE`,
  )
  const enrollment = await tx.contactService.findFirst({
    where: { tenantId: input.tenantId, id: input.contactServiceId },
  })
  const current = await findOccurrence(tx, input)
  const run = await tx.automationRun.findFirst({ where })
  if (
    !enrollment ||
    enrollment.workflowKind !== "SERVICE_STEPS" ||
    ["CANCELED", "COMPLETED"].includes(enrollment.status) ||
    current.status !== "COMPLETED" ||
    current.progressionStatus !== "WAITING_AUTOMATION" ||
    current.completionEventId !== occurrence.completionEventId ||
    !run ||
    !["WAITING", "RUNNING"].includes(run.status) ||
    run.exitRequestedAt ||
    run.waitingNodeExecutionId !== input.change.waitingNodeExecutionId ||
    !run.waitingNodeKey ||
    run.resumeAt?.getTime() !== new Date(input.change.expectedResumeAt).getTime()
  ) {
    throw new ServiceCollectionError("COMPLETION_WAIT_CHANGED", 409)
  }
  await validateAutomationServiceContextTx(tx, run)
  const waitLog = await tx.automationNodeExecution.findFirst({
    where: {
      tenantId: input.tenantId,
      id: input.change.waitingNodeExecutionId,
      attemptId: run.attemptId,
      nodeKey: run.waitingNodeKey,
      status: "WAITING",
    },
  })
  if (!waitLog) throw new ServiceCollectionError("COMPLETION_WAIT_CHANGED", 409)
  const now = input.occurredAt ?? new Date()
  const resumeAt =
    input.change.type === "CONTINUE"
      ? now
      : input.change.schedule.mode === "DURATION"
        ? new Date(
            now.getTime() + input.change.schedule.amount * unitMs[input.change.schedule.unit],
          )
        : new Date(input.change.schedule.dateTime)
  if (
    !Number.isFinite(resumeAt.getTime()) ||
    (input.change.type === "RESCHEDULE" &&
      (resumeAt.getTime() <= now.getTime() || resumeAt.getTime() - now.getTime() > maxWaitMs))
  ) {
    throw new ServiceCollectionError("INVALID_COMPLETION_WAIT_DATE")
  }
  const updated = await tx.automationRun.update({
    where: { id: run.id, tenantId: input.tenantId },
    data: {
      status: "WAITING",
      resumeAt,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
  // Keep a separate audit entry so later worker log updates cannot erase staff changes.
  await tx.automationNodeExecution.create({
    data: {
      tenantId: input.tenantId,
      automationId: run.automationId,
      automationName: run.automationName,
      contactId: run.contactId,
      contactName: run.contactName,
      actorUserId: input.actorUserId,
      opportunityId: run.opportunityId,
      ...automationServiceContextData(run),
      attemptId: run.attemptId,
      eventSource: "SERVICE_STEP_COMPLETED",
      nodeKind: "ACTION",
      nodeOrder: waitLog.nodeOrder,
      nodeKey: `${run.waitingNodeKey}:schedule:${randomUUID()}`,
      nodeLabel: input.change.type === "CONTINUE" ? "Continue now" : "Wait rescheduled",
      status: "EXECUTED",
      reasonCode: input.change.type === "CONTINUE" ? "WAIT_CONTINUE_REQUESTED" : "WAIT_RESCHEDULED",
      details: `${input.change.type === "CONTINUE" ? "Requested continuation" : "Rescheduled this enrollment's wait"}. Previous schedule: ${run.resumeAt!.toISOString()}. New schedule: ${resumeAt.toISOString()}. Remaining completion actions still run before progression.`,
      branchPath: waitLog.branchPath ?? Prisma.DbNull,
      occurredAt: now,
    },
  })
  return serializeWait(updated)!
}
