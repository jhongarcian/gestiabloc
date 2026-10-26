import type {
  ServiceVerificationProfileDraft,
  ServiceKnowledgeProfileDraft,
} from "../../_components/service-fit-rules-tab"
import type { AiQualification, AiSkillDto } from "./skills"

export type AiHelperDraft = {
  name: string
  language: string
  tone: string
  instructions: string
}
export type AiFaqDraft = { id: string; question: string; answer: string }
export type AiLinkSource = { id: string; label: string; url: string }
export type AiFileSource = {
  id: string
  name: string
  size: number
  type: string
}
export type AiKnowledgeDraft = {
  description: string
  links: AiLinkSource[]
  files: AiFileSource[]
  adapter: ServiceKnowledgeProfileDraft["adapter"]
  verification: Omit<ServiceVerificationProfileDraft, "sourceUrls">
}
export type AiSkillDraft = Omit<AiSkillDto, "notes"> & {
  faqs: AiFaqDraft[]
  knowledge: AiKnowledgeDraft
  savedQualification: AiQualification
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
export function draftSnapshots(
  draft: AiWorkspaceDraft,
): Record<string, string> {
  return Object.fromEntries(
    draft.skills.flatMap((skill) => [
      [`${skill.id}/faq`, JSON.stringify(skill.faqs)],
      [`${skill.id}/knowledge-base`, JSON.stringify(skill.knowledge)],
    ]),
  )
}
export function isSourceUrl(value: string) {
  try {
    return ["https:", "http:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
export function createDraftId() {
  return crypto.randomUUID()
}
