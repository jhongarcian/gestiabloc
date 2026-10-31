import { z } from "zod"

const flag = z.enum(["true", "false"]).default("false").transform(value => value === "true")
const schema = z.object({
  STRIPE_SECRET_KEY: z.string().trim().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().trim().min(1).optional(),
  STRIPE_PORTAL_CONFIGURATION_ID: z.string().trim().min(1).optional(),
  STRIPE_PRICE_STARTER_MONTHLY: z.string().trim().min(1).optional(),
  STRIPE_PRICE_PRO_MONTHLY: z.string().trim().min(1).optional(),
  STRIPE_PRICE_BUSINESS_MONTHLY: z.string().trim().min(1).optional(),
  STRIPE_PRICE_AI_1000: z.string().trim().min(1).optional(),
  STRIPE_PRICE_AI_5000: z.string().trim().min(1).optional(),
  STRIPE_PRICE_AI_10000: z.string().trim().min(1).optional(),
  BILLING_ENABLED: flag,
  AI_CREDIT_ENFORCEMENT_ENABLED: flag,
  AI_CREDIT_PURCHASES_ENABLED: flag,
  AI_CREDIT_MODEL_GATE_PASSED: flag,
  AI_PROVIDER_METERING_ENABLED: flag,
  AI_REPLAY_ENCRYPTION_KEY: z.string().optional(),
}).superRefine((value, ctx) => {
  const required = value.BILLING_ENABLED
    ? ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PORTAL_CONFIGURATION_ID", "STRIPE_PRICE_STARTER_MONTHLY", "STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_BUSINESS_MONTHLY"] as const
    : []
  for (const key of required)
    if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: "Required when billing is enabled." })
  if (value.BILLING_ENABLED) {
    const ids = [value.STRIPE_PRICE_STARTER_MONTHLY, value.STRIPE_PRICE_PRO_MONTHLY, value.STRIPE_PRICE_BUSINESS_MONTHLY]
    if (new Set(ids).size !== 3) ctx.addIssue({ code: "custom", path: ["STRIPE_PRICE_STARTER_MONTHLY"], message: "Each plan requires a distinct Stripe price." })
  }
  if (value.AI_CREDIT_PURCHASES_ENABLED)
    for (const key of ["STRIPE_PRICE_AI_1000", "STRIPE_PRICE_AI_5000", "STRIPE_PRICE_AI_10000"] as const)
      if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: "Required for credit purchases." })
  if (value.AI_CREDIT_PURCHASES_ENABLED) {
    const ids = [value.STRIPE_PRICE_STARTER_MONTHLY, value.STRIPE_PRICE_PRO_MONTHLY, value.STRIPE_PRICE_BUSINESS_MONTHLY, value.STRIPE_PRICE_AI_1000, value.STRIPE_PRICE_AI_5000, value.STRIPE_PRICE_AI_10000]
    if (new Set(ids).size !== 6) ctx.addIssue({ code: "custom", path: ["STRIPE_PRICE_AI_1000"], message: "Pack prices must be distinct from each other and subscription prices." })
  }
  if (value.AI_CREDIT_ENFORCEMENT_ENABLED && !value.BILLING_ENABLED)
    ctx.addIssue({ code: "custom", path: ["AI_CREDIT_ENFORCEMENT_ENABLED"], message: "Credit enforcement requires billing." })
  if (value.AI_CREDIT_ENFORCEMENT_ENABLED) {
    if (!value.AI_CREDIT_MODEL_GATE_PASSED || !value.AI_PROVIDER_METERING_ENABLED)
      ctx.addIssue({ code: "custom", path: ["AI_CREDIT_ENFORCEMENT_ENABLED"], message: "Enforcement requires approved model economics and provider metering." })
    const key = value.AI_REPLAY_ENCRYPTION_KEY
    if (!key || !/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, "base64").length !== 32)
      ctx.addIssue({ code: "custom", path: ["AI_REPLAY_ENCRYPTION_KEY"], message: "Enforcement requires a separate base64 32-byte replay key." })
  }
  if (value.AI_CREDIT_PURCHASES_ENABLED && (!value.BILLING_ENABLED || !value.AI_CREDIT_ENFORCEMENT_ENABLED || !value.AI_CREDIT_MODEL_GATE_PASSED))
    ctx.addIssue({ code: "custom", path: ["AI_CREDIT_PURCHASES_ENABLED"], message: "Purchases require billing, credit enforcement, and the model quality/cost gate." })
})

// Validate server configuration; return rollout flags only, never credentials.
export function getBillingConfiguration(env: Record<string, string | undefined> = process.env) {
  const value = schema.parse(env)
  return {
    enabled: value.BILLING_ENABLED,
    creditEnforcementEnabled: value.AI_CREDIT_ENFORCEMENT_ENABLED,
    creditPurchasesEnabled: value.AI_CREDIT_PURCHASES_ENABLED,
    modelGatePassed: value.AI_CREDIT_MODEL_GATE_PASSED,
  }
}
