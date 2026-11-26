export type PlanKey = "STARTER" | "PRO" | "BUSINESS"

export const subscriptionPlans: Record<
  PlanKey,
  {
    seatLimit: number
    storageBytes: number
    name: string
    monthlyPriceCents: number
    currency: "usd"
    trialEnabled: false
    aiCreditsPerMonth: number
  }
> = {
  STARTER: {
    name: "Starter",
    monthlyPriceCents: 4900,
    currency: "usd",
    trialEnabled: false,
    seatLimit: 3,
    storageBytes: 5 * 1024 * 1024 * 1024, // 5 GB
    aiCreditsPerMonth: 1200,
  },
  PRO: {
    name: "Pro",
    monthlyPriceCents: 9900,
    currency: "usd",
    trialEnabled: false,
    seatLimit: 10,
    storageBytes: 25 * 1024 * 1024 * 1024, // 25 GB
    aiCreditsPerMonth: 2400,
  },
  BUSINESS: {
    name: "Business",
    monthlyPriceCents: 19900,
    currency: "usd",
    trialEnabled: false,
    seatLimit: 25,
    storageBytes: 100 * 1024 * 1024 * 1024, // 100 GB
    aiCreditsPerMonth: 4800,
  },
}

// Provisional until the model quality and delivery-cost gates pass.
export const aiCreditPacks = {
  AI_1000: { credits: 1000, priceCents: 500, currency: "usd" },
  AI_5000: { credits: 5000, priceCents: 2400, currency: "usd" },
  AI_10000: { credits: 10000, priceCents: 4500, currency: "usd" },
} as const
export type AiCreditPackKey = keyof typeof aiCreditPacks

export function getSeatLimitForPlan(planKey: PlanKey) {
  return subscriptionPlans[planKey].seatLimit
}

export function getPlanDetails(planKey: PlanKey) {
  return subscriptionPlans[planKey]
}
