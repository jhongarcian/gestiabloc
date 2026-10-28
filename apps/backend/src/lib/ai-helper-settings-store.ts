import { prisma } from "./prisma.js"
import { AiSettingsError, type AiSettingsStore } from "./ai-helper-settings.js"

const includeAvatar = { avatarFile: true } as const

export const aiSettingsStore: AiSettingsStore = {
  read: (tenantId) =>
    prisma.tenantAiSettings.findUnique({
      where: { tenantId },
      include: includeAvatar,
    }),
  saveSettings: (tenantId, input) =>
    prisma.$transaction(async (tx) => {
      await tx.tenantAiSettings.createMany({
        data: [{ tenantId }],
        skipDuplicates: true,
      })
      const { revision, ...fields } = input
      const result = await tx.tenantAiSettings.updateMany({
        where: { tenantId, revision },
        data: { ...fields, revision: { increment: 1 } },
      })
      if (result.count !== 1)
        throw new AiSettingsError(409, "AI_SETTINGS_CONFLICT")
      return tx.tenantAiSettings.findUniqueOrThrow({
        where: { tenantId },
        include: includeAvatar,
      })
    }),
  saveAvatar: (tenantId, avatarPresetId, avatarFileId, avatarRevision) =>
    prisma.$transaction(async (tx) => {
      await tx.tenantAiSettings.createMany({
        data: [{ tenantId }],
        skipDuplicates: true,
      })
      const previous = await tx.tenantAiSettings.findUniqueOrThrow({
        where: { tenantId },
        select: { avatarFileId: true },
      })
      const result = await tx.tenantAiSettings.updateMany({
        where: { tenantId, avatarRevision },
        data: {
          avatarPresetId,
          avatarFileId,
          avatarRevision: { increment: 1 },
        },
      })
      if (result.count !== 1)
        throw new AiSettingsError(409, "AI_AVATAR_CONFLICT")
      return {
        record: await tx.tenantAiSettings.findUniqueOrThrow({
          where: { tenantId },
          include: includeAvatar,
        }),
        previousFileId: previous.avatarFileId,
      }
    }),
  async createFile(file) {
    await prisma.file.create({ data: { ...file, purpose: "AI_AVATAR" } })
  },
  findOwnedFile: (tenantId, id) =>
    prisma.file.findFirst({ where: { tenantId, id, purpose: "AI_AVATAR" } }),
  async isFileInUse(tenantId, avatarFileId) {
    return Boolean(
      await prisma.tenantAiSettings.findFirst({
        where: { tenantId, avatarFileId },
        select: { tenantId: true },
      }),
    )
  },
  async deleteFile(tenantId, id) {
    await prisma.file.deleteMany({
      where: { tenantId, id, purpose: "AI_AVATAR" },
    })
  },
}
