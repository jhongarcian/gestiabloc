import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"
import { Pool } from "pg"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../generated/prisma/index.js"
import { billingTestEnv as env, FakeBillingGateway } from "./stripe-billing.test-fixtures.js"
import { runSubscriptionCommand, processSubscriptionEvent, reconcileSubscription, subscriptionAccess, BILLING_GRACE_MS } from "./subscription-billing.js"
import { readAiCreditUsage, reserveAiCredit, settleAiCredit } from "./ai-credit-wallet.js"

const connectionString = process.env.AI_CREDIT_TEST_DATABASE_URL
test("Stripe subscription state and grants reconcile transactionally in isolated PostgreSQL", { skip: !connectionString }, async t => {
  const schema = `billing_test_${randomUUID().replaceAll("-", "")}`, admin = new Pool({ connectionString })
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
  async function fixture(plan: "STARTER" | "PRO" | "BUSINESS" = "STARTER", activate = true) {
    const tenantId = randomUUID(), actorId = randomUUID(), gateway = new FakeBillingGateway()
    await pool.query('INSERT INTO "Tenant"(id, slug) VALUES ($1,$1)', [tenantId])
    await pool.query('INSERT INTO "TenantSubscription"(id,"tenantId") VALUES ($1,$1)', [tenantId])
    await pool.query('INSERT INTO "Membership"(id,"tenantId") VALUES ($1,$2)', [actorId, tenantId])
    const input = { kind: "checkout" as const, planKey: plan, requestId: randomUUID() }
    const result = await runSubscriptionCommand(db, gateway, tenantId, actorId, input, env) as { checkoutId: string; url: string }
    const command = await db.billingCommand.findFirstOrThrow({ where: { tenantId } })
    const sub = gateway.completeCheckout(result.checkoutId, tenantId, command.id, plan)
    const event = { id: `evt_${randomUUID()}`, type: "invoice.paid", objectId: sub.latestInvoiceId!, created: Math.floor(Date.now() / 1000) }
    if (activate) await processSubscriptionEvent(db, gateway, event, env)
    return { tenantId, actorId, gateway, input, result, command, sub, event }
  }
  await t.test("checkout and event retries do not duplicate subscriptions or credits; redirect is not payment", async () => {
    const f = await fixture("STARTER", false)
    assert.equal((await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: f.tenantId } })).status, "NONE")
    assert.equal((await readAiCreditUsage(db, f.tenantId)).available, 0)
    assert.deepEqual(await runSubscriptionCommand(db, f.gateway, f.tenantId, f.actorId, f.input, env), f.result)
    assert.equal(f.gateway.checkoutCreates, 1)
    await pool.query('UPDATE "BillingCommand" SET status = $2, result = NULL, "completedAt" = NULL WHERE id = $1', [f.command.id, "PENDING"])
    assert.equal((await runSubscriptionCommand(db, f.gateway, f.tenantId, f.actorId, f.input, env) as { checkoutId: string }).checkoutId, f.result.checkoutId)
    assert.equal(f.gateway.checkoutCreates, 1)
    await assert.rejects(runSubscriptionCommand(db, f.gateway, f.tenantId, f.actorId, { ...f.input, planKey: "PRO" }, env), /BILLING_REQUEST_CONFLICT/)
    await processSubscriptionEvent(db, f.gateway, f.event, env)
    assert.deepEqual(await processSubscriptionEvent(db, f.gateway, f.event, env), { duplicate: true })
    await processSubscriptionEvent(db, f.gateway, { ...f.event, id: `evt_${randomUUID()}`, type: "invoice.payment_succeeded" }, env)
    const paid = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: f.tenantId } })
    assert.equal(paid.status, "ACTIVE"); assert.equal(paid.seatLimit, 3)
    assert.equal((await readAiCreditUsage(db, f.tenantId)).monthly.granted, 1200)
    assert.equal(await db.aiCreditLedger.count({ where: { tenantId: f.tenantId, kind: "MONTHLY_GRANT" } }), 1)
  })
  await t.test("an unpaid latest invoice, mismatched customer and foreign command cannot activate a plan", async () => {
    const f = await fixture("STARTER", false), invoice = f.gateway.invoices.get(f.sub.latestInvoiceId!)!
    invoice.status = "open"; invoice.amountPaid = 0
    await processSubscriptionEvent(db, f.gateway, { ...f.event, type: "checkout.session.completed", objectId: f.result.checkoutId }, env)
    assert.equal((await readAiCreditUsage(db, f.tenantId)).available, 0)
    invoice.status = "paid"; invoice.amountPaid = invoice.amountDue; invoice.customerId = "cus_foreign"
    await reconcileSubscription(db, f.gateway, f.tenantId, env)
    assert.equal((await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: f.tenantId } })).status, "NONE")
    invoice.customerId = f.sub.customerId
    const foreign = await fixture("STARTER", false); foreign.sub.metadata.billingCommandId = randomUUID()
    await assert.rejects(processSubscriptionEvent(db, foreign.gateway, foreign.event, env), /BILLING_CUSTOMER_MISMATCH/)
  })
  await t.test("paid upgrades add only the monthly allowance difference, preserve usage and execute once", async () => {
    const f = await fixture()
    const request = { tenantId: f.tenantId, actorId: f.actorId, channel: "TEST" as const, requestId: randomUUID(), requestHash: "a".repeat(64) }
    await reserveAiCredit(db, request); await settleAiCredit(db, request, "COMMIT")
    const input = { kind: "plan" as const, planKey: "PRO" as const, requestId: randomUUID() }
    const changed = await runSubscriptionCommand(db, f.gateway, f.tenantId, f.actorId, input, env)
    assert.deepEqual(await runSubscriptionCommand(db, f.gateway, f.tenantId, f.actorId, input, env), changed)
    assert.equal(f.gateway.upgradeCreates, 1)
    assert.deepEqual((await readAiCreditUsage(db, f.tenantId)).monthly, { granted: 2400, used: 1, reserved: 0, remaining: 2399 })
    assert.equal((await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: f.tenantId } })).planKey, "PRO")
  })
  await t.test("pending upgrade payment retains the paid old plan until the invoice succeeds", async () => {
    const f = await fixture(); f.gateway.pendingPayment = true
    const input = { kind: "plan" as const, planKey: "BUSINESS" as const, requestId: randomUUID() }
    const result = await runSubscriptionCommand(db, f.gateway, f.tenantId, f.actorId, input, env) as { paymentPending: boolean }
    assert.equal(result.paymentPending, true)
    assert.equal((await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: f.tenantId } })).planKey, "STARTER")
    assert.equal((await readAiCreditUsage(db, f.tenantId)).monthly.granted, 1200)
    const invoice = f.gateway.invoices.get(f.sub.latestInvoiceId!)!; invoice.status = "paid"; invoice.amountPaid = invoice.amountDue
    f.sub.items[0]!.priceId = "price_BUSINESS"; f.sub.pendingUpdate = false
    await processSubscriptionEvent(db, f.gateway, { ...f.event, id: `evt_${randomUUID()}`, objectId: invoice.id }, env)
    assert.equal((await readAiCreditUsage(db, f.tenantId)).monthly.granted, 4800)
  })
  await t.test("a lost local command completion never repeats an already paid upgrade", async () => {
    const f = await fixture(), input = { kind: "plan" as const, planKey: "PRO" as const, requestId: randomUUID() }
    await pool.query('CREATE FUNCTION reject_billing_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = \'plan\' AND NEW.status = \'SUCCEEDED\' THEN RAISE EXCEPTION \'synthetic command failure\'; END IF; RETURN NEW; END $$')
    await pool.query('CREATE TRIGGER reject_billing_completion BEFORE UPDATE ON "BillingCommand" FOR EACH ROW EXECUTE FUNCTION reject_billing_completion()')
    try { await assert.rejects(runSubscriptionCommand(db, f.gateway, f.tenantId, f.actorId, input, env)) }
    finally { await pool.query('DROP TRIGGER reject_billing_completion ON "BillingCommand"') }
    await runSubscriptionCommand(db, f.gateway, f.tenantId, f.actorId, input, env)
    assert.equal(f.gateway.upgradeCreates, 1)
    assert.equal((await readAiCreditUsage(db, f.tenantId)).monthly.granted, 2400)
    const newer = await fixture(), olderInput = { kind: "plan" as const, planKey: "PRO" as const, requestId: randomUUID() }
    await pool.query('CREATE TRIGGER reject_billing_completion BEFORE UPDATE ON "BillingCommand" FOR EACH ROW EXECUTE FUNCTION reject_billing_completion()')
    try { await assert.rejects(runSubscriptionCommand(db, newer.gateway, newer.tenantId, newer.actorId, olderInput, env)) }
    finally { await pool.query('DROP TRIGGER reject_billing_completion ON "BillingCommand"') }
    await runSubscriptionCommand(db, newer.gateway, newer.tenantId, newer.actorId, { kind: "plan", planKey: "BUSINESS", requestId: randomUUID() }, env)
    await assert.rejects(runSubscriptionCommand(db, newer.gateway, newer.tenantId, newer.actorId, olderInput, env), /BILLING_RECONCILIATION_REQUIRED/)
    assert.equal(newer.gateway.upgradeCreates, 2)
    assert.equal(newer.sub.scheduleId, null)
  })
  await t.test("payment state, monthly grants and event receipts roll back together on database failure", async () => {
    const f = await fixture("STARTER", false)
    await pool.query('CREATE FUNCTION reject_billing_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'synthetic event failure\'; END $$')
    await pool.query('CREATE TRIGGER reject_billing_event BEFORE INSERT ON "StripeBillingEvent" FOR EACH ROW EXECUTE FUNCTION reject_billing_event()')
    try { await assert.rejects(processSubscriptionEvent(db, f.gateway, f.event, env)) }
    finally { await pool.query('DROP TRIGGER reject_billing_event ON "StripeBillingEvent"') }
    assert.equal((await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: f.tenantId } })).status, "NONE")
    assert.equal((await readAiCreditUsage(db, f.tenantId)).available, 0)
    await processSubscriptionEvent(db, f.gateway, f.event, env)
    assert.equal((await readAiCreditUsage(db, f.tenantId)).monthly.granted, 1200)
  })
  await t.test("downgrades wait for renewal, and an over-capacity team cannot schedule a smaller plan", async () => {
    const f = await fixture("BUSINESS")
    await runSubscriptionCommand(db, f.gateway, f.tenantId, f.actorId, { kind: "plan", planKey: "STARTER", requestId: randomUUID() }, env)
    const scheduled = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: f.tenantId } })
    assert.equal(scheduled.planKey, "BUSINESS"); assert.equal(scheduled.scheduledPlanKey, "STARTER")
    assert.equal((await readAiCreditUsage(db, f.tenantId)).monthly.granted, 4800)
    await runSubscriptionCommand(db, f.gateway, f.tenantId, f.actorId, { kind: "plan", planKey: "BUSINESS", requestId: randomUUID() }, env)
    assert.equal((await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: f.tenantId } })).scheduledPlanKey, null)
    await runSubscriptionCommand(db, f.gateway, f.tenantId, f.actorId, { kind: "plan", planKey: "STARTER", requestId: randomUUID() }, env)
    const oldEnd = f.sub.items[0]!.endsAt; f.sub.items[0]!.startsAt = oldEnd; f.sub.items[0]!.endsAt = oldEnd + 31 * 86400; f.sub.items[0]!.priceId = "price_STARTER"; f.sub.scheduleId = null
    const invoice = f.gateway.invoiceFor(f.sub); invoice.billingReason = "subscription_cycle"; f.gateway.invoices.set(invoice.id, invoice); f.sub.latestInvoiceId = invoice.id
    await reconcileSubscription(db, f.gateway, f.tenantId, env)
    assert.equal((await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: f.tenantId } })).planKey, "STARTER")
    assert.equal((await readAiCreditUsage(db, f.tenantId, new Date(oldEnd * 1000))).monthly.granted, 1200)
    const crowded = await fixture("BUSINESS")
    for (let i = 0; i < 4; i++) await pool.query('INSERT INTO "Membership"(id,"tenantId") VALUES ($1,$2)', [randomUUID(), crowded.tenantId])
    await assert.rejects(runSubscriptionCommand(db, crowded.gateway, crowded.tenantId, crowded.actorId, { kind: "plan", planKey: "STARTER", requestId: randomUUID() }, env), /BILLING_SEAT_LIMIT/)
  })
  await t.test("failed renewals pause AI, grace never extends on retries, recovery and stale events use current Stripe state", async () => {
    const f = await fixture(), expired = new Date(Date.now() - 60000)
    await db.tenantSubscription.update({ where: { tenantId: f.tenantId }, data: { paidThrough: expired } })
    f.sub.status = "past_due"; const invoice = f.gateway.invoices.get(f.sub.latestInvoiceId!)!; invoice.status = "open"; invoice.amountPaid = 0
    const failure = { ...f.event, id: `evt_${randomUUID()}`, type: "invoice.payment_failed" }
    await processSubscriptionEvent(db, f.gateway, failure, env)
    let local = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: f.tenantId } })
    assert.equal(subscriptionAccess(local).crmAllowed, true); assert.equal(subscriptionAccess(local).aiAllowed, false)
    const grace = local.graceEndsAt!.getTime()
    await processSubscriptionEvent(db, f.gateway, { ...failure, id: `evt_${randomUUID()}` }, env)
    local = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: f.tenantId } })
    assert.equal(local.graceEndsAt!.getTime(), grace)
    assert.equal(subscriptionAccess(local, new Date(expired.getTime() + BILLING_GRACE_MS)).crmAllowed, false)
    f.sub.status = "active"; invoice.status = "paid"; invoice.amountPaid = invoice.amountDue
    await processSubscriptionEvent(db, f.gateway, { ...f.event, id: `evt_${randomUUID()}` }, env)
    await processSubscriptionEvent(db, f.gateway, { ...failure, id: `evt_${randomUUID()}` }, env)
    local = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: f.tenantId } })
    assert.equal(local.status, "ACTIVE"); assert.equal(local.graceEndsAt, null)
    assert.equal((await readAiCreditUsage(db, f.tenantId)).monthly.granted, 1200)
  })
  await t.test("cancellation keeps access through the paid period and then blocks new spending", async () => {
    const f = await fixture(); f.sub.cancelAtPeriodEnd = true
    await reconcileSubscription(db, f.gateway, f.tenantId, env)
    let local = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: f.tenantId } })
    assert.equal(local.status, "ACTIVE"); assert.equal(local.cancelAtPeriodEnd, true)
    f.sub.status = "canceled"
    await processSubscriptionEvent(db, f.gateway, { id: `evt_${randomUUID()}`, type: "customer.subscription.deleted", objectId: f.sub.id, created: Math.floor(Date.now() / 1000) }, env)
    local = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: f.tenantId } })
    assert.equal(local.status, "CANCELED"); assert.equal(subscriptionAccess(local).crmAllowed, false)
    await assert.rejects(runSubscriptionCommand(db, f.gateway, f.tenantId, f.actorId, { kind: "checkout", planKey: "STARTER", requestId: randomUUID() }, env), /BILLING_PAID_PERIOD_REMAINS/)
  })
  await t.test("a concurrent command cannot escape the per-tenant lease", async () => {
    const f = await fixture()
    await db.tenantSubscription.update({ where: { tenantId: f.tenantId }, data: { billingLeaseToken: randomUUID(), billingLeaseExpiresAt: new Date(Date.now() + 60000) } })
    await assert.rejects(runSubscriptionCommand(db, f.gateway, f.tenantId, f.actorId, { kind: "portal", requestId: randomUUID() }, env), /BILLING_CHECKOUT_PENDING/)
    await db.tenantSubscription.update({ where: { tenantId: f.tenantId }, data: { billingLeaseToken: null, billingLeaseExpiresAt: null } })
  })
})
