import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import type { Prisma, PrismaClient, TenantSubscription } from "../generated/prisma/index.js"
import { getBillingConfiguration } from "./billing-config.js"
import { subscriptionPlans, type PlanKey } from "./subscription-plans.js"
import { grantMonthlyAiCredits } from "./ai-credit-wallet.js"
import type { BillingGateway, BillingSubscription, BillingInvoice } from "./stripe-billing-gateway.js"

export class BillingError extends Error { constructor(public status: number, public code: string) { super(code) } }
export type BillingDatabase = Pick<PrismaClient, "$transaction" | "tenantSubscription" | "billingCommand" | "stripeBillingEvent" | "tenant" | "membership">
export const BillingCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("checkout"), planKey: z.enum(["STARTER", "PRO", "BUSINESS"]), requestId: z.uuid() }).strict(),
  z.object({ kind: z.literal("plan"), planKey: z.enum(["STARTER", "PRO", "BUSINESS"]), requestId: z.uuid() }).strict(),
  z.object({ kind: z.literal("portal"), requestId: z.uuid() }).strict(),
])
export type BillingCommandInput = z.infer<typeof BillingCommandSchema>
type Lease = { tenantId: string; token: string }
type Environment = Record<string, string | undefined>
export const BILLING_GRACE_MS = 72 * 60 * 60 * 1000
const PlanIntentSchema = z.object({ mode: z.enum(["upgrade", "downgrade", "cancelSchedule", "noop"]), subscriptionId: z.string(), fromPriceId: z.string(), startsAt: z.number(), endsAt: z.number(), scheduleId: z.string().nullable(), scheduleCommandId: z.string().nullable() })
const terminal = (status: string) => ["canceled", "incomplete_expired"].includes(status)
const date = (seconds: number) => new Date(z.number().int().positive().parse(seconds) * 1000)
export function subscriptionAccess(sub: Pick<TenantSubscription, "status" | "paidThrough" | "graceEndsAt"> | null, now = new Date()) {
  const paid = sub?.status === "ACTIVE" && Boolean(sub.paidThrough && sub.paidThrough > now)
  const graceEnd = sub?.paidThrough && ["ACTIVE", "PAST_DUE"].includes(sub.status) ? new Date(sub.paidThrough.getTime() + BILLING_GRACE_MS) : null
  const grace = !paid && Boolean(graceEnd && graceEnd > now)
  return { crmAllowed: paid || grace, aiAllowed: paid, state: paid ? "PAID" : grace ? "GRACE" : "BLOCKED", graceEndsAt: graceEnd?.toISOString() ?? null }
}
function configured(env: Environment) {
  try { if (!getBillingConfiguration(env).enabled) throw new Error() }
  catch { throw new BillingError(503, "BILLING_UNAVAILABLE") }
}
export function planPriceId(plan: PlanKey, env: Environment) {
  const value = env[`STRIPE_PRICE_${plan}_MONTHLY`]
  if (!value) throw new BillingError(503, "BILLING_UNAVAILABLE")
  return value
}
function planForPrice(priceId: string, env: Environment): PlanKey {
  const plans = (Object.keys(subscriptionPlans) as PlanKey[]).filter(p => planPriceId(p, env) === priceId)
  if (plans.length !== 1) throw new BillingError(409, "BILLING_PRICE_MISMATCH")
  return plans[0]!
}
export async function verifyPlanPrice(gateway: BillingGateway, plan: PlanKey, env: Environment) {
  const p = await gateway.price(planPriceId(plan, env)), expected = subscriptionPlans[plan]
  if (!p.active || p.currency !== "usd" || p.amount !== expected.monthlyPriceCents || p.interval !== "month" || p.intervalCount !== 1 || p.usageType !== "licensed" || p.scheme !== "per_unit") throw new BillingError(409, "BILLING_PRICE_MISMATCH")
  return p.id
}
export async function lease<T>(db: BillingDatabase, tenantId: string, action: (value: Lease) => Promise<T>) {
  const token = randomUUID(), now = new Date()
  const claimed = await db.tenantSubscription.updateMany({ where: { tenantId, OR: [{ billingLeaseToken: null }, { billingLeaseExpiresAt: { lte: now } }] }, data: { billingLeaseToken: token, billingLeaseExpiresAt: new Date(now.getTime() + 5 * 60000) } })
  if (claimed.count !== 1) throw new BillingError(409, "BILLING_CHECKOUT_PENDING")
  try { return await action({ tenantId, token }) }
  finally { await db.tenantSubscription.updateMany({ where: { tenantId, billingLeaseToken: token }, data: { billingLeaseToken: null, billingLeaseExpiresAt: null } }) }
}
export async function fence(tx: Prisma.TransactionClient, value: Lease) {
  const result = await tx.tenantSubscription.updateMany({ where: { tenantId: value.tenantId, billingLeaseToken: value.token, billingLeaseExpiresAt: { gt: new Date() } }, data: { billingRevision: { increment: 1 } } })
  if (!result.count) throw new BillingError(409, "BILLING_CHECKOUT_PENDING")
}
async function update(db: BillingDatabase, value: Lease, data: Prisma.TenantSubscriptionUpdateManyMutationInput) {
  await db.$transaction(async tx => { await fence(tx, value); await tx.tenantSubscription.update({ where: { tenantId: value.tenantId }, data }) })
}
function validSubscription(s: BillingSubscription, env: Environment) {
  if (s.hasMore || s.items.length !== 1 || s.items[0]!.quantity !== 1 || s.trial || s.items[0]!.endsAt <= s.items[0]!.startsAt) throw new BillingError(409, "BILLING_SUBSCRIPTION_UNSUPPORTED")
  const item = s.items[0]!
  return { item, plan: planForPrice(item.priceId, env), startsAt: date(item.startsAt), endsAt: date(item.endsAt) }
}
function paidInvoice(invoice: BillingInvoice | null, s: BillingSubscription, env: Environment) {
  if (!invoice || invoice.id !== s.latestInvoiceId || invoice.status !== "paid" || invoice.customerId !== s.customerId || invoice.subscriptionId !== s.id) return false
  if (invoice.currency !== "usd" || invoice.amountPaid < invoice.amountDue || invoice.amountDue < 0 || invoice.total < 0 || invoice.hasMore || !invoice.lines.length || !["subscription_create", "subscription_cycle", "subscription_update"].includes(invoice.billingReason ?? "")) throw new BillingError(409, "BILLING_PRICE_MISMATCH")
  const item = s.items[0]!
  for (const line of invoice.lines) {
    if (!line.priceId || line.quantity !== 1 || line.subscriptionId !== s.id) throw new BillingError(409, "BILLING_PRICE_MISMATCH")
    planForPrice(line.priceId, env)
  }
  return invoice.lines.some(l => l.priceId === item.priceId && l.amount >= 0 && l.endsAt === item.endsAt && (l.proration ? invoice.billingReason === "subscription_update" && l.startsAt >= item.startsAt && l.startsAt < item.endsAt : l.startsAt === item.startsAt))
}
// External reads are completed under a fenced lease, never inside a DB transaction.
async function syncLocked(db: BillingDatabase, gateway: BillingGateway, value: Lease, s: BillingSubscription, env: Environment, event?: { id: string; type: string; created: number }) {
  const local = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: value.tenantId } })
  if (local.stripeCustomerId !== s.customerId || s.metadata.tenantId !== value.tenantId) throw new BillingError(409, "BILLING_CUSTOMER_MISMATCH")
  if (local.stripeSubscriptionId && local.stripeSubscriptionId !== s.id && local.status !== "CANCELED") return { ignored: true }
  if (local.stripeSubscriptionId !== s.id) {
    const command = s.metadata.billingCommandId ? await db.billingCommand.findFirst({ where: { id: s.metadata.billingCommandId, tenantId: value.tenantId, kind: "checkout" } }) : null
    if (!command) throw new BillingError(409, "BILLING_CUSTOMER_MISMATCH")
  }
  const { item, plan, startsAt, endsAt } = validSubscription(s, env)
  await verifyPlanPrice(gateway, plan, env)
  const invoice = s.latestInvoiceId ? await gateway.invoice(s.latestInvoiceId) : null
  const verifiedPaid = s.status === "active" && !s.paused && paidInvoice(invoice, s, env)
  let scheduledPlanKey: PlanKey | null = null, scheduledChangeAt: Date | null = null
  if (s.scheduleId) {
    const schedule = await gateway.schedule(s.scheduleId)
    const next = schedule.phases.find(p => p.startsAt >= item.endsAt)
    if (next) {
      if (next.items.length !== 1 || next.items[0]!.quantity !== 1) throw new BillingError(409, "BILLING_SUBSCRIPTION_UNSUPPORTED")
      scheduledPlanKey = planForPrice(next.items[0]!.priceId, env); scheduledChangeAt = date(next.startsAt)
    }
  }
  const oldPaidThrough = local.stripeSubscriptionId === s.id ? local.paidThrough : null
  const paidThrough = verifiedPaid && (!oldPaidThrough || oldPaidThrough < endsAt) ? endsAt : oldPaidThrough
  const status = terminal(s.status) ? "CANCELED" : s.paused || ["past_due", "unpaid", "paused"].includes(s.status) ? "PAST_DUE" : s.status === "active" && paidThrough ? "ACTIVE" : "NONE"
  await db.$transaction(async tx => {
    await fence(tx, value)
    await tx.tenantSubscription.update({ where: { tenantId: value.tenantId }, data: {
      stripeSubscriptionId: s.id, stripePriceId: verifiedPaid ? item.priceId : local.stripePriceId, status, paidThrough,
      ...(verifiedPaid ? { planKey: plan, seatLimit: subscriptionPlans[plan].seatLimit } : {}),
      currentPeriodStart: startsAt, currentPeriodEnd: endsAt, graceEndsAt: status === "PAST_DUE" && paidThrough ? new Date(paidThrough.getTime() + BILLING_GRACE_MS) : null,
      scheduledPlanKey, scheduledChangeAt, cancelAtPeriodEnd: s.cancelAtPeriodEnd, stripeScheduleId: s.scheduleId, billingSyncedAt: new Date(),
    } })
    if (verifiedPaid) await grantMonthlyAiCredits(tx, { tenantId: value.tenantId, sourceKey: `stripe:invoice:${invoice!.id}:monthly`, planKey: plan, startsAt, endsAt })
    if (event) await tx.stripeBillingEvent.create({ data: { id: event.id, type: event.type, tenantId: value.tenantId, eventCreatedAt: date(event.created) } })
  })
  return { ignored: false }
}
export async function reconcileSubscription(db: BillingDatabase, gateway: BillingGateway, tenantId: string, env: Environment = process.env) {
  configured(env)
  return lease(db, tenantId, async value => {
    const local = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } })
    if (!local.stripeSubscriptionId) return { ignored: true }
    return syncLocked(db, gateway, value, await gateway.subscription(local.stripeSubscriptionId), env)
  })
}
export async function processSubscriptionEvent(db: BillingDatabase, gateway: BillingGateway, event: { id: string; type: string; objectId: string; created: number }, env: Environment = process.env) {
  configured(env)
  if (await db.stripeBillingEvent.findUnique({ where: { id: event.id } })) return { duplicate: true }
  let subscriptionId: string | null = null
  if (event.type.startsWith("invoice.")) subscriptionId = (await gateway.invoice(event.objectId)).subscriptionId
  else if (event.type.startsWith("customer.subscription.")) subscriptionId = event.objectId
  else if (event.type.startsWith("checkout.session.")) subscriptionId = (await gateway.session(event.objectId)).subscriptionId
  if (!subscriptionId) return { ignored: true }
  const initial = await gateway.subscription(subscriptionId)
  const local = await db.tenantSubscription.findUnique({ where: { stripeCustomerId: initial.customerId } })
  if (!local) { if (initial.metadata.tenantId) throw new BillingError(503, "BILLING_CUSTOMER_NOT_READY"); return { ignored: true } }
  return lease(db, local.tenantId, async value => {
    if (await db.stripeBillingEvent.findUnique({ where: { id: event.id } })) return { duplicate: true }
    return syncLocked(db, gateway, value, await gateway.subscription(subscriptionId!), env, event)
  })
}

