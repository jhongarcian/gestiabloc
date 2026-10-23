import {
  ensureServiceStepAutomationsTx,
  serviceStepAutomationSelect,
} from "./service-step-automations.js"
import { z } from "zod"
import { Prisma } from "../generated/prisma/index.js"
import {
  lockServiceConfigurationTx,
  ServiceCollectionError,
} from "./service-configuration-collections.js"

export const ServiceStepTimeUnitSchema = z.enum(["MINUTES", "HOURS", "DAYS"])
const unitMinutes = { MINUTES: 1, HOURS: 60, DAYS: 1440 } as const
const stepFields = z.object({
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().max(10000).nullable().optional(),
  completionDuration: z.coerce.number().int().min(1).max(5_256_000).default(3),
  completionUnit: ServiceStepTimeUnitSchema.default("DAYS"),
})
const withinLimit = (step: z.infer<typeof stepFields>) =>
  step.completionDuration * unitMinutes[step.completionUnit] <= 5_256_000
const durationError = {
  message: "Completion timeframe must be ten years or less.",
  path: ["completionDuration"],
}
export const ServiceStepInputSchema = stepFields.refine(withinLimit, durationError)
export const ServiceStepUpdateSchema = stepFields
  .extend({ id: z.string().uuid().optional() })
  .refine(withinLimit, durationError)
export const serviceStepSelect = {
  automations: serviceStepAutomationSelect,
  id: true,
  title: true,
  instructions: true,
  completionDuration: true,
  completionUnit: true,
  sortOrder: true,
} satisfies Prisma.ServiceStepSelect

export async function saveServiceStepsTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  serviceId: string,
  steps: z.infer<typeof ServiceStepUpdateSchema>[],
) {
  await lockServiceConfigurationTx(tx, tenantId, serviceId)
  const active = await tx.serviceStep.findMany({
    where: { tenantId, serviceId, archivedAt: null },
    select: { id: true },
  })
  const allowed = new Set(active.map((step) => step.id))
  const seen = new Set<string>()
  for (const step of steps) {
    if (!step.id) continue
    if (seen.has(step.id)) throw new ServiceCollectionError("DUPLICATE_SERVICE_STEP_ID")
    if (!allowed.has(step.id)) throw new ServiceCollectionError("INVALID_SERVICE_STEP_ID")
    seen.add(step.id)
  }
  await tx.serviceStep.updateMany({
    where: { tenantId, serviceId, archivedAt: null, id: { notIn: [...seen] } },
    data: { archivedAt: new Date() },
  })
  for (const [index, step] of steps.entries()) {
    const data = {
      title: step.title.trim(),
      instructions: step.instructions?.trim() || null,
      completionDuration: step.completionDuration,
      completionUnit: step.completionUnit,
      sortOrder: (index + 1) * 10,
    }
    if (step.id) await tx.serviceStep.update({ where: { id: step.id, tenantId, serviceId }, data })
    else await tx.serviceStep.create({ data: { tenantId, serviceId, ...data } })
  }
  await ensureServiceStepAutomationsTx(tx, tenantId, serviceId)
}

export const enrolledServiceStepsSelect = {
  orderBy: [{ sortOrder: "asc" }],
  include: {
    assignedTo: { select: { id: true, name: true, email: true } },
    occurrences: {
      orderBy: [{ occurrenceNumber: "asc" }],
      include: { deadlineChanges: { orderBy: { revision: "asc" } } },
    },
  },
} satisfies Prisma.ContactService$serviceStepsArgs

// Entry and its automation event commit together under the enrollment lock.
// A revisit creates another occurrence; it never rewrites the previous entry.
export async function createServiceStepOccurrenceTx(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string
    contactServiceId: string
    stepId: string
    entryKey: string
    enteredAt: Date
    automationChain?: import("./service-automation-actions.js").ServiceActionChain
    enteredByUserId?: string | null
  },
) {
  const { tenantId, contactServiceId, stepId, entryKey, enteredAt } = input
  const locked = await tx.$queryRaw<Array<{ workflowKind: string; status: string; contactId: string; serviceId: string }>>(Prisma.sql`
    SELECT "workflowKind", "status", "contactId", "serviceId" FROM "ContactService" WHERE "tenantId"=${tenantId} AND "id"=${contactServiceId} FOR UPDATE
  `)
  if (!locked.length) throw new ServiceCollectionError("CONTACT_SERVICE_NOT_FOUND", 404)
  if (locked[0].workflowKind !== "SERVICE_STEPS")
    throw new ServiceCollectionError("INVALID_SERVICE_STEP_WORKFLOW")
  const previous = await tx.serviceStepOccurrence.findUnique({
    where: { tenantId_contactServiceId_entryKey: { tenantId, contactServiceId, entryKey } },
  })
  if (previous) {
    if (previous.stepId !== stepId) throw new ServiceCollectionError("STEP_ENTRY_KEY_CONFLICT", 409)
    return previous
  }
  if (locked[0].status === "COMPLETED" || locked[0].status === "CANCELED")
    throw new ServiceCollectionError("ENROLLMENT_NOT_ACTIVE", 409)
  const step = await tx.contactServiceStep.findFirst({
    where: { tenantId, contactServiceId, id: stepId },
  })
  if (!step) throw new ServiceCollectionError("INVALID_ENROLLED_SERVICE_STEP")
  if (
    await tx.serviceStepOccurrence.findFirst({
      where: { tenantId, contactServiceId, status: "ACTIVE" },
      select: { id: true },
    })
  ) {
    throw new ServiceCollectionError("CURRENT_SERVICE_STEP_UNRESOLVED", 409)
  }
  if (!Number.isFinite(enteredAt.getTime()))
    throw new ServiceCollectionError("INVALID_STEP_ENTRY_DATE")
  const dueAt = new Date(
    enteredAt.getTime() + step.completionDuration * unitMinutes[step.completionUnit] * 60000,
  )
  if (!Number.isFinite(dueAt.getTime())) throw new ServiceCollectionError("INVALID_STEP_ENTRY_DATE")
  const last = await tx.serviceStepOccurrence.aggregate({
    where: { tenantId, stepId },
    _max: { occurrenceNumber: true },
  })
  const occurrence = await tx.serviceStepOccurrence.create({
    data: {
      tenantId,
      contactServiceId,
      stepId,
      entryKey,
      occurrenceNumber: (last._max.occurrenceNumber ?? 0) + 1,
      enteredAt,
      dueAt,
      defaultDueAt: dueAt,
      enteredByUserId: input.enteredByUserId ?? null,
    },
  })
  const { queueServiceStepEnteredAutomationEvent } = await import("./automation-event-queue.js")
  // These rows were just locked/read/created above. The queue validates their
  // attribution once before saving the event; do not resolve the same IDs twice.
  const enrollment = locked[0]
  await queueServiceStepEnteredAutomationEvent(tx, {
    tenantId,
    contactId: enrollment.contactId,
    actorUserId: input.enteredByUserId ?? null,
    ...input.automationChain,
    serviceContext: {
      contactServiceId,
      serviceId: enrollment.serviceId,
      contactServiceStepId: step.id,
      serviceStepId: step.sourceStepId,
      serviceStepOccurrenceId: occurrence.id,
    },
  })
  return occurrence
}
