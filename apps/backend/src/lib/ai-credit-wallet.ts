import { createHash } from "node:crypto"
import { z } from "zod"
import type { Prisma, PrismaClient, AiCreditRequest } from "../generated/prisma/index.js"
import { aiCreditPacks, subscriptionPlans } from "./subscription-plans.js"
import type { AiCreditUsage } from "./billing-types.js"

export class AiCreditError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}
type Database = Pick<PrismaClient, "$transaction">
type Tx = Prisma.TransactionClient
type Writer = Database | Tx
const tenantSchema = z.uuid()
const sourceSchema = z.string().trim().min(1).max(200)
const monthlySchema = z.object({ tenantId: tenantSchema, sourceKey: sourceSchema,
  planKey: z.enum(["STARTER", "PRO", "BUSINESS"]), startsAt: z.date(), endsAt: z.date(),
}).refine(p => p.endsAt > p.startsAt, { message: "Invalid billing period" })
const purchaseSchema = z.object({ tenantId: tenantSchema, sourceKey: sourceSchema, packKey: z.enum(["AI_1000", "AI_5000", "AI_10000"]) })
export const AiCreditRequestSchema = z.object({
  tenantId: tenantSchema, actorId: z.uuid(), channel: z.enum(["TEST", "CONTACT_ASSISTANT"]),
  requestId: z.uuid(), requestHash: z.string().regex(/^[a-f0-9]{64}$/),
})
export type AiCreditRequestKey = z.infer<typeof AiCreditRequestSchema>
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const requestWhere = ({ tenantId, actorId, channel, requestId }: AiCreditRequestKey) => ({ tenantId_actorId_channel_requestId: { tenantId, actorId, channel, requestId } })
const validNow = (now: Date) => z.date().parse(now)

async function locked<T>(db: Writer, tenantId: string, action: (tx: Tx) => Promise<T>): Promise<T> {
  tenantSchema.parse(tenantId)
  try {
    const actionWithLock = async (tx: Tx) => {
      // The FK prevents wallets for nonexistent tenants. Every writer takes the
      // same row lock, including grants and expiry recovery across app servers.
      await tx.aiCreditWallet.createMany({ data: [{ tenantId }], skipDuplicates: true })
      await tx.$queryRaw`SELECT "tenantId" FROM "AiCreditWallet" WHERE "tenantId" = ${tenantId} FOR UPDATE`
      return action(tx)
    }
    return "$transaction" in db
      ? await db.$transaction(actionWithLock, { timeout: 10000, maxWait: 5000 })
      : await actionWithLock(db)
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
      throw new AiCreditError(409, "AI_REQUEST_CONFLICT")
    throw error
  }
}
async function revision(tx: Tx, tenantId: string) {
  await tx.aiCreditWallet.update({ where: { tenantId }, data: { revision: { increment: 1 } } })
}
async function priorGrant(tx: Tx, tenantId: string, sourceKey: string, sourceHash: string) {
  const prior = await tx.aiCreditLedger.findUnique({ where: { sourceKey } })
  if (prior && (prior.tenantId !== tenantId || prior.sourceHash !== sourceHash)) throw new AiCreditError(409, "AI_REQUEST_CONFLICT")
  return prior
}

