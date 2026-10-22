import type { Prisma } from "../generated/prisma/index.js"

export const unfinishedServiceWorkWhere = {
  OR: [
    {
      workflowKind: "SERVICE_STEPS",
      serviceSteps: { some: { occurrences: { some: {
        supersededAt: null,
        OR: [{ status: "ACTIVE" }, { progressionStatus: { in: ["WAITING_AUTOMATION", "PAUSED"] } }],
      } } } },
    },
    {
      workflowKind: { not: "SERVICE_STEPS" },
      followUpSteps: { some: { status: { in: ["PENDING", "ACTIVE", "POSTPONED"] } } },
    },
  ],
} satisfies Prisma.ContactServiceWhereInput

export function serviceScopeWhere(scope: { serviceGroupId?: string; serviceId?: string }): Prisma.ContactServiceWhereInput {
  return {
    ...(scope.serviceId ? { serviceId: scope.serviceId } : {}),
    ...(scope.serviceGroupId ? { service: { parentServiceId: scope.serviceGroupId } } : {}),
  }
}
export function offeringSteps<T extends { automations?: Array<{ serviceOfferingId?: string | null }> }>(steps: T[], offeringId: string): T[] {
  return steps.map(step => ({
    ...step,
    automations: step.automations?.filter(item => !item.serviceOfferingId || item.serviceOfferingId === offeringId),
  }))
}
export function enrolledStepProgress(steps: Array<{ id?: string; occurrences: Array<{ status: string; enteredAt?: Date; createdAt?: Date }> }>, movements: Array<{ skippedStepIds: unknown; createdAt: Date }> = []) {
  const completed = steps.filter(step => {
    const last = step.occurrences.at(-1)
    const skippedAt = movements
      .filter(move => Array.isArray(move.skippedStepIds) && move.skippedStepIds.includes(step.id))
      .reduce((latest, move) => Math.max(latest, move.createdAt.getTime()), 0)
    if (skippedAt && (!last || ((last.createdAt ?? last.enteredAt)?.getTime() ?? 0) < skippedAt)) return true
    return last && ["COMPLETED", "SKIPPED"].includes(last.status)
  }).length
  return { total: steps.length, completed, remaining: steps.length - completed, percentage: steps.length ? Math.round(completed / steps.length * 100) : 0 }
}
