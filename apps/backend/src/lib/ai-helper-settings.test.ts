import assert from "node:assert/strict"
import { test } from "node:test"
import {
  AI_AVATAR_MAX_BYTES,
  AiSettingsError,
  AiSettingsInputSchema,
  AiAvatarRevisionSchema,
  createAiSettingsService,
  defaultAiSettings,
  validateAiAvatar,
  type AiAvatarFile,
  type AiAvatarUpload,
  type AiSettingsRecord,
  type AiSettingsStore,
} from "./ai-helper-settings.js"

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSugAAAAASUVORK5CYII=",
  "base64",
)
const image: AiAvatarUpload = {
  buffer: png,
  size: png.length,
  mimetype: "image/png",
  originalname: "avatar.png",
}

function fixture() {
  const records = new Map<string, AiSettingsRecord>()
  const files = new Map<string, AiAvatarFile>()
  const deleted: string[] = []
  const uploaded: string[] = []
  const cleanupErrors: unknown[] = []
  let failUpload = false
  let failSave = false
  let failCreateFile = false
  let failCleanup = false
  function current(tenantId: string) {
    const defaults = defaultAiSettings()
    return (
      records.get(tenantId) ?? {
        tenantId,
        ...defaults,
        avatarRevision: 0,
        avatarPresetId: "bot",
        avatarFileId: null,
        avatarFile: null,
      }
    )
  }
  const store: AiSettingsStore = {
    async read(tenantId) {
      return records.get(tenantId) ?? null
    },
    async saveSettings(tenantId, input) {
      const existing = current(tenantId)
      if (existing.revision !== input.revision)
        throw new AiSettingsError(409, "AI_SETTINGS_CONFLICT")
      const result = { ...existing, ...input, revision: existing.revision + 1 }
      records.set(tenantId, result)
      return result
    },
    async saveAvatar(tenantId, avatarPresetId, avatarFileId, revision) {
      if (failSave) throw new Error("database unavailable")
      const existing = current(tenantId)
      if (existing.avatarRevision !== revision)
        throw new AiSettingsError(409, "AI_AVATAR_CONFLICT")
      const record = {
        ...existing,
        avatarPresetId,
        avatarFileId,
        avatarFile: avatarFileId ? files.get(avatarFileId)! : null,
        avatarRevision: revision + 1,
      }
      records.set(tenantId, record)
      return { record, previousFileId: existing.avatarFileId }
    },
    async createFile(file) {
      if (failCreateFile) throw new Error("file ledger unavailable")
      files.set(file.id, file)
    },
    async findOwnedFile(tenantId, id) {
      const file = files.get(id)
      return file?.tenantId === tenantId ? file : null
    },
    async isFileInUse(tenantId, id) {
      return records.get(tenantId)?.avatarFileId === id
    },
    async deleteFile(tenantId, id) {
      if (files.get(id)?.tenantId === tenantId) files.delete(id)
    },
  }
  const service = createAiSettingsService({
    store,
    async upload({ pathname }) {
      if (failUpload) throw new Error("storage unavailable")
      uploaded.push(pathname)
      return { url: `https://storage.example/${pathname}` }
    },
    async deleteBlob(url) {
      if (failCleanup) throw new Error("cleanup unavailable")
      deleted.push(url)
    },
    reportCleanupError(error) {
      cleanupErrors.push(error)
    },
  })
  return {
    service,
    store,
    records,
    files,
    uploaded,
    deleted,
    cleanupErrors,
    failUpload: () => {
      failUpload = true
    },
    failSave: () => {
      failSave = true
    },
    failCreateFile: () => {
      failCreateFile = true
    },
    failCleanup: () => {
      failCleanup = true
    },
  }
}

test("defaults are empty account preferences and do not create a record on read", async () => {
  const f = fixture()
  assert.deepEqual(await f.service.read("tenant-a"), defaultAiSettings())
  assert.equal(f.records.size, 0)
})

test("text settings validate, persist independently by tenant, and reject stale edits", async () => {
  const f = fixture()
  const input = AiSettingsInputSchema.parse({
    name: "  Ada  ",
    language: "English and Spanish",
    tone: "Warm",
    instructions: "  Ask before advising.  ",
    revision: 0,
  })
  const saved = await f.service.save("tenant-a", input)
  assert.equal(saved.name, "Ada")
  assert.equal(saved.instructions, "Ask before advising.")
  assert.equal(saved.revision, 1)
  assert.deepEqual(await f.service.read("tenant-a"), saved)
  assert.deepEqual(await f.service.read("tenant-b"), defaultAiSettings())
  await assert.rejects(
    f.service.save("tenant-a", { ...input, name: "Stale" }),
    { status: 409, code: "AI_SETTINGS_CONFLICT" },
  )
  assert.equal((await f.service.read("tenant-a")).name, "Ada")
  for (const bad of [
    { name: " " },
    { name: "x".repeat(81) },
    { language: "Other" },
    { tone: "Other" },
    { instructions: "x".repeat(4001) },
    { revision: -1 },
    { tenantId: "tenant-b" },
    { avatarFileId: "another-file" },
  ]) {
    assert.equal(
      AiSettingsInputSchema.safeParse({ ...input, ...bad }).success,
      false,
    )
  }
})

