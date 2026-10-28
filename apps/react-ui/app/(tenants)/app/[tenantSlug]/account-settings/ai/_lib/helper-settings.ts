import type { AiHelperDraft } from "./demo-data"

export const AI_AVATAR_MAX_BYTES = 5 * 1024 * 1024
export const AI_LANGUAGES = ["English", "Spanish", "English and Spanish"]
export const AI_TONES = ["Professional", "Warm", "Direct"]
export const AI_AVATAR_PRESETS = [
  "bot",
  "sparkles",
  "compass",
  "lightbulb",
] as const
export type AiAvatarPreset = (typeof AI_AVATAR_PRESETS)[number]
export type AiHelperSettings = AiHelperDraft & {
  revision: number
  avatar: {
    presetId: AiAvatarPreset
    imageUrl: string | null
    revision: number
  }
}
export type AiSettingsResponse = { ok: true; settings: AiHelperSettings }

export function helperFields(settings: AiHelperDraft): AiHelperDraft {
  return {
    name: settings.name,
    language: settings.language,
    tone: settings.tone,
    instructions: settings.instructions,
  }
}

export function emptyHelperSettings(): AiHelperSettings {
  return {
    name: "AI Helper",
    language: "English",
    tone: "Professional",
    instructions: "",
    revision: 0,
    avatar: { presetId: "bot", imageUrl: null, revision: 0 },
  }
}

export function helperValidation(helper: AiHelperDraft) {
  const errors: Partial<Record<keyof AiHelperDraft, string>> = {}
  if (!helper.name.trim()) errors.name = "Enter a name for your helper."
  else if (helper.name.trim().length > 80)
    errors.name = "Use 80 characters or fewer."
  if (!AI_LANGUAGES.includes(helper.language))
    errors.language = "Choose a response language."
  if (!AI_TONES.includes(helper.tone)) errors.tone = "Choose a tone."
  if (helper.instructions.trim().length > 4000)
    errors.instructions = "Use 4,000 characters or fewer."
  return errors
}
