import { randomUUID, createHash } from "node:crypto"
import type {
  Prisma,
  PrismaClient,
  ServiceAiSource,
} from "../generated/prisma/index.js"
import { lockServiceHierarchyTx } from "./service-configuration-inheritance.js"
import {
  AiSourceError,
  AI_SOURCE_LIMIT,
  aiStorageKey,
  assertAiStorageKey,
  validateAiFile,
} from "./ai-source-types.js"
import { aiSourceStorage, type AiSourceStorage } from "./ai-source-storage.js"

export function presentAiSource(source: ServiceAiSource) {
  return {
    id: source.id,
    requestId: source.requestId,
    kind: source.kind,
    label: source.label,
    url: source.url,
    finalUrl: source.finalUrl,
    filename: source.filename,
    contentType: source.contentType,
    size: source.size,
    status: source.status,
    progress: source.progress,
    revision: source.revision,
    lastError: source.lastError,
    characterCount: source.characterCount,
    chunkCount: source.chunkCount,
    canDownload: Boolean(source.uploadedAt),
    canRetry:
      source.status === "FAILED" &&
      (source.kind === "LINK" || Boolean(source.uploadedAt)),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  }
}
export async function requireSourceSkill(
  client: Pick<Prisma.TransactionClient, "service">,
  tenantId: string,
  serviceId: string,
) {
  if (
    !(await client.service.findFirst({
      where: { id: serviceId, tenantId, kind: "OFFERING" },
      select: { id: true },
    }))
  )
    throw new AiSourceError(
      404,
      "AI_SKILL_NOT_FOUND",
      "The sub-service was not found in this account.",
    )
}
export async function listAiSources(
  client: PrismaClient,
  tenantId: string,
  serviceId: string,
) {
  await requireSourceSkill(client, tenantId, serviceId)
  const sources = await client.serviceAiSource.findMany({
    where: { tenantId, serviceId, deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })
  return sources.map(presentAiSource)
}
export async function readAiSource(
  client: PrismaClient,
  tenantId: string,
  serviceId: string,
  id: string,
) {
  const source = await client.serviceAiSource.findFirst({
    where: { tenantId, serviceId, id, deletedAt: null },
  })
  if (!source)
    throw new AiSourceError(
      404,
      "AI_SOURCE_NOT_FOUND",
      "This source is no longer available.",
    )
  return source
}
async function limitSources(
  tx: Prisma.TransactionClient,
  tenantId: string,
  serviceId: string,
) {
  await requireSourceSkill(tx, tenantId, serviceId)
  if (
    (await tx.serviceAiSource.count({
      where: { tenantId, serviceId, deletedAt: null },
    })) >= AI_SOURCE_LIMIT
  )
    throw new AiSourceError(
      400,
      "AI_SOURCE_LIMIT",
      "A skill can have up to 100 sources. Remove an unused source first.",
    )
}
export async function createAiLink(
  client: PrismaClient,
  tenantId: string,
  serviceId: string,
  input: { requestId: string; label: string; url: string },
  availableAt = new Date(),
) {
  return client.$transaction(async (tx) => {
    await lockServiceHierarchyTx(tx, tenantId, serviceId)
    const existing = await tx.serviceAiSource.findUnique({
      where: { tenantId_requestId: { tenantId, requestId: input.requestId } },
    })
    if (existing) {
      if (
        existing.serviceId !== serviceId ||
        existing.kind !== "LINK" ||
        existing.url !== input.url ||
        existing.deletedAt
      )
        throw new AiSourceError(
          409,
          "AI_SOURCE_REQUEST_CONFLICT",
          "Start a new source request.",
        )
      return existing
    }
    await limitSources(tx, tenantId, serviceId)
    return tx.serviceAiSource.create({
      data: {
        tenantId,
        serviceId,
        requestId: input.requestId,
        kind: "LINK",
        label: input.label || new URL(input.url).hostname,
        url: input.url,
        availableAt,
      },
    })
  })
}
export async function uploadAiFile(
  client: PrismaClient,
  tenantId: string,
  serviceId: string,
  requestId: string,
  filename: string,
  bytes: Buffer,
  storage: AiSourceStorage = aiSourceStorage,
  availableAt = new Date(),
) {
  const contentType = validateAiFile(filename, bytes)
  const checksum = createHash("sha256").update(bytes).digest("hex")
  const source = await client.$transaction(async (tx) => {
    await lockServiceHierarchyTx(tx, tenantId, serviceId)
    const existing = await tx.serviceAiSource.findUnique({
      where: { tenantId_requestId: { tenantId, requestId } },
    })
    if (existing) {
      if (
        existing.serviceId !== serviceId ||
        existing.kind !== "FILE" ||
        existing.checksum !== checksum ||
        existing.filename !== filename ||
        existing.deletedAt
      )
        throw new AiSourceError(
          409,
          "AI_SOURCE_REQUEST_CONFLICT",
          "Choose the file again to start a new upload.",
        )
      if (existing.uploadedAt) return existing
      if (existing.status === "UPLOADING")
        throw new AiSourceError(
          409,
          "AI_UPLOAD_IN_PROGRESS",
          "This upload is still running. Refresh sources in a moment.",
        )
      return tx.serviceAiSource.update({
        where: { id: existing.id },
        data: {
          status: "UPLOADING",
          lastError: null,
          progress: 0,
          revision: { increment: 1 },
        },
      })
    }
    await limitSources(tx, tenantId, serviceId)
    const id = randomUUID()
    return tx.serviceAiSource.create({
      data: {
        id,
        tenantId,
        serviceId,
        requestId,
        kind: "FILE",
        label: filename,
        filename,
        contentType,
        size: bytes.length,
        checksum,
        storageKey: aiStorageKey(tenantId, serviceId, id, filename),
        status: "UPLOADING",
        availableAt,
      },
    })
  })
  if (source.uploadedAt) return source
  try {
    await storage.upload(assertAiStorageKey(source), bytes, contentType)
    const result = await client.serviceAiSource.updateMany({
      where: {
        id: source.id,
        tenantId,
        deletedAt: null,
        status: "UPLOADING",
        revision: source.revision,
      },
      data: {
        uploadedAt: new Date(),
        status: "QUEUED",
        progress: 10,
        lastError: null,
      },
    })
    if (!result.count)
      throw new AiSourceError(
        409,
        "AI_SOURCE_CHANGED",
        "The source changed during its upload.",
      )
    return readAiSource(client, tenantId, serviceId, source.id)
  } catch (error) {
    await client.serviceAiSource.updateMany({
      where: { id: source.id, status: "UPLOADING", revision: source.revision },
      data: {
        status: "FAILED",
        lastError:
          "The upload did not finish. Upload the file again or remove this source.",
      },
    })
    if (error instanceof AiSourceError) throw error
    throw new AiSourceError(
      503,
      "AI_UPLOAD_FAILED",
      "The upload could not finish. Your file can be retried.",
    )
  }
}
export async function mutateAiSource(
  client: PrismaClient,
  tenantId: string,
  serviceId: string,
  id: string,
  revision: number,
  change:
    | { action: "delete" }
    | { action: "retry" }
    | { action: "edit"; label: string; url?: string },
  availableAt = new Date(),
) {
  return client.$transaction(async (tx) => {
    await lockServiceHierarchyTx(tx, tenantId, serviceId)
    const current = await tx.serviceAiSource.findFirst({
      where: { id, tenantId, serviceId, deletedAt: null },
    })
    if (!current)
      throw new AiSourceError(
        404,
        "AI_SOURCE_NOT_FOUND",
        "This source is no longer available.",
      )
    if (current.revision !== revision)
      throw new AiSourceError(
        409,
        "AI_SOURCE_CONFLICT",
        "This source changed elsewhere. Refresh and review it before trying again.",
      )
    if (change.action !== "delete" && current.status === "UPLOADING")
      throw new AiSourceError(
        409,
        "AI_UPLOAD_IN_PROGRESS",
        "Wait for the upload to finish.",
      )
    if (
      change.action === "retry" &&
      (!["FAILED", "OCR_REQUIRED"].includes(current.status) ||
        (current.kind === "FILE" && !current.uploadedAt))
    )
      throw new AiSourceError(
        400,
        "AI_SOURCE_NOT_RETRYABLE",
        "Upload the original file again to retry this source.",
      )
    if (
      change.action === "edit" &&
      current.kind === "FILE" &&
      change.url !== undefined
    )
      throw new AiSourceError(
        400,
        "INVALID_SOURCE_EDIT",
        "File sources do not have an editable URL.",
      )
    const restart =
      change.action === "retry" ||
      (change.action === "edit" &&
        ((change.url !== undefined && change.url !== current.url) ||
          current.status === "PROCESSING"))
    if (restart || change.action === "delete")
      await tx.aiSourceChunk.deleteMany({ where: { tenantId, sourceId: id } })
    const saved = await tx.serviceAiSource.update({
      where: { id },
      data: {
        revision: { increment: 1 },
        ...(change.action === "edit"
          ? {
              label: change.label,
              ...(change.url !== undefined
                ? { url: change.url, finalUrl: null }
                : {}),
            }
          : {}),
        ...(restart
          ? {
              status: "QUEUED",
              progress: 10,
              characterCount: 0,
              chunkCount: 0,
              attemptCount: 0,
              availableAt,
              lastError: null,
              leaseToken: null,
              leaseExpiresAt: null,
            }
          : {}),
        ...(change.action === "delete"
          ? {
              status: "DELETING",
              deletedAt: new Date(),
              availableAt: new Date(),
              progress: 0,
              characterCount: 0,
              chunkCount: 0,
              attemptCount: 0,
              leaseToken: null,
              leaseExpiresAt: null,
            }
          : {}),
      },
    })
    return saved
  })
}
