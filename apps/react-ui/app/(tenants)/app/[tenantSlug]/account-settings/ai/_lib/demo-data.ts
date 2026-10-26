import type { AiQualification, AiSkillDto } from "./skills"
import type { AiKnowledgeInput } from "./content"

export type AiHelperDraft = {
  name: string
  language: string
  tone: string
  instructions: string
}
export type AiKnowledgeDraft = AiKnowledgeInput
export type AiSkillDraft = Omit<AiSkillDto, "notes"> & {
  knowledge: AiKnowledgeDraft
  savedQualification: AiQualification
  savedKnowledge: AiKnowledgeInput
  notes: {
    overview: string
    pricing: string
    checklist: string[]
    sources: { overview: string; pricing: string; checklist: string }
  }
}
export type AiWorkspaceDraft = { helper: AiHelperDraft; skills: AiSkillDraft[] }
export const SKILL_SECTION_LABELS = {
  faq: "FAQ",
  "knowledge-base": "Knowledge Base",
  "qualification-rules": "Qualification Rules",
} as const
export type SkillSection = keyof typeof SKILL_SECTION_LABELS
