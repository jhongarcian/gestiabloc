import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import express, { type ErrorRequestHandler, type Router } from "express"
import cookieParser from "cookie-parser"
import { z } from "zod"
import { sha256 } from "./crypto.js"

// Opt-in: creates and removes isolated fixtures in the configured database and blob store.
// AI_SETTINGS_LIVE_TEST=1 node --env-file=.env --import tsx --test src/lib/ai-helper-settings.integration.test.ts
test(
  "AI settings persist through real authenticated routes, storage, and new sessions",
  { skip: process.env.AI_SETTINGS_LIVE_TEST !== "1" },
  async (t) => {
    const { prisma } = await import("./prisma.js")
    const routeModule = await import("../routes/ai-settings.routes.js")
    const { deleteBlobByUrl } = await import("./blob.js")
    const tenantId = randomUUID()
    const foreignTenantId = randomUUID()
    const userId = randomUUID()
    const token = randomUUID()
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSugAAAAASUVORK5CYII=",
      "base64",
    )
    t.after(async () => {
      // Release the helper reference before deleting files, and keep cleanup scoped to this fixture.
      await prisma.tenantAiSettings.deleteMany({ where: { tenantId } })
      const leftovers = await prisma.file.findMany({
        where: { tenantId, purpose: "AI_AVATAR" },
      })
      for (const file of leftovers) await deleteBlobByUrl(file.key)
      await prisma.tenant.deleteMany({
        where: { id: { in: [tenantId, foreignTenantId] } },
      })
      await prisma.user.deleteMany({ where: { id: userId } })
      await prisma.$disconnect()
    })
    await prisma.tenant.createMany({
      data: [
        {
          id: tenantId,
          name: "AI settings integration fixture",
          slug: `ai-settings-test-${tenantId}`,
        },
        {
          id: foreignTenantId,
          name: "AI settings foreign fixture",
          slug: `ai-settings-test-${foreignTenantId}`,
        },
      ],
    })
    await prisma.user.create({
      data: {
        id: userId,
        name: "AI Settings Test",
        email: `ai-settings-${userId}@example.test`,
        image: "https://example.test/personal-avatar.png",
      },
    })
    await prisma.membership.create({
      data: { tenantId, userId, role: "TENANT_ADMIN", status: "ACTIVE" },
    })
    await prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 300000),
      },
    })
    const app = express()
    app.use(cookieParser(), express.json())
    app.use("/api/account-settings", routeModule.default as unknown as Router)
    const errors: ErrorRequestHandler = (error, _req, res, _next) => {
      res
        .status(error instanceof z.ZodError ? 400 : (error.status ?? 500))
        .json({ error: error.message })
    }
    app.use(errors)
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
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/account-settings`
    let cookie = `sid=${token}`
    async function request(section: string, method = "GET", body?: unknown) {
      const result = await fetch(`${base}/${tenantId}/ai/${section}`, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: result.status, data: await result.json() }
    }
    async function upload(revision: number) {
      const form = new FormData()
      form.append("avatarRevision", String(revision))
      form.append("file", new Blob([png], { type: "image/png" }), "avatar.png")
      const result = await fetch(`${base}/${tenantId}/ai/avatar`, {
        method: "POST",
        headers: { cookie },
        body: form,
      })
      return { status: result.status, data: await result.json() }
    }
    const initial = await request("settings")
    assert.equal(initial.status, 200)
    assert.equal(initial.data.settings.name, "AI Helper")
    assert.equal(
      await prisma.tenantAiSettings.count({ where: { tenantId } }),
      0,
    )
    const text = {
      name: "Nora",
      language: "English and Spanish",
      tone: "Warm",
      instructions: "Ask one question at a time.",
      revision: 0,
    }
    const saved = await request("settings", "PATCH", text)
    assert.equal(saved.status, 200)
    assert.equal(saved.data.settings.revision, 1)
    assert.equal(
      (
        await fetch(`${base}/${foreignTenantId}/ai/settings`, {
          headers: { cookie },
        })
      ).status,
      403,
    )

    const first = await upload(0)
    assert.equal(first.status, 200)
    assert.equal(first.data.settings.revision, 1)
    assert.equal((await fetch(first.data.settings.avatar.imageUrl)).status, 200)
    const firstFile = await prisma.file.findFirstOrThrow({
      where: { tenantId, purpose: "AI_AVATAR" },
    })
    await assert.rejects(
      prisma.tenantAiSettings.create({
        data: { tenantId: foreignTenantId, avatarFileId: firstFile.id },
      }),
      { code: "P2003" },
    )
    const second = await upload(1)
    assert.equal(second.status, 200)
    assert.notEqual(
      second.data.settings.avatar.imageUrl,
      first.data.settings.avatar.imageUrl,
    )
    assert.equal(
      await prisma.file.count({ where: { tenantId, purpose: "AI_AVATAR" } }),
      1,
    )
    assert.equal(
      await prisma.file.findUnique({ where: { id: firstFile.id } }),
      null,
    )
    assert.equal((await upload(1)).status, 409)
    assert.equal(
      await prisma.file.count({ where: { tenantId, purpose: "AI_AVATAR" } }),
      1,
    )

    const competing = await Promise.all([
      request("settings", "PATCH", {
        ...text,
        name: "First edit",
        revision: 1,
      }),
      request("settings", "PATCH", {
        ...text,
        name: "Second edit",
        revision: 1,
      }),
    ])
    assert.deepEqual(
      competing.map((result) => result.status).sort(),
      [200, 409],
    )
    const beforeNewSession = (await request("settings")).data.settings
    await prisma.session.deleteMany({ where: { userId } })
    assert.equal((await request("settings")).status, 401)
    const newToken = randomUUID()
    await prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(newToken),
        expiresAt: new Date(Date.now() + 300000),
      },
    })
    cookie = `sid=${newToken}`
    assert.deepEqual(
      (await request("settings")).data.settings,
      beforeNewSession,
    )
    const removed = await request("avatar", "DELETE", { avatarRevision: 2 })
    assert.equal(removed.status, 200)
    assert.equal(removed.data.settings.avatar.imageUrl, null)
    assert.equal(removed.data.settings.avatar.presetId, "bot")
    assert.equal(
      await prisma.file.count({ where: { tenantId, purpose: "AI_AVATAR" } }),
      0,
    )
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).image,
      "https://example.test/personal-avatar.png",
    )
  },
)
