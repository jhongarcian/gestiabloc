import assert from "node:assert/strict"
import { test } from "node:test"
import { resolve } from "node:path"
import { subscriptionPlans, aiCreditPacks } from "./subscription-plans.js"
import { getBillingConfiguration } from "./billing-config.js"

test("catalog uses agreed USD cents, credit allowances, and no trials for every plan", () => {
  assert.deepEqual(Object.values(subscriptionPlans).map(p => [p.name, p.monthlyPriceCents, p.aiCreditsPerMonth, p.seatLimit, p.trialEnabled]), [
    ["Starter", 4900, 1200, 3, false], ["Pro", 9900, 2400, 10, false], ["Business", 19900, 4800, 25, false],
  ])
  for (const p of Object.values(subscriptionPlans)) {
    assert.equal(p.currency, "usd")
    assert.equal(Number.isInteger(p.monthlyPriceCents), true)
  }
  assert.deepEqual(Object.values(aiCreditPacks).map(p => [p.credits, p.priceCents]), [[1000, 500], [5000, 2400], [10000, 4500]])
})

test("frontend catalog matches backend prices, seats, storage, credits, and trial policy", () => {
  // Load through tsx at runtime so frontend files are not added to backend rootDir.
  const ui = require(resolve(__dirname, "../../../react-ui/lib/subscription-plans.ts"))
  assert.equal(ui.subscriptionPlans.length, Object.keys(subscriptionPlans).length)
  for (const plan of ui.subscriptionPlans) {
    const backend = subscriptionPlans[plan.key as keyof typeof subscriptionPlans]
    assert.ok(backend)
    for (const key of ["name", "monthlyPriceCents", "currency", "seatLimit", "storageBytes", "aiCreditsPerMonth", "trialEnabled"] as const)
      assert.equal(plan[key], backend[key], `${plan.key}.${key}`)
    assert.equal(plan.monthlyPrice, `$${backend.monthlyPriceCents / 100}`)
    assert.equal(plan.aiUsage, `Up to ${backend.aiCreditsPerMonth.toLocaleString("en-US")} AI credits per month`)
  }
  assert.deepEqual(ui.aiCreditPacks, aiCreditPacks)
})

test("billing switches default off and reject malformed or unsafe combinations", () => {
  assert.deepEqual(getBillingConfiguration({}), { enabled: false, creditEnforcementEnabled: false, creditPurchasesEnabled: false, modelGatePassed: false })
  for (const env of [
    { BILLING_ENABLED: "yes" }, { BILLING_ENABLED: "false", AI_CREDIT_ENFORCEMENT_ENABLED: "true" },
    { AI_CREDIT_PURCHASES_ENABLED: "true" }, { BILLING_ENABLED: "true" },
  ]) assert.throws(() => getBillingConfiguration(env))
})

test("enabling purchases requires Stripe setup, enforcement, and a passed model gate", () => {
  const env = {
    BILLING_ENABLED: "true", AI_CREDIT_ENFORCEMENT_ENABLED: "true", AI_CREDIT_PURCHASES_ENABLED: "true", AI_CREDIT_MODEL_GATE_PASSED: "true",
    AI_PROVIDER_METERING_ENABLED: "true", AI_REPLAY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_PORTAL_CONFIGURATION_ID: "bpc_fixture",
    STRIPE_PRICE_STARTER_MONTHLY: "price_starter", STRIPE_PRICE_PRO_MONTHLY: "price_pro", STRIPE_PRICE_BUSINESS_MONTHLY: "price_business",
    STRIPE_PRICE_AI_1000: "price_1000", STRIPE_PRICE_AI_5000: "price_5000", STRIPE_PRICE_AI_10000: "price_10000",
  }
  const config = getBillingConfiguration(env)
  assert.equal(config.creditPurchasesEnabled, true)
  assert.equal("STRIPE_SECRET_KEY" in config, false)
  assert.throws(() => getBillingConfiguration({ ...env, AI_CREDIT_MODEL_GATE_PASSED: "false" }))
  assert.throws(() => getBillingConfiguration({ ...env, STRIPE_PRICE_AI_5000: undefined }))
  for (const name of Object.keys(env).filter(name => name.startsWith("STRIPE_"))) {
    for (const value of ["", " \t "]) assert.throws(() => getBillingConfiguration({ ...env, [name]: value }))
  }
})

test("empty Stripe placeholders allow local development while rollout is disabled", () => {
  const settings = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PORTAL_CONFIGURATION_ID", "STRIPE_PRICE_STARTER_MONTHLY", "STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_BUSINESS_MONTHLY", "STRIPE_PRICE_AI_1000", "STRIPE_PRICE_AI_5000", "STRIPE_PRICE_AI_10000"]
  for (const value of ["", " \t "]) {
    const env = Object.fromEntries(settings.map(name => [name, value]))
    assert.deepEqual(getBillingConfiguration(env), { enabled: false, creditEnforcementEnabled: false, creditPurchasesEnabled: false, modelGatePassed: false })
    assert.throws(() => getBillingConfiguration({ ...env, BILLING_ENABLED: "true" }))
  }
})