export async function runSubscriptionCommand(db: BillingDatabase, gateway: BillingGateway, tenantId: string, actorId: string, input: BillingCommandInput, env: Environment = process.env) {
  configured(env); z.uuid().parse(tenantId); z.uuid().parse(actorId)
  const p = BillingCommandSchema.parse(input), requestHash = createHash("sha256").update(JSON.stringify([p.kind, "planKey" in p ? p.planKey : null])).digest("hex")
  return lease(db, tenantId, async value => {
    let command = await db.billingCommand.findUnique({ where: { tenantId_actorId_requestId: { tenantId, actorId, requestId: p.requestId } } })
    if (command && command.requestHash !== requestHash) throw new BillingError(409, "BILLING_REQUEST_CONFLICT")
    if (command?.status === "SUCCEEDED") return command.result
    if (command && command.createdAt.getTime() < Date.now() - 23 * 3600000) throw new BillingError(409, "BILLING_RECONCILIATION_REQUIRED")
    const retrying = Boolean(command)
    if (!command) command = await db.billingCommand.create({ data: { tenantId, actorId, requestId: p.requestId, kind: p.kind, requestHash } })
    const commandId = command.id
    const local = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } })
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } })
    const origin = new URL(env.WEB_ORIGIN ?? "http://localhost:3000")
    if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))) throw new BillingError(503, "BILLING_UNAVAILABLE")
    const returnUrl = new URL(`/app/${encodeURIComponent(tenant.slug)}/account-settings/subscription`, origin).toString()
    let customerId = local.stripeCustomerId
    if (!customerId) {
      const uncertainCustomer = await db.billingCommand.findFirst({ where: { tenantId, status: "PENDING", createdAt: { lt: new Date(Date.now() - 23 * 3600000) } } })
      if (uncertainCustomer) throw new BillingError(409, "BILLING_RECONCILIATION_REQUIRED")
      await update(db, value, {})
      customerId = await gateway.customer(tenantId, commandId)
      await update(db, value, { stripeCustomerId: customerId })
    }
    let result: Prisma.InputJsonObject
    if (p.kind === "portal") {
      result = { url: await gateway.portal(customerId, env.STRIPE_PORTAL_CONFIGURATION_ID!, returnUrl, commandId) }
    } else if (p.kind === "checkout") {
      if (local.status === "CANCELED" && local.paidThrough && local.paidThrough > new Date()) throw new BillingError(409, "BILLING_PAID_PERIOD_REMAINS")
      const priceId = await verifyPlanPrice(gateway, p.planKey, env)
      await update(db, value, {})
      const session = await gateway.checkout(customerId, priceId, tenantId, commandId, returnUrl, command.createdAt)
      if (!session.url) throw new BillingError(503, "BILLING_UNAVAILABLE")
      await update(db, value, { pendingCheckoutId: session.id, pendingCheckoutExpiresAt: date(session.expiresAt) })
      result = { checkoutId: session.id, url: session.url }
    } else {
      if (!local.stripeSubscriptionId || local.status !== "ACTIVE" || !local.paidThrough || local.paidThrough <= new Date()) throw new BillingError(402, "BILLING_REQUIRED")
      const subscription = await gateway.subscription(local.stripeSubscriptionId), { item, plan } = validSubscription(subscription, env)
      if (subscription.customerId !== customerId || subscription.metadata.tenantId !== tenantId || subscription.status !== "active" || subscription.cancelAtPeriodEnd || (subscription.pendingUpdate && !retrying)) throw new BillingError(409, "BILLING_CHANGE_PENDING")
      const targetPriceId = await verifyPlanPrice(gateway, p.planKey, env)
      await verifyPlanPrice(gateway, plan, env)
      const schedule = subscription.scheduleId ? await gateway.schedule(subscription.scheduleId) : null
      const intent = command.context ? PlanIntentSchema.parse(command.context) : {
        mode: p.planKey === plan ? subscription.scheduleId ? "cancelSchedule" as const : "noop" as const : subscriptionPlans[p.planKey].monthlyPriceCents > subscriptionPlans[plan].monthlyPriceCents ? "upgrade" as const : "downgrade" as const,
        subscriptionId: subscription.id, fromPriceId: item.priceId, startsAt: item.startsAt, endsAt: item.endsAt,
        scheduleId: subscription.scheduleId, scheduleCommandId: schedule?.metadata?.billingCommandId ?? null,
      }
      if (!command.context) await db.$transaction(async tx => { await fence(tx, value); await tx.billingCommand.update({ where: { id: commandId }, data: { context: intent } }) })
      if (intent.mode === "noop") throw new BillingError(409, "BILLING_PLAN_UNCHANGED")
      if (intent.subscriptionId !== subscription.id || (item.priceId !== intent.fromPriceId && item.priceId !== targetPriceId) || ((item.startsAt !== intent.startsAt || item.endsAt !== intent.endsAt) && item.priceId !== targetPriceId)) throw new BillingError(409, "BILLING_RECONCILIATION_REQUIRED")
      if (schedule?.metadata?.billingCommandId && ![commandId, intent.scheduleCommandId].includes(schedule.metadata.billingCommandId)) throw new BillingError(409, "BILLING_RECONCILIATION_REQUIRED")
      if ((intent.mode === "upgrade" || intent.mode === "downgrade") && item.priceId === targetPriceId) {
        await syncLocked(db, gateway, value, subscription, env)
        result = { effectiveAt: new Date().toISOString(), paymentPending: false, url: null }
      } else if (intent.mode === "cancelSchedule") {
        if (subscription.scheduleId && subscription.scheduleId !== intent.scheduleId) throw new BillingError(409, "BILLING_RECONCILIATION_REQUIRED")
        if (subscription.scheduleId) {
          if ((await gateway.schedule(subscription.scheduleId)).metadata?.tenantId !== tenantId) throw new BillingError(409, "BILLING_CHANGE_PENDING")
          await update(db, value, {})
          await gateway.releaseSchedule(subscription.scheduleId, commandId)
        }
        await syncLocked(db, gateway, value, await gateway.subscription(subscription.id), env)
        result = { effectiveAt: new Date().toISOString(), paymentPending: false, url: null }
      } else if (intent.mode === "upgrade") {
        if (subscription.pendingUpdate && subscription.pendingPriceId !== targetPriceId) throw new BillingError(409, "BILLING_CHANGE_PENDING")
        if (subscription.scheduleId) throw new BillingError(409, "BILLING_CHANGE_PENDING")
        await update(db, value, {})
        const changed = await gateway.upgrade(subscription.id, item.id, targetPriceId, commandId)
        const invoice = changed.latestInvoiceId ? await gateway.invoice(changed.latestInvoiceId) : null
        await syncLocked(db, gateway, value, await gateway.subscription(subscription.id), env)
        result = { effectiveAt: new Date().toISOString(), paymentPending: changed.pendingUpdate, url: invoice?.status !== "paid" ? invoice?.url ?? null : null }
      } else {
        if (await db.membership.count({ where: { tenantId, status: "ACTIVE" } }) > subscriptionPlans[p.planKey].seatLimit) throw new BillingError(409, "BILLING_SEAT_LIMIT")
        let scheduleId = subscription.scheduleId
        if (scheduleId && (await gateway.schedule(scheduleId)).metadata?.tenantId !== tenantId) {
          if (!retrying || await gateway.createSchedule(subscription.id, commandId) !== scheduleId) throw new BillingError(409, "BILLING_CHANGE_PENDING")
        }
        if (!scheduleId) scheduleId = await gateway.createSchedule(subscription.id, commandId)
        await update(db, value, { stripeScheduleId: scheduleId })
        await update(db, value, {})
        await gateway.downgrade(scheduleId, tenantId, item, targetPriceId, commandId)
        await syncLocked(db, gateway, value, await gateway.subscription(subscription.id), env)
        result = { effectiveAt: date(item.endsAt).toISOString(), paymentPending: false, url: null }
      }
    }
    await db.$transaction(async tx => {
      await fence(tx, value)
      await tx.billingCommand.update({ where: { id: commandId }, data: { status: "SUCCEEDED", result, completedAt: new Date() } })
    })
    return result
  })
}
