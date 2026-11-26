import assert from "node:assert/strict"
import { test } from "node:test"
import express from "express"
import cookieParser from "cookie-parser"
import type { AddressInfo } from "node:net"
import { randomUUID } from "node:crypto"
import { requireAuth } from "../middleware/requireAuth.js"
import { prisma } from "./prisma.js"

test("paid access, CRM grace and recovery are enforced in session-authenticated routes without client scope overrides", async t => {
  const saved = process.env.BILLING_ENABLED; process.env.BILLING_ENABLED = "true"
  const originals = { session: prisma.session.findUnique, membership: prisma.membership.findUnique, subscription: prisma.tenantSubscription.findUnique }
  t.after(() => { if (saved === undefined) delete process.env.BILLING_ENABLED; else process.env.BILLING_ENABLED = saved; prisma.session.findUnique = originals.session; prisma.membership.findUnique = originals.membership; prisma.tenantSubscription.findUnique = originals.subscription })
  let status = "ACTIVE", paidThrough = new Date(Date.now() + 60000), member = true
  prisma.session.findUnique = (async () => ({ expiresAt: new Date(Date.now() + 60000), user: { id: randomUUID(), email: "fixture@example.test", name: "Fixture", platformRole: "NONE" } })) as unknown as typeof originals.session
  prisma.membership.findUnique = (async () => member ? { status: "ACTIVE" } : null) as unknown as typeof originals.membership
  prisma.tenantSubscription.findUnique = (async () => ({ status, paidThrough, graceEndsAt: null })) as unknown as typeof originals.subscription
  const app = express(); app.use(cookieParser(), express.json())
  for (const path of ["/api/contacts/:tenantId", "/api/services/:tenantId/fit-scan/assistant", "/api/account-settings/:tenantId/ai/test-chat/messages", "/api/account-settings/:tenantId/subscription", "/api/billing/:tenantId/portal"])
    app.all(path, requireAuth, (_req, res) => res.json({ ok: true }))
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); s.once("error", reject) })
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() }))
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, tenantId = randomUUID(), headers = { cookie: "sid=test", "content-type": "application/json" }
  const get = (path: string) => fetch(root + path, { headers })
  const post = (path: string, body = {}) => fetch(root + path, { method: "POST", headers, body: JSON.stringify(body) })
  assert.equal((await get(`/api/contacts/${tenantId}`)).status, 200)
  status = "PAST_DUE"; paidThrough = new Date(Date.now() - 60000)
  assert.equal((await get(`/api/contacts/${tenantId}`)).status, 200)
  assert.equal((await post(`/api/services/${tenantId}/fit-scan/assistant`, { question: "typed question" })).status, 402)
  assert.equal((await post(`/api/services/${tenantId}/fit-scan/assistant`)).status, 200)
  assert.equal((await post(`/api/account-settings/${tenantId}/ai/test-chat/messages`, { question: "hello" })).status, 402)
  paidThrough = new Date(Date.now() - 73 * 3600000)
  assert.equal((await get(`/api/contacts/${tenantId}`)).status, 402)
  assert.equal((await get(`/api/account-settings/${tenantId}/subscription`)).status, 200)
  assert.equal((await post(`/api/billing/${tenantId}/portal`)).status, 200)
  assert.equal((await post(`/api/services/${tenantId}/fit-scan/assistant`, { tenantId: randomUUID() })).status, 400)
  member = false; assert.equal((await get(`/api/contacts/${tenantId}`)).status, 403)
})
