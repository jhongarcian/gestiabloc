import { aiCreditPacks, type AiCreditPackKey } from "./subscription-plans.js"
import type { CreditGateway } from "./stripe-credit-gateway.js"
import { creditTestEnv } from "./ai-credit-execution.test-fixtures.js"
export const purchaseEnv = { ...creditTestEnv, AI_CREDIT_PURCHASES_ENABLED: "true", STRIPE_PRICE_AI_1000: "price_AI_1000", STRIPE_PRICE_AI_5000: "price_AI_5000", STRIPE_PRICE_AI_10000: "price_AI_10000", WEB_ORIGIN: "http://localhost:3000" }
export class FakeCreditGateway implements CreditGateway {
  sessions = new Map<string, Awaited<ReturnType<CreditGateway["creditSession"]>>>()
  payments = new Map<string, Awaited<ReturnType<CreditGateway["creditPayment"]>>>()
  events = new Map<string, string>()
  creates = 0; wrongPrice = false; recurring = false
  async price(id: string) { return { id, active: true, currency: "usd", amount: this.wrongPrice ? 1 : aiCreditPacks[id.replace("price_", "") as AiCreditPackKey].priceCents, interval: this.recurring ? "month" : null, intervalCount: this.recurring ? 1 : null, usageType: this.recurring ? "licensed" : null, scheme: "per_unit" } }
  async creditCheckout(customerId: string, priceId: string, tenantId: string, commandId: string, packKey: string, _url: string, createdAt: Date) {
    const prior = [...this.sessions.values()].find(s => s.metadata.billingCommandId === commandId)
    if (prior) return structuredClone(prior)
    if ([...this.sessions.values()].some(s => s.customerId === customerId && s.status === "open")) throw new Error("BILLING_CHECKOUT_PENDING")
    this.creates++
    const amount = aiCreditPacks[packKey as AiCreditPackKey].priceCents, sessionId = `cs_${commandId}`
    const s: Awaited<ReturnType<CreditGateway["creditSession"]>> = { id: sessionId, mode: "payment", customerId, paymentIntentId: null, status: "open", paymentStatus: "unpaid", currency: "usd", subtotal: amount, total: amount, reference: tenantId, metadata: { tenantId, billingCommandId: commandId, packKey }, expiresAt: Math.floor(createdAt.getTime() / 1000) + 3600, url: `https://checkout.stripe.com/c/pay/${sessionId}`, hasMore: false, lines: [{ priceId, quantity: 1, currency: "usd", subtotal: amount, total: amount }] }
    this.sessions.set(sessionId, s); return structuredClone(s)
  }
  async findCreditCheckout(customerId: string, commandId: string) { const s = [...this.sessions.values()].find(s => s.customerId === customerId && s.metadata.billingCommandId === commandId); return s ? structuredClone(s) : null }
  async creditSession(id: string) { return structuredClone(this.sessions.get(id)!) }
  async creditPayment(id: string) { return structuredClone(this.payments.get(id)!) }
  async paymentForCreditEvent(type: string, id: string) { return type.startsWith("payment_intent.") ? id : this.events.get(id) ?? null }
  async expireCreditCheckout(id: string, _purchaseId: string) { const s = this.sessions.get(id)!; if (s.status === "complete") throw new Error("Already paid"); s.status = "expired"; return structuredClone(s) }
  complete(id: string) {
    const s = this.sessions.get(id)!, paymentId = `pi_${s.metadata.billingCommandId}`, chargeId = `ch_${s.metadata.billingCommandId}`
    s.status = "complete"; s.paymentStatus = "paid"; s.paymentIntentId = paymentId
    this.payments.set(paymentId, { id: paymentId, customerId: s.customerId, metadata: { ...s.metadata }, status: "succeeded", currency: "usd", amount: s.total!, received: s.total!, charge: { id: chargeId, customerId: s.customerId, paymentIntentId: paymentId, paid: true, captured: true, amount: s.total!, currency: "usd", refunded: 0, disputed: false } })
    this.events.set(chargeId, paymentId)
    return this.payments.get(paymentId)!
  }
}
