import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import express from "express"
import cookieParser from "cookie-parser"
import type { AddressInfo } from "node:net"
import Stripe from "stripe"
import { createBillingRouter, createStripeWebhookRouter } from "../routes/billing.routes.js"
import { billingTestEnv as env, FakeBillingGateway } from "./stripe-billing.test-fixtures.js"
import type { BillingDatabase } from "./subscription-billing.js"

test("raw signed Stripe webhooks reject tampering and wrong mode before any provider lookup", async t => {
  const app = express(), gateway = new FakeBillingGateway(); let lookups = 0
  const db = { stripeBillingEvent: { findUnique: async () => null } } as unknown as BillingDatabase
  gateway.invoice = async () => { lookups++; return { id: "in_fixture", customerId: "cus_fixture", subscriptionId: null, status: "paid", currency: "usd", amountPaid: 4900, amountDue: 4900, total: 4900, created: Math.floor(Date.now() / 1000), billingReason: "subscription_create", url: null, hasMore: false, lines: [] } }
  app.use("/api/billing", createStripeWebhookRouter({ db, gateway, env }))
  app.use(express.json())
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); s.once("error", reject) })
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() }))
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/billing/webhook`, stripe = new Stripe(env.STRIPE_SECRET_KEY)
  const body = JSON.stringify({ id: `evt_${randomUUID()}`, object: "event", type: "invoice.paid", livemode: false, created: Math.floor(Date.now() / 1000), data: { object: { id: "in_fixture", object: "invoice" } } })
  const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: env.STRIPE_WEBHOOK_SECRET })
  const post = (payload = body, sig = signature) => fetch(root, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": sig }, body: payload })
  assert.equal((await post(`${body} `)).status, 400); assert.equal((await post(body, "invalid")).status, 400)
  const live = body.replace('"livemode":false', '"livemode":true')
  assert.equal((await post(live, stripe.webhooks.generateTestHeaderString({ payload: live, secret: env.STRIPE_WEBHOOK_SECRET }))).status, 400)
  assert.equal(lookups, 0)
  assert.equal((await post()).status, 200); assert.equal(lookups, 1)
})
test("billing controls require active admins, trusted origin and server-selected fields; disabled rollout makes no calls", async t => {
  const { prisma } = await import("./prisma.js")
  const originalSession = prisma.session.findUnique, originalMembership = prisma.membership.findUnique
  const actorId = randomUUID(), tenantId = randomUUID(); let admin = true
  prisma.session.findUnique = (async () => ({ expiresAt: new Date(Date.now() + 60000), user: { id: actorId, email: "fixture@example.test", name: "Fixture", platformRole: "NONE" } })) as unknown as typeof originalSession
  prisma.membership.findUnique = (async () => ({ status: "ACTIVE", role: admin ? "TENANT_ADMIN" : "TENANT_USER" })) as unknown as typeof originalMembership
  t.after(() => { prisma.session.findUnique = originalSession; prisma.membership.findUnique = originalMembership })
  const app = express(); app.use(cookieParser(), express.json()); app.use("/api/billing", createBillingRouter({ env: {} }))
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); s.once("error", reject) })
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() }))
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/billing/${tenantId}/checkout`
  const headers = { cookie: "sid=test", origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", "content-type": "application/json" }
  const body = { planKey: "STARTER", requestId: randomUUID() }
  const post = (data: object = body, h = headers) => fetch(root, { method: "POST", headers: h, body: JSON.stringify(data) })
  assert.equal((await post(body, { ...headers, cookie: "" })).status, 401)
  admin = false; assert.equal((await post()).status, 403); admin = true
  assert.equal((await post(body, { ...headers, origin: "https://untrusted.example" })).status, 403)
  assert.equal((await post({ ...body, priceId: "client_price" })).status, 400)
  assert.equal((await post({ ...body, kind: "credits" })).status, 400)
  assert.equal((await post()).status, 503)
  const creditPath = root.replace(/\/checkout$/, "/credits/checkout")
  const creditPost = (data: object) => fetch(creditPath, { method: "POST", headers, body: JSON.stringify(data) })
  assert.equal((await creditPost({ packKey: "AI_1000", requestId: randomUUID(), credits: 99999 })).status, 400)
  admin = false; assert.equal((await creditPost({ packKey: "AI_1000", requestId: randomUUID() })).status, 403); admin = true
  assert.equal((await creditPost({ packKey: "AI_1000", requestId: randomUUID() })).status, 503)
  const overview = await fetch(root.replace(/\/checkout$/, "/credits"), { headers })
  assert.equal(overview.status, 200); assert.equal((await overview.json()).purchasesEnabled, false)
})

