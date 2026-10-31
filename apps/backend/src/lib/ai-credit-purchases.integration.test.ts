import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"
import { Pool } from "pg"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../generated/prisma/index.js"
import { startCreditCheckout, reconcileCreditPurchase, processCreditEvent, cancelCreditCheckout } from "./ai-credit-purchases.js"
import { readAiCreditUsage, reserveAiCredit } from "./ai-credit-wallet.js"
import { FakeCreditGateway, purchaseEnv as env } from "./credit-purchase.test-fixtures.js"
const connectionString = process.env.AI_CREDIT_TEST_DATABASE_URL
test("credit purchases fulfill verified payments once and isolate refunds/disputes safely", { skip: !connectionString }, async t => {
  const schema = `purchase_test_${randomUUID().replaceAll("-", "")}`, admin = new Pool({ connectionString })
  await admin.query(`CREATE SCHEMA "${schema}"`)
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 15 })
  const db = new PrismaClient({ adapter: new PrismaPg(pool, { schema, disposeExternalPool: false }) })
  t.after(async () => { await db.$disconnect(); await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end() })
  await pool.query(`CREATE TYPE "PlanKey" AS ENUM ('STARTER','PRO','BUSINESS'); CREATE TYPE "SubscriptionStatus" AS ENUM ('NONE','TRIALING','ACTIVE','PAST_DUE','CANCELED'); CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE','DISABLED');
    CREATE TABLE "Tenant" (id TEXT PRIMARY KEY, slug TEXT NOT NULL);
    CREATE TABLE "Membership" (id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, status "MembershipStatus" NOT NULL DEFAULT 'ACTIVE');
    CREATE TABLE "TenantSubscription" (id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL UNIQUE REFERENCES "Tenant"(id), "planKey" "PlanKey" NOT NULL DEFAULT 'STARTER', "seatLimit" INTEGER NOT NULL DEFAULT 3, status "SubscriptionStatus" NOT NULL DEFAULT 'NONE',
    "stripeCustomerId" TEXT, "stripeSubscriptionId" TEXT, "stripePriceId" TEXT, "currentPeriodStart" TIMESTAMP(3), "currentPeriodEnd" TIMESTAMP(3), "paidThrough" TIMESTAMP(3), "graceEndsAt" TIMESTAMP(3), "scheduledPlanKey" "PlanKey", "scheduledChangeAt" TIMESTAMP(3), "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false, "billingRevision" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);`)
  for (const migration of ["20261029120000_ai_credit_wallet", "20261029130000_ai_credit_replay", "20261029140000_stripe_subscriptions", "20261029150000_credit_purchase_review", "20261029151000_credit_purchases"])
    await pool.query(await readFile(resolve(__dirname, `../../prisma/migrations/${migration}/migration.sql`), "utf8"))
  async function fixture() {
    const tenantId = randomUUID(), actorId = randomUUID(), customerId = `cus_${randomUUID()}`, gateway = new FakeCreditGateway()
    await pool.query('INSERT INTO "Tenant"(id,slug) VALUES ($1,$1)', [tenantId])
    await pool.query('INSERT INTO "TenantSubscription"(id,"tenantId",status,"paidThrough","stripeCustomerId","stripeSubscriptionId") VALUES ($1,$1,\'ACTIVE\',$2,$3,$4)', [tenantId, new Date(Date.now() + 86400000), customerId, `sub_${tenantId}`])
    return { tenantId, actorId, gateway, customerId, input: { packKey: "AI_1000" as const, requestId: randomUUID() } }
  }
  const event = (type: string, objectId: string) => ({ id: `evt_${randomUUID()}`, type, objectId, created: Math.floor(Date.now() / 1000) })
  await t.test("checkout retries preserve the session and cannot alter its pack or start another purchase", async () => {
    const f = await fixture()
    const result = await startCreditCheckout(db, f.gateway, f.tenantId, f.actorId, f.input, env)
    assert.deepEqual(await startCreditCheckout(db, f.gateway, f.tenantId, f.actorId, f.input, env), result)
    assert.equal(f.gateway.creates, 1); assert.equal((await readAiCreditUsage(db, f.tenantId)).purchased.balance, 0)
    await assert.rejects(startCreditCheckout(db, f.gateway, f.tenantId, f.actorId, { ...f.input, packKey: "AI_5000" }, env), /BILLING_REQUEST_CONFLICT/)
    await assert.rejects(startCreditCheckout(db, f.gateway, f.tenantId, f.actorId, { ...f.input, requestId: randomUUID() }, env), /BILLING_CHECKOUT_PENDING/)
  })
  await t.test("redirects and unpaid events do not grant; completed/PI/replayed events share one grant", async () => {
    const f = await fixture(), checkout = await startCreditCheckout(db, f.gateway, f.tenantId, f.actorId, f.input, env) as { checkoutId: string }
    const before = event("checkout.session.completed", checkout.checkoutId)
    await processCreditEvent(db, f.gateway, before)
    assert.equal((await readAiCreditUsage(db, f.tenantId)).purchased.balance, 0)
    const payment = f.gateway.complete(checkout.checkoutId), paid = event("payment_intent.succeeded", payment.id)
    await processCreditEvent(db, f.gateway, paid)
    assert.deepEqual(await processCreditEvent(db, f.gateway, paid), { duplicate: true })
    await processCreditEvent(db, f.gateway, event("checkout.session.completed", checkout.checkoutId))
    assert.equal((await readAiCreditUsage(db, f.tenantId)).purchased.balance, 1000)
    assert.equal(await db.aiCreditLedger.count({ where: { tenantId: f.tenantId, kind: "PURCHASE_GRANT" } }), 1)
  })
  await t.test("wrong customer, amount, line item and unrelated payment cannot grant or trigger review", async () => {
    const f = await fixture(), checkout = await startCreditCheckout(db, f.gateway, f.tenantId, f.actorId, f.input, env) as { checkoutId: string }
    const payment = f.gateway.complete(checkout.checkoutId), s = f.gateway.sessions.get(checkout.checkoutId)!
    const original = payment.customerId; payment.customerId = "cus_foreign"
    await assert.rejects(processCreditEvent(db, f.gateway, event("payment_intent.succeeded", payment.id)), /BILLING_CUSTOMER_MISMATCH/); payment.customerId = original
    s.total = 1; await assert.rejects(processCreditEvent(db, f.gateway, event("payment_intent.succeeded", payment.id)), /BILLING_PRICE_MISMATCH/); s.total = 500
    s.lines[0]!.quantity = 2; await assert.rejects(processCreditEvent(db, f.gateway, event("payment_intent.succeeded", payment.id)), /BILLING_PRICE_MISMATCH/); s.lines[0]!.quantity = 1
    f.gateway.payments.set("pi_foreign", { ...structuredClone(payment), id: "pi_foreign" })
    f.gateway.events.set("ch_foreign", "pi_foreign")
    await assert.rejects(processCreditEvent(db, f.gateway, event("charge.refunded", "ch_foreign")), /BILLING_CUSTOMER_MISMATCH/)
    assert.equal((await readAiCreditUsage(db, f.tenantId)).purchaseReviewRequired, false)
    assert.equal((await readAiCreditUsage(db, f.tenantId)).purchased.balance, 0)
  })
  await t.test("a missed webhook or lost Checkout result is repaired and lapsed subscriptions keep paid credits", async () => {
    const f = await fixture(), checkout = await startCreditCheckout(db, f.gateway, f.tenantId, f.actorId, f.input, env) as { checkoutId: string }
    const row = await db.aiCreditPurchase.findFirstOrThrow({ where: { tenantId: f.tenantId } })
    await db.aiCreditPurchase.update({ where: { id: row.id }, data: { sessionId: null } })
    await pool.query('UPDATE "BillingCommand" SET status = \'PENDING\', result = NULL, "completedAt" = NULL WHERE id = $1', [row.id])
    await reconcileCreditPurchase(db, f.gateway, row.id)
    assert.equal((await db.billingCommand.findUniqueOrThrow({ where: { id: row.id } })).status, "SUCCEEDED")
    f.gateway.complete(checkout.checkoutId)
    await db.tenantSubscription.update({ where: { tenantId: f.tenantId }, data: { status: "PAST_DUE" } })
    await reconcileCreditPurchase(db, f.gateway, row.id)
    assert.equal((await readAiCreditUsage(db, f.tenantId)).purchased.balance, 1000)
    await assert.rejects(reserveAiCredit(db, { tenantId: f.tenantId, actorId: f.actorId, channel: "TEST", requestId: randomUUID(), requestHash: "a".repeat(64) }), /BILLING_REQUIRED/)
  })
  await t.test("refunds and disputes pause new spending without negative balances or silent re-grants", async () => {
    for (const type of ["charge.refunded", "charge.dispute.created"]) {
      const f = await fixture(), checkout = await startCreditCheckout(db, f.gateway, f.tenantId, f.actorId, f.input, env) as { checkoutId: string }
      const payment = f.gateway.complete(checkout.checkoutId)
      await processCreditEvent(db, f.gateway, event("payment_intent.succeeded", payment.id))
      if (type === "charge.refunded") payment.charge!.refunded = 500; else payment.charge!.disputed = true
      f.gateway.events.set("reversal", payment.id)
      await processCreditEvent(db, f.gateway, event(type, "reversal"))
      const usage = await readAiCreditUsage(db, f.tenantId)
      assert.equal(usage.purchaseReviewRequired, true); assert.equal(usage.purchased.balance, 1000)
      await assert.rejects(reserveAiCredit(db, { tenantId: f.tenantId, actorId: f.actorId, channel: "TEST", requestId: randomUUID(), requestHash: "b".repeat(64) }), /AI_PURCHASE_REVIEW_REQUIRED/)
      await assert.rejects(startCreditCheckout(db, f.gateway, f.tenantId, f.actorId, { ...f.input, requestId: randomUUID() }, env), /AI_PURCHASE_REVIEW_REQUIRED/)
      await processCreditEvent(db, f.gateway, event("payment_intent.succeeded", payment.id))
      assert.equal((await readAiCreditUsage(db, f.tenantId)).purchased.balance, 1000)
    }
  })
  await t.test("a refund before fulfillment never grants credits; unpaid cancel is scoped and repeatable", async () => {
    const f = await fixture(), checkout = await startCreditCheckout(db, f.gateway, f.tenantId, f.actorId, f.input, env) as { checkoutId: string }
    const payment = f.gateway.complete(checkout.checkoutId); payment.charge!.refunded = 500
    await processCreditEvent(db, f.gateway, event("payment_intent.succeeded", payment.id))
    assert.equal((await readAiCreditUsage(db, f.tenantId)).purchased.balance, 0)
    assert.equal((await readAiCreditUsage(db, f.tenantId)).purchaseReviewRequired, true)
    const unpaid = await fixture(), result = await startCreditCheckout(db, unpaid.gateway, unpaid.tenantId, unpaid.actorId, unpaid.input, env) as { checkoutId: string }
    const purchase = await db.aiCreditPurchase.findFirstOrThrow({ where: { tenantId: unpaid.tenantId } })
    await assert.rejects(cancelCreditCheckout(db, unpaid.gateway, f.tenantId, purchase.id), /CREDIT_PURCHASE_NOT_FOUND/)
    assert.deepEqual(await cancelCreditCheckout(db, unpaid.gateway, unpaid.tenantId, purchase.id), { canceled: true })
    assert.deepEqual(await cancelCreditCheckout(db, unpaid.gateway, unpaid.tenantId, purchase.id), { canceled: true })
    await assert.rejects(startCreditCheckout(db, unpaid.gateway, unpaid.tenantId, unpaid.actorId, unpaid.input, env), /BILLING_CHECKOUT_EXPIRED/)
    assert.equal(unpaid.gateway.sessions.get(result.checkoutId)!.status, "expired")
    await startCreditCheckout(db, unpaid.gateway, unpaid.tenantId, unpaid.actorId, { ...unpaid.input, requestId: randomUUID() }, env)
  })
  await t.test("grant, purchase status and receipt roll back together on persistence failure", async () => {
    const f = await fixture(), checkout = await startCreditCheckout(db, f.gateway, f.tenantId, f.actorId, f.input, env) as { checkoutId: string }, payment = f.gateway.complete(checkout.checkoutId)
    const paid = event("payment_intent.succeeded", payment.id)
    await pool.query('CREATE FUNCTION reject_credit_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'synthetic persistence failure\'; END $$')
    await pool.query('CREATE TRIGGER reject_credit_event BEFORE INSERT ON "StripeBillingEvent" FOR EACH ROW EXECUTE FUNCTION reject_credit_event()')
    try { await assert.rejects(processCreditEvent(db, f.gateway, paid)) } finally { await pool.query('DROP TRIGGER reject_credit_event ON "StripeBillingEvent"') }
    assert.equal((await readAiCreditUsage(db, f.tenantId)).purchased.balance, 0)
    await processCreditEvent(db, f.gateway, paid)
    assert.equal((await readAiCreditUsage(db, f.tenantId)).purchased.balance, 1000)
  })
})
