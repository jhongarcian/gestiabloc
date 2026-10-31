import assert from "node:assert/strict"
import { test } from "node:test"
import { CreditCheckoutSchema, startCreditCheckout, verifyCreditPrice } from "./ai-credit-purchases.js"
import { FakeCreditGateway, purchaseEnv } from "./credit-purchase.test-fixtures.js"
import { getBillingConfiguration } from "./billing-config.js"
import { StripeCreditGateway } from "./stripe-credit-gateway.js"
test("pack purchases require all gates and only accept server-known, exact one-time USD pricing", async () => {
  const gateway = new FakeCreditGateway()
  assert.equal(await verifyCreditPrice(gateway, "AI_1000", purchaseEnv), "price_AI_1000")
  gateway.wrongPrice = true; await assert.rejects(verifyCreditPrice(gateway, "AI_1000", purchaseEnv), /BILLING_PRICE_MISMATCH/)
  gateway.wrongPrice = false; gateway.recurring = true; await assert.rejects(verifyCreditPrice(gateway, "AI_1000", purchaseEnv), /BILLING_PRICE_MISMATCH/)
  assert.equal(CreditCheckoutSchema.safeParse({ packKey: "AI_1000", requestId: "invalid", credits: 999999 }).success, false)
  await assert.rejects(startCreditCheckout({} as never, gateway, "", "", {} as never, {}), /CREDIT_PURCHASES_UNAVAILABLE/)
  assert.throws(() => getBillingConfiguration({ ...purchaseEnv, STRIPE_PRICE_AI_1000: purchaseEnv.STRIPE_PRICE_STARTER_MONTHLY }))
})
test("SDK sends a single non-recurring pack, stable expiry/idempotency, provenance on both objects and no discounts", async () => {
  const gateway = new StripeCreditGateway("sk_test_fixture"), bodies: unknown[] = [], opts: unknown[] = []
  gateway.client.checkout.sessions.list = (async () => ({ data: [], has_more: false })) as unknown as typeof gateway.client.checkout.sessions.list
  gateway.client.checkout.sessions.create = (async (body: unknown, option: unknown) => { bodies.push(body); opts.push(option); return { id: "cs_test", mode: "payment", customer: "cus_test", payment_intent: null, status: "open", payment_status: "unpaid", metadata: {}, expires_at: 2000000000, url: "https://checkout.stripe.com/test" } }) as unknown as typeof gateway.client.checkout.sessions.create
  const created = new Date()
  for (let i = 0; i < 2; i++) await gateway.creditCheckout("cus_test", "price_AI_1000", "tenant", "command", "AI_1000", "http://localhost:3000/return", created)
  assert.deepEqual(bodies[0], bodies[1]); assert.deepEqual(opts[0], opts[1])
  const body = bodies[0] as { mode: string; line_items: unknown; metadata: unknown; payment_intent_data: { metadata: unknown }; allow_promotion_codes: boolean }
  assert.equal(body.mode, "payment"); assert.equal(body.allow_promotion_codes, false)
  assert.deepEqual(body.line_items, [{ price: "price_AI_1000", quantity: 1 }]); assert.deepEqual(body.metadata, body.payment_intent_data.metadata)
  assert.doesNotMatch(JSON.stringify(body), /subscription_data|trial_period/)
})
