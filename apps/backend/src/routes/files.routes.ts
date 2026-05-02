import { Router } from "express"
import { z } from "zod"
import multer from "multer"
import {
  createSignedDownload,
  createSignedUpload,
  getPrivateStorageBucket,
  privateStorageKeyForTenantFile,
} from "../lib/private-storage.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"
import { randomUUID } from "crypto"
import { prisma } from "../lib/prisma.js"
import { deleteBlobByUrl, uploadPublicBlob } from "../lib/blob.js"

const router = Router()

const PresignUploadSchema = z.object({
  tenantId: z.string().min(1),
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(200),
})

const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "application/pdf",
])

const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES },
})

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function isStorageObjectMissingError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    error.statusCode === "404"
  )
}

async function deleteLegacyAvatar(oldKey: string) {
  if (oldKey.startsWith("http://") || oldKey.startsWith("https://")) {
    await deleteBlobByUrl(oldKey).catch(() => {})
  }
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
  const key = privateStorageKeyForTenantFile(tenantId, fileId, filename)
  const upload = await createSignedUpload({ path: key })

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

  res.json({
    bucket: getPrivateStorageBucket(),
    fileId,
    path: upload.path,
    token: upload.token,
  })
})

router.post(
  "/avatar-upload",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    const user = (req as AuthedRequest).user
    const tenantId = String(req.body?.tenantId ?? "")
    const file = (req as any).file as
      | {
          mimetype: string
          size: number
          originalname: string
          buffer: Buffer
        }
      | undefined

    if (!tenantId) {
      return res.status(400).json({ error: "INVALID_TENANT_ID" })
    }
    if (!file) return res.status(400).json({ error: "FILE_REQUIRED" })

    const contentType = file.mimetype
    if (
      !["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(
        contentType,
      )
    ) {
      return res.status(400).json({ error: "UNSUPPORTED_CONTENT_TYPE" })
    }
    if (file.size > IMAGE_MAX_BYTES) {
      return res.status(400).json({ error: "FILE_TOO_LARGE" })
    }

    const membership = await prisma.membership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId } },
    })

    if (!membership || membership.status !== "ACTIVE") {
      return res.status(403).json({ error: "FORBIDDEN" })
    }

    const fileId = randomUUID()
    const safeFilename = sanitizeFilename(file.originalname || "avatar")
    const pathname = `tenants/${tenantId}/avatars/${user.id}/${fileId}/${safeFilename}`
    const blob = await uploadPublicBlob({
      pathname,
      body: file.buffer,
      contentType,
    })

    await prisma.file.create({
      data: {
        id: fileId,
        tenantId,
        key: blob.url,
        contentType,
        size: file.size,
        createdById: user.id,
        purpose: "AVATAR",
      },
    })
    const existingUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { image: true },
    })
    const oldKey = existingUser?.image ?? null

    await prisma.user.update({
      where: { id: user.id },
      data: { image: blob.url },
    })

    if (oldKey && oldKey !== blob.url) {
      const oldFile = await prisma.file.findUnique({ where: { key: oldKey } })
      if (oldFile?.tenantId === tenantId) {
        await prisma.file.delete({ where: { key: oldKey } }).catch(() => {})
      }
      await deleteLegacyAvatar(oldKey)
    }

    res.json({ ok: true, imageUrl: blob.url, fileId })
  },
)

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

  try {
    const url = await createSignedDownload({ path: key, expiresInSeconds: 60 })
    res.json({ url })
  } catch (error) {
    if (isStorageObjectMissingError(error)) {
      return res.status(404).json({ error: "FILE_OBJECT_MISSING" })
    }

    throw error
  }
})

export default router
