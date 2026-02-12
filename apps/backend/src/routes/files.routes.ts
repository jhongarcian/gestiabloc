import { Router } from "express"
import { z } from "zod"
import {
  presignPostObject,
  s3KeyForTenantFile,
  s3KeyForTenantAvatar,
  presignGetObject,
  deleteObject,
} from "../lib/s3.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"
import { randomUUID } from "crypto"
import { prisma } from "../lib/prisma.js"

const router = Router()

const PresignUploadSchema = z.object({
  tenantId: z.string().min(1),
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(200),
})

const PresignAvatarUploadSchema = z.object({
  tenantId: z.string().min(1),
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(200),
})

const CompleteUploadSchema = z.object({
  fileId: z.string().uuid(),
  size: z.number().int().positive().max(20 * 1024 * 1024),
})

const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "application/pdf",
])

const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const PDF_MAX_BYTES = 20 * 1024 * 1024

function maxSizeForContentType(contentType: string) {
  return contentType === "application/pdf" ? PDF_MAX_BYTES : IMAGE_MAX_BYTES
}

router.post("/presign-upload", requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user
  const { tenantId, filename, contentType } = PresignUploadSchema.parse(
    req.body,
  )

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return res.status(400).json({ error: "UNSUPPORTED_CONTENT_TYPE" })
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId } },
  })

  if (!membership || membership.status !== "ACTIVE") {
    return res.status(403).json({ error: "FORBIDDEN" })
  }

  const fileId = randomUUID()
  const key = s3KeyForTenantFile(tenantId, fileId, filename)

  const post = await presignPostObject({
    key,
    contentType,
    maxSizeBytes: maxSizeForContentType(contentType),
    expiresInSeconds: 60,
  })

  await prisma.file.create({
    data: {
      id: fileId,
      tenantId,
      key,
      contentType,
      createdById: user.id,
      purpose: "GENERIC",
    },
  })

  res.json({ ...post, key, fileId })
})

router.post("/presign-avatar-upload", requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user
  const { tenantId, filename, contentType } = PresignAvatarUploadSchema.parse(
    req.body,
  )

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return res.status(400).json({ error: "UNSUPPORTED_CONTENT_TYPE" })
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId } },
  })

  if (!membership || membership.status !== "ACTIVE") {
    return res.status(403).json({ error: "FORBIDDEN" })
  }

  const fileId = randomUUID()
  const key = s3KeyForTenantAvatar(tenantId, user.id, fileId, filename)

  const post = await presignPostObject({
    key,
    contentType,
    maxSizeBytes: maxSizeForContentType(contentType),
    expiresInSeconds: 60,
  })

  await prisma.file.create({
    data: {
      id: fileId,
      tenantId,
      key,
      contentType,
      createdById: user.id,
      purpose: "AVATAR",
    },
  })

  res.json({ ...post, key, fileId })
})

router.post("/complete-upload", requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user
  const { fileId, size } = CompleteUploadSchema.parse(req.body)

  const file = await prisma.file.findUnique({ where: { id: fileId } })
  if (!file) return res.status(404).json({ error: "NOT_FOUND" })

  const maxSize = maxSizeForContentType(file.contentType)
  if (size > maxSize) {
    return res.status(400).json({ error: "FILE_TOO_LARGE" })
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: file.tenantId } },
  })

  if (!membership || membership.status !== "ACTIVE") {
    return res.status(403).json({ error: "FORBIDDEN" })
  }

  await prisma.file.update({
    where: { id: fileId },
    data: { size },
  })

  let avatarUpdate: { imageKey: string; oldKey?: string } | null = null

  if (file.purpose === "AVATAR") {
    const targetUserId = file.createdById
    const existingUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { image: true },
    })
    const oldKey = existingUser?.image ?? null

    await prisma.user.update({
      where: { id: targetUserId },
      data: { image: file.key },
    })

    if (oldKey && oldKey !== file.key) {
      const oldFile = await prisma.file.findUnique({ where: { key: oldKey } })
      if (oldFile?.tenantId === file.tenantId) {
        await prisma.file
          .delete({ where: { key: oldKey } })
          .catch(() => {})
      }
      await deleteObject({ key: oldKey }).catch(() => {})
    }

    avatarUpdate = { imageKey: file.key, oldKey: oldKey ?? undefined }
  }

  res.json({ ok: true, avatarUpdate })
})

const PresignDownloadSchema = z.object({
  tenantId: z.string().min(1).optional(),
  key: z.string().min(1),
})

router.post("/presign-download", requireAuth, async (req, res) => {
  const user = (req as AuthedRequest).user
  const { key } = PresignDownloadSchema.parse(req.body)

  const file = await prisma.file.findUnique({ where: { key } })
  if (!file) {
    return res.status(404).json({ error: "NOT_FOUND" })
  }

  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: user.id, tenantId: file.tenantId } },
  })

  if (!membership || membership.status !== "ACTIVE") {
    return res.status(403).json({ error: "FORBIDDEN" })
  }

  const url = await presignGetObject({ key, expiresInSeconds: 60 })
  res.json({ url })
})

export default router
