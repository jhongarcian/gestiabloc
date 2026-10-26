import type {
  ServiceFitFieldDefinition,
  ServiceFitProfileDraft,
} from "../../_components/service-fit-rules-tab"
import type { AiSkillDraft } from "./demo-data"
import { knowledgeInput } from "./content"

export type AiQualification = Pick<
  ServiceFitProfileDraft,
  "enabled" | "summary" | "rules" | "requirementMetadata" | "optionMetadata"
>
export type AiSkillDto = {
  id: string
  name: string
  parentId: string | null
  parentName: string
  isActive: boolean
  parentActive: boolean
  availableToAssistant: boolean
  tagline: string
  faqCount: number
  knowledgeRevision: string
  knowledgeReadOnlyReason: string | null
  revision: string
  qualification: AiQualification
  qualificationReadOnlyReason: string | null
  knowledgeProfile: ServiceFitProfileDraft["knowledgeProfile"]
  verificationProfile: ServiceFitProfileDraft["verificationProfile"]
  notes: {
    overview: string
    pricing: { basePriceCents: number; currency: string }
    checklist: Array<{
      id: string
      label: string
      description: string | null
      isRequired: boolean
    }>
    sources: { overview: string; pricing: string; checklist: string }
  }
}
export type AiSkillsResponse = {
  ok: true
  skills: AiSkillDto[]
  fields: ServiceFitFieldDefinition[]
}
export type AiSkillResponse = {
  ok: true
  skill: AiSkillDto
  fields: ServiceFitFieldDefinition[]
}
export function toSkillDraft(skill: AiSkillDto): AiSkillDraft {
  let pricing = `${(skill.notes.pricing.basePriceCents / 100).toFixed(2)} ${skill.notes.pricing.currency}`
  try {
    pricing = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: skill.notes.pricing.currency,
    }).format(skill.notes.pricing.basePriceCents / 100)
  } catch {
    /* Keep the saved currency code visible. */
  }
  return {
    ...skill,
    qualification: structuredClone(skill.qualification),
    savedQualification: structuredClone(skill.qualification),
    savedKnowledge: knowledgeInput({
      description: skill.knowledgeProfile.overview,
      pricingNotes: skill.knowledgeProfile.pricingNotes,
      workflowNotes: skill.knowledgeProfile.workflowNotes,
      adapter: skill.knowledgeProfile.adapter,
      verification: skill.verificationProfile,
    }),
    knowledge: {
      description: skill.knowledgeProfile.overview,
      pricingNotes: skill.knowledgeProfile.pricingNotes,
      workflowNotes: skill.knowledgeProfile.workflowNotes,
      adapter: skill.knowledgeProfile.adapter,
      verification: {
        mode: skill.verificationProfile.mode,
        guidance: skill.verificationProfile.guidance,
        triggerKeywords: [...skill.verificationProfile.triggerKeywords],
      },
      files: [],
      links: skill.verificationProfile.sourceUrls.map((url, index) => ({
        id: `legacy-source-${index}`,
        label: url,
        url,
      })),
    },
    notes: {
      overview: skill.notes.overview || "No service overview has been saved.",
      pricing: `${pricing} base price.`,
      checklist: skill.notes.checklist.map(
        (item) =>
          `${item.label}${item.description ? ` — ${item.description}` : ""}${item.isRequired ? " (required)" : " (optional)"}`,
      ),
      sources: skill.notes.sources,
    },
  }
}
export const qualificationDirty = (skill: AiSkillDraft) =>
  JSON.stringify(skill.qualification) !==
  JSON.stringify(skill.savedQualification)
export const knowledgeDirty = (skill: AiSkillDraft) =>
  JSON.stringify(knowledgeInput(skill.knowledge)) !==
  JSON.stringify(skill.savedKnowledge)
export function mergeSavedSkill(
  current: AiSkillDraft,
  dto: AiSkillDto,
  section: "knowledge" | "qualification" | "refresh",
): AiSkillDraft {
  const next = toSkillDraft(dto)
  const keepQualification =
    section !== "qualification" && qualificationDirty(current)
  const keepKnowledge = section !== "knowledge" && knowledgeDirty(current)
  return {
    ...next,
    qualification: keepQualification
      ? current.qualification
      : next.qualification,
    savedQualification: keepQualification
      ? current.savedQualification
      : next.savedQualification,
    revision:
      keepQualification &&
      JSON.stringify(dto.qualification) !==
        JSON.stringify(current.savedQualification)
        ? current.revision
        : next.revision,
    knowledge: {
      ...(keepKnowledge ? current.knowledge : next.knowledge),
      links: current.knowledge.links,
      files: current.knowledge.files,
    },
    savedKnowledge: keepKnowledge
      ? current.savedKnowledge
      : next.savedKnowledge,
    knowledgeRevision: keepKnowledge
      ? current.knowledgeRevision
      : next.knowledgeRevision,
  }
}
