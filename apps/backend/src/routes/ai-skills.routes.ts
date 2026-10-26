import { Router, type ErrorRequestHandler } from "express"
import { z } from "zod"
import { requireAuth } from "../middleware/requireAuth.js"
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js"
import { enforceSameOrigin } from "../lib/security.js"
import { prisma } from "../lib/prisma.js"
import { ServiceCollectionError } from "../lib/service-configuration-collections.js"
import {
  AiQualificationUpdateSchema,
  AiSkillError,
  listAiSkills,
  readAiSkill,
  saveAiQualification,
} from "../lib/ai-skills.js"

const router = Router()
const tenantPath = z.object({ tenantId: z.uuid() })
const skillPath = tenantPath.extend({ skillId: z.uuid() })
router.use(
  "/:tenantId/ai/skills",
  requireAuth,
  requireTenantAdmin({
    tenantIdLookups: [{ source: "params", key: "tenantId" }],
  }),
  (req, _res, next) => {
    tenantPath.parse(req.params)
    if (req.method !== "GET") enforceSameOrigin(req)
    next()
  },
)
router.get("/:tenantId/ai/skills", async (req, res) => {
  const { tenantId } = tenantPath.parse(req.params)
  res.json({ ok: true, ...(await listAiSkills(prisma, tenantId)) })
})
router.get("/:tenantId/ai/skills/:skillId", async (req, res) => {
  const { tenantId, skillId } = skillPath.parse(req.params)
  res.json({ ok: true, ...(await readAiSkill(prisma, tenantId, skillId)) })
})
router.patch(
  "/:tenantId/ai/skills/:skillId/qualification",
  async (req, res) => {
    const { tenantId, skillId } = skillPath.parse(req.params)
    res.json({
      ok: true,
      ...(await saveAiQualification(
        prisma,
        tenantId,
        skillId,
        AiQualificationUpdateSchema.parse(req.body),
      )),
    })
  },
)
const handleError: ErrorRequestHandler = (error, _req, res, next) => {
  if (
    error instanceof AiSkillError ||
    error instanceof ServiceCollectionError
  ) {
    res.status(error.status).json({
      error: error.code,
      ...(error instanceof AiSkillError && error.details
        ? { details: error.details }
        : {}),
    })
    return
  }
  next(error)
}
router.use(handleError)
export default router
