import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import express, { type ErrorRequestHandler, type Router } from "express"
import cookieParser from "cookie-parser"
import { z } from "zod"
import { sha256 } from "./crypto.js"
import { AiChatError } from "./ai-test-chat.js"
import { loadAiAnalytics, recordAiInteraction } from "./ai-analytics.js"

// Isolated PostgreSQL fixtures, no provider or upload requests.
// AI_ANALYTICS_DB_TEST=1 node --env-file=.env --import tsx --test src/lib/ai-analytics.integration.test.ts
test("real routes record deduplicated metadata and report tenant-scoped totals, channels and date windows", {
  skip: process.env.AI_ANALYTICS_DB_TEST !== "1",
}, async (t) => {
  const { prisma } = await import("./prisma.js")
  const { createAiTestChatRouter } = await import("../routes/ai-test-chat.routes.js")
  const { default: analyticsRoutes } = await import("../routes/ai-analytics.routes.js")
  const { default: serviceRoutes } = await import("../routes/services.routes.js")
  const tenantId = randomUUID(), foreignId = randomUUID(), userId = randomUUID(), token = randomUUID()
  t.after(async () => {
    await prisma.service.deleteMany({ where: { tenantId, kind: "OFFERING" } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignId] } } })
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.$disconnect()
  })
  await prisma.tenant.createMany({ data: [tenantId, foreignId].map((id) => ({ id, slug: `analytics-test-${id}`, name: "Analytics fixture" })) })
  await prisma.user.create({ data: { id: userId, name: "Analytics fixture", email: `analytics-${userId}@example.test` } })
  await prisma.membership.create({ data: { userId, tenantId, role: "TENANT_ADMIN", status: "ACTIVE" } })
  await prisma.session.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 300000) } })
  const status = await prisma.contactStatusConfig.create({ data: { tenantId, name: "Fixture", bgColor: "#ffffff", textColor: "#000000" } })
  const contact = await prisma.contact.create({ data: { tenantId, firstName: "Analytics", lastName: "Fixture", statusConfigId: status.id } })
  const parent = await prisma.service.create({ data: { tenantId, kind: "GROUP", name: "Fixture group", basePriceCents: 0 } })
  const service = await prisma.service.create({ data: {
    tenantId, kind: "OFFERING", parentServiceId: parent.id, name: "Fixture service", basePriceCents: 0,
    fitProfile: { enabled: true, rules: [{
      id: "first-name", source: "core", fieldKey: "firstName", operator: "is_not_empty",
      valueType: "string", compareValue: null, weight: 1, required: true,
    }] },
  } })
  let fail = false
  const app = express()
  app.use(cookieParser(), express.json())
  app.use("/api/account-settings", createAiTestChatRouter({
    load: async () => ({ helper: { name: "Fixture helper", language: "English", tone: "Direct", instructions: "", revision: 0 }, skillCount: 0, sources: [] }),
    getProvider: () => async (messages) => {
      if (fail) throw new AiChatError(503, "AI_PROVIDER_UNAVAILABLE")
      return { answer: "Fixture reply", sourceIds: [], outcome: messages[1]!.content.includes("unknown") ? "NEEDS_REVIEW" : "ANSWERED" }
    },
  }))
  app.use("/api/account-settings", analyticsRoutes as unknown as Router)
  app.use("/api/services", serviceRoutes as unknown as Router)
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error instanceof z.ZodError ? 400 : error.status ?? 500).json({ error: error.message })
  }
  app.use(errors)
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener))
    listener.once("error", reject)
  })
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const headers = { cookie: `sid=${token}`, origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", "content-type": "application/json" }
  const post = (path: string, body: unknown) => fetch(`${root}${path}`, { method: "POST", headers, body: JSON.stringify(body) })
  const analyticsPath = `/api/account-settings/${tenantId}/ai/analytics`
  const report = async (query = "") => {
    const response = await fetch(`${root}${analyticsPath}${query}`, { headers })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store")
    return (await response.json()).analytics
  }
  assert.deepEqual((await report()).totals, { conversations: 0, answered: 0, needsReview: 0, qualificationRuns: 0 })
  const conversationId = randomUUID(), requestId = randomUUID()
  const question = { question: "hello", conversationId, requestId }
  const chatPath = `/api/account-settings/${tenantId}/ai/test-chat/messages`
  assert.equal((await post(chatPath, question)).status, 200)
  assert.equal((await post(chatPath, question)).status, 200)
  assert.equal((await post(chatPath, { ...question, question: "unknown information", requestId: randomUUID() })).status, 200)
  fail = true
  assert.equal((await post(chatPath, { ...question, requestId: randomUUID() })).status, 503)
  fail = false
  assert.equal((await post(chatPath, { ...question, requestId: "invalid" })).status, 400)
  assert.deepEqual((await report("?channel=TEST&days=7")).totals, { conversations: 1, answered: 1, needsReview: 1, qualificationRuns: 0 })

  const contactConversation = randomUUID(), runId = randomUUID()
  const runPath = `/api/services/${tenantId}/fit-scan/run`
  const run = { contactId: contact.id, conversationId: contactConversation, requestId: runId }
  // Passive reads never record activity. The explicit action records one actual run.
  const passive = await fetch(`${root}/api/services/${tenantId}/fit-scan?contactId=${contact.id}`, { headers })
  assert.equal(passive.status, 200)
  assert.equal((await post(runPath, run)).status, 200)
  assert.equal((await post(runPath, run)).status, 200)
  const ask = { ...run, requestId: randomUUID(), scope: "service", serviceId: service.id, question: "What is missing?" }
  assert.equal((await post(`/api/services/${tenantId}/fit-scan/assistant`, ask)).status, 200)
  // Generation is disabled for this fixture; typed qualification gets a usable
  // fallback marked for review rather than pretending the model answered.
  assert.deepEqual((await report("?channel=CONTACT_ASSISTANT&days=7")).totals, { conversations: 1, answered: 0, needsReview: 1, qualificationRuns: 2 })
  assert.deepEqual((await report("?days=7")).totals, { conversations: 2, answered: 1, needsReview: 2, qualificationRuns: 2 })
  assert.equal((await post(runPath, { ...run, contactId: randomUUID(), requestId: randomUUID() })).status, 404)
  assert.equal((await post(`/api/services/${foreignId}/fit-scan/run`, run)).status, 403)

  // Concurrent database retries also count exactly once, irrespective of actor/channel IDs.
  const activity = { tenantId, actorId: userId, channel: "TEST" as const, conversationId, requestId: randomUUID(), questionOutcome: "ANSWERED" as const, qualificationRun: false }
  const writes = await Promise.all(Array.from({ length: 5 }, () => recordAiInteraction(prisma, activity)))
  assert.equal(writes.reduce((count, result) => count + result.count, 0), 1)
  const now = new Date()
  const dated = (daysAgo: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo, 12))
  for (const daysAgo of [8, 40, 91, -1]) await prisma.aiInteraction.create({ data: { ...activity, requestId: randomUUID(), createdAt: dated(daysAgo) } })
  await recordAiInteraction(prisma, { ...activity, tenantId: foreignId, requestId: randomUUID() })
  const seven = await report("?channel=TEST&days=7")
  const thirty = await report("?channel=TEST&days=30")
  const ninety = await report("?channel=TEST&days=90")
  assert.equal(seven.totals.answered, 2)
  assert.equal(thirty.totals.answered, 3)
  assert.equal(ninety.totals.answered, 4)
  assert.equal(ninety.totals.conversations, 1)
  assert.equal(seven.daily.length, 7)
  assert.equal(thirty.daily.length, 30)
  assert.equal(ninety.daily.length, 90)
  assert.equal(ninety.daily.reduce((sum: number, day: { answered: number }) => sum + day.answered, 0), 4)
  // Inspect the complete persisted record: no question, answer, history, contact ID or source contents.
  const stored = await prisma.aiInteraction.findFirstOrThrow({ where: { tenantId } })
  assert.deepEqual(Object.keys(stored).sort(), ["id", "tenantId", "actorId", "channel", "conversationId", "requestId", "questionOutcome", "qualificationRun", "createdAt"].sort())
  const foreign = await loadAiAnalytics(prisma, foreignId, { days: "7", channel: "ALL" })
  assert.equal(foreign.totals.answered, 1)

  assert.equal((await fetch(`${root}${analyticsPath}`)).status, 401)
  assert.equal((await fetch(`${root}/api/account-settings/${foreignId}/ai/analytics`, { headers })).status, 403)
  for (const query of ["?days=365", "?channel=INVALID", "?tenantId=foreign"]) assert.equal((await fetch(`${root}${analyticsPath}${query}`, { headers })).status, 400)
  await prisma.membership.update({ where: { userId_tenantId: { userId, tenantId } }, data: { role: "TENANT_USER" } })
  assert.equal((await fetch(`${root}${analyticsPath}`, { headers })).status, 403)
  await prisma.membership.update({ where: { userId_tenantId: { userId, tenantId } }, data: { role: "TENANT_ADMIN", status: "DISABLED" } })
  assert.equal((await fetch(`${root}${analyticsPath}`, { headers })).status, 403)
})
