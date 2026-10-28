import { z } from "zod"
import type { Prisma, PrismaClient } from "../generated/prisma/index.js"
import { aiProfileRevision } from "./ai-profile-revision.js"
import { AiSkillError, aiSkillSelect, presentAiSkill } from "./ai-skills.js"
import { lockServiceHierarchyTx } from "./service-configuration-inheritance.js"
import {
  knowledgeReadOnlyReason,
  knowledgeRevision,
  mergeAiKnowledge,
  profileObject,
  type AiKnowledgeUpdateSchema,
} from "./ai-knowledge.js"

export const AiFaqSchema = z
  .object({
    question: z.string().trim().min(1, "Enter a question.").max(500),
    answer: z.string().trim().min(1, "Enter an answer.").max(4000),
    exactAnswer: z.boolean(),
  })
  .strict()
const revision = z.string().regex(/^[a-f0-9]{64}$/)
export const AiFaqMutationSchema = z
  .object({ revision, faq: AiFaqSchema })
  .strict()
export const AiFaqDeleteSchema = z.object({ revision }).strict()
export const AiFaqOrderSchema = z
  .object({ revision, ids: z.array(z.uuid()).max(100) })
  .strict()
export const aiFaqSelect = {
  id: true,
  question: true,
  answer: true,
  exactAnswer: true,
  sortOrder: true,
} satisfies Prisma.ServiceAiFaqSelect
type Client = Pick<Prisma.TransactionClient, "service" | "serviceAiFaq">
async function requireSkill(
  client: Client,
  tenantId: string,
  serviceId: string,
) {
  const record = await client.service.findFirst({
    where: { tenantId, id: serviceId, kind: "OFFERING" },
    select: { id: true, fitProfile: true },
  })
  if (!record) throw new AiSkillError(404, "AI_SKILL_NOT_FOUND")
  return record
}
export async function readAiFaqs(
  client: Client,
  tenantId: string,
  serviceId: string,
) {
  const record = await requireSkill(client, tenantId, serviceId)
  const faqs = await client.serviceAiFaq.findMany({
    where: { tenantId, serviceId },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: aiFaqSelect,
  })
  const legacy = profileObject(
    profileObject(record.fitProfile).knowledgeProfile,
  ).faqNotes
  return {
    faqs,
    revision: aiProfileRevision(faqs),
    legacyNotes: typeof legacy === "string" ? legacy : "",
  }
}
export async function mutateAiFaqs(
  client: PrismaClient,
  tenantId: string,
  serviceId: string,
  input: { revision: string } & (
    | { action: "create"; faq: z.infer<typeof AiFaqSchema> }
    | { action: "update"; id: string; faq: z.infer<typeof AiFaqSchema> }
    | { action: "delete"; id: string }
    | { action: "order"; ids: string[] }
  ),
) {
  return client.$transaction(
    async (tx) => {
      await lockServiceHierarchyTx(tx, tenantId, serviceId)
      const current = await readAiFaqs(tx, tenantId, serviceId)
      if (current.revision !== input.revision)
        throw new AiSkillError(409, "AI_FAQ_CONFLICT")
      if (
        (input.action === "update" || input.action === "delete") &&
        !current.faqs.some((faq) => faq.id === input.id)
      )
        throw new AiSkillError(404, "AI_FAQ_NOT_FOUND")
      if (input.action === "create") {
        if (current.faqs.length >= 100)
          throw new AiSkillError(
            400,
            "AI_FAQ_LIMIT_REACHED",
            "A skill can have up to 100 questions.",
          )
        await tx.serviceAiFaq.create({
          data: {
            tenantId,
            serviceId,
            ...input.faq,
            sortOrder:
              Math.max(-1, ...current.faqs.map((faq) => faq.sortOrder)) + 1,
          },
        })
      } else if (input.action === "update") {
        await tx.serviceAiFaq.update({
          where: { tenantId_id: { tenantId, id: input.id } },
          data: input.faq,
        })
      } else if (input.action === "delete") {
        await tx.serviceAiFaq.delete({
          where: { tenantId_id: { tenantId, id: input.id } },
        })
      } else {
        const ids = new Set(input.ids)
        if (
          ids.size !== current.faqs.length ||
          input.ids.length !== ids.size ||
          current.faqs.some((faq) => !ids.has(faq.id))
        )
          throw new AiSkillError(400, "INVALID_FAQ_ORDER")
        for (const [sortOrder, id] of input.ids.entries())
          await tx.serviceAiFaq.update({
            where: { tenantId_id: { tenantId, id } },
            data: { sortOrder },
          })
      }
      return readAiFaqs(tx, tenantId, serviceId)
    },
    { timeout: 15000 },
  )
}
export async function saveAiKnowledge(
  client: PrismaClient,
  tenantId: string,
  serviceId: string,
  input: z.infer<typeof AiKnowledgeUpdateSchema>,
) {
  return client.$transaction(async (tx) => {
    await lockServiceHierarchyTx(tx, tenantId, serviceId)
    const current = await requireSkill(tx, tenantId, serviceId)
    const reason = knowledgeReadOnlyReason(current.fitProfile)
    if (reason)
      throw new AiSkillError(409, "AI_KNOWLEDGE_REVIEW_REQUIRED", reason)
    if (knowledgeRevision(current.fitProfile) !== input.revision)
      throw new AiSkillError(409, "AI_KNOWLEDGE_CONFLICT")
    const saved = await tx.service.update({
      where: { tenantId_id: { tenantId, id: serviceId } },
      data: {
        fitProfile: mergeAiKnowledge(
          current.fitProfile,
          input.knowledge,
        ) as Prisma.InputJsonObject,
      },
      select: aiSkillSelect,
    })
    return { skill: presentAiSkill(saved) }
  })
}
