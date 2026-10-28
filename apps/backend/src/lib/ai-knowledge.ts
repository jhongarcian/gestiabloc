import { z } from "zod"
import { aiProfileRevision } from "./ai-profile-revision.js"
import {
  SERVICE_KNOWLEDGE_ADAPTERS,
  SERVICE_VERIFICATION_MODES,
} from "./service-fit.js"
export const AiKnowledgeSchema = z
  .object({
    description: z.string().trim().max(6000),
    pricingNotes: z.string().trim().max(4000),
    workflowNotes: z.string().trim().max(4000),
    adapter: z.enum(SERVICE_KNOWLEDGE_ADAPTERS),
    verification: z
      .object({
        mode: z.enum(SERVICE_VERIFICATION_MODES),
        guidance: z.string().trim().max(4000),
        triggerKeywords: z.array(z.string().trim().min(1).max(120)).max(12),
      })
      .strict(),
  })
  .strict()
export const AiKnowledgeUpdateSchema = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    knowledge: AiKnowledgeSchema,
  })
  .strict()
export type AiKnowledgeInput = z.infer<typeof AiKnowledgeSchema>
export function profileObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
export function knowledgeRevision(raw: unknown) {
  const profile = profileObject(raw)
  return aiProfileRevision({
    knowledge: profile.knowledgeProfile ?? null,
    verification: profile.verificationProfile ?? null,
  })
}
export function knowledgeReadOnlyReason(raw: unknown) {
  const object = (value: unknown) =>
    value == null || (typeof value === "object" && !Array.isArray(value))
  const profile = profileObject(raw)
  const knowledge = profileObject(profile.knowledgeProfile)
  const verification = profileObject(profile.verificationProfile)
  const strings = (record: Record<string, unknown>, keys: string[]) =>
    keys.every((key) => record[key] == null || typeof record[key] === "string")
  return !object(raw) ||
    !object(profile.knowledgeProfile) ||
    !object(profile.verificationProfile) ||
    !strings(knowledge, ["overview", "pricingNotes", "workflowNotes"]) ||
    !strings(verification, ["guidance"]) ||
    (knowledge.adapter != null &&
      !z.enum(SERVICE_KNOWLEDGE_ADAPTERS).safeParse(knowledge.adapter)
        .success) ||
    (verification.mode != null &&
      !z.enum(SERVICE_VERIFICATION_MODES).safeParse(verification.mode)
        .success) ||
    (verification.triggerKeywords != null &&
      (!Array.isArray(verification.triggerKeywords) ||
        verification.triggerKeywords.length > 12 ||
        verification.triggerKeywords.some(
          (keyword) => typeof keyword !== "string",
        )))
    ? "The saved knowledge format needs review before it can be edited. Existing content has been preserved."
    : null
}
export function mergeAiKnowledge(raw: unknown, input: AiKnowledgeInput) {
  const profile = profileObject(raw)
  return {
    ...profile,
    knowledgeProfile: {
      ...profileObject(profile.knowledgeProfile),
      overview: input.description,
      pricingNotes: input.pricingNotes,
      workflowNotes: input.workflowNotes,
      adapter: input.adapter,
    },
    verificationProfile: {
      ...profileObject(profile.verificationProfile),
      mode: input.verification.mode,
      guidance: input.verification.guidance,
      triggerKeywords: [...new Set(input.verification.triggerKeywords)],
    },
  }
}
