import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import express, { type ErrorRequestHandler } from "express"
import cookieParser from "cookie-parser"
import { z } from "zod"
import { sha256 } from "./crypto.js"
import { aiSourcePdf } from "./ai-source-fixtures.js"

// Isolated accounts and real private Supabase objects. Future scheduling keeps
// test work reserved for the tenant-scoped worker without pausing app workers.
// AI_SOURCES_LIVE_TEST=1 AI_SOURCES_REAL_AI_TEST=1 node --env-file=.env --import tsx --test src/lib/ai-sources.integration.test.ts
test(
  "AI sources persist privately, process safely, isolate tenants, retrieve current text and clean deleted/cascaded objects",
  { skip: process.env.AI_SOURCES_LIVE_TEST !== "1" },
  async (t) => {
    const { prisma } = await import("./prisma.js")
    const { createAiSourcesRouter } =
      await import("../routes/ai-sources.routes.js")
    const future = new Date(Date.now() + 3_600_000)
    const routes = createAiSourcesRouter({ scheduleAt: () => future })
    const { aiSourceStorage } = await import("./ai-source-storage.js")
    const { runAiSourceWorkerOnce } = await import("./ai-source-worker.js")
    const { extractAiFile } = await import("./ai-source-extraction.js")
    const { fetchAiWebpage } = await import("./ai-source-web.js")
    const { uploadAiFile, mutateAiSource } = await import("./ai-sources.js")
    const { loadAiChatSnapshot, getAiChatProvider, replyToAiTestChat } =
      await import("./ai-test-chat.js")
    const tenantId = randomUUID(),
      foreignId = randomUUID(),
      userId = randomUUID(),
      token = randomUUID()
    const keys = new Set<string>()
    t.after(async () => {
      for (const source of await prisma.serviceAiSource.findMany({
        where: { tenantId },
        select: { storageKey: true },
      }))
        if (source.storageKey) keys.add(source.storageKey)
      for (const item of await prisma.aiSourceStorageCleanup.findMany({
        where: { tenantId },
      }))
        keys.add(item.storageKey)
      await prisma.service.deleteMany({
        where: { tenantId: { in: [tenantId, foreignId] }, kind: "OFFERING" },
      })
      await prisma.tenant.deleteMany({
        where: { id: { in: [tenantId, foreignId] } },
      })
      await prisma.user.deleteMany({ where: { id: userId } })
      for (const key of keys) await aiSourceStorage.remove(key)
      await prisma.aiSourceStorageCleanup.deleteMany({
        where: { tenantId: { in: [tenantId, foreignId] } },
      })
      await prisma.$disconnect()
    })
    await prisma.tenant.createMany({
      data: [tenantId, foreignId].map((id) => ({
        id,
        slug: `ai-sources-test-${id}`,
        name: "Harbor Source Test",
      })),
    })
    await prisma.user.create({
      data: {
        id: userId,
        email: `source-test-${userId}@example.test`,
        name: "Source Test",
      },
    })
    await prisma.membership.create({
      data: { tenantId, userId, role: "TENANT_ADMIN", status: "ACTIVE" },
    })
    await prisma.session.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 600000),
      },
    })
    const parent = await prisma.service.create({
      data: {
        tenantId,
        kind: "GROUP",
        name: "Test services",
        basePriceCents: 7500,
      },
    })
    const profile = {
      enabled: true,
      rules: [],
      knowledgeProfile: {
        overview: "Saved knowledge",
        faqNotes: "Legacy FAQ remains untouched",
      },
      verificationProfile: { sourceUrls: ["https://example.com/legacy"] },
      extension: { keep: true },
    }
    const service = await prisma.service.create({
      data: {
        tenantId,
        kind: "OFFERING",
        parentServiceId: parent.id,
        name: "Harbor intake",
        basePriceCents: 7500,
        fitProfile: profile,
      },
    })
    const foreignParent = await prisma.service.create({
      data: {
        tenantId: foreignId,
        kind: "GROUP",
        name: "Other group",
        basePriceCents: 0,
      },
    })
    const foreign = await prisma.service.create({
      data: {
        tenantId: foreignId,
        kind: "OFFERING",
        parentServiceId: foreignParent.id,
        name: "Other skill",
        basePriceCents: 0,
      },
    })
    const app = express()
    app.use(cookieParser(), express.json())
    app.use("/api/account-settings", routes)
    const errors: ErrorRequestHandler = (error, _req, res, _next) =>
      res
        .status(error instanceof z.ZodError ? 400 : (error.status ?? 500))
        .json({ error: error.code ?? error.message })
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
    const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const path = `/api/account-settings/${tenantId}/ai/skills/${service.id}/sources`
    const headers = {
      cookie: `sid=${token}`,
      origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    }
    async function request(
      url = path,
      method = "GET",
      body?: unknown,
      extra: Record<string, string> = {},
    ) {
      const response = await fetch(root + url, {
        method,
        headers: { ...headers, "content-type": "application/json", ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: response.status, data: await response.json() }
    }
    async function upload(
      filename: string,
      bytes: Buffer,
      requestId = randomUUID(),
    ) {
      const form = new FormData()
      form.set("requestId", requestId)
      form.set("file", new Blob([new Uint8Array(bytes)]), filename)
      const response = await fetch(root + path + "/files", {
        method: "POST",
        headers,
        body: form,
      })
      const data = await response.json()
      if (data.source) {
        const saved = await prisma.serviceAiSource.findUniqueOrThrow({
          where: { id: data.source.id },
        })
        if (saved.storageKey) keys.add(saved.storageKey)
      }
      return { status: response.status, data, requestId }
    }
    const run = () =>
      runAiSourceWorkerOnce(
        prisma,
        {
          storage: aiSourceStorage,
          extract: extractAiFile,
          webpage: fetchAiWebpage,
        },
        tenantId,
        future,
      )
    assert.equal(
      (await request(path, "GET", undefined, { cookie: "" })).status,
      401,
    )
    for (const state of [
      { role: "TENANT_USER" as const, status: "ACTIVE" as const },
      { role: "TENANT_ADMIN" as const, status: "DISABLED" as const },
    ]) {
      await prisma.membership.update({
        where: { userId_tenantId: { userId, tenantId } },
        data: state,
      })
      assert.equal((await request()).status, 403)
      assert.equal((await request(path + "/links", "POST", {})).status, 403)
    }
    await prisma.membership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: { role: "TENANT_ADMIN", status: "ACTIVE" },
    })
    assert.equal(
      (
        await request(
          `/api/account-settings/${foreignId}/ai/skills/${foreign.id}/sources`,
        )
      ).status,
      403,
    )
    assert.equal(
      (
        await request(
          `/api/account-settings/${tenantId}/ai/skills/${foreign.id}/sources`,
        )
      ).status,
      404,
    )
    assert.equal(
      (
        await request(path + "/links", "POST", {
          requestId: randomUUID(),
          label: "Unsafe",
          url: "http://127.0.0.1",
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await request(
          path + "/links",
          "POST",
          {
            requestId: randomUUID(),
            label: "Public",
            url: "https://example.com",
          },
          { origin: "https://foreign.example" },
        )
      ).status,
      403,
    )
    assert.equal(
      (await upload("invalid.pdf", Buffer.from("Not a PDF"))).status,
      400,
    )
    const bytes = Buffer.from(
      "Harbor intake appointments use the Cedar desk. The intake reference code is T-42. Allow 3 business days.",
    )
    const uploaded = await upload("intake.txt", bytes)
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data))
    const id = uploaded.data.source.id
    assert.equal(
      (await upload("intake.txt", bytes, uploaded.requestId)).data.source.id,
      id,
    )
    let record = await prisma.serviceAiSource.findUniqueOrThrow({
      where: { id },
    })
    assert.ok(
      record.storageKey?.startsWith(
        `tenants/${tenantId}/ai/skills/${service.id}/sources/${id}/`,
      ),
    )
    assert.equal("storageKey" in uploaded.data.source, false)
    assert.deepEqual(await aiSourceStorage.download(record.storageKey!), bytes)
    const signed = await fetch(root + `${path}/${id}/download`, {
      headers,
      redirect: "manual",
    })
    assert.equal(signed.status, 303)
    const download = await fetch(signed.headers.get("location")!)
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes)
    const publicRead = await fetch(
      `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_STORAGE_BUCKET}/${record.storageKey}`,
    )
    assert.notEqual(publicRead.status, 200)
    assert.equal(
      (
        await request(
          `/api/account-settings/${foreignId}/ai/skills/${service.id}/sources/${id}/download`,
        )
      ).status,
      403,
    )
    await run()
    record = await prisma.serviceAiSource.findUniqueOrThrow({ where: { id } })
    assert.equal(record.status, "READY")
    assert.equal(record.progress, 100)
    const text = await request(`${path}/${id}/text`)
    assert.equal(text.status, 200)
    assert.match(text.data.chunks[0].content, /T-42/)
    const input = {
      question:
        "What is the Harbor intake reference code and which desk handles appointments?",
      history: [],
    }
    let snapshot = await loadAiChatSnapshot(prisma, tenantId, input)
    assert.ok(snapshot.sources.some((source) => source.sourceId === id))
    await prisma.service.update({
      where: { id: service.id },
      data: { isActive: false },
    })
    assert.equal(
      (await loadAiChatSnapshot(prisma, tenantId, input)).sources.some(
        (source) => source.sourceId === id,
      ),
      false,
    )
    await prisma.service.update({
      where: { id: service.id },
      data: { isActive: true },
    })
    if (process.env.AI_SOURCES_REAL_AI_TEST === "1") {
      const reply = await replyToAiTestChat(
        snapshot,
        input,
        getAiChatProvider(),
      )
      assert.match(reply.answer, /T-42/)
      assert.match(reply.answer, /Cedar/)
      assert.ok(reply.sources.some((source) => source.sourceId === id))
      await prisma.tenantAiSettings.create({
        data: { tenantId, language: "English and Spanish" },
      })
      const spanishInput = {
        question:
          "¿Cuál es el código de Harbor intake y en qué mostrador se atiende?",
        history: [],
      }
      const spanish = await replyToAiTestChat(
        await loadAiChatSnapshot(prisma, tenantId, spanishInput),
        spanishInput,
        getAiChatProvider(),
      )
      assert.match(spanish.answer, /T-42/)
      assert.match(spanish.answer, /Cedar/)
      assert.ok(spanish.sources.some((source) => source.sourceId === id))
    }
    const renamed = await request(`${path}/${id}`, "PATCH", {
      revision: record.revision,
      label: "Intake preparation",
    })
    assert.equal(renamed.status, 200)
    assert.equal(
      (
        await request(`${path}/${id}`, "PATCH", {
          revision: record.revision,
          label: "Stale edit",
        })
      ).status,
      409,
    )
    const link = await request(path + "/links", "POST", {
      requestId: randomUUID(),
      label: "Example Domain",
      url: "https://example.com",
    })
    assert.equal(link.status, 201)
    await run()
    const web = await prisma.serviceAiSource.findUniqueOrThrow({
      where: { id: link.data.source.id },
    })
    assert.equal(web.status, "READY", web.lastError ?? "")
    assert.match(
      (await request(`${path}/${web.id}/text`)).data.chunks[0].content,
      /documentation examples/i,
    )
    const changed = await request(`${path}/${web.id}`, "PATCH", {
      revision: web.revision,
      label: "Changed webpage",
      url: "https://example.org/",
    })
    assert.equal(changed.status, 200)
    assert.equal(
      await prisma.aiSourceChunk.count({ where: { sourceId: web.id } }),
      0,
    )
    await request(`${path}/${web.id}`, "DELETE", {
      revision: changed.data.source.revision,
    })
    const scan = await upload("scan.pdf", aiSourcePdf(null))
    assert.equal(scan.status, 201)
    await run()
    const scanned = await prisma.serviceAiSource.findUniqueOrThrow({
      where: { id: scan.data.source.id },
    })
    assert.equal(scanned.status, "OCR_REQUIRED")
    assert.equal(scanned.chunkCount, 0)
    assert.equal((await request(`${path}/${scanned.id}/text`)).status, 409)
    const bad = await upload("broken.docx", Buffer.from("PK\x03\x04broken"))
    assert.equal(bad.status, 201)
    await run()
    let failed = await prisma.serviceAiSource.findUniqueOrThrow({
      where: { id: bad.data.source.id },
    })
    assert.equal(failed.status, "FAILED")
    assert.equal(
      (
        await request(`${path}/${failed.id}/retry`, "POST", {
          revision: failed.revision,
        })
      ).status,
      200,
    )
    await run()
    failed = await prisma.serviceAiSource.findUniqueOrThrow({
      where: { id: failed.id },
    })
    assert.equal(failed.status, "FAILED")
    const latest = await prisma.serviceAiSource.findUniqueOrThrow({
      where: { id },
    })
    assert.equal(
      (await request(`${path}/${id}`, "DELETE", { revision: latest.revision }))
        .status,
      200,
    )
    assert.equal(
      (await loadAiChatSnapshot(prisma, tenantId, input)).sources.some(
        (source) => source.sourceId === id,
      ),
      false,
    )
    await run()
    assert.equal(await prisma.serviceAiSource.count({ where: { id } }), 0)
    await assert.rejects(aiSourceStorage.download(record.storageKey!))
    const race = await uploadAiFile(
      prisma,
      tenantId,
      service.id,
      randomUUID(),
      "race.txt",
      Buffer.from("Race document Cedar desk."),
      aiSourceStorage,
      future,
    )
    keys.add(race.storageKey!)
    let release!: (value: Array<{ text: string; page: null }>) => void
    let started!: () => void
    const atExtraction = new Promise<void>((resolve) => {
      started = resolve
    })
    const pending = runAiSourceWorkerOnce(
      prisma,
      {
        storage: aiSourceStorage,
        webpage: fetchAiWebpage,
        extract: async () => {
          started()
          return new Promise((resolve) => {
            release = resolve
          })
        },
      },
      tenantId,
      future,
    )
    await atExtraction
    await mutateAiSource(prisma, tenantId, service.id, race.id, race.revision, {
      action: "delete",
    })
    release([{ text: "Late extracted text must not reappear.", page: null }])
    await pending
    assert.equal(
      await prisma.aiSourceChunk.count({ where: { sourceId: race.id } }),
      0,
    )
    await run()
    assert.deepEqual(
      (await prisma.service.findUniqueOrThrow({ where: { id: service.id } }))
        .fitProfile,
      profile,
    )
    // Service deletion cascades rows but leaves durable cleanup entries for every original.
    await prisma.$transaction([
      prisma.service.delete({ where: { id: service.id } }),
      prisma.aiSourceStorageCleanup.updateMany({
        where: { tenantId },
        data: { availableAt: future },
      }),
    ])
    assert.ok(
      (await prisma.aiSourceStorageCleanup.count({ where: { tenantId } })) > 0,
    )
    await runAiSourceWorkerOnce(
      prisma,
      {
        storage: {
          ...aiSourceStorage,
          remove: async () => {
            throw Error("Temporary storage failure")
          },
        },
        extract: extractAiFile,
        webpage: fetchAiWebpage,
      },
      tenantId,
      future,
    )
    assert.ok(
      (await prisma.aiSourceStorageCleanup.count({ where: { tenantId } })) > 0,
    )
    await prisma.aiSourceStorageCleanup.updateMany({
      where: { tenantId },
      data: { availableAt: new Date(), leaseToken: null, leaseExpiresAt: null },
    })
    for (
      let count = 0;
      count < 10 &&
      (await prisma.aiSourceStorageCleanup.count({ where: { tenantId } }));
      count++
    )
      await run()
    assert.equal(
      await prisma.aiSourceStorageCleanup.count({ where: { tenantId } }),
      0,
    )
  },
)
