import Stripe from "stripe"

export const STRIPE_BILLING_API_VERSION = "2026-09-30.endive" as const
const id = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id ?? null
export type BillingPrice = { id: string; active: boolean; currency: string; amount: number | null; interval: string | null; intervalCount: number | null; usageType: string | null; scheme: string }
export type BillingSubscription = ReturnType<typeof normalizeSubscription>
export type BillingInvoice = ReturnType<typeof normalizeInvoice>
function normalizeSubscription(s: Stripe.Subscription) {
  return { id: s.id, customerId: id(s.customer)!, status: s.status, metadata: s.metadata, cancelAtPeriodEnd: s.cancel_at_period_end,
    scheduleId: id(s.schedule), latestInvoiceId: id(s.latest_invoice), pendingUpdate: Boolean(s.pending_update), pendingPriceId: id(s.pending_update?.subscription_items?.[0]?.price), paused: Boolean(s.pause_collection), trial: s.trial_start !== null || s.trial_end !== null,
    items: s.items.data.map(i => ({ id: i.id, priceId: i.price.id, quantity: i.quantity ?? 1, startsAt: i.current_period_start, endsAt: i.current_period_end })), hasMore: s.items.has_more }
}
function normalizeInvoice(i: Stripe.Invoice) {
  return { id: i.id, customerId: id(i.customer), subscriptionId: id(i.parent?.subscription_details?.subscription), status: i.status, currency: i.currency,
    amountPaid: i.amount_paid, amountDue: i.amount_due, total: i.total, created: i.created, billingReason: i.billing_reason, url: i.hosted_invoice_url ?? null, hasMore: i.lines.has_more,
    lines: i.lines.data.map(l => ({ priceId: id(l.pricing?.price_details?.price), quantity: l.quantity, amount: l.amount,
      subscriptionId: id(l.parent?.subscription_item_details?.subscription ?? l.parent?.invoice_item_details?.subscription ?? l.subscription),
      startsAt: l.period.start, endsAt: l.period.end, proration: Boolean(l.parent?.subscription_item_details?.proration ?? l.parent?.invoice_item_details?.proration) })) }
}
export class StripeBillingGateway {
  readonly client: Stripe
  constructor(secretKey: string) { this.client = new Stripe(secretKey, { apiVersion: STRIPE_BILLING_API_VERSION, timeout: 15000, maxNetworkRetries: 1 }) }
  async price(priceId: string): Promise<BillingPrice> {
    const p = await this.client.prices.retrieve(priceId)
    return { id: p.id, active: p.active, currency: p.currency, amount: p.unit_amount, interval: p.recurring?.interval ?? null, intervalCount: p.recurring?.interval_count ?? null, usageType: p.recurring?.usage_type ?? null, scheme: p.billing_scheme }
  }
  async customer(tenantId: string, _commandId: string) { return (await this.client.customers.create({ metadata: { tenantId } }, { idempotencyKey: `billing:tenant:${tenantId}:customer` })).id }
  async subscription(subscriptionId: string) { return normalizeSubscription(await this.client.subscriptions.retrieve(subscriptionId)) }
  async invoice(invoiceId: string) { return normalizeInvoice(await this.client.invoices.retrieve(invoiceId)) }
  async liveSubscriptions(customerId: string) {
    const list = await this.client.subscriptions.list({ customer: customerId, status: "all", limit: 100 })
    return { ids: list.data.filter(s => !["canceled", "incomplete_expired"].includes(s.status)).map(s => s.id), hasMore: list.has_more }
  }
  async checkout(customerId: string, priceId: string, tenantId: string, commandId: string, returnUrl: string, createdAt: Date) {
    const sessions = await this.client.checkout.sessions.list({ customer: customerId, limit: 100 })
    const prior = sessions.data.find(s => s.metadata?.billingCommandId === commandId)
    if (prior) {
      if (prior.status === "expired") throw new Error("BILLING_CHECKOUT_EXPIRED")
      return { id: prior.id, url: prior.status === "complete" ? returnUrl : prior.url, expiresAt: prior.expires_at, customerId: id(prior.customer), subscriptionId: id(prior.subscription), status: prior.status }
    }
    if (sessions.has_more || sessions.data.some(s => s.status === "open")) throw new Error("BILLING_CHECKOUT_PENDING")
    const existing = await this.liveSubscriptions(customerId)
    if (existing.ids.length || existing.hasMore) throw new Error("BILLING_SUBSCRIPTION_EXISTS")
    if (createdAt.getTime() < Date.now() - 30 * 60000) throw new Error("BILLING_RECONCILIATION_REQUIRED")
    const s = await this.client.checkout.sessions.create({ mode: "subscription", customer: customerId, allowed_payment_method_types: ["card"],
      client_reference_id: tenantId, line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { billing_mode: { type: "classic" }, metadata: { tenantId, billingCommandId: commandId } }, metadata: { tenantId, billingCommandId: commandId },
      success_url: `${returnUrl}?checkout=complete`, cancel_url: `${returnUrl}?checkout=canceled`, expires_at: Math.floor(createdAt.getTime() / 1000) + 3600,
    }, { idempotencyKey: `billing:${commandId}:checkout` })
    return { id: s.id, url: s.url, expiresAt: s.expires_at, customerId: id(s.customer), subscriptionId: id(s.subscription), status: s.status }
  }
  async session(sessionId: string) {
    const s = await this.client.checkout.sessions.retrieve(sessionId)
    return { id: s.id, customerId: id(s.customer), subscriptionId: id(s.subscription), status: s.status, expiresAt: s.expires_at, url: s.url }
  }
  async portal(customerId: string, configurationId: string, returnUrl: string, commandId: string) {
    const config = await this.client.billingPortal.configurations.retrieve(configurationId)
    if (!config.active || config.features.subscription_update.enabled || !config.features.payment_method_update.enabled || !config.features.invoice_history.enabled || !config.features.subscription_cancel.enabled || config.features.subscription_cancel.mode !== "at_period_end") throw new Error("BILLING_PORTAL_CONFIGURATION_INVALID")
    return (await this.client.billingPortal.sessions.create({ customer: customerId, configuration: configurationId, return_url: returnUrl }, { idempotencyKey: `billing:${commandId}:portal` })).url
  }
  async upgrade(subscriptionId: string, itemId: string, priceId: string, commandId: string) {
    return normalizeSubscription(await this.client.subscriptions.update(subscriptionId, { items: [{ id: itemId, price: priceId, quantity: 1 }], payment_behavior: "pending_if_incomplete", proration_behavior: "always_invoice" }, { idempotencyKey: `billing:${commandId}:upgrade` }))
  }
  async schedule(scheduleId: string) {
    const s = await this.client.subscriptionSchedules.retrieve(scheduleId)
    return { id: s.id, metadata: s.metadata, phases: s.phases.map(p => ({ startsAt: p.start_date, endsAt: p.end_date, items: p.items.map(i => ({ priceId: id(i.price)!, quantity: i.quantity ?? 1 })) })) }
  }
  async createSchedule(subscriptionId: string, commandId: string) {
    return (await this.client.subscriptionSchedules.create({ from_subscription: subscriptionId }, { idempotencyKey: `billing:${commandId}:schedule-create` })).id
  }
  async releaseSchedule(scheduleId: string, commandId: string) {
    await this.client.subscriptionSchedules.release(scheduleId, {}, { idempotencyKey: `billing:${commandId}:schedule-release` })
  }
  async downgrade(scheduleId: string, tenantId: string, item: BillingSubscription["items"][number], priceId: string, commandId: string) {
    await this.client.subscriptionSchedules.update(scheduleId, { end_behavior: "release", metadata: { tenantId, billingCommandId: commandId }, proration_behavior: "none", phases: [
      { start_date: item.startsAt, end_date: item.endsAt, items: [{ price: item.priceId, quantity: 1 }], proration_behavior: "none" },
      { start_date: item.endsAt, duration: { interval: "month", interval_count: 1 }, items: [{ price: priceId, quantity: 1 }], proration_behavior: "none" },
    ] }, { idempotencyKey: `billing:${commandId}:schedule-update` })
  }
}
// A narrow structural surface lets tests replace the provider without API calls.
export type BillingGateway = Pick<StripeBillingGateway, "price" | "customer" | "subscription" | "invoice" | "liveSubscriptions" | "checkout" | "session" | "portal" | "upgrade" | "schedule" | "createSchedule" | "releaseSchedule" | "downgrade">
