import assert from "node:assert/strict"
import { test } from "node:test"
import { StripeBillingGateway } from "./stripe-billing-gateway.js"

test("Stripe Checkout sends only server-selected monthly pricing, no trials, stable request parameters and card filtering", async () => {
  const gateway = new StripeBillingGateway("sk_test_fixture"), bodies: unknown[] = [], options: unknown[] = []
  gateway.client.checkout.sessions.list = (async () => ({ data: [], has_more: false })) as unknown as typeof gateway.client.checkout.sessions.list
  gateway.client.subscriptions.list = (async () => ({ data: [], has_more: false })) as unknown as typeof gateway.client.subscriptions.list
  gateway.client.checkout.sessions.create = (async (body: unknown, opts: unknown) => { bodies.push(body); options.push(opts); return { id: "cs_fixture", url: "https://checkout.stripe.com/c/test", expires_at: 2000000000, customer: "cus_fixture", subscription: null, status: "open" } }) as unknown as typeof gateway.client.checkout.sessions.create
  const created = new Date()
  await gateway.checkout("cus_fixture", "price_STARTER", "tenant", "command", "http://localhost:3000/return", created)
  await gateway.checkout("cus_fixture", "price_STARTER", "tenant", "command", "http://localhost:3000/return", created)
  assert.deepEqual(bodies[0], bodies[1]); assert.deepEqual(options[0], options[1])
  const body = bodies[0] as { subscription_data: object; allowed_payment_method_types: string[]; line_items: unknown[] }
  assert.deepEqual(body.allowed_payment_method_types, ["card"])
  assert.deepEqual(body.line_items, [{ price: "price_STARTER", quantity: 1 }])
  assert.doesNotMatch(JSON.stringify(body.subscription_data), /trial/)
})
test("customer creation is stable per tenant across different request IDs; portal cannot bypass plan-change policy", async () => {
  const gateway = new StripeBillingGateway("sk_test_fixture"), keys: unknown[] = []
  gateway.client.customers.create = (async (_body: unknown, opts: unknown) => { keys.push(opts); return { id: "cus_fixture" } }) as unknown as typeof gateway.client.customers.create
  await gateway.customer("tenant", "one"); await gateway.customer("tenant", "two")
  assert.deepEqual(keys[0], keys[1])
  const config = { active: true, features: { subscription_update: { enabled: true }, subscription_cancel: { enabled: true, mode: "at_period_end" }, payment_method_update: { enabled: true }, invoice_history: { enabled: true } } }
  gateway.client.billingPortal.configurations.retrieve = (async () => config) as unknown as typeof gateway.client.billingPortal.configurations.retrieve
  gateway.client.billingPortal.sessions.create = (async () => ({ url: "https://billing.stripe.com/p/test" })) as unknown as typeof gateway.client.billingPortal.sessions.create
  await assert.rejects(gateway.portal("cus_fixture", "config", "http://localhost:3000/return", "cmd"), /BILLING_PORTAL_CONFIGURATION_INVALID/)
  config.features.subscription_update.enabled = false; config.features.subscription_cancel.mode = "immediately"
  await assert.rejects(gateway.portal("cus_fixture", "config", "http://localhost:3000/return", "cmd"), /BILLING_PORTAL_CONFIGURATION_INVALID/)
  config.features.subscription_cancel.mode = "at_period_end"
  assert.match(await gateway.portal("cus_fixture", "config", "http://localhost:3000/return", "cmd"), /^https:\/\/billing.stripe.com/)
})
