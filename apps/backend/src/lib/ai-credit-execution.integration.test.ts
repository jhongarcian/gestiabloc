import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { test } from "node:test"
import { Pool } from "pg"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../generated/prisma/index.js"
import { grantMonthlyAiCredits, reserveAiCredit, readAiCreditUsage } from "./ai-credit-wallet.js"
import { createAiReplyExecutor } from "./ai-credit-execution.js"
import { maintainAiCredits } from "./ai-credit-maintenance.js"
import { creditTestEnv as env } from "./ai-credit-execution.test-fixtures.js"
import express, { type ErrorRequestHandler } from "express"
import cookieParser from "cookie-parser"
import type { AddressInfo } from "node:net"
import type { AiChatProvider, AiChatSnapshot } from "./ai-helper-replies.js"

const connectionString = process.env.AI_CREDIT_TEST_DATABASE_URL
const model = "openai/gpt-oss-120b"
test("paid AI execution persists one encrypted reply and one debit with safe retries and cleanup", { skip: !connectionString }, async t => {
  const schema = `replay_test_${randomUUID().replaceAll("-", "")}`
  const admin = new Pool({ connectionString })
  await admin.query(`CREATE SCHEMA "${schema}"`)
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 15 })
  const db = new PrismaClient({ adapter: new PrismaPg(pool, { schema, disposeExternalPool: false }) })
  t.after(async () => { await db.$disconnect(); await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end() })
  await pool.query('CREATE TABLE "Tenant" ("id" TEXT PRIMARY KEY)')
  await pool.query('CREATE TABLE "TenantSubscription" ("id" TEXT PRIMARY KEY, "tenantId" TEXT UNIQUE NOT NULL, "status" TEXT NOT NULL, "paidThrough" TIMESTAMP(3))')
  for (const name of ["20261029120000_ai_credit_wallet", "20261029130000_ai_credit_replay", "20261029150000_credit_purchase_review"])
    await pool.query(await readFile(resolve(__dirname, `../../prisma/migrations/${name}/migration.sql`), "utf8"))
  let clock = new Date("2026-10-29T12:00:00Z")
  async function fixture() {
    const tenantId = randomUUID()
    await pool.query('INSERT INTO "Tenant" ("id") VALUES ($1)', [tenantId])
    await pool.query('INSERT INTO "TenantSubscription" ("id", "tenantId", "status", "paidThrough") VALUES ($1, $1, $2, $3)', [tenantId, "ACTIVE", new Date("2026-11-01")])
    await grantMonthlyAiCredits(db, { tenantId, sourceKey: randomUUID(), planKey: "STARTER", startsAt: new Date("2026-10-01"), endsAt: new Date("2026-11-01") })
    const identity = { tenantId, actorId: randomUUID(), channel: "TEST" as const, requestId: randomUUID(), conversationId: randomUUID() }
    return { identity, run: createAiReplyExecutor(db, identity, { env, now: () => clock }) }
  }
  await t.test("a concurrent retry gets in-progress, then replays the same answer without a second call", async () => {
    const { identity, run } = await fixture()
    let calls = 0, unblock!: () => void, started!: () => void
    const waiting = new Promise<void>(resolve => { unblock = resolve })
    const ready = new Promise<void>(resolve => { started = resolve })
    const generate = async () => { calls++; started(); await waiting; return { id: randomUUID(), answer: "Synthetic private answer" } }
    const first = run({ question: "Hello", context: "original" }, generate, model)
    await ready
    await assert.rejects(run({ question: "Hello", context: "original" }, generate, model), /AI_REQUEST_IN_PROGRESS/)
    unblock(); const answer = await first
    assert.deepEqual(await run({ question: "Hello", context: "original" }, generate, model), answer)
    assert.equal(calls, 1)
    assert.equal((await readAiCreditUsage(db, identity.tenantId, clock)).monthly.used, 1)
    const stored = await db.aiCreditRequest.findFirstOrThrow({ where: { tenantId: identity.tenantId } })
    assert.doesNotMatch(JSON.stringify(stored), /Synthetic private answer|Hello|original/)
    await assert.rejects(run({ question: "Hello", context: "changed" }, generate, model), /AI_REQUEST_CONFLICT/)
    assert.equal(calls, 1)
  })
  await t.test("provider errors and cancellation release holds without charges; the failed ID is not regenerated", async () => {
    const { identity, run } = await fixture()
    await assert.rejects(run({}, async () => { throw new Error("PROVIDER_FAILED") }, model), /PROVIDER_FAILED/)
    assert.equal((await readAiCreditUsage(db, identity.tenantId, clock)).monthly.remaining, 1200)
    await assert.rejects(run({}, async () => "wrong", model), /AI_RESPONSE_EXPIRED/)
    const abort = new AbortController()
    const runCanceled = createAiReplyExecutor(db, { ...identity, requestId: randomUUID() }, { env, now: () => clock, signal: abort.signal })
    await assert.rejects(runCanceled({}, async () => { abort.abort(); return "lost answer" }, model))
    assert.equal((await readAiCreditUsage(db, identity.tenantId, clock)).monthly.used, 0)
  })
  await t.test("replay persistence failure rolls back the debit and releases the hold", async () => {
    const { identity, run } = await fixture()
    await pool.query('CREATE FUNCTION reject_replay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."responseCiphertext" IS NOT NULL THEN RAISE EXCEPTION \'synthetic persistence failure\'; END IF; RETURN NEW; END $$')
    await pool.query('CREATE TRIGGER reject_replay BEFORE UPDATE ON "AiCreditRequest" FOR EACH ROW EXECUTE FUNCTION reject_replay()')
    try { await assert.rejects(run({}, async () => "valid answer", model), /AI_BILLING_UNAVAILABLE/) }
    finally { await pool.query('DROP TRIGGER reject_replay ON "AiCreditRequest"') }
    const usage = await readAiCreditUsage(db, identity.tenantId, clock)
    assert.equal(usage.monthly.used, 0); assert.equal(usage.monthly.reserved, 0)
    assert.equal(await db.aiCreditLedger.count({ where: { tenantId: identity.tenantId, kind: "COMMIT" } }), 0)
  })
  await t.test("TTL expiry rejects replay, maintenance erases ciphertext and abandoned reservations recover once", async () => {
    const { identity, run } = await fixture()
    await run({}, async () => "private cached answer", model)
    const abandoned = { ...identity, requestId: randomUUID(), requestHash: "a".repeat(64) }
    await reserveAiCredit(db, abandoned, clock)
    clock = new Date(clock.getTime() + 15 * 60000)
    const maintenance = await maintainAiCredits(db, clock)
    assert.equal(maintenance.released, 1); assert.ok(maintenance.purged >= 1)
    const row = await db.aiCreditRequest.findFirstOrThrow({ where: { tenantId: identity.tenantId, status: "COMMITTED" } })
    assert.equal(row.responseCiphertext, null); assert.equal(row.responseExpiresAt, null)
    await assert.rejects(run({}, async () => "must not regenerate", model), /AI_RESPONSE_EXPIRED/)
    assert.deepEqual(await maintainAiCredits(db, clock), { released: 0, purged: 0 })
    assert.equal((await readAiCreditUsage(db, identity.tenantId, clock)).monthly.used, 1)
  })
  await t.test("real chat routes replay across lost responses, recheck access, and keep contact fallbacks free", async st => {
    const { identity } = await fixture()
    const { prisma } = await import("./prisma.js")
    const { createAiTestChatRouter } = await import("../routes/ai-test-chat.routes.js")
    const { createContactAssistantRouter } = await import("../routes/contact-assistant.routes.js")
    const { answerContactAssistant } = await import("./ai-contact-assistant.js")
    const originalSession = prisma.session.findUnique, originalMembership = prisma.membership.findUnique
    let active = true, revision = 0, failAnalytics = true, calls = 0, failProvider = false
    prisma.session.findUnique = (async () => ({ expiresAt: new Date(Date.now() + 60000), user: { id: identity.actorId, name: "Fixture", email: "fixture@example.test", platformRole: "NONE" } })) as unknown as typeof originalSession
    prisma.membership.findUnique = (async () => active ? { role: "TENANT_ADMIN", status: "ACTIVE" } : null) as unknown as typeof originalMembership
    st.after(() => { prisma.session.findUnique = originalSession; prisma.membership.findUnique = originalMembership })
    const provider: AiChatProvider = async () => {
      calls++
      if (failProvider) throw new Error("Synthetic provider failure")
      return { answer: "Synthetic AI answer", sourceIds: [], outcome: "ANSWERED" }
    }
    provider.model = model
    const snapshot = (): AiChatSnapshot => ({ helper: { name: "Fixture", language: "English", tone: "Warm", instructions: "", revision }, skillCount: 0, sources: [] })
    const execute: typeof createAiReplyExecutor = (_client, who, opts) => createAiReplyExecutor(db, who, { ...opts, env, now: () => clock })
    const app = express(); app.use(cookieParser(), express.json())
    app.use("/api/account-settings", createAiTestChatRouter({ load: async () => snapshot(), getProvider: () => provider, execute,
      recordActivity: async () => { if (failAnalytics) { failAnalytics = false; throw new Error("Synthetic lost response") } return { count: 1 } },
    }))
    app.use("/api/services", createContactAssistantRouter({
      requireMembership: async (_req, res, tenantId) => {
        if (!active || tenantId !== identity.tenantId) { res.status(403).json({ error: "FORBIDDEN" }); return null }
        return { role: "TENANT_USER" }
      },
      evaluate: async () => ({ items: [] }), record: async () => ({ count: 1 }), execute,
      identity: async () => ({ name: "Fixture", avatar: { presetId: "compass", imageUrl: null, revision: 0 } }),
      reply: (client, tenantId, input, signal, overrides) => answerContactAssistant(client, tenantId, input, signal, { load: async () => snapshot(), getProvider: () => provider, ...overrides }),
    }))
    const errors: ErrorRequestHandler = (error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.code ?? "TEST_ERROR" })
    app.use(errors)
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); s.once("error", reject) })
    st.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() }))
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const headers = { cookie: "sid=test", origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", "content-type": "application/json" }
    const post = (path: string, body: unknown) => fetch(`${root}${path}`, { method: "POST", headers, body: JSON.stringify(body) })
    const path = `/api/account-settings/${identity.tenantId}/ai/test-chat/messages`
    const body = { question: "Hello", requestId: identity.requestId, conversationId: identity.conversationId }
    assert.equal((await post(path, body)).status, 500) // debit/replay saved before analytics failed
    const recovered = await post(path, body); assert.equal(recovered.status, 200)
    const recoveredBody = await recovered.json()
    assert.deepEqual(await (await post(path, body)).json(), recoveredBody)
    assert.equal(calls, 1)
    active = false; assert.equal((await post(path, body)).status, 403); active = true
    revision++; assert.equal((await post(path, body)).status, 409)
    assert.equal((await post(path, { question: "No IDs" })).status, 400)
    const contactPath = `/api/services/${identity.tenantId}/fit-scan/assistant`
    assert.equal((await post(contactPath, { contactId: "synthetic", scope: "all" })).status, 200)
    const contactBody = { contactId: "synthetic", scope: "all", question: "What is the company name?", conversationId: randomUUID(), requestId: randomUUID() }
    assert.equal((await post(contactPath, contactBody)).status, 200)
    assert.equal((await post(contactPath, contactBody)).status, 200)
    assert.equal(calls, 2)
    failProvider = true
    const fallback = await post(contactPath, { ...contactBody, requestId: randomUUID() })
    assert.equal(fallback.status, 200); assert.equal((await fallback.json()).answer.replySource, "FALLBACK")
    assert.equal((await readAiCreditUsage(db, identity.tenantId, clock)).monthly.used, 2)
    await pool.query('UPDATE "TenantSubscription" SET "status" = $2 WHERE "tenantId" = $1', [identity.tenantId, "PAST_DUE"])
    assert.equal((await post(contactPath, { ...contactBody, requestId: randomUUID() })).status, 402)
    assert.equal((await post(`/api/services/${identity.tenantId}/fit-scan/run`, { contactId: "synthetic" })).status, 200)
  })
})