// Server-only grant operations: call only after verified payment/webhook handling.
// They deliberately have no public HTTP mutation endpoints.
export async function grantMonthlyAiCredits(db: Writer, input: z.input<typeof monthlySchema>) {
  const p = monthlySchema.parse(input)
  const sourceHash = hash(["MONTHLY_GRANT", p.tenantId, p.planKey, p.startsAt.toISOString(), p.endsAt.toISOString()])
  return locked(db, p.tenantId, async tx => {
    const prior = await priorGrant(tx, p.tenantId, p.sourceKey, sourceHash)
    if (prior) return { granted: prior.monthlyUnits, duplicate: true }
    let period = await tx.aiCreditPeriod.findUnique({ where: { tenantId_startsAt: { tenantId: p.tenantId, startsAt: p.startsAt } } })
    if (period && period.endsAt.getTime() !== p.endsAt.getTime()) throw new AiCreditError(409, "AI_REQUEST_CONFLICT")
    if (!period) {
      const overlap = await tx.aiCreditPeriod.findFirst({ where: { tenantId: p.tenantId, startsAt: { lt: p.endsAt }, endsAt: { gt: p.startsAt } } })
      if (overlap) throw new AiCreditError(409, "AI_REQUEST_CONFLICT")
      period = await tx.aiCreditPeriod.create({ data: { tenantId: p.tenantId, startsAt: p.startsAt, endsAt: p.endsAt } })
    }
    // Upgrades grant the allowance difference. A delayed lower-plan event must
    // never reduce an allowance or reset credits already consumed this period.
    const granted = Math.max(0, subscriptionPlans[p.planKey].aiCreditsPerMonth - period.granted)
    await tx.aiCreditPeriod.update({ where: { id: period.id }, data: { granted: { increment: granted } } })
    await tx.aiCreditLedger.create({ data: { tenantId: p.tenantId, kind: "MONTHLY_GRANT", periodId: period.id, monthlyUnits: granted, purchasedUnits: 0, sourceKey: p.sourceKey, sourceHash } })
    await revision(tx, p.tenantId)
    return { granted, duplicate: false }
  })
}
export async function grantPurchasedAiCredits(db: Writer, input: z.input<typeof purchaseSchema>) {
  const p = purchaseSchema.parse(input)
  const sourceHash = hash(["PURCHASE_GRANT", p.tenantId, p.packKey])
  return locked(db, p.tenantId, async tx => {
    const prior = await priorGrant(tx, p.tenantId, p.sourceKey, sourceHash)
    if (prior) return { granted: prior.purchasedUnits, duplicate: true }
    const granted = aiCreditPacks[p.packKey].credits
    await tx.aiCreditWallet.update({ where: { tenantId: p.tenantId }, data: { purchasedBalance: { increment: granted }, revision: { increment: 1 } } })
    await tx.aiCreditLedger.create({ data: { tenantId: p.tenantId, kind: "PURCHASE_GRANT", monthlyUnits: 0, purchasedUnits: granted, sourceKey: p.sourceKey, sourceHash } })
    return { granted, duplicate: false }
  })
}
async function release(tx: Tx, request: AiCreditRequest, now: Date) {
  if (request.monthlyUnits) await tx.aiCreditPeriod.update({ where: { id: request.periodId! }, data: { reserved: { decrement: request.monthlyUnits } } })
  await tx.aiCreditWallet.update({ where: { tenantId: request.tenantId }, data: { purchasedReserved: { decrement: request.purchasedUnits }, revision: { increment: 1 } } })
  const result = await tx.aiCreditRequest.update({ where: { id: request.id }, data: { status: "RELEASED", finishedAt: now } })
  await tx.aiCreditLedger.create({ data: { tenantId: request.tenantId, kind: "RELEASE", periodId: request.periodId, requestId: request.id, monthlyUnits: request.monthlyUnits, purchasedUnits: request.purchasedUnits } })
  return result
}
async function recover(tx: Tx, tenantId: string, now: Date) {
  // Bounded batches keep locks short. Maintenance may repeat until count < 100.
  const expired = await tx.aiCreditRequest.findMany({ where: { tenantId, status: "RESERVED", expiresAt: { lte: now } }, orderBy: { expiresAt: "asc" }, take: 100 })
  for (const request of expired) await release(tx, request, now)
  return expired.length
}
export async function recoverExpiredAiCredits(db: Writer, tenantId: string, at?: Date) {
  if (at) validNow(at)
  return locked(db, tenantId, tx => recover(tx, tenantId, validNow(at ?? new Date())))
}

