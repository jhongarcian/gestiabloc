import type { PrismaClient } from "../generated/prisma/index.js"
import { recoverExpiredAiCredits } from "./ai-credit-wallet.js"
import { emptyAiReply } from "./ai-credit-replay.js"

type Database = Pick<PrismaClient, "$transaction" | "aiCreditRequest">
export async function maintainAiCredits(db: Database, now = new Date()) {
  const expired = await db.aiCreditRequest.findMany({ where: { status: "RESERVED", expiresAt: { lte: now } }, orderBy: { expiresAt: "asc" }, take: 100, select: { tenantId: true } })
  let released = 0
  for (const tenantId of new Set(expired.map(r => r.tenantId))) released += await recoverExpiredAiCredits(db, tenantId, now)
  const replies = await db.aiCreditRequest.findMany({ where: { responseExpiresAt: { lte: now } }, orderBy: { responseExpiresAt: "asc" }, take: 200, select: { id: true } })
  const purged = replies.length ? (await db.aiCreditRequest.updateMany({ where: { id: { in: replies.map(r => r.id) }, responseExpiresAt: { lte: now } }, data: emptyAiReply })).count : 0
  return { released, purged }
}
