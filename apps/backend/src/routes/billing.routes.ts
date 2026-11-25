import { Router, raw, type ErrorRequestHandler } from "express"
import Stripe from "stripe"
import { z } from "zod"
import { prisma } from "../lib/prisma.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js"
import { enforceSameOrigin } from "../lib/security.js"
import { getBillingConfiguration } from "../lib/billing-config.js"
import { StripeBillingGateway, type BillingGateway } from "../lib/stripe-billing-gateway.js"
import { BillingCommandSchema, BillingError, processSubscriptionEvent, reconcileSubscription, runSubscriptionCommand, type BillingDatabase } from "../lib/subscription-billing.js"
import { StripeCreditGateway, type CreditGateway } from "../lib/stripe-credit-gateway.js"
import { CreditCheckoutSchema, startCreditCheckout, processCreditEvent, cancelCreditCheckout, type PurchaseDatabase } from "../lib/ai-credit-purchases.js"
import { readAiCreditUsage } from "../lib/ai-credit-wallet.js"
import { aiCreditPacks, subscriptionPlans } from "../lib/subscription-plans.js"
import { subscriptionAccess } from "../lib/subscription-billing.js"

type Dependencies = { db?: BillingDatabase; gateway?: BillingGateway; creditGateway?: CreditGateway; env?: Record<string, string | undefined> }
const creditEvents = new Set(["payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.canceled", "charge.refunded", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed", "refund.created", "refund.updated", "refund.failed"])
const events = new Set(["invoice.paid", "invoice.payment_succeeded", "invoice.payment_failed", "invoice.payment_action_required", "invoice.marked_uncollectible", "invoice.voided", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed", "customer.subscription.pending_update_applied", "customer.subscription.pending_update_expired", "checkout.session.completed", "checkout.session.expired"])
const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  res.setHeader("Cache-Control", "no-store")
  if (error instanceof z.ZodError) return res.status(400).json({ error: "INVALID_BILLING_REQUEST" })
  if (error && typeof error === "object" && "status" in error && error.status === 403) return res.status(403).json({ error: "FORBIDDEN" })
  if (error instanceof BillingError) return res.status(error.status).json({ error: error.code })
  const expected = ["BILLING_CHECKOUT_PENDING", "BILLING_SUBSCRIPTION_EXISTS", "BILLING_CHECKOUT_EXPIRED", "BILLING_RECONCILIATION_REQUIRED", "BILLING_PORTAL_CONFIGURATION_INVALID"]
  if (error instanceof Error && expected.includes(error.message)) return res.status(409).json({ error: error.message })
  return res.status(503).json({ error: "BILLING_UNAVAILABLE" })
}
function context(deps: Dependencies, webhook = false) {
  const env = deps.env ?? process.env
  if (webhook ? !env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET : !getBillingConfiguration(env).enabled) throw new BillingError(503, "BILLING_UNAVAILABLE")
  return { env, db: deps.db ?? prisma, gateway: deps.gateway ?? new StripeBillingGateway(env.STRIPE_SECRET_KEY!) }
}
export function createBillingRouter(deps: Dependencies = {}) {
  const router = Router()
  const admin = requireTenantAdmin({ tenantIdLookups: [{ source: "params", key: "tenantId" }] })
  router.get("/:tenantId/credits", requireAuth, admin, async (req, res) => {
    const { tenantId } = z.object({ tenantId: z.uuid() }).parse(req.params), env = deps.env ?? process.env, config = getBillingConfiguration(env)
    res.setHeader("Cache-Control", "no-store")
    const now = new Date(), asOf = now.toISOString()
    if (!config.enabled) return res.json({ ok: true, enabled: false, enforcementEnabled: false, asOf, plan: null, access: null, timeZone: null, purchasesEnabled: false, eligible: false, canResume: false, usage: null, pendingCheckout: null, packs: aiCreditPacks })
    const db = (deps.db ?? prisma) as PurchaseDatabase
    const [sub, tenant] = await Promise.all([
      db.tenantSubscription.findUnique({ where: { tenantId } }),
      db.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }),
    ])
    const metadata = { enabled: true, enforcementEnabled: config.creditEnforcementEnabled, asOf, timeZone: tenant?.timezone ?? null,
      plan: sub ? { key: sub.planKey, name: subscriptionPlans[sub.planKey].name, monthlyAllowance: subscriptionPlans[sub.planKey].aiCreditsPerMonth } : null,
      access: subscriptionAccess(sub, now), paidThrough: sub?.paidThrough ?? null, cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false }
    if (!config.creditEnforcementEnabled) return res.json({ ok: true, ...metadata, purchasesEnabled: false, eligible: false, canResume: false, usage: null, pendingCheckout: null, packs: aiCreditPacks })
    const usage = await readAiCreditUsage(db, tenantId, now)
    const pending = await db.aiCreditPurchase.findFirst({ where: { tenantId, status: "PENDING" }, select: { id: true, packKey: true, command: { select: { result: true } } } })
    const link = z.object({ url: z.string().url() }).safeParse(pending?.command.result)
    const canResume = config.creditPurchasesEnabled && subscriptionAccess(sub).aiAllowed && !usage.purchaseReviewRequired
    res.json({ ok: true, ...metadata, purchasesEnabled: config.creditPurchasesEnabled, eligible: canResume && !pending, canResume, usage, packs: aiCreditPacks, pendingCheckout: pending ? { id: pending.id, packKey: pending.packKey, url: link.success ? link.data.url : null } : null })
  })
  router.post("/:tenantId/credits/:purchaseId/cancel", requireAuth, admin, async (req, res) => {
    enforceSameOrigin(req)
    z.object({}).strict().parse(req.body)
    const { tenantId, purchaseId } = z.object({ tenantId: z.uuid(), purchaseId: z.uuid() }).parse(req.params)
    const { db, env } = context(deps, true)
    res.setHeader("Cache-Control", "no-store")
    res.json({ ok: true, ...await cancelCreditCheckout(db as PurchaseDatabase, deps.creditGateway ?? new StripeCreditGateway(env.STRIPE_SECRET_KEY!), tenantId, purchaseId) })
  })
  router.post("/:tenantId/credits/checkout", requireAuth, admin, async (req, res) => {
    enforceSameOrigin(req)
    const { tenantId } = z.object({ tenantId: z.uuid() }).parse(req.params), input = CreditCheckoutSchema.parse(req.body)
    const { db, env } = context(deps)
    const gateway = deps.creditGateway ?? new StripeCreditGateway(env.STRIPE_SECRET_KEY!)
    const result = await startCreditCheckout(db as PurchaseDatabase, gateway, tenantId, (req as unknown as AuthedRequest).user.id, input, env)
    res.setHeader("Cache-Control", "no-store"); res.json({ ok: true, ...result as object })
  })
  router.post("/:tenantId/sync", requireAuth, admin, async (req, res) => {
    enforceSameOrigin(req)
    z.object({}).strict().parse(req.body)
    const { tenantId } = z.object({ tenantId: z.uuid() }).parse(req.params)
    const { db, gateway, env } = context(deps)
    res.setHeader("Cache-Control", "no-store")
    const result = await reconcileSubscription(db, gateway, tenantId, env)
    const subscription = await db.tenantSubscription.findUnique({ where: { tenantId } })
    res.json({ ok: true, ...result, access: subscriptionAccess(subscription) })
  })
  router.post("/:tenantId/:action", requireAuth, requireTenantAdmin({ tenantIdLookups: [{ source: "params", key: "tenantId" }] }), async (req, res) => {
    enforceSameOrigin(req)
    const { tenantId, action } = z.object({ tenantId: z.uuid(), action: z.enum(["checkout", "portal", "plan"]) }).parse(req.params)
    const input = BillingCommandSchema.parse({ ...req.body, kind: action })
    if (req.body?.kind !== undefined && req.body.kind !== action) throw new BillingError(400, "INVALID_BILLING_REQUEST")
    const { db, gateway, env } = context(deps)
    const result = await runSubscriptionCommand(db, gateway, tenantId, (req as unknown as AuthedRequest).user.id, input, env)
    res.setHeader("Cache-Control", "no-store")
    res.json({ ok: true, ...result as object })
  })
  router.use(handleError)
  return router
}
export function createStripeWebhookRouter(deps: Dependencies = {}) {
  const router = Router()
  router.post("/webhook", raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
    const { db, gateway, env } = context(deps, true)
    let event: Stripe.Event
    try {
      if (!Buffer.isBuffer(req.body)) throw new Error()
      event = new Stripe(env.STRIPE_SECRET_KEY!).webhooks.constructEvent(req.body, req.header("stripe-signature") ?? "", env.STRIPE_WEBHOOK_SECRET!)
      const live = /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY!)
      if (event.livemode !== live || event.account) throw new Error()
    } catch { return res.status(400).json({ error: "STRIPE_SIGNATURE_INVALID" }) }
    if (!events.has(event.type) && !creditEvents.has(event.type) && event.type !== "checkout.session.async_payment_succeeded" && event.type !== "checkout.session.async_payment_failed") return res.json({ ok: true, ignored: true })
    const objectId = z.object({ id: z.string().min(1) }).parse(event.data.object).id
    const paymentCheckout = event.type.startsWith("checkout.session.") && z.object({ mode: z.string().optional() }).parse(event.data.object).mode === "payment"
    if (creditEvents.has(event.type) || paymentCheckout) {
      const result = await processCreditEvent(db as PurchaseDatabase, deps.creditGateway ?? new StripeCreditGateway(env.STRIPE_SECRET_KEY!), { id: event.id, type: event.type, created: event.created, objectId })
      return res.json({ ok: true, ...result })
    }
    const result = await processSubscriptionEvent(db, gateway, { id: event.id, type: event.type, created: event.created, objectId }, env)
    res.json({ ok: true, ...result })
  })
  router.use(handleError)
  return router
}
