import { z } from "zod"
import { Prisma } from "../generated/prisma/index.js"
import { ServiceCollectionError } from "./service-configuration-collections.js"

const unitMs = { MINUTES: 60000, HOURS: 3600000, DAYS: 86400000 } as const
const maxDurationMs = 3650 * unitMs.DAYS
export const ServiceStepDeadlineScheduleSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("DEFAULT") }).strict(),
  z
    .object({
      mode: z.literal("DURATION"),
      amount: z.number().int().min(1).max(5256000),
      unit: z.enum(["MINUTES", "HOURS", "DAYS"]),
    })
    .strict()
    .refine((value) => value.amount * unitMs[value.unit] <= maxDurationMs, {
      message: "The timeframe must be ten years or less.",
      path: ["amount"],
    }),
  z
    .object({
      mode: z.literal("FIXED_DATE"),
      dateTime: z.iso
        .datetime({ offset: true })
        .transform((value) => new Date(value).toISOString()),
    })
    .strict(),
])
export const ChangeServiceStepDeadlineSchema = z
  .object({
    requestId: z.uuid(),
    expectedDeadlineRevision: z.number().int().min(0).max(2147483646),
    schedule: ServiceStepDeadlineScheduleSchema,
  })
  .strict()

export function serviceStepDeadlineDate(
  occurrence: { enteredAt: Date; defaultDueAt: Date },
  schedule: z.infer<typeof ServiceStepDeadlineScheduleSchema>,
) {
  if (schedule.mode === "DEFAULT") return occurrence.defaultDueAt
  const dueAt =
    schedule.mode === "DURATION"
      ? new Date(occurrence.enteredAt.getTime() + schedule.amount * unitMs[schedule.unit])
      : new Date(schedule.dateTime)
  const duration = dueAt.getTime() - occurrence.enteredAt.getTime()
  // Past deadlines are valid for overdue work; a deadline must follow this entry.
  if (!Number.isFinite(duration) || duration <= 0 || duration > maxDurationMs)
    throw new ServiceCollectionError("INVALID_SERVICE_STEP_DEADLINE")
  return dueAt
}

const includeHistory = { deadlineChanges: { orderBy: { revision: "asc" as const } } }
export async function changeServiceStepDeadlineTx(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof ChangeServiceStepDeadlineSchema> & {
    tenantId: string
    contactServiceId: string
    occurrenceId: string
    actorUserId: string | null
    actorName?: string
    automationSource?: Prisma.InputJsonValue
    occurredAt?: Date
  },
) {
  const { tenantId, contactServiceId, occurrenceId } = input
  // Match completion, movement and worker locking. A stale dialog cannot edit a revisit.
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "ContactService" WHERE "tenantId"=${tenantId} AND id=${contactServiceId} FOR UPDATE`,
  )
  const enrollment = await tx.contactService.findFirst({
    where: { tenantId, id: contactServiceId },
  })
  if (!enrollment) throw new ServiceCollectionError("CONTACT_SERVICE_NOT_FOUND", 404)
  const occurrence = await tx.serviceStepOccurrence.findFirst({
    where: { tenantId, contactServiceId, id: occurrenceId },
    include: includeHistory,
  })
  if (!occurrence) throw new ServiceCollectionError("SERVICE_STEP_OCCURRENCE_NOT_FOUND", 404)
  const previous = await tx.serviceStepDeadlineChange.findUnique({
    where: {
      tenantId_occurrenceId_requestId: { tenantId, occurrenceId, requestId: input.requestId },
    },
  })
  const schedule = input.schedule
  if (previous) {
    // JSONB does not preserve key order. Compare parsed canonical schedule objects.
    const savedSchedule = ServiceStepDeadlineScheduleSchema.parse(previous.schedule)
    if (
      previous.previousRevision !== input.expectedDeadlineRevision ||
      JSON.stringify(savedSchedule) !== JSON.stringify(schedule)
    )
      throw new ServiceCollectionError("DEADLINE_REQUEST_CONFLICT", 409)
    return occurrence
  }
  if (enrollment.workflowKind !== "SERVICE_STEPS")
    throw new ServiceCollectionError("INVALID_SERVICE_STEP_WORKFLOW", 409)
  if (["CANCELED", "COMPLETED"].includes(enrollment.status))
    throw new ServiceCollectionError("ENROLLMENT_NOT_ACTIVE", 409)
  if (
    occurrence.status !== "ACTIVE" ||
    occurrence.supersededAt ||
    occurrence.deadlineRevision !== input.expectedDeadlineRevision
  )
    throw new ServiceCollectionError("SERVICE_STEP_DEADLINE_CHANGED", 409)
  const dueAt = serviceStepDeadlineDate(occurrence, schedule)
  const previousSchedule = occurrence.deadlineOverride ?? { mode: "DEFAULT" }
  if (
    dueAt.getTime() === occurrence.dueAt.getTime() &&
    JSON.stringify(ServiceStepDeadlineScheduleSchema.parse(previousSchedule)) ===
      JSON.stringify(schedule)
  )
    return occurrence
  const actor = input.actorUserId ? await tx.user.findUnique({
    where: { id: input.actorUserId },
    select: { name: true, email: true },
  }) : null
  await tx.serviceStepDeadlineChange.create({
    data: {
      tenantId,
      contactServiceId,
      occurrenceId,
      requestId: input.requestId,
      previousDueAt: occurrence.dueAt,
      dueAt,
      previousSchedule,
      schedule,
      previousRevision: occurrence.deadlineRevision,
      revision: occurrence.deadlineRevision + 1,
      actorUserId: input.actorUserId,
      actorName: input.actorName || actor?.name || actor?.email || "Automation",
      ...(input.automationSource ? { automationSource: input.automationSource } : {}),
      createdAt: input.occurredAt ?? new Date(),
    },
  })
  return tx.serviceStepOccurrence.update({
    where: { id: occurrenceId },
    data: {
      dueAt,
      deadlineOverride: schedule.mode === "DEFAULT" ? Prisma.DbNull : schedule,
      deadlineRevision: { increment: 1 },
    },
    include: includeHistory,
  })
}
