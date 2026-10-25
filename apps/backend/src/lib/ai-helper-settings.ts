import { randomUUID } from "node:crypto"
import { z } from "zod"

export const AI_AVATAR_MAX_BYTES = 5 * 1024 * 1024
export const AI_AVATAR_PRESETS = [
  "bot",
  "sparkles",
  "compass",
  "lightbulb",
] as const
export const AI_LANGUAGES = [
  "English",
  "Spanish",
  "English and Spanish",
] as const
export const AI_TONES = ["Professional", "Warm", "Direct"] as const

export const AiSettingsInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    language: z.enum(AI_LANGUAGES),
    tone: z.enum(AI_TONES),
    instructions: z.string().trim().max(4000),
    revision: z.number().int().nonnegative().max(2147483646),
  })
  .strict()
export const AiPresetInputSchema = z
  .object({
    presetId: z.enum(AI_AVATAR_PRESETS),
    avatarRevision: z.number().int().nonnegative().max(2147483646),
  })
  .strict()
export const AiAvatarRevisionSchema = z
  .object({
    avatarRevision: z
      .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
      .pipe(z.number().int().nonnegative().max(2147483646)),
  })
  .strict()
export type AiSettingsInput = z.infer<typeof AiSettingsInputSchema>
export type AiSettingsFields = Omit<AiSettingsInput, "revision">
export type AiAvatarPreset = (typeof AI_AVATAR_PRESETS)[number]
export type AiAvatarFile = {
  id: string
  tenantId: string
  key: string
  purpose: string
}
export type AiSettingsRecord = Omit<AiSettingsFields, "language" | "tone"> & {
  language: string
  tone: string
  tenantId: string
  revision: number
  avatarRevision: number
  avatarPresetId: string
  avatarFileId: string | null
  avatarFile: AiAvatarFile | null
}
export type AiSettingsDto = AiSettingsFields & {
  revision: number
  avatar: {
    presetId: AiAvatarPreset
    imageUrl: string | null
    revision: number
  }
}
export type AiAvatarUpload = {
  buffer: Buffer
  mimetype: string
  size: number
  originalname: string
}

export interface AiSettingsStore {
  read(tenantId: string): Promise<AiSettingsRecord | null>
  saveSettings(
    tenantId: string,
    input: AiSettingsInput,
  ): Promise<AiSettingsRecord>
  saveAvatar(
    tenantId: string,
    presetId: AiAvatarPreset,
    fileId: string | null,
    revision: number,
  ): Promise<{ record: AiSettingsRecord; previousFileId: string | null }>
  createFile(
    file: AiAvatarFile & {
      contentType: string
      size: number
      createdById: string
    },
  ): Promise<void>
  findOwnedFile(tenantId: string, fileId: string): Promise<AiAvatarFile | null>
  isFileInUse(tenantId: string, fileId: string): Promise<boolean>
  deleteFile(tenantId: string, fileId: string): Promise<void>
}

export class AiSettingsError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code)
  }
}

export function defaultAiSettings(): AiSettingsDto {
  return {
    name: "AI Helper",
    language: "English",
    tone: "Professional",
    instructions: "",
    revision: 0,
    avatar: { presetId: "bot", imageUrl: null, revision: 0 },
  }
}

function present(
  record: AiSettingsRecord | null,
  tenantId: string,
): AiSettingsDto {
  if (!record) return defaultAiSettings()
  if (record.tenantId !== tenantId)
    throw new AiSettingsError(404, "AI_SETTINGS_NOT_FOUND")
  const avatarFile =
    record.avatarFile?.tenantId === tenantId &&
    record.avatarFile.purpose === "AI_AVATAR"
      ? record.avatarFile
      : null
  return {
    name: record.name,
    language: z.enum(AI_LANGUAGES).parse(record.language),
    tone: z.enum(AI_TONES).parse(record.tone),
    instructions: record.instructions,
    revision: record.revision,
    avatar: {
      presetId: AI_AVATAR_PRESETS.includes(
        record.avatarPresetId as AiAvatarPreset,
      )
        ? (record.avatarPresetId as AiAvatarPreset)
        : "bot",
      imageUrl: avatarFile?.key ?? null,
      revision: record.avatarRevision,
    },
  }
}

