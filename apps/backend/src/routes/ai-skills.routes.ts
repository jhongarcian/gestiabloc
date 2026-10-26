import { Router, type ErrorRequestHandler } from "express"
import { z } from "zod"
import { requireAuth } from "../middleware/requireAuth.js"
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js"
import { enforceSameOrigin } from "../lib/security.js"
import { prisma } from "../lib/prisma.js"
import { ServiceCollectionError } from "../lib/service-configuration-collections.js"
import { AiKnowledgeUpdateSchema } from "../lib/ai-knowledge.js"
import {
  AiFaqMutationSchema,
  AiFaqDeleteSchema,
  AiFaqOrderSchema,
  readAiFaqs,
  mutateAiFaqs,
  saveAiKnowledge,
} from "../lib/ai-skill-content.js"
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
const faqPath = skillPath.extend({ faqId: z.uuid() })
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
router.get("/:tenantId/ai/skills/:skillId/faqs", async (req, res) => {
  const { tenantId, skillId } = skillPath.parse(req.params)
  res.setHeader("Cache-Control", "no-store")
  res.json({ ok: true, ...(await readAiFaqs(prisma, tenantId, skillId)) })
})
router.post("/:tenantId/ai/skills/:skillId/faqs", async (req, res) => {
  const { tenantId, skillId } = skillPath.parse(req.params)
  res.status(201).json({
    ok: true,
    ...(await mutateAiFaqs(prisma, tenantId, skillId, {
      ...AiFaqMutationSchema.parse(req.body),
      action: "create",
    })),
  })
})
router.put("/:tenantId/ai/skills/:skillId/faqs/order", async (req, res) => {
  const { tenantId, skillId } = skillPath.parse(req.params)
  res.json({
    ok: true,
    ...(await mutateAiFaqs(prisma, tenantId, skillId, {
      ...AiFaqOrderSchema.parse(req.body),
      action: "order",
    })),
  })
})
router.patch("/:tenantId/ai/skills/:skillId/faqs/:faqId", async (req, res) => {
  const { tenantId, skillId, faqId } = faqPath.parse(req.params)
  res.json({
    ok: true,
    ...(await mutateAiFaqs(prisma, tenantId, skillId, {
      ...AiFaqMutationSchema.parse(req.body),
      action: "update",
      id: faqId,
    })),
  })
})
router.delete("/:tenantId/ai/skills/:skillId/faqs/:faqId", async (req, res) => {
  const { tenantId, skillId, faqId } = faqPath.parse(req.params)
  res.json({
    ok: true,
    ...(await mutateAiFaqs(prisma, tenantId, skillId, {
      ...AiFaqDeleteSchema.parse(req.body),
      action: "delete",
      id: faqId,
    })),
  })
})
router.patch("/:tenantId/ai/skills/:skillId/knowledge", async (req, res) => {
  const { tenantId, skillId } = skillPath.parse(req.params)
  res.json({
    ok: true,
    ...(await saveAiKnowledge(
      prisma,
      tenantId,
      skillId,
      AiKnowledgeUpdateSchema.parse(req.body),
    )),
  })
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
