import { getSeatLimitForPlan, type PlanKey } from "./subscription-plans.js"
export function unpaidSubscription(planKey: PlanKey) {
  return { planKey, seatLimit: getSeatLimitForPlan(planKey), status: "NONE" as const, currentPeriodEnd: null, paidThrough: null, graceEndsAt: null }
}
