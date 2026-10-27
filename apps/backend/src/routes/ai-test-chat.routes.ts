import { Router, type ErrorRequestHandler } from "express"
import { z } from "zod"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js"
import { enforceSameOrigin } from "../lib/security.js"
import { prisma } from "../lib/prisma.js"
import { recordAiInteraction } from "../lib/ai-analytics.js"
import { AiReplyLimit } from "../lib/ai-reply-limit.js"
import {
  AiChatError,
  AiTestChatInputSchema,
  getAiChatProvider,
  loadAiChatSnapshot,
  replyToAiTestChat,
} from "../lib/ai-test-chat.js"

type Dependencies = {
  load: typeof loadAiChatSnapshot
  getProvider: typeof getAiChatProvider
  now: () => number
  recordActivity: typeof recordAiInteraction
}
export function createAiTestChatRouter(
  dependencies: Partial<Dependencies> = {},
) {
  const {
    load = loadAiChatSnapshot,
    getProvider = getAiChatProvider,
    now = Date.now,
    recordActivity = recordAiInteraction,
  } = dependencies
  const router = Router()
  const limit = new AiReplyLimit()
  const path = "/:tenantId/ai/test-chat"
  const tenantPath = z.object({ tenantId: z.uuid() })
  router.use(
    path,
    requireAuth,
    requireTenantAdmin({
      tenantIdLookups: [{ source: "params", key: "tenantId" }],
    }),
  )
  router.get(path, (req, res) => {
    tenantPath.parse(req.params)
    res.setHeader("Cache-Control", "no-store")
    res.json({ ok: true, available: getProvider() !== null })
  })
  router.post(`${path}/messages`, async (req, res) => {
    enforceSameOrigin(req)
    const { tenantId } = tenantPath.parse(req.params)
    const input = AiTestChatInputSchema.parse(req.body)
    const provider = getProvider()
    if (!provider) throw new AiChatError(503, "AI_PROVIDER_UNAVAILABLE")
    const key = `${tenantId}:${(req as unknown as AuthedRequest).user.id}`
    const release = limit.acquire(key, now())
    if (!release) {
      res.setHeader("Retry-After", "60")
      throw new AiChatError(429, "AI_CHAT_RATE_LIMITED")
    }
    const controller = new AbortController()
    const disconnected = () => {
      if (!res.writableEnded) controller.abort()
    }
    res.once("close", disconnected)
    try {
      const snapshot = await load(prisma, tenantId, input)
      const reply = await replyToAiTestChat(
        snapshot,
        input,
        provider,
        controller.signal,
      )
      if (controller.signal.aborted) return
      await recordActivity(prisma, {
        tenantId,
        actorId: (req as unknown as AuthedRequest).user.id,
        channel: "TEST",
        conversationId: input.conversationId,
        requestId: input.requestId,
        questionOutcome: reply.outcome,
        qualificationRun: false,
      })
      res.setHeader("Cache-Control", "no-store")
      res.json({ ok: true, reply })
    } finally {
      release()
      res.removeListener("close", disconnected)
    }
  })
  const handleError: ErrorRequestHandler = (error, _req, res, next) => {
    if (!(error instanceof AiChatError)) return next(error)
    res.setHeader("Cache-Control", "no-store")
    res.status(error.status).json({ error: error.code })
  }
  router.use(handleError)
  return router
}
export default createAiTestChatRouter()