test("text and avatar revisions do not invalidate each other", async () => {
  const f = fixture()
  await f.service.setPreset("tenant-a", "compass", 0)
  const { avatar: _avatar, ...fields } = defaultAiSettings()
  await f.service.save("tenant-a", { ...fields, name: "Nora" })
  const saved = await f.service.setPreset("tenant-a", "sparkles", 1)
  assert.equal(saved.name, "Nora")
  assert.equal(saved.revision, 1)
  assert.equal(saved.avatar.revision, 2)
  await assert.rejects(f.service.setPreset("tenant-a", "bot", 1), {
    status: 409,
    code: "AI_AVATAR_CONFLICT",
  })
})

test("uploads use account-specific AI ownership and replace/remove only the previous helper image", async () => {
  const f = fixture()
  const first = await f.service.uploadAvatar("tenant-a", "admin", image, 0)
  const firstFile = [...f.files.values()][0]
  assert.equal(firstFile.purpose, "AI_AVATAR")
  assert.match(
    f.uploaded[0],
    /^tenants\/tenant-a\/ai-avatars\/[\w-]+\/avatar.png$/,
  )
  assert.equal(first.avatar.imageUrl, firstFile.key)
  await f.service.uploadAvatar("tenant-a", "admin", image, 1)
  assert.equal(f.files.size, 1)
  assert.deepEqual(f.deleted, [firstFile.key])
  const removed = await f.service.setPreset("tenant-a", "bot", 2)
  assert.equal(removed.avatar.imageUrl, null)
  assert.equal(removed.avatar.presetId, "bot")
  assert.equal(f.files.size, 0)
  assert.equal(f.deleted.length, 2)
})

test("upload failure leaves the current avatar untouched", async () => {
  const f = fixture()
  const original = await f.service.setPreset("tenant-a", "lightbulb", 0)
  f.failUpload()
  await assert.rejects(f.service.uploadAvatar("tenant-a", "admin", image, 1), {
    status: 503,
    code: "AVATAR_UPLOAD_FAILED",
  })
  assert.deepEqual(await f.service.read("tenant-a"), original)
  assert.equal(f.files.size, 0)
})

test("stale uploads and database failures compensate new blobs and preserve the current avatar", async () => {
  for (const failure of ["stale", "save", "ledger"]) {
    const f = fixture()
    const original = await f.service.setPreset("tenant-a", "compass", 0)
    if (failure === "save") f.failSave()
    if (failure === "ledger") f.failCreateFile()
    await assert.rejects(
      f.service.uploadAvatar(
        "tenant-a",
        "admin",
        image,
        failure === "stale" ? 0 : 1,
      ),
    )
    assert.deepEqual(await f.service.read("tenant-a"), original)
    assert.equal(f.files.size, 0)
    assert.equal(f.deleted.length, 1)
  }
})

test("failed old-image cleanup preserves its ledger without undoing the new avatar", async () => {
  const f = fixture()
  await f.service.uploadAvatar("tenant-a", "admin", image, 0)
  f.failCleanup()
  const updated = await f.service.setPreset("tenant-a", "sparkles", 1)
  assert.equal(updated.avatar.presetId, "sparkles")
  assert.equal(f.files.size, 1)
  assert.equal(f.cleanupErrors.length, 1)
})

test("foreign-tenant and personal profile files are never exposed or cleaned up", async () => {
  for (const file of [
    {
      id: "foreign",
      tenantId: "tenant-b",
      purpose: "AI_AVATAR",
      key: "https://storage.example/foreign.png",
    },
    {
      id: "personal",
      tenantId: "tenant-a",
      purpose: "AVATAR",
      key: "https://storage.example/personal.png",
    },
  ]) {
    const f = fixture()
    f.files.set(file.id, file)
    f.records.set("tenant-a", {
      ...defaultAiSettings(),
      tenantId: "tenant-a",
      avatarPresetId: "bot",
      avatarRevision: 0,
      avatarFileId: file.id,
      avatarFile: file,
    })
    assert.equal((await f.service.read("tenant-a")).avatar.imageUrl, null)
    await f.service.setPreset("tenant-a", "compass", 0)
    assert.equal(f.files.has(file.id), true)
    assert.equal(f.deleted.length, 0)
  }
})

test("avatar validation rejects empty, oversize, unsupported, and mismatched image content", () => {
  assert.deepEqual(AiAvatarRevisionSchema.parse({ avatarRevision: "2" }), {
    avatarRevision: 2,
  })
  for (const avatarRevision of [null, "", false, -1, "1.5", "-1", undefined]) {
    assert.equal(
      AiAvatarRevisionSchema.safeParse({ avatarRevision }).success,
      false,
    )
  }
  assert.equal(validateAiAvatar(image), "image/png")
  for (const bad of [
    { ...image, size: 0 },
    { ...image, size: AI_AVATAR_MAX_BYTES + 1 },
    { ...image, mimetype: "image/svg+xml" },
    { ...image, mimetype: "image/jpeg" },
    { ...image, buffer: Buffer.from("not an image"), size: 12 },
  ]) {
    assert.throws(() => validateAiAvatar(bad), AiSettingsError)
  }
  const jpeg = Buffer.from([255, 216, 255, 224, 0, 0, 255, 217])
  assert.equal(
    validateAiAvatar({
      ...image,
      buffer: jpeg,
      size: jpeg.length,
      mimetype: "image/jpeg",
    }),
    "image/jpeg",
  )
  const webp = Buffer.from("RIFF0000WEBPVP8 00000000")
  assert.equal(
    validateAiAvatar({
      ...image,
      buffer: webp,
      size: webp.length,
      mimetype: "image/webp",
    }),
    "image/webp",
  )
})
