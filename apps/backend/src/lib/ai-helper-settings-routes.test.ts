import assert from "node:assert/strict"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import express, { type ErrorRequestHandler, type Router } from "express"
import cookieParser from "cookie-parser"
import { z } from "zod"
import {
  defaultAiSettings,
  type AiSettingsInput,
} from "./ai-helper-settings.js"

test("AI settings routes enforce account admin access, origin, validation, and scoped writes", async (t) => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"
  const previousOrigin = process.env.WEB_ORIGIN
  process.env.WEB_ORIGIN = "http://localhost:3000"
  t.after(() => {
    if (previousOrigin === undefined) delete process.env.WEB_ORIGIN
    else process.env.WEB_ORIGIN = previousOrigin
  })
  const { prisma } = await import("./prisma.js")
  const { aiSettingsStore } = await import("./ai-helper-settings-store.js")
  const routeModule = await import("../routes/ai-settings.routes.js")
  const router = routeModule.default as unknown as Router
  const tenantId = "11111111-1111-4111-8111-111111111111"
  const otherTenantId = "22222222-2222-4222-8222-222222222222"
  let role = "TENANT_ADMIN"
  let status = "ACTIVE"
  let savedName = "AI Helper"
  let reads = 0
  let writes = 0
  const originalSessionLookup = prisma.session.findUnique
  const originalMembershipLookup = prisma.membership.findUnique
  prisma.session.findUnique = (async () => ({
    id: "session",
    expiresAt: new Date(Date.now() + 60000),
    user: {
      id: "admin",
      email: "admin@example.test",
      name: "Admin",
      platformRole: "USER",
    },
  })) as unknown as typeof originalSessionLookup
  prisma.membership.findUnique = (async ({
    where,
  }: {
    where: { userId_tenantId: { tenantId: string } }
  }) =>
    where.userId_tenantId.tenantId === tenantId
      ? { role, status }
      : null) as unknown as typeof originalMembershipLookup
  t.after(() => {
    prisma.session.findUnique = originalSessionLookup
    prisma.membership.findUnique = originalMembershipLookup
  })
  t.mock.method(aiSettingsStore, "read", async (scope: string) => {
    reads++
    assert.equal(scope, tenantId)
    return null
  })
  t.mock.method(
    aiSettingsStore,
    "saveSettings",
    async (scope: string, input: AiSettingsInput) => {
      writes++
      assert.equal(scope, tenantId)
      savedName = input.name
      return {
        tenantId,
        ...input,
        revision: input.revision + 1,
        avatarRevision: 0,
        avatarPresetId: "bot",
        avatarFileId: null,
        avatarFile: null,
      }
    },
  )
  const app = express()
  app.use(cookieParser(), express.json())
  app.use("/api/account-settings", router)
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error instanceof z.ZodError ? 400 : (error.status ?? 500)).json({
      error: error instanceof z.ZodError ? "VALIDATION_ERROR" : error.message,
    })
  }
  app.use(errors)
  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening))
      listening.once("error", reject)
    },
  )
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  )
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/account-settings`
  const headers = {
    cookie: "sid=test-session",
    origin: "http://localhost:3000",
    "content-type": "application/json",
  }
  const fields = {
    name: "Nora",
    language: "Spanish",
    tone: "Warm",
    instructions: "Be helpful.",
    revision: 0,
  }

  await t.test(
    "all routes reject unauthenticated, non-admin, inactive, and foreign-account requests",
    async () => {
      for (const [method, section, body] of [
        ["GET", "settings", undefined],
        ["PATCH", "settings", fields],
        ["POST", "avatar", {}],
        ["PATCH", "avatar", { presetId: "bot", avatarRevision: 0 }],
        ["DELETE", "avatar", { avatarRevision: 0 }],
      ] as const) {
        const options = {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        }
        assert.equal(
          (
            await fetch(`${base}/${tenantId}/ai/${section}`, {
              ...options,
              headers: {
                origin: headers.origin,
                "content-type": "application/json",
              },
            })
          ).status,
          401,
        )
        role = "TENANT_USER"
        assert.equal(
          (await fetch(`${base}/${tenantId}/ai/${section}`, options)).status,
          403,
        )
        role = "TENANT_ADMIN"
        status = "INACTIVE"
        assert.equal(
          (await fetch(`${base}/${tenantId}/ai/${section}`, options)).status,
          403,
        )
        status = "ACTIVE"
        assert.equal(
          (
            await fetch(
              `${base}/${otherTenantId}/ai/${section}?tenantId=${tenantId}`,
              options,
            )
          ).status,
          403,
        )
      }
      assert.equal(reads, 0)
      assert.equal(writes, 0)
    },
  )
  await t.test(
    "admin reads defaults and can save text in the authorized tenant only",
    async () => {
      const read = await fetch(`${base}/${tenantId}/ai/settings`, { headers })
      assert.equal(read.status, 200)
      assert.deepEqual((await read.json()).settings, defaultAiSettings())
      const result = await fetch(`${base}/${tenantId}/ai/settings`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(fields),
      })
      assert.equal(result.status, 200)
      assert.equal((await result.json()).settings.revision, 1)
      assert.equal(savedName, "Nora")
    },
  )
  await t.test(
    "invalid bodies and foreign origins never reach settings writes",
    async () => {
      const previousWrites = writes
      for (const body of [
        { ...fields, name: " " },
        { ...fields, revision: -1 },
        { ...fields, tone: "unknown" },
        { ...fields, tenantId: otherTenantId },
        { ...fields, avatarFileId: "personal-file" },
      ]) {
        assert.equal(
          (
            await fetch(`${base}/${tenantId}/ai/settings`, {
              method: "PATCH",
              headers,
              body: JSON.stringify(body),
            })
          ).status,
          400,
        )
      }
      for (const method of ["PATCH", "POST", "DELETE"]) {
        assert.equal(
          (
            await fetch(`${base}/${tenantId}/ai/avatar`, {
              method,
              headers: { ...headers, origin: "https://foreign.example" },
              body: "{}",
            })
          ).status,
          403,
        )
      }
      assert.equal(writes, previousWrites)
    },
  )
  await t.test(
    "avatar uploads reject missing, spoofed, and oversized images before storage",
    async () => {
      for (const [content, expected] of [
        [null, 400],
        [Buffer.from("not an image"), 400],
        [Buffer.alloc(5 * 1024 * 1024 + 1), 413],
      ] as const) {
        const form = new FormData()
        form.append("avatarRevision", "0")
        if (content)
          form.append(
            "file",
            new Blob([content], { type: "image/png" }),
            "avatar.png",
          )
        const result = await fetch(`${base}/${tenantId}/ai/avatar`, {
          method: "POST",
          headers: { cookie: headers.cookie, origin: headers.origin },
          body: form,
        })
        assert.equal(result.status, expected)
      }
    },
  )
})
