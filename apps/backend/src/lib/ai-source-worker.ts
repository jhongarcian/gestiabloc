import { randomUUID } from "node:crypto"
import type { PrismaClient } from "../generated/prisma/index.js"
import { prisma } from "./prisma.js"
import { aiSourceStorage, type AiSourceStorage } from "./ai-source-storage.js"
import { assertAiStorageKey, AiSourceError } from "./ai-source-types.js"
import { chunkSourceText, extractAiFile } from "./ai-source-extraction.js"
import { fetchAiWebpage } from "./ai-source-web.js"

type Dependencies = {
  storage: AiSourceStorage
  extract: typeof extractAiFile
  webpage: typeof fetchAiWebpage
}
const defaults: Dependencies = {
  storage: aiSourceStorage,
  extract: extractAiFile,
  webpage: fetchAiWebpage,
}
export async function runAiSourceWorkerOnce(
  client: PrismaClient = prisma,
  dependencies: Dependencies = defaults,
  tenantId: string | null = null,
  claimBefore = new Date(),
) {
  const scope = tenantId ? { tenantId } : {}
  // Deleting content is excluded from retrieval immediately; the durable outbox survives cascades.
  await client.serviceAiSource.deleteMany({
    where: { ...scope, status: "DELETING", deletedAt: { not: null } },
  })
  await client.serviceAiSource.updateMany({
    where: {
      ...scope,
      status: "UPLOADING",
      updatedAt: { lt: new Date(Date.now() - 120_000) },
    },
    data: {
      status: "FAILED",
      lastError:
        "The upload did not finish. Upload the file again or remove this source.",
    },
  })
  await client.serviceAiSource.updateMany({
    where: {
      ...scope,
      status: "PROCESSING",
      leaseExpiresAt: { lt: new Date() },
      attemptCount: { gte: 3 },
    },
    data: {
      status: "FAILED",
      lastError: "Processing was interrupted repeatedly. Try again.",
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
  const token = randomUUID()
  const cleanup = await client.$queryRaw<
    Array<{
      id: string
      tenantId: string
      serviceId: string
      sourceId: string
      storageKey: string
      attemptCount: number
    }>
  >`
    WITH candidate AS (
      SELECT id FROM "AiSourceStorageCleanup" WHERE (${tenantId}::text IS NULL OR "tenantId"=${tenantId}) AND "availableAt" <= ${claimBefore} AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < NOW())
      ORDER BY "availableAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE "AiSourceStorageCleanup" job SET "leaseToken"=${token}, "leaseExpiresAt"=NOW()+INTERVAL '60 seconds', "attemptCount"=job."attemptCount"+1
      FROM candidate WHERE job.id=candidate.id RETURNING job.*`
  if (cleanup[0]) {
    const job = cleanup[0]
    try {
      await dependencies.storage.remove(
        assertAiStorageKey({ ...job, id: job.sourceId }),
      )
      await client.aiSourceStorageCleanup.deleteMany({
        where: { id: job.id, leaseToken: token },
      })
    } catch {
      await client.aiSourceStorageCleanup.updateMany({
        where: { id: job.id, leaseToken: token },
        data: {
          leaseToken: null,
          leaseExpiresAt: null,
          availableAt: new Date(
            Date.now() +
              Math.min(3_600_000, 5000 * 2 ** Math.min(10, job.attemptCount)),
          ),
        },
      })
    }
  }
  const claims = await client.$queryRaw<
    Array<{ id: string; leaseToken: string }>
  >`
    WITH candidate AS (
      SELECT id FROM "ServiceAiSource" WHERE (${tenantId}::text IS NULL OR "tenantId"=${tenantId}) AND "deletedAt" IS NULL AND "attemptCount" < 3
      AND ((status='QUEUED' AND "availableAt" <= ${claimBefore}) OR (status='PROCESSING' AND "leaseExpiresAt" < NOW()))
      ORDER BY "availableAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE "ServiceAiSource" job SET status='PROCESSING', progress=20, "leaseToken"=${token},
      "leaseExpiresAt"=NOW()+INTERVAL '90 seconds', "attemptCount"=job."attemptCount"+1, "updatedAt"=NOW()
      FROM candidate WHERE job.id=candidate.id RETURNING job.id, job."leaseToken"`
  if (!claims[0]) return
  const source = await client.serviceAiSource.findFirst({
    where: {
      id: claims[0].id,
      leaseToken: token,
      status: "PROCESSING",
      deletedAt: null,
    },
  })
  if (!source) return
  const current = {
    id: source.id,
    tenantId: source.tenantId,
    revision: source.revision,
    leaseToken: token,
    status: "PROCESSING" as const,
    deletedAt: null,
  }
  const heartbeat = setInterval(() => {
    void client.serviceAiSource
      .updateMany({
        where: { ...current, leaseExpiresAt: { gt: new Date() } },
        data: { leaseExpiresAt: new Date(Date.now() + 90000) },
      })
      .catch(() => {})
  }, 20000)
  heartbeat.unref()
  try {
    let pages
    let finalUrl: string | null = null
    if (source.kind === "FILE") {
      if (!source.uploadedAt || !source.filename)
        throw new AiSourceError(
          400,
          "MISSING_UPLOAD",
          "Upload the original file again.",
        )
      const bytes = await dependencies.storage.download(
        assertAiStorageKey(source),
      )
      if (
        source.checksum !==
        (await import("node:crypto"))
          .createHash("sha256")
          .update(bytes)
          .digest("hex")
      )
        throw new AiSourceError(
          400,
          "SOURCE_FILE_CHANGED",
          "The stored file changed. Upload the original document again.",
        )
      if (
        !(
          await client.serviceAiSource.updateMany({
            where: current,
            data: { progress: 50 },
          })
        ).count
      )
        return
      pages = await dependencies.extract(source.filename, bytes)
    } else {
      const fetched = await dependencies.webpage(source.url!)
      pages = [{ text: fetched.text, page: null }]
      finalUrl = fetched.finalUrl
    }
    const extracted = chunkSourceText(pages)
    await client.$transaction(
      async (tx) => {
        // Lock/update the source first, so a concurrent removal cannot leave late chunks behind.
        const claimed = await tx.serviceAiSource.updateMany({
          where: current,
          data: { progress: 85 },
        })
        if (!claimed.count) return
        await tx.aiSourceChunk.deleteMany({
          where: { tenantId: source.tenantId, sourceId: source.id },
        })
        await tx.aiSourceChunk.createMany({
          data: extracted.chunks.map((chunk) => ({
            ...chunk,
            tenantId: source.tenantId,
            sourceId: source.id,
          })),
        })
        await tx.serviceAiSource.updateMany({
          where: current,
          data: {
            status: "READY",
            progress: 100,
            characterCount: extracted.characterCount,
            chunkCount: extracted.chunks.length,
            finalUrl,
            lastError: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        })
      },
      { timeout: 15000 },
    )
  } catch (error) {
    const known = error instanceof AiSourceError
    const retry = !known || error.status >= 500
    const status =
      known && error.code === "OCR_REQUIRED"
        ? "OCR_REQUIRED"
        : retry && source.attemptCount < 3
          ? "QUEUED"
          : "FAILED"
    await client.serviceAiSource.updateMany({
      where: current,
      data: {
        status,
        progress: 0,
        lastError: known
          ? error.message
          : "The source could not be processed. Try again.",
        availableAt: new Date(Date.now() + 5000 * 2 ** source.attemptCount),
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
  } finally {
    clearInterval(heartbeat)
  }
}
export function startAiSourceWorker({
  keepAlive = false,
}: { keepAlive?: boolean } = {}) {
  let active: Promise<void> | null = null
  const poll = () => {
    if (active) return
    active = runAiSourceWorkerOnce()
      .catch(() => console.error("AI source worker could not complete a poll."))
      .finally(() => {
        active = null
      })
  }
  const timer = setInterval(poll, 3000)
  if (!keepAlive) timer.unref()
  poll()
  return async () => {
    clearInterval(timer)
    await active
  }
}
