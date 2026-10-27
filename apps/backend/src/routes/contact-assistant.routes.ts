import { Router, type Response } from "express"
import { z } from "zod"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"
import { enforceSameOrigin } from "../lib/security.js"
import { prisma } from "../lib/prisma.js"
import { AiTrackingFields, recordAiInteraction } from "../lib/ai-analytics.js"
import { answerContactAssistant, type ContactAssistantInput } from "../lib/ai-contact-assistant.js"
import { loadAiHelperIdentity } from "../lib/ai-helper-identity.js"
import { AiReplyLimit } from "../lib/ai-reply-limit.js"
import { AiTestChatInputSchema } from "../lib/ai-helper-replies.js"
import { presentContactScanItems, resolveContactServiceScope, type ContactAssistantContext } from "../lib/contact-assistant-context.js"

const tenantPath = z.object({ tenantId: z.string().trim().min(1) })
const assistantBody = z.object({
  ...AiTrackingFields,
  contactId: z.string().trim().min(1),
  serviceId: z.string().trim().min(1).optional(),
  scope: z.enum(["all", "service"]).default("service"),
  question: z.string().trim().min(1).max(500).optional().nullable(),
  history: AiTestChatInputSchema.shape.history,
}).strict()
type ScanResult = { error: string; items?: never } | { error?: never; items: ContactAssistantInput["items"]; contactContext?: ContactAssistantContext }
type Dependencies = {
  requireMembership: (req: AuthedRequest, res: Response, tenantId: string) => Promise<unknown | null>
  evaluate: (input: { tenantId: string; contactId: string; serviceId?: string; explainWithAi?: boolean; includeContactContext?: boolean }) => Promise<ScanResult>
  reply?: typeof answerContactAssistant
  identity?: typeof loadAiHelperIdentity
  record?: typeof recordAiInteraction
  now?: () => number
}

export function createContactAssistantRouter(dependencies: Dependencies) {
  const { requireMembership, evaluate, reply = answerContactAssistant,
    identity = loadAiHelperIdentity, record = recordAiInteraction, now = Date.now } = dependencies
  const router = Router()
  const limit = new AiReplyLimit()

  router.get("/:tenantId/fit-scan/helper", requireAuth, async (req, res) => {
    const { tenantId } = tenantPath.parse(req.params)
    if (!await requireMembership(req as AuthedRequest, res, tenantId)) return
    res.setHeader("Cache-Control", "no-store")
    res.json({ ok: true, helper: await identity(prisma, tenantId) })
  })

  router.post("/:tenantId/fit-scan/run", requireAuth, async (req, res) => {
    enforceSameOrigin(req)
    const authed = req as AuthedRequest
    const { tenantId } = tenantPath.parse(req.params)
    const payload = z.object({ contactId: z.string().trim().min(1), ...AiTrackingFields }).strict().parse(req.body)
    if (!await requireMembership(authed, res, tenantId)) return
    const result = await evaluate({ tenantId, contactId: payload.contactId, explainWithAi: false, includeContactContext: true })
    if (!result.items) return res.status(404).json({ error: result.error })
    await record(prisma, {
      tenantId, actorId: authed.user.id, channel: "CONTACT_ASSISTANT",
      conversationId: payload.conversationId, requestId: payload.requestId,
      questionOutcome: null, qualificationRun: true,
    })
    res.setHeader("Cache-Control", "no-store")
    res.json({ ok: true, items: presentContactScanItems(result.items, result.contactContext), helper: await identity(prisma, tenantId) })
  })

  router.post("/:tenantId/fit-scan/assistant", requireAuth, async (req, res) => {
    enforceSameOrigin(req)
    const authed = req as AuthedRequest
    const { tenantId } = tenantPath.parse(req.params)
    const payload = assistantBody.parse(req.body)
    AiTestChatInputSchema.parse({ question: payload.question ?? "Review this service", history: payload.history })
    if (!await requireMembership(authed, res, tenantId)) return
    const controller = new AbortController()
    const disconnected = () => { if (!res.writableEnded) controller.abort() }
    res.once("close", disconnected)
    let release: (() => void) | null = null
    try {
      const result = await evaluate({
        tenantId, contactId: payload.contactId,
        explainWithAi: false, includeContactContext: true,
      })
      if (!result.items) return res.status(404).json({ error: result.error })
      const available = result.contactContext?.skills ?? result.items
      const selectedId = payload.question
        ? resolveContactServiceScope(payload.question, available, payload.scope === "service" ? payload.serviceId : undefined)
        : payload.scope === "service" ? payload.serviceId : undefined
      const service = selectedId ? available.find((item) => item.serviceId === selectedId) : null
      if (selectedId && !service) return res.status(404).json({ error: "SERVICE_NOT_FOUND" })
      const scope = service ? "service" : "all"
      if (controller.signal.aborted) return
      const usesKnowledge = Boolean(payload.question)
      if (usesKnowledge) release = limit.acquire(`${tenantId}:${authed.user.id}`, now())
      const answer = await reply(prisma, tenantId, {
        items: result.items, scope, serviceId: service?.serviceId, question: payload.question,
        contactContext: result.contactContext, history: payload.history,
      }, controller.signal, usesKnowledge && !release ? { getProvider: () => null } : {})
      if (controller.signal.aborted) return
      await record(prisma, {
        tenantId, actorId: authed.user.id, channel: "CONTACT_ASSISTANT",
        conversationId: payload.conversationId, requestId: payload.requestId,
        questionOutcome: payload.question ? answer.outcome ?? "NEEDS_REVIEW" : null,
        qualificationRun: true,
      })
      res.setHeader("Cache-Control", "no-store")
      res.json({
        ok: true, helper: await identity(prisma, tenantId), items: presentContactScanItems(result.items, result.contactContext),
        scope: { mode: scope, serviceId: service?.serviceId ?? null, serviceName: service?.serviceName ?? null }, answer
      })
    } finally {
      release?.()
      res.removeListener("close", disconnected)
    }
  })
  return router
}
