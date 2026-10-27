import type { PrismaClient } from "../generated/prisma/index.js"
import { AI_AVATAR_PRESETS, defaultAiSettings } from "./ai-helper-settings.js"

// Only the name and avatar are visible to staff. Instructions remain admin-only.
export async function loadAiHelperIdentity(
  client: Pick<PrismaClient, "tenantAiSettings">,
  tenantId: string,
) {
  const record = await client.tenantAiSettings.findUnique({
    where: { tenantId },
    select: {
      name: true, avatarPresetId: true, avatarRevision: true,
      avatarFile: { select: { tenantId: true, purpose: true, key: true } },
    },
  })
  const defaults = defaultAiSettings()
  const presetId = AI_AVATAR_PRESETS.find((preset) => preset === record?.avatarPresetId) ?? "bot"
  return {
    name: record?.name ?? defaults.name,
    avatar: {
      presetId,
      revision: record?.avatarRevision ?? 0,
      imageUrl: record?.avatarFile?.tenantId === tenantId && record.avatarFile.purpose === "AI_AVATAR"
        ? record.avatarFile.key : null,
    },
  }
}
