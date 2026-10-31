import Stripe from "stripe"
import { StripeBillingGateway } from "./stripe-billing-gateway.js"
const id = (v: string | { id: string } | null | undefined) => typeof v === "string" ? v : v?.id ?? null
const session = (s: Stripe.Checkout.Session) => ({ id: s.id, mode: s.mode, customerId: id(s.customer), paymentIntentId: id(s.payment_intent), status: s.status, paymentStatus: s.payment_status,
  currency: s.currency, subtotal: s.amount_subtotal, total: s.amount_total, reference: s.client_reference_id, metadata: s.metadata ?? {}, expiresAt: s.expires_at, url: s.url })
export class StripeCreditGateway extends StripeBillingGateway {
  async creditCheckout(customerId: string, priceId: string, tenantId: string, commandId: string, packKey: string, returnUrl: string, createdAt: Date) {
    const sessions = await this.client.checkout.sessions.list({ customer: customerId, limit: 100 })
    const prior = sessions.data.find(s => s.metadata?.billingCommandId === commandId)
    if (prior) return session(prior)
    if (sessions.has_more || sessions.data.some(s => s.status === "open")) throw new Error("BILLING_CHECKOUT_PENDING")
    if (createdAt.getTime() < Date.now() - 30 * 60000) throw new Error("BILLING_RECONCILIATION_REQUIRED")
    const metadata = { tenantId, billingCommandId: commandId, packKey }
    return session(await this.client.checkout.sessions.create({ mode: "payment", customer: customerId, client_reference_id: tenantId, allowed_payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }], metadata, payment_intent_data: { metadata }, allow_promotion_codes: false,
      success_url: `${returnUrl}?credits=complete`, cancel_url: `${returnUrl}?credits=canceled`, expires_at: Math.floor(createdAt.getTime() / 1000) + 3600,
    }, { idempotencyKey: `billing:${commandId}:credits` }))
  }
  async findCreditCheckout(customerId: string, commandId: string) {
    const list = await this.client.checkout.sessions.list({ customer: customerId, limit: 100 })
    const found = list.data.find(s => s.metadata?.billingCommandId === commandId)
    if (!found && list.has_more) throw new Error("BILLING_RECONCILIATION_REQUIRED")
    return found ? session(found) : null
  }
  async creditSession(sessionId: string) {
    const s = await this.client.checkout.sessions.retrieve(sessionId)
    const lines = await this.client.checkout.sessions.listLineItems(sessionId, { limit: 2 })
    return { ...session(s), hasMore: lines.has_more, lines: lines.data.map(l => ({ priceId: l.price?.id ?? null, quantity: l.quantity, currency: l.currency, subtotal: l.amount_subtotal, total: l.amount_total })) }
  }
  async creditPayment(paymentId: string) {
    const p = await this.client.paymentIntents.retrieve(paymentId, { expand: ["latest_charge"] })
    const charge = p.latest_charge && typeof p.latest_charge !== "string" ? p.latest_charge : null
    return { id: p.id, customerId: id(p.customer), metadata: p.metadata, status: p.status, currency: p.currency, amount: p.amount, received: p.amount_received,
      charge: charge ? { id: charge.id, customerId: id(charge.customer), paymentIntentId: id(charge.payment_intent), paid: charge.paid, captured: charge.captured, amount: charge.amount_captured, currency: charge.currency, refunded: charge.amount_refunded, disputed: charge.disputed } : null }
  }
  async expireCreditCheckout(sessionId: string, purchaseId: string) {
    return session(await this.client.checkout.sessions.expire(sessionId, {}, { idempotencyKey: `billing:${purchaseId}:expire-credits` }))
  }
  async paymentForCreditEvent(type: string, objectId: string) {
    if (type.startsWith("payment_intent.")) return objectId
    if (type.startsWith("charge.dispute.")) {
      const d = await this.client.disputes.retrieve(objectId)
      return id(d.payment_intent) ?? id((await this.client.charges.retrieve(id(d.charge)!)).payment_intent)
    }
    if (type.startsWith("refund.")) return id((await this.client.refunds.retrieve(objectId)).payment_intent)
    return id((await this.client.charges.retrieve(objectId)).payment_intent)
  }
}
export type CreditGateway = Pick<StripeCreditGateway, "price" | "creditCheckout" | "findCreditCheckout" | "creditSession" | "creditPayment" | "paymentForCreditEvent" | "expireCreditCheckout">