export async function reserveAiCredit(db: Writer, input: AiCreditRequestKey, at?: Date, units = 1) {
  const p = AiCreditRequestSchema.parse(input); if (at) validNow(at)
  z.number().int().min(1).max(1000).parse(units)
  return locked(db, p.tenantId, async tx => {
    const now = validNow(at ?? new Date()) // evaluate after acquiring the lock
    const prior = await tx.aiCreditRequest.findUnique({ where: requestWhere(p) })
    if (prior) {
      if (prior.requestHash !== p.requestHash || prior.monthlyUnits + prior.purchasedUnits !== units) throw new AiCreditError(409, "AI_REQUEST_CONFLICT")
      if (prior.status === "RELEASED" || (prior.status === "RESERVED" && prior.expiresAt <= now)) throw new AiCreditError(409, "AI_RESPONSE_EXPIRED")
      return { request: prior, duplicate: true }
    }
    // Purchased credits are retained when a subscription lapses, but AI is paused.
    const subscription = await tx.tenantSubscription.findUnique({ where: { tenantId: p.tenantId }, select: { status: true, paidThrough: true } })
    if (!subscription || subscription.status !== "ACTIVE" || !subscription.paidThrough || subscription.paidThrough <= now)
      throw new AiCreditError(402, "BILLING_REQUIRED")
    await recover(tx, p.tenantId, now)
    const period = await tx.aiCreditPeriod.findFirst({ where: { tenantId: p.tenantId, startsAt: { lte: now }, endsAt: { gt: now } } })
    const monthlyUnits = Math.min(units, period ? period.granted - period.used - period.reserved : 0)
    const purchasedUnits = units - monthlyUnits
    const wallet = await tx.aiCreditWallet.findUniqueOrThrow({ where: { tenantId: p.tenantId } })
    if (wallet.purchaseReviewRequired) throw new AiCreditError(402, "AI_PURCHASE_REVIEW_REQUIRED")
    if (wallet.purchasedBalance - wallet.purchasedReserved < purchasedUnits) throw new AiCreditError(402, "AI_CREDITS_EXHAUSTED")
    if (monthlyUnits) await tx.aiCreditPeriod.update({ where: { id: period!.id }, data: { reserved: { increment: monthlyUnits } } })
    await tx.aiCreditWallet.update({ where: { tenantId: p.tenantId }, data: { purchasedReserved: { increment: purchasedUnits }, revision: { increment: 1 } } })
    const request = await tx.aiCreditRequest.create({ data: { ...p, status: "RESERVED", monthlyUnits, purchasedUnits, periodId: monthlyUnits ? period!.id : null, expiresAt: new Date(now.getTime() + 5 * 60000) } })
    await tx.aiCreditLedger.create({ data: { tenantId: p.tenantId, kind: "RESERVE", periodId: request.periodId, requestId: request.id, monthlyUnits, purchasedUnits } })
    return { request, duplicate: false }
  })
}

export async function settleAiCredit(db: Writer, input: AiCreditRequestKey, outcome: "COMMIT" | "RELEASE", at?: Date) {
  const p = AiCreditRequestSchema.parse(input); if (at) validNow(at)
  z.enum(["COMMIT", "RELEASE"]).parse(outcome)
  return locked(db, p.tenantId, async tx => {
    const now = validNow(at ?? new Date())
    const request = await tx.aiCreditRequest.findUnique({ where: requestWhere(p) })
    if (!request || request.requestHash !== p.requestHash) throw new AiCreditError(409, "AI_REQUEST_CONFLICT")
    if (request.status !== "RESERVED") {
      if (outcome === "COMMIT" && request.status === "RELEASED") throw new AiCreditError(409, "AI_RESPONSE_EXPIRED")
      return request // never refund a committed answer or repeat a final debit
    }
    if (outcome === "RELEASE") return release(tx, request, now)
    if (request.expiresAt <= now) throw new AiCreditError(409, "AI_RESPONSE_EXPIRED")
    if (request.monthlyUnits) await tx.aiCreditPeriod.update({ where: { id: request.periodId! }, data: { reserved: { decrement: request.monthlyUnits }, used: { increment: request.monthlyUnits } } })
    await tx.aiCreditWallet.update({ where: { tenantId: p.tenantId }, data: { purchasedReserved: { decrement: request.purchasedUnits }, purchasedBalance: { decrement: request.purchasedUnits }, revision: { increment: 1 } } })
    const result = await tx.aiCreditRequest.update({ where: { id: request.id }, data: { status: "COMMITTED", finishedAt: now } })
    await tx.aiCreditLedger.create({ data: { tenantId: p.tenantId, kind: "COMMIT", periodId: request.periodId, requestId: request.id, monthlyUnits: request.monthlyUnits, purchasedUnits: request.purchasedUnits } })
    return result
  })
}

export async function readAiCreditUsage(db: Database, tenantId: string, now = new Date()): Promise<AiCreditUsage> {
  tenantSchema.parse(tenantId); validNow(now)
  return db.$transaction(async tx => {
    const wallet = await tx.aiCreditWallet.findUnique({ where: { tenantId } })
    const period = await tx.aiCreditPeriod.findFirst({ where: { tenantId, startsAt: { lte: now }, endsAt: { gt: now } } })
    const remaining = period ? period.granted - period.used - period.reserved : 0
    const balance = wallet?.purchasedBalance ?? 0, reserved = wallet?.purchasedReserved ?? 0
    return {
      revision: wallet?.revision ?? 0,
      purchaseReviewRequired: wallet?.purchaseReviewRequired ?? false,
      period: period ? { startsAt: period.startsAt.toISOString(), endsAt: period.endsAt.toISOString() } : null,
      monthly: { granted: period?.granted ?? 0, used: period?.used ?? 0, reserved: period?.reserved ?? 0, remaining },
      purchased: { balance, reserved, available: balance - reserved },
      available: remaining + balance - reserved,
    }
  }, { isolationLevel: "RepeatableRead" })
}
