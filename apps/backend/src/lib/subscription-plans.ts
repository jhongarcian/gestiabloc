export type PlanKey = "STARTER" | "PRO" | "BUSINESS"

export const trialPeriodDays = 7

export const subscriptionPlans: Record<
  PlanKey,
  {
    seatLimit: number
    storageBytes: number
    aiActionsPerMonth: number
  }
> = {
  STARTER: {
    seatLimit: 3,
    storageBytes: 5 * 1024 * 1024 * 1024, // 5 GB
    aiActionsPerMonth: 100,
  },
  PRO: {
    seatLimit: 10,
    storageBytes: 25 * 1024 * 1024 * 1024, // 25 GB
    aiActionsPerMonth: 750,
  },
  BUSINESS: {
    seatLimit: 25,
    storageBytes: 100 * 1024 * 1024 * 1024, // 100 GB
    aiActionsPerMonth: 3000,
  },
}

export function getSeatLimitForPlan(planKey: PlanKey) {
  return subscriptionPlans[planKey].seatLimit
}

export function getPlanDetails(planKey: PlanKey) {
  return subscriptionPlans[planKey]
}
