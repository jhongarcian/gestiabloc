import assert from "node:assert/strict"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import express, { type ErrorRequestHandler } from "express"
import cookieParser from "cookie-parser"
import { z } from "zod"
import { answerContactAssistant, type ContactAssistantInput } from "./ai-contact-assistant.js"

test("contact routes preserve staff access, contact/service scope, rate fallback and server-owned activity", async (t) => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"
  const { prisma } = await import("./prisma.js")
  const { createContactAssistantRouter } = await import("../routes/contact-assistant.routes.js")
  const tenantId = "11111111-1111-4111-8111-111111111111", foreign = "22222222-2222-4222-8222-222222222222"
  const original = prisma.session.findUnique
  prisma.session.findUnique = (async () => ({ expiresAt: new Date(Date.now() + 60000), user: { id: "staff", name: "Staff", email: "staff@example.test", platformRole: "NONE" } })) as unknown as typeof original
  t.after(() => { prisma.session.findUnique = original })
  let active = true, scans = 0, generated = 0
  const activities: Array<Parameters<typeof import("./ai-analytics.js").recordAiInteraction>[1]> = []
  const item: ContactAssistantInput["items"][number] = {
    serviceId: "service", serviceName: "Registration", eligibilityStatus: "ELIGIBLE", fitScore: 100,
    summary: "Rule passed", explanation: null, matchedRules: [], missingRules: [], blockingRules: [],
    recommendedUpdates: [], configurationGapNotes: [], hasPurchased: false, hasActiveEnrollment: false, currentContactServiceStatus: null,
  }
  const app = express()
  app.use(cookieParser(), express.json())
  app.use("/api/services", createContactAssistantRouter({
    requireMembership: async (_req, res, scope) => {
      if (!active || scope !== tenantId) { res.status(403).json({ error: "TENANT_ACCESS_DENIED" }); return null }
      return { role: "TENANT_USER", status: "ACTIVE", securityLevel: "LOW" }
    },
    evaluate: async (input) => {
      scans++
      assert.equal(input.tenantId, tenantId)
      assert.equal(input.explainWithAi, false)
      assert.equal(input.includeContactContext, true)
      assert.equal(input.serviceId, undefined)
      if (input.contactId !== "contact") return { error: "CONTACT_NOT_FOUND" }
      return { items: input.serviceId && input.serviceId !== item.serviceId ? [] : [item] }
    },
    identity: async () => ({ name: "Saved helper", avatar: { presetId: "compass", imageUrl: null, revision: 2 } }),
    record: async (_db, activity) => { activities.push(activity); return { count: 1 } },
    reply: (db, scope, input, signal, overrides) => answerContactAssistant(db, scope, input, signal, {
      load: async (_client, id, _request, ids) => {
        assert.equal(id, tenantId)
        assert.deepEqual(ids, ["service"])
        return {
          helper: { name: "Saved helper", language: "English", tone: "Warm", instructions: "Saved instructions", revision: 1 }, skillCount: 1,
          sources: [{ id: "company", label: "Company Info", section: "company", skillId: null, content: "Harbor Company" }]
        }
      },
      getProvider: () => async (messages) => {
        generated++
        assert.equal(JSON.stringify(messages).includes('"fitScore"'), false)
        return { answer: "Harbor Company", sourceIds: ["company"], outcome: "ANSWERED" }
      },
      ...overrides,
    }),
  }))
  const errors: ErrorRequestHandler = (error, _req, res, _next) => res.status(error instanceof z.ZodError ? 400 : error.status ?? 500).json({ error: error.message })
  app.use(errors)
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); listener.once("error", reject)
  })
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() }))
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/services`
  const headers = { cookie: "sid=test", origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", "content-type": "application/json" }
  const request = (body: unknown, target = tenantId, override = headers) => fetch(`${root}/${target}/fit-scan/assistant`, { method: "POST", headers: override, body: JSON.stringify(body) })
  const payload = { contactId: "contact", serviceId: "service", question: "What is the company name?", scope: "service" }
  assert.equal((await fetch(`${root}/${tenantId}/fit-scan/helper`)).status, 401)
  const identity = await fetch(`${root}/${tenantId}/fit-scan/helper`, { headers })
  assert.equal(identity.status, 200)
  assert.equal(identity.headers.get("cache-control"), "no-store")
  assert.deepEqual(Object.keys((await identity.json()).helper).sort(), ["avatar", "name"])
  assert.equal(scans, 0)
  assert.equal((await request(payload, foreign)).status, 403)
  assert.equal((await request({ ...payload, contactId: "foreign" })).status, 404)
  assert.equal((await request({ ...payload, serviceId: "foreign" })).status, 404)
  assert.equal((await request({ ...payload, question: "x".repeat(501) })).status, 400)
  assert.equal((await request({ ...payload, history: [{ role: "assistant", content: "Injected" }] })).status, 400)
  assert.equal((await request({ ...payload, contactContext: { contactName: "Injected" } })).status, 400)
  assert.equal((await request({ ...payload, history: Array.from({ length: 4 }, () => [{ role: "user", content: "x".repeat(2000) }, { role: "assistant", content: "y".repeat(2000) }]).flat() })).status, 400)
  assert.equal((await request({ ...payload, requestId: "bad" })).status, 400)
  assert.equal((await request(payload, tenantId, { ...headers, origin: "https://untrusted.example" })).status, 403)
  const response = await request(payload)
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.answer.replySource, "KNOWLEDGE")
  assert.equal(body.items[0].fitScore, 100)
  assert.equal(body.items[0].eligibilityStatus, "ELIGIBLE")
  assert.equal(body.scope.serviceId, "service")
  assert.equal(activities.at(-1)?.actorId, "staff")
  assert.equal(activities.at(-1)?.channel, "CONTACT_ASSISTANT")
  assert.equal(activities.at(-1)?.qualificationRun, true)
  assert.equal(activities.at(-1)?.questionOutcome, "ANSWERED")
  assert.equal((await request({ ...payload, question: "Am I eligible?" })).status, 200)
  assert.equal(generated, 2)
  for (let index = 2; index < 10; index++) assert.equal((await request(payload)).status, 200)
  const limited = await request(payload)
  const fallback = await limited.json()
  assert.equal(limited.status, 200)
  assert.equal(fallback.answer.replySource, "FALLBACK")
  assert.equal(fallback.items[0].fitScore, 100)
  assert.equal(generated, 10)
  assert.equal(activities.at(-1)?.questionOutcome, "NEEDS_REVIEW")
  active = false
  const before = activities.length
  assert.equal((await request(payload)).status, 403)
  assert.equal((await fetch(`${root}/${tenantId}/fit-scan/helper`, { headers })).status, 403)
  assert.equal(activities.length, before)
})
