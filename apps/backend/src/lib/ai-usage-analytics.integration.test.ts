import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import express from "express"
import cookieParser from "cookie-parser"
import { Pool } from "pg"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../generated/prisma/index.js"
import { loadAiAnalytics } from "./ai-analytics.js"

const connectionString = process.env.AI_CREDIT_TEST_DATABASE_URL
test("usage analytics counts actual charges and attempts without join inflation, transcript exposure or cross-tenant leakage", { skip: !connectionString }, async t => {
  const schema = `usage_test_${randomUUID().replaceAll("-", "")}`
  const admin = new Pool({ connectionString }); await admin.query(`CREATE SCHEMA "${schema}"`)
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` })
  const db = new PrismaClient({ adapter: new PrismaPg(pool, { schema, disposeExternalPool: false }) })
  t.after(async () => { await db.$disconnect(); await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end() })
  await pool.query(`CREATE TYPE "AiActivityChannel" AS ENUM ('TEST', 'CONTACT_ASSISTANT');
    CREATE TABLE "AiInteraction" ("tenantId" text, "actorId" text, "channel" "AiActivityChannel", "conversationId" text, "questionOutcome" text, "qualificationRun" boolean, "createdAt" timestamp);
    CREATE TABLE "AiCreditRequest" (id text, "tenantId" text, channel text);
    CREATE TABLE "AiCreditLedger" ("tenantId" text, "requestId" text, kind text, "monthlyUnits" integer, "purchasedUnits" integer, "createdAt" timestamp);
    CREATE TABLE "AiProviderUsage" ("tenantId" text, channel text, status text, "inputTokens" integer, "outputTokens" integer, "createdAt" timestamp);`)
  const tenantId = randomUUID(), foreignId = randomUUID(), now = new Date("2026-11-25T15:00:00Z"), recent = new Date("2026-11-25T12:00:00Z"), older = new Date("2026-11-17T12:00:00Z")
  const report = (days: "7" | "30" | "90" = "7", channel: "ALL" | "TEST" | "CONTACT_ASSISTANT" = "ALL") => loadAiAnalytics(db, tenantId, { days, channel }, now)
  assert.equal((await report()).usage.totals.providerCalls, 0)
  const charge = async (who: string, channel: string, monthly: number, purchased: number, at = recent, kind = "COMMIT") => {
    const id = randomUUID()
    await pool.query('INSERT INTO "AiCreditRequest" VALUES ($1,$2,$3)', [id, who, channel])
    await pool.query('INSERT INTO "AiCreditLedger" VALUES ($1,$2,$3,$4,$5,$6)', [who, id, kind, monthly, purchased, at.toISOString()])
  }
  const usage = (who: string, channel: string, status: string, input: number | null, output: number | null, at = recent) => pool.query('INSERT INTO "AiProviderUsage" VALUES ($1,$2,$3,$4,$5,$6)', [who, channel, status, input, output, at.toISOString()])
  await charge(tenantId, "TEST", 2, 10)
  await charge(tenantId, "TEST", 6, 0, recent, "RESERVE"); await charge(tenantId, "TEST", 6, 0, recent, "RELEASE")
  await charge(tenantId, "TEST", 1200, 0, recent, "MONTHLY_GRANT")
  await charge(tenantId, "CONTACT_ASSISTANT", 1, 0)
  await charge(tenantId, "TEST", 4, 0, older)
  await charge(tenantId, "TEST", 9, 0, new Date("2026-11-25T16:00:00Z"))
  await charge(foreignId, "TEST", 999, 0)
  await usage(tenantId, "TEST", "SUCCESS", 100, 20)
  await usage(tenantId, "TEST", "INVALID_RESPONSE", 50, 10)
  await usage(tenantId, "TEST", "TRANSPORT_ERROR", null, null)
  await usage(tenantId, "TEST", "STARTED", null, null)
  await usage(tenantId, "TEST", "SUCCESS", 40, 5)
  await usage(tenantId, "CONTACT_ASSISTANT", "SUCCESS", 500, 50)
  await usage(tenantId, "TEST", "SUCCESS", 800, 80, older)
  for (const channel of ["SYSTEM", "DIAGNOSTIC", "EVALUATION"]) await usage(tenantId, channel, "SUCCESS", 9999, 9999)
  await usage(foreignId, "TEST", "SUCCESS", 9999, 9999)
  await usage(tenantId, "TEST", "SUCCESS", 9999, 9999, new Date("2026-11-25T16:00:00Z"))
  const seven = await report("7", "TEST")
  assert.deepEqual(seven.usage.totals, { creditsUsed: 12, chargedReplies: 1, providerCalls: 5, inputTokens: 190, outputTokens: 35, unknownTokenCalls: 2, inProgressCalls: 1, failedCalls: 2 })
  assert.equal(seven.usage.daily.length, 7)
  assert.equal(seven.usage.daily.reduce((sum, day) => sum + day.creditsUsed, 0), 12)
  assert.equal((await report("30", "TEST")).usage.totals.creditsUsed, 16)
  assert.equal((await report("90", "TEST")).usage.totals.inputTokens, 990)
  assert.equal((await report()).usage.totals.creditsUsed, 13)
  assert.equal((await report("7", "CONTACT_ASSISTANT")).usage.totals.providerCalls, 1)
  assert.doesNotMatch(JSON.stringify(seven), /estimatedCostUsd|upperBoundCostUsd|questionText|answerText|apiKey/)

  const { prisma } = await import("./prisma.js"), { createAiAnalyticsRouter } = await import("../routes/ai-analytics.routes.js")
  const originals = { session: prisma.session.findUnique, membership: prisma.membership.findUnique }
  let role = "TENANT_ADMIN", active = true
  prisma.session.findUnique = (async () => ({ expiresAt: new Date(Date.now() + 60000), user: { id: randomUUID(), name: "Fixture", email: "fixture@example.test", platformRole: "NONE" } })) as unknown as typeof originals.session
  prisma.membership.findUnique = (async ({ where }: { where: { userId_tenantId: { tenantId: string } } }) => where.userId_tenantId.tenantId === tenantId && active ? { status: "ACTIVE", role } : null) as unknown as typeof originals.membership
  t.after(() => { prisma.session.findUnique = originals.session; prisma.membership.findUnique = originals.membership })
  const app = express(); app.use(cookieParser()); app.use("/api/account-settings", createAiAnalyticsRouter({ db, now: () => now }))
  app.use(((error, _req, res, _next) => res.status(error.name === "ZodError" ? 400 : 500).json({ error: "TEST_ERROR" })) as express.ErrorRequestHandler)
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); server.once("error", reject) })
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() }))
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/account-settings`, headers = { cookie: "sid=fixture" }
  const response = await fetch(`${root}/${tenantId}/ai/analytics?days=7&channel=TEST`, { headers })
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal((await response.json()).analytics.usage.totals.creditsUsed, 12)
  assert.equal((await fetch(`${root}/${tenantId}/ai/analytics`)).status, 401)
  assert.equal((await fetch(`${root}/${foreignId}/ai/analytics`, { headers })).status, 403)
  assert.equal((await fetch(`${root}/${tenantId}/ai/analytics?days=365`, { headers })).status, 400)
  role = "TENANT_USER"; assert.equal((await fetch(`${root}/${tenantId}/ai/analytics`, { headers })).status, 403)
  role = "TENANT_ADMIN"; active = false; assert.equal((await fetch(`${root}/${tenantId}/ai/analytics`, { headers })).status, 403)
})
