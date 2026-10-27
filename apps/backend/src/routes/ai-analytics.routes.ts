import { Router } from "express"
import { z } from "zod"
import { requireAuth } from "../middleware/requireAuth.js"
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js"
import { prisma } from "../lib/prisma.js"
import { AiAnalyticsQuerySchema, loadAiAnalytics } from "../lib/ai-analytics.js"

const router = Router()
router.get("/:tenantId/ai/analytics", requireAuth,
  requireTenantAdmin({ tenantIdLookups: [{ source: "params", key: "tenantId" }] }),
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store")
    const { tenantId } = z.object({ tenantId: z.uuid() }).parse(req.params)
    const query = AiAnalyticsQuerySchema.parse(req.query)
    res.json({ ok: true, analytics: await loadAiAnalytics(prisma, tenantId, query) })
  },
)
export default router
