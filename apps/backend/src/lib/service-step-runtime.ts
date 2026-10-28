import { Prisma } from "../generated/prisma/index.js"
import { readAutomationServiceContext } from "./automation-service-context.js"

// Enrollment first, then dispatch/run: movement and workers must use the same lock order.
export async function lockServiceStepRuntimeTx(
  tx: any,
  source: { tenantId: string; serviceContext?: unknown },
) {
  const context = readAutomationServiceContext(source.serviceContext)
  if (!context || typeof tx.$queryRaw !== "function") return null
  const locked = await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "ContactService" WHERE "tenantId"=${source.tenantId} AND id=${context.contactServiceId} FOR UPDATE`,
  )
  if (Array.isArray(locked) && !locked.length) return { context, superseded: true }
  if (!context.serviceStepOccurrenceId) return { context, superseded: false }
  const occurrence = await tx.serviceStepOccurrence.findFirst({
    where: {
      tenantId: source.tenantId,
      contactServiceId: context.contactServiceId,
      id: context.serviceStepOccurrenceId,
    },
    select: { supersededAt: true },
  })
  return { context, superseded: Boolean(occurrence?.supersededAt) }
}
