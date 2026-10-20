import { z } from "zod"
import { Prisma } from "../generated/prisma/index.js"

const optionalText = (max: number) => z.preprocess(
  (value) => typeof value === "string" ? value.trim() || null : value,
  z.string().max(max).nullable().optional(),
)

export const ServiceChecklistItemInputSchema = z.object({
  label: z.string().trim().min(1).max(200),
  description: optionalText(1000),
  isRequired: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
})

export const ServiceProfessionalInputSchema = z.object({
  kind: z.enum(["INTERNAL_USER", "EXTERNAL"]),
  userId: optionalText(120),
  externalProfessionalName: optionalText(160),
  externalContact: optionalText(160),
  notes: optionalText(500),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
})

export const ServiceChecklistItemUpdateSchema = ServiceChecklistItemInputSchema.extend({
  id: z.string().uuid().optional(),
})
export const ServiceProfessionalUpdateSchema = ServiceProfessionalInputSchema.extend({
  id: z.string().uuid().optional(),
})

export class ServiceCollectionError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code)
  }
}

export const serviceChecklistItemSelect = {
  id: true, label: true, description: true, isRequired: true, sortOrder: true,
} satisfies Prisma.ServiceChecklistItemSelect

export const serviceProfessionalSelect = {
  id: true, kind: true, userId: true, externalProfessionalName: true,
  externalContact: true, notes: true, sortOrder: true,
  user: { select: { name: true, email: true, image: true } },
} satisfies Prisma.ServiceProfessionalSelect

function validateIds(
  submitted: Array<{ id?: string }>,
  existing: Array<{ id: string; archivedAt: Date | null }>,
  collection: string,
) {
  const activeIds = new Set(existing.filter((item) => !item.archivedAt).map((item) => item.id))
  const seen = new Set<string>()
  for (const item of submitted) {
    if (!item.id) continue
    if (seen.has(item.id)) throw new ServiceCollectionError(`DUPLICATE_${collection}_ID`)
    if (!activeIds.has(item.id)) throw new ServiceCollectionError(`INVALID_${collection}_ID`)
    seen.add(item.id)
  }
}

export async function lockServiceConfigurationTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  serviceId: string,
) {
  const services = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "Service"
    WHERE "tenantId" = ${tenantId} AND "id" = ${serviceId}
    FOR UPDATE
  `)
  if (!services.length) throw new ServiceCollectionError("SERVICE_NOT_FOUND", 404)
}

// The parent lock serializes full-collection replacements across backend instances.
// The caller must run this helper and the service update in the same transaction.
export async function saveServiceCollectionsTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  serviceId: string,
  payload: {
    checklistItems?: z.infer<typeof ServiceChecklistItemUpdateSchema>[]
    professionals?: z.infer<typeof ServiceProfessionalUpdateSchema>[]
  },
) {
  await lockServiceConfigurationTx(tx, tenantId, serviceId)

  const checklist = payload.checklistItems === undefined ? [] : await tx.serviceChecklistItem.findMany({
    where: { tenantId, serviceId, archivedAt: null }, select: { id: true, archivedAt: true },
  })
  const professionals = payload.professionals === undefined ? [] : await tx.serviceProfessional.findMany({
    where: { tenantId, serviceId, archivedAt: null }, select: { id: true, archivedAt: true, kind: true, userId: true },
  })
  // Validate both collections before writing either collection.
  if (payload.checklistItems) validateIds(payload.checklistItems, checklist, "CHECKLIST_ITEM")
  if (payload.professionals) validateIds(payload.professionals, professionals, "SERVICE_PROFESSIONAL")

  const archivedAt = new Date()
  if (payload.checklistItems !== undefined) {
    const retainedIds = payload.checklistItems.flatMap((item) => item.id ? [item.id] : [])
    await tx.serviceChecklistItem.updateMany({
      where: { tenantId, serviceId, archivedAt: null, id: { notIn: retainedIds } },
      data: { archivedAt },
    })
    for (const [index, item] of payload.checklistItems.entries()) {
      const data = {
        label: item.label.trim(), description: item.description ?? null,
        isRequired: item.isRequired, sortOrder: item.sortOrder ?? (index + 1) * 10,
      }
      if (item.id) {
        await tx.serviceChecklistItem.update({ where: { id: item.id, tenantId, serviceId }, data })
      } else {
        await tx.serviceChecklistItem.create({ data: { ...data, tenantId, serviceId } })
      }
    }
  }

  if (payload.professionals !== undefined) {
    const existingById = new Map(professionals.map((item) => [item.id, item]))
    const retainedIds: string[] = []
    for (const [index, item] of payload.professionals.entries()) {
      const data = {
        kind: item.kind,
        userId: item.kind === "INTERNAL_USER" ? item.userId || null : null,
        externalProfessionalName: item.kind === "EXTERNAL" ? item.externalProfessionalName ?? null : null,
        externalContact: item.kind === "EXTERNAL" ? item.externalContact ?? null : null,
        notes: item.notes ?? null, sortOrder: item.sortOrder ?? (index + 1) * 10,
      }
      if ((data.kind === "INTERNAL_USER" && !data.userId) ||
          (data.kind === "EXTERNAL" && !data.externalProfessionalName?.trim())) {
        throw new ServiceCollectionError("INVALID_SERVICE_PROFESSIONAL")
      }
      const previous = item.id ? existingById.get(item.id) : undefined
      const sameIdentity = previous && previous.kind === data.kind && previous.userId === data.userId
      if (sameIdentity) {
        retainedIds.push(previous.id)
        await tx.serviceProfessional.update({ where: { id: previous.id, tenantId, serviceId }, data })
      } else {
        // Replacements get a new ID so existing enrollments keep the original person.
        const created = await tx.serviceProfessional.create({ data: { ...data, tenantId, serviceId } })
        retainedIds.push(created.id)
      }
    }
    await tx.serviceProfessional.updateMany({
      where: { tenantId, serviceId, archivedAt: null, id: { notIn: retainedIds } },
      data: { archivedAt },
    })
  }
}
