import { Router, type ErrorRequestHandler } from "express"
import multer from "multer"
import { z } from "zod"
import { prisma } from "../lib/prisma.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js"
import { enforceSameOrigin } from "../lib/security.js"
import { ServiceCollectionError } from "../lib/service-configuration-collections.js"
import {
  AiSourceError,
  AI_FILE_MAX_BYTES,
  AiSourceLinkSchema,
  AiSourceEditSchema,
  AiSourceRevisionSchema,
  assertAiStorageKey,
  decodeUploadFilename,
} from "../lib/ai-source-types.js"
import { aiSourceStorage } from "../lib/ai-source-storage.js"
import {
  createAiLink,
  listAiSources,
  mutateAiSource,
  presentAiSource,
  readAiSource,
  uploadAiFile,
} from "../lib/ai-sources.js"

export function createAiSourcesRouter({
  scheduleAt = () => new Date(),
}: { scheduleAt?: () => Date } = {}) {
  const router = Router()
  const path = z.object({ tenantId: z.uuid(), skillId: z.uuid() })
  const sourcePath = path.extend({ sourceId: z.uuid() })
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: AI_FILE_MAX_BYTES,
      files: 1,
      fields: 1,
      fieldSize: 200,
      parts: 3,
    },
  })
  const uploads = new Set<string>()
  const budget = new Map<string, { count: number; until: number }>()
  router.use(
    "/:tenantId/ai/skills/:skillId/sources",
    requireAuth,
    requireTenantAdmin({
      tenantIdLookups: [{ source: "params", key: "tenantId" }],
    }),
    (req, res, next) => {
      path.parse(req.params)
      res.setHeader("Cache-Control", "no-store")
      if (req.method !== "GET") {
        enforceSameOrigin(req)
        const key = `${(req as AuthedRequest).user.id}:${req.params.tenantId}`
        const current = budget.get(key)
        if (current && current.until > Date.now() && current.count >= 30)
          return res.status(429).json({
            error: "AI_SOURCE_RATE_LIMITED",
            details: "Wait a minute before making more source changes.",
          })
        if (!current || current.until <= Date.now())
          budget.set(key, { count: 1, until: Date.now() + 60000 })
        else current.count++
        if (budget.size > 5000)
          for (const [id, item] of budget)
            if (item.until <= Date.now()) budget.delete(id)
      }
      next()
    },
  )
  router.get("/:tenantId/ai/skills/:skillId/sources", async (req, res) => {
    const { tenantId, skillId } = path.parse(req.params)
    res.json({
      ok: true,
      sources: await listAiSources(prisma, tenantId, skillId),
    })
  })
  router.post(
    "/:tenantId/ai/skills/:skillId/sources/links",
    async (req, res) => {
      const { tenantId, skillId } = path.parse(req.params)
      res.status(201).json({
        ok: true,
        source: presentAiSource(
          await createAiLink(
            prisma,
            tenantId,
            skillId,
            AiSourceLinkSchema.parse(req.body),
            scheduleAt(),
          ),
        ),
      })
    },
  )
  router.post(
    "/:tenantId/ai/skills/:skillId/sources/files",
    (req, res, next) => {
      const key = `${(req as unknown as AuthedRequest).user.id}:${req.params.tenantId}`
      if (uploads.has(key))
        return res.status(429).json({
          error: "AI_UPLOAD_BUSY",
          details: "Wait for your current upload to finish.",
        })
      uploads.add(key)
      const release = () => uploads.delete(key)
      res.once("finish", release)
      res.once("close", release)
      next()
    },
    upload.single("file"),
    async (req, res) => {
      const { tenantId, skillId } = path.parse(req.params)
      const { requestId } = z
        .object({ requestId: z.uuid() })
        .strict()
        .parse(req.body)
      const file = (
        req as typeof req & { file?: { originalname: string; buffer: Buffer } }
      ).file
      if (!file)
        throw new AiSourceError(
          400,
          "FILE_REQUIRED",
          "Choose one file to upload.",
        )
      const source = await uploadAiFile(
        prisma,
        tenantId,
        skillId,
        requestId,
        decodeUploadFilename(file.originalname),
        file.buffer,
        aiSourceStorage,
        scheduleAt(),
      )
      res.status(201).json({ ok: true, source: presentAiSource(source) })
    },
  )
  router.patch(
    "/:tenantId/ai/skills/:skillId/sources/:sourceId",
    async (req, res) => {
      const { tenantId, skillId, sourceId } = sourcePath.parse(req.params)
      const { revision, ...input } = AiSourceEditSchema.parse(req.body)
      res.json({
        ok: true,
        source: presentAiSource(
          await mutateAiSource(
            prisma,
            tenantId,
            skillId,
            sourceId,
            revision,
            { action: "edit", ...input },
            scheduleAt(),
          ),
        ),
      })
    },
  )
  router.post(
    "/:tenantId/ai/skills/:skillId/sources/:sourceId/retry",
    async (req, res) => {
      const { tenantId, skillId, sourceId } = sourcePath.parse(req.params)
      const { revision } = AiSourceRevisionSchema.parse(req.body)
      res.json({
        ok: true,
        source: presentAiSource(
          await mutateAiSource(
            prisma,
            tenantId,
            skillId,
            sourceId,
            revision,
            { action: "retry" },
            scheduleAt(),
          ),
        ),
      })
    },
  )
  router.delete(
    "/:tenantId/ai/skills/:skillId/sources/:sourceId",
    async (req, res) => {
      const { tenantId, skillId, sourceId } = sourcePath.parse(req.params)
      const { revision } = AiSourceRevisionSchema.parse(req.body)
      await mutateAiSource(prisma, tenantId, skillId, sourceId, revision, {
        action: "delete",
      })
      res.json({ ok: true })
    },
  )
  router.get(
    "/:tenantId/ai/skills/:skillId/sources/:sourceId/download",
    async (req, res) => {
      const { tenantId, skillId, sourceId } = sourcePath.parse(req.params)
      const source = await readAiSource(prisma, tenantId, skillId, sourceId)
      if (!source.uploadedAt || !source.filename)
        throw new AiSourceError(
          404,
          "AI_FILE_NOT_AVAILABLE",
          "The original file is not available.",
        )
      res.redirect(
        303,
        await aiSourceStorage.signedDownload(
          assertAiStorageKey(source),
          source.filename,
        ),
      )
    },
  )
  router.get(
    "/:tenantId/ai/skills/:skillId/sources/:sourceId/text",
    async (req, res) => {
      const { tenantId, skillId, sourceId } = sourcePath.parse(req.params)
      const { after } = z
        .object({
          after: z.coerce.number().int().min(-1).max(1000).default(-1),
        })
        .strict()
        .parse(req.query)
      const source = await readAiSource(prisma, tenantId, skillId, sourceId)
      if (source.status !== "READY")
        throw new AiSourceError(
          409,
          "AI_SOURCE_NOT_READY",
          "Readable text is available when processing finishes.",
        )
      const chunks = await prisma.aiSourceChunk.findMany({
        where: { tenantId, sourceId, ordinal: { gt: after } },
        orderBy: { ordinal: "asc" },
        take: 26,
        select: { ordinal: true, page: true, content: true },
      })
      res.json({
        ok: true,
        chunks: chunks.slice(0, 25),
        hasMore: chunks.length > 25,
      })
    },
  )
  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (
      error instanceof AiSourceError ||
      error instanceof ServiceCollectionError
    )
      return void res
        .status(error.status)
        .json({ error: error.code, details: error.message })
    if (error instanceof multer.MulterError)
      return void res.status(400).json({
        error: error.code,
        details: "Choose one PDF, DOCX, or TXT file up to 10 MB.",
      })
    next(error)
  }
  router.use(errors)
  return router
}
export default createAiSourcesRouter()