export function validateAiAvatar(file: AiAvatarUpload) {
  if (
    file.size > AI_AVATAR_MAX_BYTES ||
    file.buffer.length > AI_AVATAR_MAX_BYTES
  )
    throw new AiSettingsError(413, "FILE_TOO_LARGE")
  if (!file.size || file.size !== file.buffer.length)
    throw new AiSettingsError(400, "INVALID_IMAGE")
  const type = file.mimetype === "image/jpg" ? "image/jpeg" : file.mimetype
  const bytes = file.buffer
  const valid =
    type === "image/png"
      ? bytes.length >= 24 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.toString("ascii", 12, 16) === "IHDR"
      : type === "image/jpeg"
        ? bytes.length >= 4 &&
          bytes[0] === 255 &&
          bytes[1] === 216 &&
          bytes[2] === 255 &&
          bytes[bytes.length - 2] === 255 &&
          bytes[bytes.length - 1] === 217
        : type === "image/webp"
          ? bytes.length >= 20 &&
            bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WEBP" &&
            ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16))
          : false
  if (!valid) throw new AiSettingsError(400, "UNSUPPORTED_OR_INVALID_IMAGE")
  return type
}

export function createAiSettingsService(deps: {
  store: AiSettingsStore
  upload: (input: {
    pathname: string
    body: Buffer
    contentType: string
  }) => Promise<{ url: string }>
  deleteBlob: (url: string) => Promise<void>
  reportCleanupError?: (error: unknown) => void
}) {
  const { store } = deps
  const report =
    deps.reportCleanupError ??
    ((error: unknown) => console.error("AI avatar cleanup failed", error))
  async function cleanup(tenantId: string, fileId: string | null) {
    if (!fileId) return
    try {
      const file = await store.findOwnedFile(tenantId, fileId)
      if (
        !file ||
        file.purpose !== "AI_AVATAR" ||
        file.tenantId !== tenantId ||
        (await store.isFileInUse(tenantId, fileId))
      )
        return
      // Keep the file ledger if storage deletion fails so cleanup can be retried.
      await deps.deleteBlob(file.key)
      await store.deleteFile(tenantId, fileId)
    } catch (error) {
      report(error)
    }
  }
  return {
    async read(tenantId: string) {
      return present(await store.read(tenantId), tenantId)
    },
    async save(tenantId: string, input: AiSettingsInput) {
      return present(await store.saveSettings(tenantId, input), tenantId)
    },
    async setPreset(
      tenantId: string,
      presetId: AiAvatarPreset,
      revision: number,
    ) {
      const result = await store.saveAvatar(tenantId, presetId, null, revision)
      await cleanup(tenantId, result.previousFileId)
      return present(result.record, tenantId)
    },
    async uploadAvatar(
      tenantId: string,
      userId: string,
      file: AiAvatarUpload,
      revision: number,
    ) {
      const contentType = validateAiAvatar(file)
      const id = randomUUID()
      const extension =
        contentType === "image/png"
          ? "png"
          : contentType === "image/webp"
            ? "webp"
            : "jpg"
      let blob: { url: string }
      try {
        blob = await deps.upload({
          pathname: `tenants/${tenantId}/ai-avatars/${id}/avatar.${extension}`,
          body: file.buffer,
          contentType,
        })
      } catch {
        throw new AiSettingsError(503, "AVATAR_UPLOAD_FAILED")
      }
      try {
        await store.createFile({
          id,
          tenantId,
          key: blob.url,
          purpose: "AI_AVATAR",
          contentType,
          size: file.size,
          createdById: userId,
        })
      } catch (error) {
        await deps.deleteBlob(blob.url).catch(report)
        throw error
      }
      try {
        const result = await store.saveAvatar(tenantId, "bot", id, revision)
        await cleanup(tenantId, result.previousFileId)
        return present(result.record, tenantId)
      } catch (error) {
        await cleanup(tenantId, id)
        throw error
      }
    },
  }
}