test("credit overview returns real balances, plan/access metadata and no fabricated balances when enforcement is off", async t => {
  const { prisma } = await import("./prisma.js"), { creditTestEnv } = await import("./ai-credit-execution.test-fixtures.js")
  const originals = { session: prisma.session.findUnique, membership: prisma.membership.findUnique }, tenantId = randomUUID(), actorId = randomUUID()
  prisma.session.findUnique = (async () => ({ expiresAt: new Date(Date.now() + 60000), user: { id: actorId, name: "Fixture", email: "fixture@example.test", platformRole: "NONE" } })) as unknown as typeof originals.session
  let admin = true, transactions = 0
  prisma.membership.findUnique = (async () => ({ status: "ACTIVE", role: admin ? "TENANT_ADMIN" : "TENANT_USER" })) as unknown as typeof originals.membership
  t.after(() => { prisma.session.findUnique = originals.session; prisma.membership.findUnique = originals.membership })
  const sub = { planKey: "PRO", status: "PAST_DUE", paidThrough: new Date(Date.now() - 60000), graceEndsAt: null, cancelAtPeriodEnd: false }
  const db = {
    tenantSubscription: { findUnique: async () => sub }, tenant: { findUnique: async () => ({ timezone: "America/Chicago" }) }, aiCreditPurchase: { findFirst: async () => null },
    $transaction: async (action: (tx: unknown) => unknown) => { transactions++; return action({ aiCreditWallet: { findUnique: async () => ({ revision: 5, purchasedBalance: 600, purchasedReserved: 20, purchaseReviewRequired: false }) }, aiCreditPeriod: { findFirst: async () => ({ startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000), granted: 2400, used: 500, reserved: 100 }) } }) },
  } as unknown as BillingDatabase
  const app = express(); app.use(cookieParser(), express.json())
  app.use("/api/billing", createBillingRouter({ db, env: creditTestEnv }))
  app.use("/off", createBillingRouter({ db, env: { ...creditTestEnv, AI_CREDIT_ENFORCEMENT_ENABLED: "false" } }))
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); s.once("error", reject) })
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() }))
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, headers = { cookie: "sid=test" }
  const res = await fetch(`${root}/api/billing/${tenantId}/credits`, { headers }), data = await res.json()
  assert.equal(res.status, 200); assert.equal(res.headers.get("cache-control"), "no-store")
  assert.equal(data.plan.name, "Pro"); assert.equal(data.plan.monthlyAllowance, 2400); assert.equal(data.access.state, "GRACE")
  assert.equal(data.timeZone, "America/Chicago"); assert.ok(Number.isFinite(Date.parse(data.asOf)))
  assert.equal(data.usage.monthly.remaining, 1800); assert.equal(data.usage.purchased.available, 580); assert.equal(data.usage.available, 2380)
  assert.equal(data.eligible, false); assert.equal(transactions, 1)
  const off = await (await fetch(`${root}/off/${tenantId}/credits`, { headers })).json()
  assert.equal(off.usage, null); assert.equal(transactions, 1)
  admin = false; assert.equal((await fetch(`${root}/api/billing/${tenantId}/credits`, { headers })).status, 403)
})
