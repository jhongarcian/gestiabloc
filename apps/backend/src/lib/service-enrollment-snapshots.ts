import { z } from "zod"
import { Prisma } from "../generated/prisma/index.js"

const professionalSchema = z.object({
  id: z.string(),
  kind: z.enum(["INTERNAL_USER", "EXTERNAL"]),
  userId: z.string().nullable(),
  externalProfessionalName: z.string().nullable(),
  externalContact: z.string().nullable(),
  notes: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
  user: z
    .object({
      name: z.string().nullable(),
      email: z.string(),
      image: z.string().nullable().optional(),
    })
    .nullable(),
})
export type ProfessionalSnapshot = z.infer<typeof professionalSchema>
const configurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    service: z.object({ id: z.string(), name: z.string(), description: z.string().nullable() }),
    professionals: z.array(professionalSchema),
  })
  .passthrough()

export function readEnrollmentConfiguration(value: unknown) {
  const parsed = configurationSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
export function readProfessionalSnapshot(value: unknown) {
  const parsed = professionalSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
export function professionalSnapshot(value: ProfessionalSnapshot): Prisma.InputJsonValue {
  // Schema parsing copies only the public attribution fields; live User records are never serialized.
  return professionalSchema.parse(value) as Prisma.InputJsonValue
}
export function captureEnrollmentConfiguration(input: {
  service: {
    id: string
    name: string
    description: string | null
    parentService: unknown
    inheritance: unknown
    checklistItems: unknown[]
    professionals: unknown[]
    steps: unknown[]
  }
  billing: unknown
  workflowKind: string
  followUpTemplateVersionId: string | null
  serviceAutomations?: unknown
}): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify({
      schemaVersion: 1,
      service: {
        id: input.service.id,
        name: input.service.name,
        description: input.service.description,
        parentService: input.service.parentService,
      },
      inheritance: input.service.inheritance,
      billing: input.billing,
      workflowKind: input.workflowKind,
      followUpTemplateVersionId: input.followUpTemplateVersionId,
      checklistItems: input.service.checklistItems,
      professionals: input.service.professionals,
      steps: input.service.steps,
      ...(input.serviceAutomations ? { serviceAutomations: input.serviceAutomations } : {}),
    }),
  ) as Prisma.InputJsonValue
}
export async function enrollmentProfessionalOptions(
  tx: Prisma.TransactionClient,
  tenantId: string,
  configuration: unknown,
  fallback: ProfessionalSnapshot[],
) {
  const snapshot = readEnrollmentConfiguration(configuration)
  if (!snapshot) return fallback
  const active = await tx.serviceProfessional.findMany({
    where: { tenantId, id: { in: snapshot.professionals.map((p) => p.id) }, archivedAt: null },
    select: { id: true },
  })
  const available = new Set(active.map((p) => p.id))
  return snapshot.professionals.filter((p) => available.has(p.id))
}

export const enrolledChecklistSnapshotSelect = {
  labelSnapshot: true,
  descriptionSnapshot: true,
  isRequiredSnapshot: true,
  sortOrderSnapshot: true,
} satisfies Prisma.ContactServiceChecklistItemSelect

export function serializeEnrolledChecklistItem(item: {
  id: string
  checklistItemId: string
  status: string
  completedAt: Date | null
  labelSnapshot?: string | null
  descriptionSnapshot?: string | null
  isRequiredSnapshot?: boolean | null
  sortOrderSnapshot?: number | null
  checklistItem?: {
    label?: string
    description?: string | null
    isRequired?: boolean
    sortOrder?: number
  } | null
}) {
  const captured = item.labelSnapshot !== null && item.labelSnapshot !== undefined
  return {
    id: item.id,
    checklistItemId: item.checklistItemId,
    status: item.status,
    completedAt: item.completedAt,
    label: captured ? item.labelSnapshot! : (item.checklistItem?.label ?? ""),
    description: captured
      ? (item.descriptionSnapshot ?? null)
      : (item.checklistItem?.description ?? null),
    isRequired: captured
      ? Boolean(item.isRequiredSnapshot)
      : Boolean(item.checklistItem?.isRequired),
    sortOrder: captured ? (item.sortOrderSnapshot ?? 0) : (item.checklistItem?.sortOrder ?? 0),
  }
}
