import { createHash } from "node:crypto"
import { z } from "zod"
import type { PrismaClient, AiCreditPurchase, Prisma } from "../generated/prisma/index.js"
import { BillingError, lease, fence, subscriptionAccess, type BillingDatabase } from "./subscription-billing.js"
import { aiCreditPacks, type AiCreditPackKey } from "./subscription-plans.js"
import { getBillingConfiguration } from "./billing-config.js"
import { grantPurchasedAiCredits } from "./ai-credit-wallet.js"
import type { CreditGateway } from "./stripe-credit-gateway.js"
export type PurchaseDatabase = BillingDatabase & Pick<PrismaClient, "aiCreditPurchase" | "aiCreditWallet">
type Environment = Record<string, string | undefined>
export const CreditCheckoutSchema = z.object({ packKey: z.enum(["AI_1000", "AI_5000", "AI_10000"]), requestId: z.uuid() }).strict()
function available(env: Environment) {
  try { if (!getBillingConfiguration(env).creditPurchasesEnabled) throw new Error() } catch { throw new BillingError(503, "CREDIT_PURCHASES_UNAVAILABLE") }
}
export async function verifyCreditPrice(gateway: CreditGateway, packKey: AiCreditPackKey, env: Environment) {
  const priceId = env[`STRIPE_PRICE_${packKey}`], pack = aiCreditPacks[packKey]
  if (!priceId) throw new BillingError(503, "CREDIT_PURCHASES_UNAVAILABLE")
  const price = await gateway.price(priceId)
  if (!price.active || price.id !== priceId || price.currency !== "usd" || price.amount !== pack.priceCents || price.interval !== null || price.usageType !== null || price.scheme !== "per_unit") throw new BillingError(409, "BILLING_PRICE_MISMATCH")
  return priceId
}
export async function startCreditCheckout(db: PurchaseDatabase, gateway: CreditGateway, tenantId: string, actorId: string, input: z.input<typeof CreditCheckoutSchema>, env: Environment = process.env) {
  available(env); z.uuid().parse(tenantId); z.uuid().parse(actorId)
  const p = CreditCheckoutSchema.parse(input), hash = createHash("sha256").update(JSON.stringify(["credits", p.packKey])).digest("hex")
  return lease(db, tenantId, async value => {
    const subscription = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } })
    if (!subscriptionAccess(subscription).aiAllowed || !subscription.stripeCustomerId || !subscription.stripeSubscriptionId) throw new BillingError(402, "BILLING_REQUIRED")
    if ((await db.aiCreditWallet.findUnique({ where: { tenantId } }))?.purchaseReviewRequired) throw new BillingError(402, "AI_PURCHASE_REVIEW_REQUIRED")
    let command = await db.billingCommand.findUnique({ where: { tenantId_actorId_requestId: { tenantId, actorId, requestId: p.requestId } } })
    if (command && (command.kind !== "credits" || command.requestHash !== hash)) throw new BillingError(409, "BILLING_REQUEST_CONFLICT")
    if (command?.status === "SUCCEEDED") {
      const purchase = await db.aiCreditPurchase.findUniqueOrThrow({ where: { id: command.id } })
      if (purchase.status === "EXPIRED") throw new BillingError(409, "BILLING_CHECKOUT_EXPIRED")
      return command.result
    }
    if (command && command.createdAt.getTime() < Date.now() - 23 * 3600000) throw new BillingError(409, "BILLING_RECONCILIATION_REQUIRED")
    const pending = await db.aiCreditPurchase.findFirst({ where: { tenantId, status: "PENDING", ...(command ? { id: { not: command.id } } : {}) } })
    if (pending) throw new BillingError(409, "BILLING_CHECKOUT_PENDING")
    const priceId = await verifyCreditPrice(gateway, p.packKey, env), pack = aiCreditPacks[p.packKey]
    if (!command) command = await db.$transaction(async tx => {
      await fence(tx, value)
      const cmd = await tx.billingCommand.create({ data: { tenantId, actorId, requestId: p.requestId, kind: "credits", requestHash: hash } })
      await tx.aiCreditPurchase.create({ data: { id: cmd.id, tenantId, packKey: p.packKey, credits: pack.credits, amountCents: pack.priceCents, stripePriceId: priceId } })
      return cmd
    })
    const purchase = await db.aiCreditPurchase.findUniqueOrThrow({ where: { id: command.id } })
    if (purchase.stripePriceId !== priceId || purchase.credits !== pack.credits || purchase.amountCents !== pack.priceCents) throw new BillingError(409, "BILLING_RECONCILIATION_REQUIRED")
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } }), origin = new URL(env.WEB_ORIGIN ?? "http://localhost:3000")
    if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))) throw new BillingError(503, "BILLING_UNAVAILABLE")
    await db.$transaction(tx => fence(tx, value))
    const checkout = await gateway.creditCheckout(subscription.stripeCustomerId, priceId, tenantId, command.id, p.packKey, new URL(`/app/${encodeURIComponent(tenant.slug)}/account-settings/subscription`, origin).toString(), command.createdAt)
    if (!checkout.url || checkout.status === "expired") throw new BillingError(409, "BILLING_CHECKOUT_EXPIRED")
    const result = { checkoutId: checkout.id, url: checkout.url }
    await db.$transaction(async tx => {
      await fence(tx, value)
      await tx.aiCreditPurchase.update({ where: { id: command.id }, data: { sessionId: checkout.id } })
      await tx.billingCommand.update({ where: { id: command.id }, data: { status: "SUCCEEDED", result, completedAt: new Date() } })
    })
    return result
  })
}
export async function reconcileCreditPurchase(db: PurchaseDatabase, gateway: CreditGateway, purchaseId: string, event?: { id: string; type: string; created: number }) {
  const initial = await db.aiCreditPurchase.findUniqueOrThrow({ where: { id: purchaseId } })
  return lease(db, initial.tenantId, async value => {
    if (event && await db.stripeBillingEvent.findUnique({ where: { id: event.id } })) return { duplicate: true }
    const purchase = await db.aiCreditPurchase.findUniqueOrThrow({ where: { id: purchaseId } }), subscription = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: purchase.tenantId } })
    if (!subscription.stripeCustomerId) throw new BillingError(409, "BILLING_CUSTOMER_MISMATCH")
    const found = purchase.sessionId ? { id: purchase.sessionId } : await gateway.findCreditCheckout(subscription.stripeCustomerId, purchase.id)
    if (!found) {
      if (event) throw new BillingError(503, "CREDIT_PURCHASE_NOT_READY")
      await db.$transaction(async tx => { await fence(tx, value); await tx.aiCreditPurchase.update({ where: { id: purchaseId }, data: { checkedAt: new Date() } }) })
      return { pending: true }
    }
    const s = await gateway.creditSession(found.id)
    if (s.mode !== "payment" || s.customerId !== subscription.stripeCustomerId || s.reference !== purchase.tenantId || s.metadata.tenantId !== purchase.tenantId || s.metadata.billingCommandId !== purchase.id || s.metadata.packKey !== purchase.packKey) throw new BillingError(409, "BILLING_CUSTOMER_MISMATCH")
    if (s.currency !== "usd" || s.subtotal !== purchase.amountCents || s.total !== purchase.amountCents || s.hasMore || s.lines.length !== 1 || s.lines[0]!.priceId !== purchase.stripePriceId || s.lines[0]!.quantity !== 1 || s.lines[0]!.currency !== "usd" || s.lines[0]!.subtotal !== purchase.amountCents || s.lines[0]!.total !== purchase.amountCents) throw new BillingError(409, "BILLING_PRICE_MISMATCH")
    const payment = s.paymentIntentId ? await gateway.creditPayment(s.paymentIntentId) : null
    if (payment && (payment.id !== s.paymentIntentId || payment.customerId !== s.customerId || payment.metadata.tenantId !== purchase.tenantId || payment.metadata.billingCommandId !== purchase.id || payment.metadata.packKey !== purchase.packKey || payment.currency !== "usd" || payment.amount !== purchase.amountCents)) throw new BillingError(409, "BILLING_CUSTOMER_MISMATCH")
    const c = payment?.charge
    const review = purchase.status === "REVIEW" || Boolean(c?.refunded || c?.disputed || event?.type.startsWith("refund.") || event?.type.startsWith("charge.dispute.") || event?.type === "charge.refunded")
    const paid = s.status === "complete" && s.paymentStatus === "paid" && payment?.status === "succeeded" && payment.received === purchase.amountCents && c?.paid && c.captured && c.amount === purchase.amountCents && c.currency === "usd" && c.customerId === s.customerId && c.paymentIntentId === payment.id
    const pack = aiCreditPacks[purchase.packKey as AiCreditPackKey]
    if (!review && (!pack || pack.credits !== purchase.credits || pack.priceCents !== purchase.amountCents)) throw new BillingError(409, "BILLING_RECONCILIATION_REQUIRED")
    await db.$transaction(async tx => {
      await fence(tx, value)
      if (review) {
        await tx.aiCreditWallet.upsert({ where: { tenantId: purchase.tenantId }, create: { tenantId: purchase.tenantId, purchaseReviewRequired: true }, update: { purchaseReviewRequired: true, revision: { increment: 1 } } })
      } else if (paid) await grantPurchasedAiCredits(tx, { tenantId: purchase.tenantId, sourceKey: `stripe:payment_intent:${payment!.id}:credits`, packKey: purchase.packKey as AiCreditPackKey })
      await tx.aiCreditPurchase.update({ where: { id: purchase.id }, data: { sessionId: s.id, paymentIntentId: payment?.id ?? purchase.paymentIntentId, status: review ? "REVIEW" : paid || purchase.status === "PAID" ? "PAID" : s.status === "expired" ? "EXPIRED" : "PENDING", reviewReason: review ? purchase.reviewReason ?? (c?.disputed || event?.type.startsWith("charge.dispute.") ? "DISPUTE" : "REFUND") : null, checkedAt: new Date() } })
      if (s.status === "open" && s.url) await tx.billingCommand.updateMany({ where: { id: purchase.id, status: "PENDING" }, data: { status: "SUCCEEDED", result: { checkoutId: s.id, url: s.url }, completedAt: new Date() } })
      if (event) await tx.stripeBillingEvent.create({ data: { id: event.id, type: event.type, tenantId: purchase.tenantId, eventCreatedAt: new Date(event.created * 1000) } })
    })
    return { pending: !paid && !review }
  })
}
export async function cancelCreditCheckout(db: PurchaseDatabase, gateway: CreditGateway, tenantId: string, purchaseId: string) {
  z.uuid().parse(tenantId); z.uuid().parse(purchaseId)
  return lease(db, tenantId, async value => {
    const p = await db.aiCreditPurchase.findFirst({ where: { id: purchaseId, tenantId } })
    if (!p) throw new BillingError(404, "CREDIT_PURCHASE_NOT_FOUND")
    if (p.status === "EXPIRED") return { canceled: true }
    if (p.status !== "PENDING") throw new BillingError(409, "CREDIT_PAYMENT_ALREADY_COMPLETED")
    const sub = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } })
    const found = p.sessionId ? { id: p.sessionId } : sub.stripeCustomerId ? await gateway.findCreditCheckout(sub.stripeCustomerId, p.id) : null
    if (!found) throw new BillingError(409, "BILLING_RECONCILIATION_REQUIRED")
    const current = await gateway.creditSession(found.id)
    if (current.customerId !== sub.stripeCustomerId || current.metadata.billingCommandId !== p.id || current.metadata.tenantId !== tenantId) throw new BillingError(409, "BILLING_CUSTOMER_MISMATCH")
    if (current.status === "complete" || current.paymentStatus === "paid") throw new BillingError(409, "CREDIT_PAYMENT_ALREADY_COMPLETED")
    await db.$transaction(tx => fence(tx, value))
    const expired = current.status === "expired" ? current : await gateway.expireCreditCheckout(found.id, p.id)
    if (expired.status !== "expired") throw new BillingError(409, "BILLING_RECONCILIATION_REQUIRED")
    await db.$transaction(async tx => { await fence(tx, value); await tx.aiCreditPurchase.update({ where: { id: p.id }, data: { status: "EXPIRED", sessionId: expired.id, checkedAt: new Date() } }) })
    return { canceled: true }
  })
}
export async function processCreditEvent(db: PurchaseDatabase, gateway: CreditGateway, event: { id: string; type: string; objectId: string; created: number }) {
  if (await db.stripeBillingEvent.findUnique({ where: { id: event.id } })) return { duplicate: true }
  let commandId: string | undefined, eventPaymentId: string | null = null
  if (event.type.startsWith("checkout.session.")) commandId = (await gateway.creditSession(event.objectId)).metadata.billingCommandId
  else {
    const paymentId = await gateway.paymentForCreditEvent(event.type, event.objectId)
    if (!paymentId) return { ignored: true }
    eventPaymentId = paymentId
    commandId = (await gateway.creditPayment(paymentId)).metadata.billingCommandId
  }
  const purchase = commandId ? await db.aiCreditPurchase.findUnique({ where: { id: commandId } }) : null
  if (!purchase) return { ignored: true }
  const customer = await db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: purchase.tenantId }, select: { stripeCustomerId: true } })
  const found = purchase.sessionId ? { id: purchase.sessionId } : customer.stripeCustomerId ? await gateway.findCreditCheckout(customer.stripeCustomerId, purchase.id) : null
  if (!found) throw new BillingError(503, "CREDIT_PURCHASE_NOT_READY")
  const current = await gateway.creditSession(found.id)
  if (event.type.startsWith("checkout.session.") ? current.id !== event.objectId : current.paymentIntentId !== eventPaymentId) throw new BillingError(409, "BILLING_CUSTOMER_MISMATCH")
  return reconcileCreditPurchase(db, gateway, purchase.id, event)
}
