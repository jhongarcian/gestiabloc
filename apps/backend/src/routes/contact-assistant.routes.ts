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
import { ContactCaseError, ContactCasesQuerySchema, CaseHistoryQuerySchema, listContactCases, loadContactCase, isContactCaseQuestion } from "../lib/ai-contact-cases.js"

const tenantPath = z.object({ tenantId: z.string().trim().min(1) })
const assistantBody = z.object({
  ...AiTrackingFields,
  contactId: z.string().trim().min(1),
  serviceId: z.string().trim().min(1).optional(),
  scope: z.enum(["all", "service", "case"]).default("service"),
  contactServiceId: z.string().trim().min(1).optional(),
  compareContactServiceIds: z.array(z.string().trim().min(1)).min(2).max(5).refine((ids) => new Set(ids).size === ids.length).optional(),
  caseHistory: CaseHistoryQuerySchema.optional(),
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
  listCases?: typeof listContactCases
  loadCase?: typeof loadContactCase
}

export function createContactAssistantRouter(dependencies: Dependencies) {
  const { requireMembership, evaluate, reply = answerContactAssistant,
    identity = loadAiHelperIdentity, record = recordAiInteraction, now = Date.now,
    listCases = listContactCases, loadCase = loadContactCase } = dependencies
  const router = Router()
  const limit = new AiReplyLimit()

  router.get("/:tenantId/fit-scan/cases", requireAuth, async (req, res) => {
    const { tenantId } = tenantPath.parse(req.params)
    const query = ContactCasesQuerySchema.parse(req.query)
    if (!await requireMembership(req as AuthedRequest, res, tenantId)) return
    try {
      const data = await listCases(prisma, tenantId, query)
      res.setHeader("Cache-Control", "no-store")
      res.json({ ok: true, ...data })
    } catch (error) {
      if (error instanceof ContactCaseError) return res.status(404).json({ error: error.message })
      throw error
    }
  })

  router.get("/:tenantId/fit-scan/cases/:contactServiceId", requireAuth, async (req, res) => {
    const { tenantId } = tenantPath.parse(req.params)
    const { contactId, ...history } = z.object({ contactId: z.string().trim().min(1), ...CaseHistoryQuerySchema.shape }).strict().parse(req.query)
    if (!await requireMembership(req as AuthedRequest, res, tenantId)) return
    try {
      const item = await loadCase(prisma, tenantId, contactId, String(req.params.contactServiceId), history)
      res.setHeader("Cache-Control", "no-store")
      res.json({ ok: true, item })
    } catch (error) {
      if (error instanceof ContactCaseError) return res.status(404).json({ error: error.message })
      throw error
    }
  })

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
      if (payload.scope === "case" || payload.contactServiceId || payload.compareContactServiceIds || (payload.question && isContactCaseQuestion(payload.question))) {
        const catalog = await listCases(prisma, tenantId, ContactCasesQuerySchema.parse({ contactId: payload.contactId, pageSize: 25 }))
        let selected = payload.contactServiceId ? await loadCase(prisma, tenantId, payload.contactId, payload.contactServiceId, payload.caseHistory) : null
        if (selected && payload.serviceId && payload.serviceId !== selected.serviceId) return res.status(404).json({ error: "CONTACT_SERVICE_NOT_FOUND" })
        const serviceId = payload.question
          ? resolveContactServiceScope(payload.question, catalog.services, selected?.serviceId ?? payload.serviceId)
          : selected?.serviceId ?? payload.serviceId
        if (serviceId && !catalog.services.some((service) => service.serviceId === serviceId)) return res.status(404).json({ error: "SERVICE_NOT_FOUND" })
        if (selected && serviceId !== selected.serviceId) selected = null
        const candidates = serviceId ? await listCases(prisma, tenantId, ContactCasesQuerySchema.parse({ contactId: payload.contactId, serviceId, pageSize: 25 })) : catalog
        const compare = Boolean(payload.compareContactServiceIds || (payload.question && /\b(compar\w*|both|all purchases|all cases|ambos|ambas)\b/i.test(payload.question)))
        // A selected case remains selected for follow-ups. Broader comparisons
        // require an explicit request and never silently select the latest case.
        const cases = payload.compareContactServiceIds
          ? await Promise.all(payload.compareContactServiceIds.map((id) => loadCase(prisma, tenantId, payload.contactId, id, payload.caseHistory)))
          : compare && candidates.pagination.total <= 5
          ? await Promise.all(candidates.items.map((item) => loadCase(prisma, tenantId, payload.contactId, item.contactServiceId, payload.caseHistory)))
          : compare ? [] : selected ? [selected] : candidates.pagination.total === 1 && candidates.items[0]
            ? [await loadCase(prisma, tenantId, payload.contactId, candidates.items[0].contactServiceId, payload.caseHistory)] : []
        const qualificationQuestion = Boolean(payload.question && /\b(qualif\w*|eligib\w*|elegib\w*|calific\w*)\b/i.test(payload.question))
        const changedToProspectiveService = Boolean(!cases.length && candidates.pagination.total === 0 && serviceId && payload.question && !isContactCaseQuestion(payload.question))
        const qualification = qualificationQuestion || changedToProspectiveService
          ? await evaluate({ tenantId, contactId: payload.contactId, explainWithAi: false, includeContactContext: true }) : null
        if (qualification && !qualification.items) return res.status(404).json({ error: qualification.error })
        const qualificationOnly = Boolean(!cases.length && qualification?.items)
        if (controller.signal.aborted) return
        if (payload.question && (cases.length || qualificationOnly)) release = limit.acquire(`${tenantId}:${authed.user.id}`, now())
        const mode = qualificationOnly ? serviceId ? "service" : "all" : "case"
        const answer = cases.length || qualificationOnly
          ? await reply(prisma, tenantId, { items: qualification?.items ?? [], contactContext: qualification?.contactContext, scope: mode, serviceId, cases: cases.length ? cases : undefined, question: payload.question, history: payload.history }, controller.signal,
            payload.question && !release ? { getProvider: () => null } : {})
          : { title: "Purchased services", summary: candidates.pagination.total
            ? `There are ${candidates.pagination.total} matching purchases. ${compare ? "Compare up to five purchases at a time. " : ""}Which purchase would you like to review? Choose by date, status and reference below.`
            : "No purchased cases were found for this contact in the selected service scope.", bullets: [], suggestedQuestions: [], outcome: "ANSWERED" as const, replySource: "CASE" as const }
        if (controller.signal.aborted) return
        await record(prisma, { tenantId, actorId: authed.user.id, channel: "CONTACT_ASSISTANT", conversationId: payload.conversationId, requestId: payload.requestId,
          questionOutcome: payload.question ? answer.outcome ?? "NEEDS_REVIEW" : null, qualificationRun: Boolean(qualification) })
        res.setHeader("Cache-Control", "no-store")
        return res.json({ ok: true, helper: await identity(prisma, tenantId), ...(qualification?.items ? { items: presentContactScanItems(qualification.items, qualification.contactContext) } : {}),
          scope: { mode, serviceId: cases[0]?.serviceId ?? serviceId ?? null, serviceName: cases[0]?.serviceName ?? catalog.services.find((service) => service.serviceId === serviceId)?.serviceName ?? null,
            contactServiceId: cases.length === 1 ? cases[0]!.contactServiceId : null },
          selectedCase: cases.length === 1 ? cases[0] : null, caseChoices: cases.length || qualificationOnly ? [] : candidates.items, casePagination: candidates.pagination, comparedCases: cases.length > 1 ? cases : [], answer })
      }
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
    } catch (error) {
      if (error instanceof ContactCaseError) return res.status(404).json({ error: error.message })
      throw error
    } finally {
      release?.()
      res.removeListener("close", disconnected)
    }
  })
  return router
}
