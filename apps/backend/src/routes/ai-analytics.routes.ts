import { Router } from "express"
import { z } from "zod"
import { requireAuth } from "../middleware/requireAuth.js"
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js"
import { prisma } from "../lib/prisma.js"
import { AiAnalyticsQuerySchema, loadAiAnalytics } from "../lib/ai-analytics.js"
import type { PrismaClient } from "../generated/prisma/index.js"

export function createAiAnalyticsRouter({ db = prisma, now = () => new Date() }: { db?: Pick<PrismaClient, "$queryRaw">; now?: () => Date } = {}) {
  const router = Router()
  router.get("/:tenantId/ai/analytics", requireAuth,
    requireTenantAdmin({ tenantIdLookups: [{ source: "params", key: "tenantId" }] }),
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store")
      const { tenantId } = z.object({ tenantId: z.uuid() }).parse(req.params)
      const query = AiAnalyticsQuerySchema.parse(req.query)
      res.json({ ok: true, analytics: await loadAiAnalytics(db, tenantId, query, now()) })
    },
  )
  return router
}
export default createAiAnalyticsRouter()
