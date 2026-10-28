import { randomUUID } from "node:crypto"
import type { Prisma } from "../generated/prisma/index.js"

export const serviceStepAutomationSelect = {
  where: { triggerType: { in: ["SERVICE_STEP_ENTERED", "SERVICE_STEP_COMPLETED"] } },
  orderBy: [{ triggerType: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
  select: {
    triggerType: true,
    serviceOfferingId: true,
    serviceOffering: { select: { name: true } },
    id: true,
    name: true,
    isEnabled: true,
    _count: { select: { actions: true } },
  },
} satisfies Prisma.ServiceStep$automationsArgs

// Configuration saves already hold the service lock. Existing drafts/actions are never replaced.
export async function ensureServiceStepAutomationsTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  serviceId: string,
) {
  for (const triggerType of ["SERVICE_STEP_ENTERED", "SERVICE_STEP_COMPLETED"] as const) {
    const steps = await tx.serviceStep.findMany({
      where: {
        tenantId,
        serviceId,
        archivedAt: null,
        automations: { none: { triggerType } },
      },
      select: { id: true, title: true },
    })
    if (!steps.length) continue
    const last = await tx.automation.aggregate({
      where: { tenantId },
      _max: { sortOrder: true, librarySortOrder: true },
    })
    for (const [index, step] of steps.entries()) {
      const baseName = `Step ${triggerType === "SERVICE_STEP_ENTERED" ? "entered" : "completed"}: ${step.title.slice(0, 82)}`
      for (let suffix = 1; ; suffix += 1) {
        const created = await tx.automation.createMany({
          data: [
            {
              id: randomUUID(),
              tenantId,
              serviceStepId: step.id,
              name: suffix === 1 ? baseName : `${baseName} (${suffix})`,
              triggerType,
              isEnabled: false,
              sortOrder: (last._max.sortOrder ?? 0) + (index + 1) * 10,
              librarySortOrder: (last._max.librarySortOrder ?? 0) + (index + 1) * 10,
            },
          ],
          skipDuplicates: true,
        })
        if (created.count) break
        // Another save may have created this step's draft; a name collision only needs a new suffix.
        if (
          await tx.automation.findFirst({
            where: { tenantId, serviceStepId: step.id, triggerType },
            select: { id: true },
          })
        )
          break
      }
    }
  }
}
