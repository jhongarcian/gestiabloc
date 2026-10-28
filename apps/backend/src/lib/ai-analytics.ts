import { randomUUID } from "node:crypto"
import { z } from "zod"
import { Prisma, type PrismaClient } from "../generated/prisma/index.js"

export const AiTrackingFields = {
  conversationId: z.uuid().optional(),
  requestId: z.uuid().optional(),
}
export const AiAnalyticsQuerySchema = z.object({
  days: z.enum(["7", "30", "90"]).default("30"),
  channel: z.enum(["ALL", "TEST", "CONTACT_ASSISTANT"]).default("ALL"),
}).strict()
export type AiAnalyticsQuery = z.infer<typeof AiAnalyticsQuerySchema>
export type AiActivity = {
  tenantId: string
  actorId: string
  channel: "TEST" | "CONTACT_ASSISTANT"
  conversationId?: string
  requestId?: string
  questionOutcome: "ANSWERED" | "NEEDS_REVIEW" | null
  qualificationRun: boolean
}

export async function recordAiInteraction(
  client: Pick<PrismaClient, "aiInteraction">,
  activity: AiActivity,
) {
  // The database unique key also deduplicates concurrent retries across processes.
  // Legacy clients without tracking IDs remain supported as separate interactions.
  return client.aiInteraction.createMany({
    data: [{ ...activity,
      conversationId: activity.conversationId ?? randomUUID(),
      requestId: activity.requestId ?? randomUUID(),
    }],
    skipDuplicates: true,
  })
}

export function analyticsWindow(days: number, now: Date) {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  start.setUTCDate(start.getUTCDate() - days + 1)
  return { start, end: now }
}
type AggregateRow = {
  date: string | null
  conversations: number
  answered: number
  needsReview: number
  qualificationRuns: number
}
const zeroMetrics = () => ({ conversations: 0, answered: 0, needsReview: 0, qualificationRuns: 0 })
export function buildAiAnalytics(
  rows: AggregateRow[], query: AiAnalyticsQuery, now: Date,
) {
  const days = Number(query.days)
  const { start, end } = analyticsWindow(days, now)
  const byDate = new Map(rows.filter((row) => row.date !== null).map((row) => [row.date, row]))
  const total = rows.find((row) => row.date === null)
  const { date: _date, ...totals } = total ?? { date: null, ...zeroMetrics() }
  const daily = Array.from({ length: days }, (_, index) => {
    const day = new Date(start)
    day.setUTCDate(day.getUTCDate() + index)
    const date = day.toISOString().slice(0, 10)
    return byDate.get(date) ?? { date, ...zeroMetrics() }
  })
  return { days, channel: query.channel, timezone: "UTC" as const,
    from: start.toISOString(), through: end.toISOString(), totals, daily }
}

export async function loadAiAnalytics(
  client: Pick<PrismaClient, "$queryRaw">,
  tenantId: string, query: AiAnalyticsQuery, now = new Date(),
) {
  const { start, end } = analyticsWindow(Number(query.days), now)
  const channel = query.channel === "ALL" ? Prisma.empty
    : Prisma.sql`AND "channel" = ${query.channel}::"AiActivityChannel"`
  const rows = await client.$queryRaw<AggregateRow[]>(Prisma.sql`
    WITH activity AS (
      SELECT *, to_char("createdAt", 'YYYY-MM-DD') AS day
      FROM "AiInteraction"
      WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${start} AND "createdAt" <= ${end}
      ${channel}
    )
    SELECT day AS date,
      COUNT(DISTINCT ("actorId", "channel", "conversationId"))::int AS conversations,
      COUNT(*) FILTER (WHERE "questionOutcome" = 'ANSWERED')::int AS answered,
      COUNT(*) FILTER (WHERE "questionOutcome" = 'NEEDS_REVIEW')::int AS "needsReview",
      COUNT(*) FILTER (WHERE "qualificationRun")::int AS "qualificationRuns"
    FROM activity GROUP BY GROUPING SETS ((), (day))
  `)
  return buildAiAnalytics(rows, query, now)
}
