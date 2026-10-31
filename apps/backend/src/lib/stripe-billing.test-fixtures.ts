import { randomUUID } from "node:crypto"
import { subscriptionPlans, type PlanKey } from "./subscription-plans.js"
import type { BillingGateway, BillingSubscription, BillingInvoice } from "./stripe-billing-gateway.js"
export const billingTestEnv = {
  BILLING_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture", STRIPE_PORTAL_CONFIGURATION_ID: "bpc_fixture",
  STRIPE_PRICE_STARTER_MONTHLY: "price_STARTER", STRIPE_PRICE_PRO_MONTHLY: "price_PRO", STRIPE_PRICE_BUSINESS_MONTHLY: "price_BUSINESS", WEB_ORIGIN: "http://localhost:3000",
}
export class FakeBillingGateway implements BillingGateway {
  subs = new Map<string, BillingSubscription>()
  invoices = new Map<string, BillingInvoice>()
  sessions = new Map<string, Awaited<ReturnType<BillingGateway["checkout"]>>>()
  schedules = new Map<string, Awaited<ReturnType<BillingGateway["schedule"]>>>()
  customers = new Map<string, string>()
  upgrades = new Map<string, BillingSubscription>()
  checkoutCreates = 0; upgradeCreates = 0; pendingPayment = false; wrongPrice = false
  async price(id: string) { return { id, active: true, currency: "usd", amount: this.wrongPrice ? 1 : subscriptionPlans[id.replace("price_", "") as PlanKey].monthlyPriceCents, interval: "month", intervalCount: 1, usageType: "licensed", scheme: "per_unit" } }
  async customer(tenantId: string, _commandId: string) { if (!this.customers.has(tenantId)) this.customers.set(tenantId, `cus_${randomUUID()}`); return this.customers.get(tenantId)! }
  async subscription(id: string) { return structuredClone(this.subs.get(id)!) }
  async invoice(id: string) { return structuredClone(this.invoices.get(id)!) }
  async liveSubscriptions(customerId: string) { return { ids: [...this.subs.values()].filter(s => s.customerId === customerId && s.status !== "canceled").map(s => s.id), hasMore: false } }
  async checkout(customerId: string, priceId: string, tenantId: string, commandId: string, _returnUrl: string, createdAt: Date) {
    const prior = [...this.sessions.values()].find(s => s.id === `cs_${commandId}`)
    if (prior) return prior
    if ([...this.sessions.values()].some(s => s.customerId === customerId && s.status === "open")) throw new Error("BILLING_CHECKOUT_PENDING")
    if ((await this.liveSubscriptions(customerId)).ids.length) throw new Error("BILLING_SUBSCRIPTION_EXISTS")
    this.checkoutCreates++
    const session: Awaited<ReturnType<BillingGateway["checkout"]>> = { id: `cs_${commandId}`, url: `https://checkout.stripe.com/c/pay/${commandId}`, expiresAt: Math.floor(createdAt.getTime() / 1000) + 3600, customerId, subscriptionId: null as string | null, status: "open" }
    this.sessions.set(session.id, session)
    return session
  }
  async session(id: string) { return structuredClone(this.sessions.get(id)!) }
  async portal(_customerId: string, _configId: string, _returnUrl: string, commandId: string) { return `https://billing.stripe.com/p/session/${commandId}` }
  async upgrade(id: string, _itemId: string, priceId: string, commandId: string) {
    if (this.upgrades.has(commandId)) return this.upgrades.get(commandId)!
    this.upgradeCreates++
    const s = this.subs.get(id)!, invoice = this.invoiceFor(s, priceId)
    invoice.billingReason = "subscription_update"; invoice.lines[0]!.proration = true; invoice.lines[0]!.startsAt = Math.floor(Date.now() / 1000)
    if (this.pendingPayment) { invoice.status = "open"; invoice.amountPaid = 0; s.pendingUpdate = true; s.pendingPriceId = priceId }
    else s.items[0]!.priceId = priceId
    s.latestInvoiceId = invoice.id; this.invoices.set(invoice.id, invoice)
    const result = structuredClone(s); this.upgrades.set(commandId, result); return result
  }
  async schedule(id: string) { return structuredClone(this.schedules.get(id)!) }
  async createSchedule(id: string, commandId: string) {
    const scheduleId = `sched_${commandId}`, s = this.subs.get(id)!
    if (!this.schedules.has(scheduleId)) this.schedules.set(scheduleId, { id: scheduleId, metadata: {}, phases: [{ startsAt: s.items[0]!.startsAt, endsAt: s.items[0]!.endsAt, items: [{ priceId: s.items[0]!.priceId, quantity: 1 }] }] })
    s.scheduleId = scheduleId; return scheduleId
  }
  async releaseSchedule(id: string, _commandId: string) {
    for (const sub of this.subs.values()) if (sub.scheduleId === id) sub.scheduleId = null
  }
  async downgrade(id: string, tenantId: string, item: BillingSubscription["items"][number], priceId: string, _commandId: string) {
    this.schedules.set(id, { id, metadata: { tenantId, billingCommandId: _commandId }, phases: [
      { startsAt: item.startsAt, endsAt: item.endsAt, items: [{ priceId: item.priceId, quantity: 1 }] },
      { startsAt: item.endsAt, endsAt: item.endsAt + 31 * 86400, items: [{ priceId, quantity: 1 }] },
    ] })
  }
  invoiceFor(s: BillingSubscription, priceId = s.items[0]!.priceId): BillingInvoice {
    const amount = subscriptionPlans[priceId.replace("price_", "") as PlanKey].monthlyPriceCents
    return { id: `in_${randomUUID()}`, customerId: s.customerId, subscriptionId: s.id, status: "paid", currency: "usd", amountPaid: amount, amountDue: amount, total: amount, created: Math.floor(Date.now() / 1000), billingReason: "subscription_create", url: "https://invoice.stripe.com/i/test", hasMore: false,
      lines: [{ priceId, quantity: 1, amount, subscriptionId: s.id, startsAt: s.items[0]!.startsAt, endsAt: s.items[0]!.endsAt, proration: false }] }
  }
  completeCheckout(sessionId: string, tenantId: string, commandId: string, plan: PlanKey = "STARTER") {
    const session = this.sessions.get(sessionId)!, now = new Date(), starts = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000, ends = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) / 1000
    const sub: BillingSubscription = { id: `sub_${randomUUID()}`, customerId: session.customerId!, status: "active", metadata: { tenantId, billingCommandId: commandId }, cancelAtPeriodEnd: false, scheduleId: null, latestInvoiceId: null, pendingUpdate: false, pendingPriceId: null, paused: false, trial: false, hasMore: false, items: [{ id: `si_${randomUUID()}`, priceId: `price_${plan}`, quantity: 1, startsAt: starts, endsAt: ends }] }
    const invoice = this.invoiceFor(sub); sub.latestInvoiceId = invoice.id
    this.subs.set(sub.id, sub); this.invoices.set(invoice.id, invoice); session.status = "complete"; session.subscriptionId = sub.id
    return sub
  }
}
