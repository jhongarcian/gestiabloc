export type AiHelperIdentity = {
  name: string
  avatar: {
    presetId: "bot" | "sparkles" | "compass" | "lightbulb"
    imageUrl: string | null
    revision: number
  }
}
export type AiHelperSource = {
  id: string
  label: string
  section: string
  skillId: string | null
  excerpt: string
  sourceId?: string
  page?: number
}
export const defaultAiHelperIdentity: AiHelperIdentity = {
  name: "AI Helper",
  avatar: { presetId: "bot", imageUrl: null, revision: 0 },
}
