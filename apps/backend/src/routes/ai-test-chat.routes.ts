import { aiUsageContext } from "../lib/ai-provider-usage.js"
import { createAiReplyExecutor } from "../lib/ai-credit-execution.js"
import { AiCreditError } from "../lib/ai-credit-wallet.js"
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
  execute: typeof createAiReplyExecutor
}
export function createAiTestChatRouter(
  dependencies: Partial<Dependencies> = {},
) {
  const {
    load = loadAiChatSnapshot,
    getProvider = getAiChatProvider,
    now = Date.now,
    recordActivity = recordAiInteraction,
    execute = createAiReplyExecutor,
  } = dependencies
  const router = Router()
  const limit = new AiReplyLimit()
  const path = "/:tenantId/ai/test-chat"
  const tenantPath = z.object({ tenantId: z.uuid() })
  router.use(
    path,
    requireAuth,
    aiUsageContext("TEST"),
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
    const controller = new AbortController()
    const disconnected = () => {
      if (!res.writableEnded) controller.abort()
    }
    res.once("close", disconnected)
    try {
      const snapshot = await load(prisma, tenantId, input)
      const run = execute(prisma, { tenantId, actorId: (req as unknown as AuthedRequest).user.id, channel: "TEST", requestId: input.requestId, conversationId: input.conversationId }, { signal: controller.signal })
      const reply = await run({ snapshot, input }, async () => {
        const release = limit.acquire(key, now())
        if (!release) {
          res.setHeader("Retry-After", "60")
          throw new AiChatError(429, "AI_CHAT_RATE_LIMITED")
        }
        try { return await replyToAiTestChat(snapshot, input, provider, controller.signal) }
        finally { release() }
      }, provider.modelReference ?? provider.model)
      if (controller.signal.aborted) return
      await recordActivity(prisma, {
        tenantId,
        actorId: (req as unknown as AuthedRequest).user.id,
        channel: "TEST",
        conversationId: input.conversationId,
        requestId: input.requestId,
        questionOutcome: reply.outcome,
        qualificationRun: false,
        reviewReason: reply.reviewReason,
        review: { question: input.question, answer: reply.answer, sourceLabels: reply.sources.map(source => source.label.slice(0, 320)) },
      })
      res.setHeader("Cache-Control", "no-store")
      res.json({ ok: true, reply })
    } finally {
      res.removeListener("close", disconnected)
    }
  })
  const handleError: ErrorRequestHandler = (error, _req, res, next) => {
    if (!(error instanceof AiChatError) && !(error instanceof AiCreditError)) return next(error)
    if (error.code === "AI_REQUEST_IN_PROGRESS") res.setHeader("Retry-After", "2")
    res.setHeader("Cache-Control", "no-store")
    res.status(error.status).json({ error: error.code })
  }
  router.use(handleError)
  return router
}
export default createAiTestChatRouter()
