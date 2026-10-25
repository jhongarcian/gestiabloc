import { Router, type ErrorRequestHandler } from "express"
import { z } from "zod"
import multer from "multer"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js"
import { enforceSameOrigin } from "../lib/security.js"
import { uploadPublicBlob, deleteBlobByUrl } from "../lib/blob.js"
import { aiSettingsStore } from "../lib/ai-helper-settings-store.js"
import {
  AI_AVATAR_MAX_BYTES,
  AiAvatarRevisionSchema,
  AiPresetInputSchema,
  AiSettingsError,
  AiSettingsInputSchema,
  createAiSettingsService,
  type AiAvatarUpload,
} from "../lib/ai-helper-settings.js"

const router = Router()
const pathSchema = z.object({ tenantId: z.uuid() })
const service = createAiSettingsService({
  store: aiSettingsStore,
  upload: uploadPublicBlob,
  deleteBlob: deleteBlobByUrl,
})
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: AI_AVATAR_MAX_BYTES,
    files: 1,
    fields: 1,
    fieldSize: 100,
  },
})

router.use(
  "/:tenantId/ai",
  requireAuth,
  requireTenantAdmin({
    tenantIdLookups: [{ source: "params", key: "tenantId" }],
  }),
  (req, _res, next) => {
    pathSchema.parse(req.params)
    if (req.method !== "GET") enforceSameOrigin(req)
    next()
  },
)
router.get("/:tenantId/ai/settings", async (req, res) => {
  const { tenantId } = pathSchema.parse(req.params)
  res.json({ ok: true, settings: await service.read(tenantId) })
})
router.patch("/:tenantId/ai/settings", async (req, res) => {
  const { tenantId } = pathSchema.parse(req.params)
  res.json({
    ok: true,
    settings: await service.save(
      tenantId,
      AiSettingsInputSchema.parse(req.body),
    ),
  })
})
router.patch("/:tenantId/ai/avatar", async (req, res) => {
  const { tenantId } = pathSchema.parse(req.params)
  const { presetId, avatarRevision } = AiPresetInputSchema.parse(req.body)
  res.json({
    ok: true,
    settings: await service.setPreset(tenantId, presetId, avatarRevision),
  })
})
router.delete("/:tenantId/ai/avatar", async (req, res) => {
  const { tenantId } = pathSchema.parse(req.params)
  const { avatarRevision } = AiAvatarRevisionSchema.parse(req.body)
  res.json({
    ok: true,
    settings: await service.setPreset(tenantId, "bot", avatarRevision),
  })
})
router.post("/:tenantId/ai/avatar", upload.single("file"), async (req, res) => {
  const { tenantId } = pathSchema.parse(req.params)
  if (!(req as typeof req & { file?: AiAvatarUpload }).file)
    throw new AiSettingsError(400, "FILE_REQUIRED")
  const { avatarRevision } = AiAvatarRevisionSchema.parse(req.body)
  const file = (req as typeof req & { file: AiAvatarUpload }).file
  res.json({
    ok: true,
    settings: await service.uploadAvatar(
      tenantId,
      (req as unknown as AuthedRequest).user.id,
      file,
      avatarRevision,
    ),
  })
})
const handleError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof AiSettingsError) {
    res.status(error.status).json({ error: error.code })
    return
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    String(error.code).startsWith("LIMIT_")
  ) {
    res
      .status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
      .json({
        error:
          error.code === "LIMIT_FILE_SIZE"
            ? "FILE_TOO_LARGE"
            : "INVALID_UPLOAD",
      })
    return
  }
  next(error)
}
router.use(handleError)
export default router
