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
