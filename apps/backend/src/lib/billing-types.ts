import type { AiCreditPackKey, PlanKey } from "./subscription-plans.js"

export type BillingCheckoutInput =
  | { kind: "subscription"; planKey: PlanKey; requestId: string }
  | { kind: "credits"; packKey: AiCreditPackKey; requestId: string }

export type BillingCheckoutResponse = { ok: true; checkoutId: string; url: string }
export type AiCreditUsage = {
  purchaseReviewRequired: boolean
  revision: number
  period: { startsAt: string; endsAt: string } | null
  monthly: { granted: number; used: number; reserved: number; remaining: number }
  purchased: { balance: number; reserved: number; available: number }
  available: number
}

export const BILLING_ERROR_CODES = [
  "BILLING_UNAVAILABLE", "BILLING_REQUIRED", "BILLING_ADMIN_REQUIRED",
  "AI_CREDITS_EXHAUSTED", "AI_REQUEST_CONFLICT", "AI_REQUEST_IN_PROGRESS",
  "AI_RESPONSE_EXPIRED", "BILLING_CHECKOUT_PENDING", "BILLING_PRICE_MISMATCH",
  "AI_PURCHASE_REVIEW_REQUIRED", "AI_BILLING_UNAVAILABLE", "AI_REQUEST_ID_REQUIRED",
] as const
export type BillingErrorCode = typeof BILLING_ERROR_CODES[number]
