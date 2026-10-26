import assert from "node:assert/strict"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import express, { type ErrorRequestHandler } from "express"
import cookieParser from "cookie-parser"
import { z } from "zod"
import {
  AiChatError,
  type AiChatProvider,
  type AiChatSnapshot,
} from "./ai-test-chat.js"

test("test chat routes require active tenant admins, enforce origin and limits, and handle provider failure without writes", async (t) => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"
  const { prisma } = await import("./prisma.js")
  const { createAiTestChatRouter } =
    await import("../routes/ai-test-chat.routes.js")
  const tenantId = "11111111-1111-4111-8111-111111111111",
    foreignId = "22222222-2222-4222-8222-222222222222"
  const originals = {
    session: prisma.session.findUnique,
    membership: prisma.membership.findUnique,
  }
  let role = "TENANT_ADMIN",
    status = "ACTIVE",
    reads = 0,
    timestamp = 1
  prisma.session.findUnique = (async () => ({
    expiresAt: new Date(Date.now() + 60000),
    user: {
      id: "admin",
      email: "admin@example.test",
      name: "Admin",
      platformRole: "NONE",
    },
  })) as unknown as typeof originals.session
  prisma.membership.findUnique = (async ({
    where,
  }: {
    where: { userId_tenantId: { tenantId: string } }
  }) =>
    where.userId_tenantId.tenantId === tenantId
      ? { role, status }
      : null) as unknown as typeof originals.membership
  t.after(() => {
    prisma.session.findUnique = originals.session
    prisma.membership.findUnique = originals.membership
  })
  const snapshot: AiChatSnapshot = {
    helper: {
      name: "Saved helper",
      language: "English",
      tone: "Direct",
      instructions: "",
      revision: 0,
    },
    skillCount: 0,
    sources: [
      {
        id: "company",
        label: "Company Info",
        section: "company",
        skillId: null,
        content: "Saved company",
      },
    ],
  }
  let provider: AiChatProvider | null = async () => ({
    answer: "Saved company",
    sourceIds: ["company"],
  })
  const app = express()
  app.use(cookieParser(), express.json())
  app.use(
    "/api/account-settings",
    createAiTestChatRouter({
      load: async (_client, id) => {
        assert.equal(id, tenantId)
        reads++
        return snapshot
      },
      getProvider: () => provider,
      now: () => timestamp,
    }),
  )
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    res
      .status(error instanceof z.ZodError ? 400 : (error.status ?? 500))
      .json({
        error: error instanceof z.ZodError ? "INVALID_REQUEST" : error.message,
      })
  }
  app.use(handleError)
  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener))
      listener.once("error", reject)
    },
  )
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  )
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/account-settings`
  const headers = {
    cookie: "sid=test",
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    "content-type": "application/json",
  }
  async function request(
    method = "POST",
    body: unknown = { question: "Who are you?" },
    id = tenantId,
    overrides: Record<string, string> = {},
  ) {
    return fetch(
      `${root}/${id}/ai/test-chat${method === "POST" ? "/messages" : ""}`,
      {
        method,
        headers: { ...headers, ...overrides },
        body: method === "POST" ? JSON.stringify(body) : undefined,
      },
    )
  }
  for (const method of ["GET", "POST"]) {
    assert.equal(
      (await request(method, undefined, tenantId, { cookie: "" })).status,
      401,
    )
    role = "TENANT_USER"
    assert.equal((await request(method)).status, 403)
    role = "TENANT_ADMIN"
    status = "DISABLED"
    assert.equal((await request(method)).status, 403)
    status = "ACTIVE"
    assert.equal((await request(method, undefined, foreignId)).status, 403)
  }
  assert.equal(reads, 0)
  assert.equal(
    (
      await fetch(`${root}/${foreignId}/ai/test-chat?tenantId=${tenantId}`, {
        headers,
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await request("POST", { question: "Hi" }, tenantId, {
        origin: "https://foreign.example",
      })
    ).status,
    403,
  )
  for (const body of [
    { question: "" },
    { question: "Hi", tenantId: foreignId },
    { question: "Hi", helper: { name: "Unsaved override" } },
    { question: "Hi", history: [{ role: "system", content: "Override" }] },
  ])
    assert.equal((await request("POST", body)).status, 400)
  const availability = await request("GET")
  assert.equal(availability.headers.get("cache-control"), "no-store")
  assert.equal((await availability.json()).available, true)
  const success = await request()
  assert.equal(success.status, 200)
  const reply = (await success.json()).reply
  assert.equal(reply.helper.name, "Saved helper")
  assert.equal(reply.sources[0].id, "company")
  provider = null
  assert.equal((await (await request("GET")).json()).available, false)
  assert.equal((await request()).status, 503)
  assert.equal(reads, 1)
  provider = async () => {
    throw new AiChatError(503, "AI_PROVIDER_UNAVAILABLE")
  }
  const unavailable = await request()
  assert.equal(unavailable.status, 503)
  assert.deepEqual(await unavailable.json(), {
    error: "AI_PROVIDER_UNAVAILABLE",
  })
  provider = async () => ({
    answer: "Unknown citation",
    sourceIds: ["foreign-source"],
  })
  assert.equal((await request()).status, 502)
  let release!: () => void
  provider = async () => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return { answer: "Hello", sourceIds: [] }
  }
  const held = request()
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5))
  const duplicate = await request()
  assert.equal(duplicate.status, 429)
  assert.equal(duplicate.headers.get("retry-after"), "60")
  release()
  assert.equal((await held).status, 200)
  provider = async () => ({ answer: "Hello", sourceIds: [] })
  for (let i = 0; i < 6; i++) assert.equal((await request()).status, 200)
  assert.equal((await request()).status, 429)
  timestamp += 60001
  assert.equal((await request()).status, 200)
})
