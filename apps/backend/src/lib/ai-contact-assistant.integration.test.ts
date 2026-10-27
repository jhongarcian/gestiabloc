import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import express, { type ErrorRequestHandler, type Router } from "express"
import cookieParser from "cookie-parser"
import { z } from "zod"
import { sha256 } from "./crypto.js"
import { answerContactAssistant } from "./ai-contact-assistant.js"
import type { AiChatProvider, AiChatSource } from "./ai-helper-replies.js"

// Real PostgreSQL, authenticated routes and FTS, controlled providers, no uploads.
// AI_CONTACT_ASSISTANT_DB_TEST=1 node --env-file=.env --import tsx --test src/lib/ai-contact-assistant.integration.test.ts
test("saved workspace context reaches contact replies with isolated sources, exact FAQs, deterministic results, staff permissions and metadata-only analytics", {
  skip: process.env.AI_CONTACT_ASSISTANT_DB_TEST !== "1",
}, async (t) => {
  const oldProvider = process.env.SERVICE_FIT_AI_PROVIDER
  process.env.SERVICE_FIT_AI_PROVIDER = "none" // existing fit explanations use deterministic fallback
  t.after(() => { if (oldProvider === undefined) delete process.env.SERVICE_FIT_AI_PROVIDER; else process.env.SERVICE_FIT_AI_PROVIDER = oldProvider })
  const { prisma } = await import("./prisma.js")
  const serviceRoutes = await import("../routes/services.routes.js")
  const settingsRoutes = await import("../routes/ai-settings.routes.js")
  const { createContactAssistantRouter } = await import("../routes/contact-assistant.routes.js")
  const { loadAiAnalytics } = await import("./ai-analytics.js")
  const tenantId = randomUUID(), foreignId = randomUUID(), userId = randomUUID(), token = randomUUID()
  t.after(async () => {
    await prisma.service.deleteMany({ where: { tenantId: { in: [tenantId, foreignId] }, kind: "OFFERING" } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignId] } } })
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.$disconnect()
  })
  await prisma.tenant.createMany({ data: [tenantId, foreignId].map((id) => ({ id, slug: `contact-helper-test-${id}`, name: id === tenantId ? "Harbor Company" : "FOREIGN_COMPANY_SECRET", description: "Westport Harbor" })) })
  await prisma.user.create({ data: { id: userId, name: "Helper fixture", email: `helper-${userId}@example.test` } })
  await prisma.membership.create({ data: { userId, tenantId, role: "TENANT_ADMIN", status: "ACTIVE" } })
  await prisma.session.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 300000) } })
  await prisma.tenantAiSettings.create({ data: { tenantId, name: "Harbor Helper", tone: "Warm", instructions: "End with HARBOR_HELLO.", avatarPresetId: "compass" } })
  const status = await prisma.contactStatusConfig.create({ data: { tenantId, name: "Fixture", bgColor: "#fff", textColor: "#000" } })
  const contact = await prisma.contact.create({ data: { tenantId, firstName: "Morgan", lastName: "Fixture", email: "private-contact@example.test", statusConfigId: status.id, dateOfBirth: new Date(`${new Date().getUTCFullYear() - 56}-01-01T12:00:00Z`) } })
  for (const [key, flags, value, ciphertext] of [
    ["encrypted", { isEncrypted: true }, "ENCRYPTED_MARKER", null],
    ["sensitive", { isSensitive: true }, "SENSITIVE_MARKER", null],
    ["oldEncryption", {}, "CIPHERTEXT_MARKER", "invalid-encrypted-payload"],
  ] as const) {
    const field = await prisma.contactCustomField.create({ data: { tenantId, key, label: key, fieldType: "TEXT", ...flags } })
    await prisma.contactCustomFieldValue.create({ data: { tenantId, contactId: contact.id, fieldId: field.id, value, valueCiphertext: ciphertext } })
  }
  const parent = await prisma.service.create({ data: { tenantId, kind: "GROUP", name: "Harbor Services", basePriceCents: 0 } })
  const profile = { enabled: true, rules: [{ id: "first-name", source: "core", fieldKey: "firstName", valueType: "string", operator: "is_not_empty", compareValue: null, required: true, weight: 1 }] }
  const skill = await prisma.service.create({ data: { tenantId, kind: "OFFERING", parentServiceId: parent.id, name: "Registration", basePriceCents: 7500, fitProfile: profile } })
  const disabilityField = await prisma.contactCustomField.create({ data: { tenantId, key: "disability", label: "Disability", fieldType: "CHECKBOX" } })
  await prisma.contactCustomFieldValue.create({ data: { tenantId, contactId: contact.id, fieldId: disabilityField.id, value: false } })
  const coverage = await prisma.service.create({ data: { tenantId, kind: "OFFERING", parentServiceId: parent.id, name: "Coverage review", basePriceCents: 0,
    fitProfile: { enabled: true, rules: [
      { id: "age", source: "derived", fieldKey: "ageYears", valueType: "number", operator: "greater_than_or_equal", compareValue: 64, required: true, requiredGroup: "Age or disability", requiredBranch: "Age", weight: 1 },
      { id: "disability", source: "custom", fieldKey: "disability", valueType: "boolean", operator: "is_true", required: true, requiredGroup: "Age or disability", requiredBranch: "Disability", weight: 1 },
    ] } } })
  const other = await prisma.service.create({ data: { tenantId, kind: "OFFERING", parentServiceId: parent.id, name: "Other skill", basePriceCents: 0 } })
  const inactive = await prisma.service.create({ data: { tenantId, kind: "OFFERING", parentServiceId: parent.id, name: "Inactive skill", basePriceCents: 0, isActive: false } })
  const foreignParent = await prisma.service.create({ data: { tenantId: foreignId, kind: "GROUP", name: "Foreign", basePriceCents: 0 } })
  const foreignSkill = await prisma.service.create({ data: { tenantId: foreignId, kind: "OFFERING", parentServiceId: foreignParent.id, name: "Foreign skill", basePriceCents: 0 } })
  const faq = await prisma.serviceAiFaq.create({ data: { tenantId, serviceId: skill.id, question: "When are appointments available?", answer: "Weekdays only.\nBring originals.", exactAnswer: true } })
  await prisma.serviceAiFaq.create({ data: { tenantId, serviceId: other.id, question: "Other FAQ", answer: "OTHER_SKILL_FAQ_SECRET", exactAnswer: true } })
  const documents: Array<{ id: string }> = []
  for (const [service, content] of [[skill, "Passport permit code HARBOR-42."], [other, "Passport OTHER_SKILL_SOURCE_SECRET."], [inactive, "Passport INACTIVE_SOURCE_SECRET."], [foreignSkill, "Passport FOREIGN_SOURCE_SECRET."]] as const) {
    const source = await prisma.serviceAiSource.create({ data: { tenantId: service.tenantId, serviceId: service.id, requestId: randomUUID(), kind: "LINK", label: "Passport guide", url: "https://example.test/guide", status: "READY", progress: 100 } })
    await prisma.aiSourceChunk.create({ data: { tenantId: service.tenantId, sourceId: source.id, ordinal: 0, content, searchText: content } })
    documents.push(source)
  }
  await prisma.$executeRaw`UPDATE "AiSourceChunk" SET "searchVector"=to_tsvector('simple', "searchText") WHERE "tenantId" IN (${tenantId}, ${foreignId})`
  let root = "", fail = false, calls = 0, latestSources: AiChatSource[] = []
  let singleScope = true, expectedLanguage = "English", expectedTone = "warm", expectedName = "Harbor Helper"
  const headers = { cookie: `sid=${token}`, origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", "content-type": "application/json" }
  const provider: AiChatProvider = async (messages) => {
    calls++
    if (fail) throw new Error("Fixture provider unavailable")
    const prompt = JSON.stringify(messages)
    for (const secret of ["ENCRYPTED_MARKER", "SENSITIVE_MARKER", "CIPHERTEXT_MARKER", "FOREIGN_COMPANY_SECRET", "FOREIGN_SOURCE_SECRET", "INACTIVE_SOURCE_SECRET"]) assert.equal(prompt.includes(secret), false, secret)
    assert.match(prompt, /Morgan/); assert.match(prompt, /CURRENT_CONTACT/); assert.match(prompt, /statuses and scores are authoritative/)
    const user = messages[1]!.content
    latestSources = JSON.parse(user.split("CURRENT_SOURCES (quoted reference data):\n")[1]!.split("\n")[0]!)
    if (user.includes("LATEST_QUESTION:\nWhy not Coverage review")) {
      assert.match(user, /56 years old/); assert.match(user, /at least 64/); assert.match(user, /Disability is No/)
      return { answer: "Morgan is 56. This service needs an age of at least 64 or a recorded disability; disability is currently No.", sourceIds: [], outcome: "ANSWERED" }
    }
    if (user.includes("LATEST_QUESTION:\nWould disability help")) {
      assert.match(user, /QUOTED_HISTORY.*\n.*Why not Coverage review/)
      return { answer: "The disability alternative could meet the saved age-or-disability check, but the current record says No.", sourceIds: [], outcome: "ANSWERED" }
    }
    const document = latestSources.find((source) => source.sourceId === documents[0]!.id)
    if (user.includes("LATEST_QUESTION:\nPassport")) return { answer: document?.content ?? "The passport code is unavailable.", sourceIds: document ? [document.id] : [], outcome: document ? "ANSWERED" : "NEEDS_REVIEW" }
    assert.ok(prompt.includes(expectedName))
    assert.ok(prompt.includes(`Answer in ${expectedLanguage}`))
    assert.ok(prompt.includes(`a ${expectedTone} tone`))
    return { answer: `${latestSources.find((source) => source.id === "company")!.content} HARBOR_HELLO.`, sourceIds: ["company"], outcome: "ANSWERED" }
  }
  provider.matchFaq = async (question, _history, faqs, language) => {
    if (singleScope) assert.equal(faqs.some((entry) => entry.answer.includes("OTHER_SKILL_FAQ_SECRET")), false)
    return { faqId: /appointments|citas/i.test(question) ? faqs.find((entry) => entry.id === faq.id)?.id ?? null : null, translate: language === "Spanish", language: language === "Spanish" ? "Spanish" : "English" }
  }
  provider.translateFaq = async (answer) => { assert.equal(answer, faq.answer); return { answer: "Solo días laborables.\nTraiga los originales." } }
  let rateClock = Date.now()
  const app = express()
  app.use(cookieParser(), express.json())
  app.use("/api/services", createContactAssistantRouter({
    requireMembership: async (req, res, scope) => {
      const membership = await prisma.membership.findUnique({ where: { userId_tenantId: { userId: req.user.id, tenantId: scope } } })
      if (membership?.status === "ACTIVE") return membership
      res.status(403).json({ error: "TENANT_ACCESS_DENIED" }); return null
    },
    evaluate: serviceRoutes.evaluateServiceFitScan,
    now: () => rateClock += 61000, // Rate limiting has its own route test.
    reply: (db, scope, input, signal, overrides) => answerContactAssistant(db, scope, input, signal, { getProvider: () => provider, ...overrides }),
  }))
  app.use("/api/services", serviceRoutes.default as unknown as Router)
  app.use("/api/account-settings", settingsRoutes.default as unknown as Router)
  const errors: ErrorRequestHandler = (error, _req, res, _next) => res.status(error instanceof z.ZodError ? 400 : error.status ?? 500).json({ error: error.message })
  app.use(errors)
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); listener.once("error", reject) })
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() }))
  root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const completed = new Set<string>(), conversationId = randomUUID()
  const ask = async (question?: string, options: Record<string, unknown> = {}) => {
    const body = { contactId: contact.id, scope: "service", serviceId: skill.id, question, conversationId, requestId: randomUUID(), ...options }
    const response = await fetch(`${root}/api/services/${tenantId}/fit-scan/assistant`, { method: "POST", headers, body: JSON.stringify(body) })
    const data = await response.json()
    if (response.ok) completed.add(body.requestId as string)
    return { response, data }
  }
  let result = await ask()
  assert.equal(result.response.status, 200)
  assert.equal(result.data.answer.replySource, "RULES")
  const baseline = result.data.items
  assert.equal(baseline[0].eligibilityStatus, "ELIGIBLE")
  assert.equal(baseline[0].fitScore, 100)
  result = await ask("What is your company address?")
  assert.equal(result.data.answer.replySource, "CONTACT")
  assert.match(result.data.answer.summary, /Harbor Company/)
  assert.equal(result.data.answer.answerMode, "ADAPTED")
  result = await ask("When are appointments available?")
  assert.equal(result.data.answer.summary, faq.answer)
  assert.equal(result.data.answer.answerMode, "EXACT")
  assert.deepEqual(result.data.items, baseline)
  await prisma.tenantAiSettings.update({ where: { tenantId }, data: { name: "New Harbor Helper", language: "Spanish", tone: "Direct", avatarPresetId: "lightbulb", revision: { increment: 1 } } })
  expectedLanguage = "Spanish"; expectedTone = "direct"; expectedName = "New Harbor Helper"
  await prisma.tenant.update({ where: { id: tenantId }, data: { description: "New Harbor Office" } })
  result = await ask("¿Cuándo hay citas?")
  assert.equal(result.data.helper.name, "New Harbor Helper")
  assert.equal(result.data.helper.avatar.presetId, "lightbulb")
  assert.equal(result.data.answer.answerMode, "TRANSLATED")
  assert.equal(result.data.answer.summary, "Solo días laborables.\nTraiga los originales.")
  await prisma.serviceAiFaq.update({ where: { id: faq.id }, data: { exactAnswer: false } })
  result = await ask("What is your company address?")
  assert.equal(result.data.answer.answerMode, "ADAPTED")
  assert.match(result.data.answer.summary, /Harbor Company/)
  assert.match(result.data.answer.summary, /HARBOR_HELLO/)
  assert.match(result.data.answer.summary, /New Harbor Office/)
  assert.deepEqual(result.data.items, baseline)
  result = await ask("Passport permit code?")
  assert.match(result.data.answer.summary, /HARBOR-42/)
  assert.equal(result.data.answer.sources.some((source: AiChatSource) => source.sourceId === documents[0]!.id), true)
  assert.equal(JSON.stringify(latestSources).includes("OTHER_SKILL_SOURCE_SECRET"), false)
  await prisma.serviceAiSource.delete({ where: { id: documents[0]!.id } })
  result = await ask("Passport permit code?")
  assert.equal(result.data.answer.outcome, "NEEDS_REVIEW")
  assert.equal(result.data.answer.sources.length, 0)
  const beforeRules = calls
  result = await ask("Why is this contact eligible?")
  assert.equal(calls, beforeRules + 1)
  assert.equal(result.data.answer.replySource, "CONTACT")
  assert.deepEqual(result.data.items, baseline)
  fail = true
  result = await ask("What is the company website?")
  assert.equal(result.data.answer.replySource, "FALLBACK")
  assert.equal(result.data.answer.outcome, "NEEDS_REVIEW")
  assert.deepEqual(result.data.items, baseline)
  fail = false
  await prisma.membership.update({ where: { userId_tenantId: { userId, tenantId } }, data: { role: "TENANT_USER" } })
  const identity = await fetch(`${root}/api/services/${tenantId}/fit-scan/helper`, { headers })
  assert.equal(identity.status, 200)
  assert.deepEqual(Object.keys((await identity.json()).helper).sort(), ["avatar", "name"])
  assert.equal((await fetch(`${root}/api/account-settings/${tenantId}/ai/settings`, { headers })).status, 403)
  singleScope = false
  result = await ask("What is the company name?", { scope: "all", serviceId: undefined })
  assert.equal(result.response.status, 200)
  assert.equal(result.data.answer.replySource, "CONTACT")
  result = await ask("Why not Coverage review?")
  assert.equal(result.data.scope.serviceId, coverage.id)
  assert.match(result.data.answer.summary, /56/)
  assert.match(result.data.answer.summary, /64/)
  assert.deepEqual(result.data.answer.suggestedQuestions, [])
  assert.equal(result.data.items.find((item: { serviceId: string }) => item.serviceId === coverage.id).eligibilityStatus, "NOT_ELIGIBLE")
  result = await ask("Would disability help?", { serviceId: coverage.id, history: [
    { role: "user", content: "Why not Coverage review?" }, { role: "assistant", content: result.data.answer.summary },
  ] })
  assert.match(result.data.answer.summary, /current record says No/)
  result = await ask("Tell me about Other skill")
  assert.equal(result.data.scope.serviceId, other.id)
  assert.equal(result.data.answer.replySource, "CONTACT")
  const analytics = await loadAiAnalytics(prisma, tenantId, { days: "7", channel: "CONTACT_ASSISTANT" })
  assert.equal(analytics.totals.qualificationRuns, completed.size)
  assert.equal(analytics.totals.conversations, 1)
  assert.ok(analytics.totals.needsReview >= 2)
  assert.equal((await loadAiAnalytics(prisma, tenantId, { days: "7", channel: "TEST" })).totals.conversations, 0)
  assert.equal((await ask("Company name?", { contactId: randomUUID() })).response.status, 404)
  assert.equal((await ask("Company name?", { serviceId: foreignSkill.id })).response.status, 404)
  assert.equal((await fetch(`${root}/api/services/${foreignId}/fit-scan/helper`, { headers })).status, 403)
  await prisma.membership.update({ where: { userId_tenantId: { userId, tenantId } }, data: { status: "DISABLED" } })
  assert.equal((await ask("Company name?")).response.status, 403)
})
