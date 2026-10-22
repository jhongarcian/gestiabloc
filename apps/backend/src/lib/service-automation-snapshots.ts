import { z } from "zod"
import { Prisma } from "../generated/prisma/index.js"
import { SERVICE_TRIGGER_TYPES } from "./service-automation-triggers.js"

const definitionSchema = z.object({
  id: z.uuid(), name: z.string(), isEnabled: z.boolean(), triggerType: z.enum(SERVICE_TRIGGER_TYPES),
  serviceStepId: z.string().nullable(), serviceGroupId: z.string().nullable(),
  serviceOfferingId: z.string().nullable(), serviceTriggerConfig: z.unknown().nullable(),
  sortOrder: z.number(), conditions: z.array(z.record(z.string(), z.unknown())),
  actions: z.array(z.record(z.string(), z.unknown())),
})
const savedSchema = z.object({ schemaVersion: z.literal(1), definitions: z.array(definitionSchema) })
export type SavedServiceAutomation = z.infer<typeof definitionSchema>
export type SavedServiceAutomations = z.infer<typeof savedSchema>

// Absence denotes a pre-Chunk-18 enrollment and retains its previous live-definition behavior.
// A present, malformed snapshot must never silently fall back to live configuration.
export function readSavedServiceAutomations(configuration: unknown): SavedServiceAutomations | null {
  if (!configuration || typeof configuration !== "object" || !("serviceAutomations" in configuration)) return null
  return savedSchema.parse(configuration.serviceAutomations)
}

export async function captureServiceAutomationsTx(tx: Prisma.TransactionClient, input: {
  tenantId: string; serviceId: string; groupId: string | null; sourceStepIds: string[]
}): Promise<SavedServiceAutomations> {
  const { automationActionSnapshot } = await import("./opportunity-automations.js")
  const scope: Prisma.AutomationWhereInput = { tenantId: input.tenantId, triggerType: { in: [...SERVICE_TRIGGER_TYPES] },
      AND: [
        { OR: [{ serviceOfferingId: null }, { serviceOfferingId: input.serviceId }] },
        { OR: [{ serviceStepId: { in: input.sourceStepIds } }, ...(input.groupId ? [{ serviceGroupId: input.groupId }] : [])] },
      ],
    }
  const candidates = await tx.automation.findMany({
    where: scope,
    select: { id: true },
  })
  if (candidates.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM "Automation" WHERE "tenantId"=${input.tenantId} AND id IN (${Prisma.join(candidates.map(item => item.id))}) ORDER BY id FOR SHARE`)
  const definitions = await tx.automation.findMany({
    where: { AND: [scope, { id: { in: candidates.map(item => item.id) } }] },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { conditions: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }, actions: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
  })
  return savedSchema.parse(JSON.parse(JSON.stringify({ schemaVersion: 1, definitions: definitions.map(item => ({
    id: item.id, name: item.name, isEnabled: item.isEnabled, triggerType: item.triggerType,
    serviceStepId: item.serviceStepId, serviceGroupId: item.serviceGroupId,
    serviceOfferingId: item.serviceOfferingId, serviceTriggerConfig: item.serviceTriggerConfig,
    sortOrder: item.sortOrder,
    conditions: item.conditions.map(({ id, tenantId, automationId, createdAt, updatedAt, ...condition }) => condition),
    actions: item.actions.map(automationActionSnapshot),
  })) })))
}

export async function savedServiceAutomationsTx(tx: Prisma.TransactionClient, tenantId: string, contactServiceId: string) {
  const enrollment = await tx.contactService.findFirstOrThrow({ where: { tenantId, id: contactServiceId }, select: { configurationSnapshot: true } })
  return readSavedServiceAutomations(enrollment.configurationSnapshot)
}
