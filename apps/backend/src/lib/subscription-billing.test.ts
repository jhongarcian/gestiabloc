import assert from "node:assert/strict"
import { test } from "node:test"
import { BillingCommandSchema, subscriptionAccess, BILLING_GRACE_MS, verifyPlanPrice, runSubscriptionCommand } from "./subscription-billing.js"
import { unpaidSubscription } from "./subscription-signup.js"
import { getBillingConfiguration } from "./billing-config.js"
import type { BillingGateway } from "./stripe-billing-gateway.js"

import { billingTestEnv } from "./stripe-billing.test-fixtures.js"
test("every new plan is unpaid without trials, payment dates or initial credits", () => {
  for (const plan of ["STARTER", "PRO", "BUSINESS"] as const) {
    assert.equal(unpaidSubscription(plan).status, "NONE")
    assert.equal(unpaidSubscription(plan).currentPeriodEnd, null)
    assert.equal(unpaidSubscription(plan).paidThrough, null)
  }
})
test("CRM grace is bounded by paid-through rather than webhook delivery; AI pauses immediately", () => {
  const paidThrough = new Date("2026-10-29T12:00:00Z"), now = new Date(paidThrough.getTime() - 1)
  assert.equal(subscriptionAccess({ status: "ACTIVE", paidThrough, graceEndsAt: null }, now).aiAllowed, true)
  assert.equal(subscriptionAccess({ status: "PAST_DUE", paidThrough, graceEndsAt: null }, now).aiAllowed, false)
  assert.equal(subscriptionAccess({ status: "PAST_DUE", paidThrough, graceEndsAt: new Date("2099-01-01") }, new Date(paidThrough.getTime() + BILLING_GRACE_MS)).crmAllowed, false)
  assert.equal(subscriptionAccess({ status: "ACTIVE", paidThrough, graceEndsAt: null }, paidThrough).state, "GRACE")
  for (const status of ["NONE", "TRIALING", "CANCELED"] as const) assert.equal(subscriptionAccess({ status, paidThrough, graceEndsAt: new Date("2099-01-01") }, now).crmAllowed, false)
})
test("only configured exact monthly USD prices and strict server-owned command inputs are accepted", async () => {
  const good = { id: "price_STARTER", active: true, currency: "usd", amount: 4900, interval: "month", intervalCount: 1, usageType: "licensed", scheme: "per_unit" }
  const gateway = (price = good) => ({ price: async () => price }) as unknown as BillingGateway
  assert.equal(await verifyPlanPrice(gateway(), "STARTER", billingTestEnv), "price_STARTER")
  for (const changed of [{ amount: 1 }, { currency: "eur" }, { interval: "year" }, { intervalCount: 2 }, { usageType: "metered" }, { active: false }]) await assert.rejects(verifyPlanPrice(gateway({ ...good, ...changed }), "STARTER", billingTestEnv), /BILLING_PRICE_MISMATCH/)
  assert.throws(() => getBillingConfiguration({ ...billingTestEnv, STRIPE_PRICE_PRO_MONTHLY: "price_STARTER" }))
  assert.equal(BillingCommandSchema.safeParse({ kind: "checkout", planKey: "STARTER", requestId: "invalid", priceId: "client_price" }).success, false)
  await assert.rejects(runSubscriptionCommand({} as never, {} as never, "", "", {} as never, {}), /BILLING_UNAVAILABLE/)
})
test("signup rejects obsolete paidNow and trial overrides before touching storage", async () => {
  const { TenantSignupSchema } = await import("../routes/auth.routes.js")
  const input = { tenantName: "Fixture", planKey: "STARTER", adminName: "Fixture", adminEmail: "fixture@example.test", adminPassword: "Synthetic!123" }
  assert.equal(TenantSignupSchema.safeParse(input).success, true)
  for (const extra of [{ paidNow: true }, { paidNow: false }, { status: "ACTIVE" }, { trialDays: 7 }]) assert.equal(TenantSignupSchema.safeParse({ ...input, ...extra }).success, false)
})
