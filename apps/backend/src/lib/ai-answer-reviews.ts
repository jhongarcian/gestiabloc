import { Prisma, type PrismaClient } from "../generated/prisma/index.js"
import { AiAnalyticsQuerySchema, analyticsWindow } from "./ai-analytics.js"
import { z } from "zod"
import { aiReviewCaptureAvailable, decryptReviewDetails, emptyReviewDetails, AiReviewReasonSchema } from "./ai-review-details.js"

type Database = Pick<PrismaClient, "aiInteraction">
export class AiReviewError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}
export const AiReviewListQuerySchema = AiAnalyticsQuerySchema.extend({
  state: z.enum(["OPEN", "REVIEWED", "ALL"]).default("OPEN"), cursor: z.uuid().optional(),
})
export const AiReviewUpdateSchema = z.object({ reviewed: z.boolean(), revision: z.number().int().nonnegative() }).strict()
const select = {
  id: true, tenantId: true, actorId: true, channel: true, requestId: true, createdAt: true,
  reviewReason: true, reviewedAt: true, reviewRevision: true,
  reviewCiphertext: true, reviewIv: true, reviewAuthTag: true, reviewKeyVersion: true, reviewExpiresAt: true,
} satisfies Prisma.AiInteractionSelect
type Row = Prisma.AiInteractionGetPayload<{ select: typeof select }>
function metadata(row: Row) {
  return { id: row.id, channel: row.channel, createdAt: row.createdAt, reason: AiReviewReasonSchema.catch("OTHER").parse(row.reviewReason), reviewedAt: row.reviewedAt, revision: row.reviewRevision, expiresAt: row.reviewExpiresAt }
}
const available = (tenantId: string, now: Date): Prisma.AiInteractionWhereInput => ({ tenantId, questionOutcome: "NEEDS_REVIEW", reviewCiphertext: { not: null }, reviewExpiresAt: { gt: now } })

export async function listAiAnswerReviews(db: Database, tenantId: string, query: z.infer<typeof AiReviewListQuerySchema>, now = new Date()) {
  const window = analyticsWindow(Number(query.days), now)
  const period: Prisma.AiInteractionWhereInput = { tenantId, questionOutcome: "NEEDS_REVIEW", createdAt: { gte: window.start, lte: window.end }, ...(query.channel === "ALL" ? {} : { channel: query.channel }) }
  const captured: Prisma.AiInteractionWhereInput = { AND: [period, available(tenantId, now)] }
  const where: Prisma.AiInteractionWhereInput = { AND: [captured, ...(query.state === "ALL" ? [] : [{ reviewedAt: query.state === "OPEN" ? null : { not: null } }])] }
  if (query.cursor) {
    const cursor = await db.aiInteraction.findFirst({ where: { AND: [where, { id: query.cursor }] }, select: { id: true, createdAt: true } })
    if (!cursor) throw new AiReviewError(400, "AI_REVIEW_CURSOR_INVALID")
    where.AND = [...(where.AND as Prisma.AiInteractionWhereInput[]), { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }]
  }
  const [rows, flagged, capturedCount, openCount, reviewedCount] = await Promise.all([
    db.aiInteraction.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21, select }),
    db.aiInteraction.count({ where: period }), db.aiInteraction.count({ where: captured }),
    db.aiInteraction.count({ where: { AND: [captured, { reviewedAt: null }] } }),
    db.aiInteraction.count({ where: { AND: [captured, { reviewedAt: { not: null } }] } }),
  ])
  const page = rows.slice(0, 20)
  return { items: page.map(row => {
    try {
      const details = decryptReviewDetails(row, row, now)
      return { ...metadata(row), questionPreview: details.question.slice(0, 200), detailsAvailable: true }
    } catch { return { ...metadata(row), questionPreview: null, detailsAvailable: false } }
  }), nextCursor: rows.length > 20 ? page.at(-1)!.id : null,
  counts: { open: openCount, reviewed: reviewedCount, unavailable: Math.max(0, flagged - capturedCount) }, captureAvailable: aiReviewCaptureAvailable(), retentionDays: 30 }
}

export async function readAiAnswerReview(db: Database, tenantId: string, id: string, now = new Date()) {
  const row = await db.aiInteraction.findFirst({ where: { ...available(tenantId, now), id }, select })
  if (!row) throw new AiReviewError(404, "AI_REVIEW_NOT_FOUND")
  try { return { ...metadata(row), details: decryptReviewDetails(row, row, now) } }
  catch { throw new AiReviewError(410, "AI_REVIEW_DETAILS_UNAVAILABLE") }
}
export async function updateAiAnswerReview(db: Database, tenantId: string, id: string, actorId: string, input: z.infer<typeof AiReviewUpdateSchema>, now = new Date()) {
  await readAiAnswerReview(db, tenantId, id, now)
  const result = await db.aiInteraction.updateMany({ where: { ...available(tenantId, now), id, reviewRevision: input.revision }, data: { reviewedAt: input.reviewed ? now : null, reviewedById: input.reviewed ? actorId : null, reviewRevision: { increment: 1 } } })
  const review = await readAiAnswerReview(db, tenantId, id, now)
  if (!result.count && Boolean(review.reviewedAt) !== input.reviewed) throw new AiReviewError(409, "AI_REVIEW_CHANGED")
  return review
}
export async function purgeExpiredAiReviews(db: Database, now = new Date()) {
  return db.aiInteraction.updateMany({ where: { reviewExpiresAt: { lte: now }, reviewCiphertext: { not: null } }, data: emptyReviewDetails })
}
