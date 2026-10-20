import { z } from "zod"
import { Prisma } from "../generated/prisma/index.js"
import { ServiceCollectionError, lockServiceConfigurationTx } from "./service-configuration-collections.js"

export const ServiceKindSchema = z.enum(["GROUP", "OFFERING"])
export const ServiceHierarchyInputSchema = z.object({
  kind: ServiceKindSchema.default("GROUP"),
  parentServiceId: z.string().uuid().nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.kind === "GROUP" && value.parentServiceId) {
    ctx.addIssue({ code: "custom", path: ["parentServiceId"], message: "Parent services cannot be nested." })
  }
  if (value.kind === "OFFERING" && !value.parentServiceId) {
    ctx.addIssue({ code: "custom", path: ["parentServiceId"], message: "Choose a parent service for this sub-service." })
  }
})

export const serviceHierarchySelect = {
  kind: true,
  parentServiceId: true,
  parentService: { select: { id: true, name: true, isActive: true } },
  _count: { select: { subServices: true } },
} satisfies Prisma.ServiceSelect

export const enrollableServiceWhere = {
  kind: "OFFERING", isActive: true, parentService: { is: { kind: "GROUP", isActive: true } },
} satisfies Prisma.ServiceWhereInput

export async function validateServiceParentTx(
  tx: Prisma.TransactionClient, tenantId: string, kind: "GROUP" | "OFFERING", parentServiceId?: string | null,
) {
  if (kind === "GROUP") {
    if (parentServiceId) throw new ServiceCollectionError("SERVICE_GROUP_CANNOT_HAVE_PARENT")
    return
  }
  if (!parentServiceId) throw new ServiceCollectionError("SUB_SERVICE_PARENT_REQUIRED")
  const parents = await tx.$queryRaw<Array<{ id: string; kind: string }>>(Prisma.sql`
    SELECT "id", "kind" FROM "Service"
    WHERE "tenantId" = ${tenantId} AND "id" = ${parentServiceId} FOR UPDATE
  `)
  if (parents[0]?.kind !== "GROUP") throw new ServiceCollectionError("INVALID_PARENT_SERVICE")
}

export async function assertServiceEnrollableTx(tx: Prisma.TransactionClient, tenantId: string, serviceId: string) {
  const service = await tx.service.findFirst({
    where: { tenantId, id: serviceId }, select: { kind: true, parentServiceId: true },
  })
  if (!service) throw new ServiceCollectionError("INVALID_SERVICE")
  if (service.kind !== "OFFERING" || !service.parentServiceId) {
    throw new ServiceCollectionError("SUB_SERVICE_REQUIRED")
  }
  // Group first, then sub-service: consistent with configuration/deletion locks.
  await lockServiceConfigurationTx(tx, tenantId, service.parentServiceId)
  await lockServiceConfigurationTx(tx, tenantId, serviceId)
  const active = await tx.service.findFirst({ where: { tenantId, id: serviceId, ...enrollableServiceWhere }, select: { id: true } })
  if (!active) throw new ServiceCollectionError("SERVICE_NOT_AVAILABLE")
}
