import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import express, { type ErrorRequestHandler } from "express"
import cookieParser from "cookie-parser"
import { Pool } from "pg"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../generated/prisma/index.js"
import { recordAiInteraction } from "./ai-analytics.js"
import { AiReviewListQuerySchema, listAiAnswerReviews, readAiAnswerReview, updateAiAnswerReview, purgeExpiredAiReviews } from "./ai-answer-reviews.js"

const connectionString = process.env.AI_CREDIT_TEST_DATABASE_URL
test("real review storage, route authorization, pagination, deduplication, resolution and retention remain tenant scoped", { skip: !connectionString }, async t => {
  const oldKey = process.env.AI_REPLAY_ENCRYPTION_KEY
  process.env.AI_REPLAY_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString("base64")
  t.after(() => { if (oldKey === undefined) delete process.env.AI_REPLAY_ENCRYPTION_KEY; else process.env.AI_REPLAY_ENCRYPTION_KEY = oldKey })
  const schema = `reviews_${randomUUID().replaceAll("-", "")}`
  const admin = new Pool({ connectionString }); await admin.query(`CREATE SCHEMA "${schema}"`)
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` })
  const db = new PrismaClient({ adapter: new PrismaPg(pool, { schema, disposeExternalPool: false }) })
  t.after(async () => { await db.$disconnect(); await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end() })
  await pool.query(`CREATE TYPE "AiActivityChannel" AS ENUM ('TEST','CONTACT_ASSISTANT'); CREATE TYPE "AiQuestionOutcome" AS ENUM ('ANSWERED','NEEDS_REVIEW');
    CREATE TABLE "AiInteraction" (id text PRIMARY KEY, "tenantId" text NOT NULL, "actorId" text NOT NULL, channel "AiActivityChannel" NOT NULL, "conversationId" uuid NOT NULL, "requestId" uuid NOT NULL, "questionOutcome" "AiQuestionOutcome", "qualificationRun" boolean NOT NULL DEFAULT false, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE ("tenantId","actorId",channel,"requestId"));`)
  await pool.query(await readFile(join(__dirname, "../../prisma/migrations/20261126010000_ai_answer_reviews/migration.sql"), "utf8"))
  const tenantId = randomUUID(), foreignId = randomUUID(), actorId = randomUUID()
  let now = new Date(Date.now() + 60000)
  const base = { tenantId, actorId, channel: "TEST" as const, conversationId: randomUUID(), qualificationRun: false }
  const requestId = randomUUID().toUpperCase()
  const activity = { ...base, requestId, questionOutcome: "NEEDS_REVIEW" as const, reviewReason: "MISSING_KNOWLEDGE" as const, review: { question: "Fixture question about a missing price?", answer: "The saved price is unavailable.", sourceLabels: ["Pricing"] } }
  await Promise.all([recordAiInteraction(db, activity), recordAiInteraction(db, activity)])
  assert.equal(await db.aiInteraction.count({ where: { tenantId } }), 1)
  const stored = await db.aiInteraction.findFirstOrThrow({ where: { tenantId } })
  assert.doesNotMatch(JSON.stringify(stored), /Fixture question|saved price|Pricing/)
  assert.equal(stored.requestId, requestId.toLowerCase())
  await recordAiInteraction(db, { ...activity, questionOutcome: "ANSWERED", requestId: randomUUID() })
  await recordAiInteraction(db, { ...activity, review: undefined, requestId: randomUUID() })
  await recordAiInteraction(db, { ...activity, tenantId: foreignId, requestId: randomUUID() })
  await recordAiInteraction(db, { ...activity, channel: "CONTACT_ASSISTANT", requestId: randomUUID() })
  const query = (extra: object = {}) => AiReviewListQuerySchema.parse({ days: "7", channel: "TEST", ...extra })
  let list = await listAiAnswerReviews(db, tenantId, query(), now)
  assert.deepEqual(list.counts, { open: 1, reviewed: 0, unavailable: 1 })
  assert.equal(list.items[0]?.questionPreview, activity.review.question)
  assert.doesNotMatch(JSON.stringify(list), /saved price|Ciphertext|AuthTag|actorId/)
  const detail = await readAiAnswerReview(db, tenantId, stored.id, now)
  assert.equal(detail.details.answer, activity.review.answer)
  await assert.rejects(readAiAnswerReview(db, foreignId, stored.id, now), /AI_REVIEW_NOT_FOUND/)
  const updated = await updateAiAnswerReview(db, tenantId, stored.id, actorId, { reviewed: true, revision: 0 }, now)
  assert.ok(updated.reviewedAt); assert.equal(updated.revision, 1)
  assert.equal((await updateAiAnswerReview(db, tenantId, stored.id, "another-admin", { reviewed: true, revision: 0 }, now)).revision, 1)
  await assert.rejects(updateAiAnswerReview(db, tenantId, stored.id, actorId, { reviewed: false, revision: 0 }, now), /AI_REVIEW_CHANGED/)
  assert.equal((await db.aiInteraction.findUniqueOrThrow({ where: { id: stored.id } })).questionOutcome, "NEEDS_REVIEW")
  assert.equal((await listAiAnswerReviews(db, tenantId, query(), now)).items.length, 0)
  assert.equal((await listAiAnswerReviews(db, tenantId, query({ state: "REVIEWED" }), now)).items.length, 1)
  await updateAiAnswerReview(db, tenantId, stored.id, actorId, { reviewed: false, revision: 1 }, now)
  for (let i = 0; i < 24; i++) await recordAiInteraction(db, { ...activity, requestId: randomUUID() })
  list = await listAiAnswerReviews(db, tenantId, query(), now)
  assert.equal(list.items.length, 20); assert.ok(list.nextCursor)
  const second = await listAiAnswerReviews(db, tenantId, query({ cursor: list.nextCursor }), now)
  assert.equal(second.items.length, 5)
  assert.equal(new Set([...list.items, ...second.items].map(row => row.id)).size, 25)
  const foreign = await db.aiInteraction.findFirstOrThrow({ where: { tenantId: foreignId } })
  await assert.rejects(listAiAnswerReviews(db, tenantId, query({ cursor: foreign.id }), now), /AI_REVIEW_CURSOR_INVALID/)

  const { prisma } = await import("./prisma.js"), { createAiAnalyticsRouter } = await import("../routes/ai-analytics.routes.js")
  const originals = { session: prisma.session.findUnique, membership: prisma.membership.findUnique }
  let role = "TENANT_ADMIN", active = true
  prisma.session.findUnique = (async () => ({ expiresAt: new Date(Date.now() + 60000), user: { id: actorId, name: "Fixture", email: "fixture@example.test", platformRole: "NONE" } })) as unknown as typeof originals.session
  prisma.membership.findUnique = (async ({ where }: { where: { userId_tenantId: { tenantId: string } } }) => where.userId_tenantId.tenantId === tenantId && active ? { status: "ACTIVE", role } : null) as unknown as typeof originals.membership
  t.after(() => { prisma.session.findUnique = originals.session; prisma.membership.findUnique = originals.membership })
  const app = express(); app.use(cookieParser(), express.json()); app.use("/api/account-settings", createAiAnalyticsRouter({ db, now: () => now }))
  app.use(((error, _req, res, _next) => res.status(error.name === "ZodError" ? 400 : error.status ?? 500).json({ error: "TEST_ERROR" })) as ErrorRequestHandler)
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); server.once("error", reject) })
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() }))
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/account-settings/${tenantId}/ai/analytics/reviews`, headers = { cookie: "sid=fixture", "content-type": "application/json", origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" }
  assert.equal((await fetch(root)).status, 401)
  const response = await fetch(root, { headers }); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal((await fetch(`${root}/${foreign.id}`, { headers })).status, 404)
  assert.equal((await fetch(`${root}?days=365`, { headers })).status, 400)
  const patch = (origin: string, body = { reviewed: true, revision: 2 }) => fetch(`${root}/${stored.id}`, { method: "PATCH", headers: { ...headers, origin }, body: JSON.stringify(body) })
  assert.equal((await patch("https://untrusted.example.test")).status, 403)
  assert.equal((await patch(headers.origin)).status, 200)
  role = "TENANT_USER"; assert.equal((await fetch(root, { headers })).status, 403); assert.equal((await fetch(`${root}/${stored.id}`, { headers })).status, 403)
  role = "TENANT_ADMIN"; active = false; assert.equal((await patch(headers.origin)).status, 403)
  active = true
  now = new Date(now.getTime() + 31 * 86400000)
  assert.equal((await fetch(`${root}/${stored.id}`, { headers })).status, 404)
  const purge = await purgeExpiredAiReviews(db, now); assert.ok(purge.count >= 27)
  const expired = await db.aiInteraction.findUniqueOrThrow({ where: { id: stored.id } })
  assert.equal(expired.reviewCiphertext, null); assert.equal(expired.reviewIv, null); assert.equal(expired.reviewAuthTag, null)
  assert.equal(expired.questionOutcome, "NEEDS_REVIEW"); assert.ok(expired.reviewedAt)
})
