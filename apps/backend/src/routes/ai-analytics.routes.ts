import { Router, type ErrorRequestHandler } from "express"
import { z } from "zod"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js"
import { prisma } from "../lib/prisma.js"
import { AiAnalyticsQuerySchema, loadAiAnalytics } from "../lib/ai-analytics.js"
import type { PrismaClient } from "../generated/prisma/index.js"
import { enforceSameOrigin } from "../lib/security.js"
import { AiReviewError, AiReviewListQuerySchema, AiReviewUpdateSchema, listAiAnswerReviews, readAiAnswerReview, updateAiAnswerReview } from "../lib/ai-answer-reviews.js"

export function createAiAnalyticsRouter({ db = prisma, now = () => new Date() }: { db?: Pick<PrismaClient, "$queryRaw"> & Partial<Pick<PrismaClient, "aiInteraction">>; now?: () => Date } = {}) {
  const router = Router()
  const admin = requireTenantAdmin({ tenantIdLookups: [{ source: "params", key: "tenantId" }] })
  const reviewDb = () => {
    if (!db.aiInteraction) throw new AiReviewError(503, "AI_REVIEWS_UNAVAILABLE")
    return { aiInteraction: db.aiInteraction }
  }
  const reviewPath = "/:tenantId/ai/analytics/reviews"
  router.use(reviewPath, requireAuth, admin, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next() })
  router.get(reviewPath, async (req, res) => {
    const { tenantId } = z.object({ tenantId: z.uuid() }).parse(req.params)
    res.json({ ok: true, reviews: await listAiAnswerReviews(reviewDb(), tenantId, AiReviewListQuerySchema.parse(req.query), now()) })
  })
  router.get(`${reviewPath}/:id`, async (req, res) => {
    const { tenantId, id } = z.object({ tenantId: z.uuid(), id: z.uuid() }).parse(req.params)
    res.json({ ok: true, review: await readAiAnswerReview(reviewDb(), tenantId, id, now()) })
  })
  router.patch(`${reviewPath}/:id`, async (req, res) => {
    enforceSameOrigin(req)
    const { tenantId, id } = z.object({ tenantId: z.uuid(), id: z.uuid() }).parse(req.params)
    res.json({ ok: true, review: await updateAiAnswerReview(reviewDb(), tenantId, id, (req as unknown as AuthedRequest).user.id, AiReviewUpdateSchema.parse(req.body), now()) })
  })
  router.get("/:tenantId/ai/analytics", requireAuth,
    requireTenantAdmin({ tenantIdLookups: [{ source: "params", key: "tenantId" }] }),
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store")
      const { tenantId } = z.object({ tenantId: z.uuid() }).parse(req.params)
      const query = AiAnalyticsQuerySchema.parse(req.query)
      res.json({ ok: true, analytics: await loadAiAnalytics(db, tenantId, query, now()) })
    },
  )
  router.use(((error, _req, res, next) => {
    if (!(error instanceof AiReviewError)) return next(error)
    res.setHeader("Cache-Control", "no-store")
    res.status(error.status).json({ error: error.code })
  }) satisfies ErrorRequestHandler)
  return router
}
export default createAiAnalyticsRouter()
