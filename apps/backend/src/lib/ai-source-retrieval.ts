import type { PrismaClient } from "../generated/prisma/index.js"
import { Prisma } from "../generated/prisma/index.js"
import type { AiChatSource, AiTestChatInput } from "./ai-helper-replies.js"

const stop = new Set(
  "what which how where when why is are the a an and or of for to in on with do does can could i you your our please tell me about de la el los las que como donde cuando por para un una y o es son del se puede cual".split(
    " ",
  ),
)
export function aiSourceSearchQuery(input: AiTestChatInput) {
  const terms =
    `${input.question} ${input.history
      .filter((item) => item.role === "user")
      .slice(-2)
      .map((item) => item.content)
      .join(" ")}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  return [
    ...new Set(terms.filter((word) => word.length > 1 && !stop.has(word))),
  ]
    .slice(0, 24)
    .join(" OR ")
}
export async function retrieveAiDocumentSources(
  client: Pick<PrismaClient, "$queryRaw">,
  tenantId: string,
  input: AiTestChatInput,
  serviceIds?: readonly string[],
): Promise<AiChatSource[]> {
  if (serviceIds && serviceIds.length === 0) return []
  const query = aiSourceSearchQuery(input)
  if (!query) return []
  const scope = serviceIds
    ? Prisma.sql`AND v.id IN (${Prisma.join([...serviceIds])})`
    : Prisma.empty
  const rows = await client.$queryRaw<
    Array<{
      id: string
      sourceId: string
      serviceId: string
      label: string
      skillName: string
      page: number | null
      content: string
    }>
  >(Prisma.sql`
    SELECT c.id, c."sourceId", s."serviceId", s.label, v.name AS "skillName", c.page, c.content
    FROM "AiSourceChunk" c
    JOIN "ServiceAiSource" s ON s.id=c."sourceId" AND s."tenantId"=c."tenantId"
    JOIN "Service" v ON v.id=s."serviceId" AND v."tenantId"=s."tenantId"
    JOIN "Service" p ON p.id=v."parentServiceId" AND p."tenantId"=v."tenantId"
    WHERE c."tenantId"=${tenantId} AND s.status='READY' AND s."deletedAt" IS NULL
      AND v.kind='OFFERING' AND v."isActive"=true AND p.kind='GROUP' AND p."isActive"=true
      ${scope}
      AND c."searchVector" @@ websearch_to_tsquery('simple', ${query})
    ORDER BY ts_rank_cd(c."searchVector", websearch_to_tsquery('simple', ${query})) DESC, s."createdAt" DESC, c.ordinal ASC
    LIMIT 12`)
  return rows.map((row) => ({
    id: `document:${row.id}`,
    label: `${row.skillName} · ${row.label}${row.page ? ` · Page ${row.page}` : ""}`,
    section: "document",
    skillId: row.serviceId,
    sourceId: row.sourceId,
    page: row.page ?? undefined,
    content: row.content,
  }))
}
