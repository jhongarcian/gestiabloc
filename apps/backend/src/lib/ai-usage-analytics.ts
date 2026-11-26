import { Prisma, type PrismaClient } from "../generated/prisma/index.js"

export type AiUsageMetrics = {
  creditsUsed: number
  chargedReplies: number
  providerCalls: number
  inputTokens: number
  outputTokens: number
  unknownTokenCalls: number
  inProgressCalls: number
  failedCalls: number
}
type CreditRow = { date: string | null; creditsUsed: number; chargedReplies: number }
type ProviderRow = { date: string | null; providerCalls: number; inputTokens: number; outputTokens: number; unknownTokenCalls: number; inProgressCalls: number; failedCalls: number }
const zero = (): AiUsageMetrics => ({ creditsUsed: 0, chargedReplies: 0, providerCalls: 0, inputTokens: 0, outputTokens: 0, unknownTokenCalls: 0, inProgressCalls: 0, failedCalls: 0 })

export function buildAiUsageAnalytics(credits: CreditRow[], providers: ProviderRow[], dates: string[]) {
  const merge = (date: string | null): AiUsageMetrics => {
    const { date: _creditDate, ...credit } = credits.find(row => row.date === date) ?? { date }
    const { date: _providerDate, ...provider } = providers.find(row => row.date === date) ?? { date }
    const result = { ...zero(), ...credit, ...provider }
    if (!Object.values(result).every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("Invalid AI usage totals")
    return result
  }
  return { totals: merge(null), daily: dates.map(date => ({ date, ...merge(date) })) }
}

export async function loadAiUsageAnalytics(
  client: Pick<PrismaClient, "$queryRaw">,
  tenantId: string, channel: "ALL" | "TEST" | "CONTACT_ASSISTANT", start: Date, end: Date, dates: string[],
) {
  // Aggregate each source separately: joining provider attempts to credit ledger
  // rows would multiply customer charges when one reply makes internal calls.
  const creditChannel = channel === "ALL" ? Prisma.empty : Prisma.sql`AND r."channel" = ${channel}`
  const providerChannel = channel === "ALL" ? Prisma.empty : Prisma.sql`AND "channel" = ${channel}`
  const [credits, providers] = await Promise.all([
    client.$queryRaw<CreditRow[]>(Prisma.sql`
      SELECT to_char(l."createdAt", 'YYYY-MM-DD') AS date,
        SUM(l."monthlyUnits"::bigint + l."purchasedUnits"::bigint)::float8 AS "creditsUsed",
        COUNT(*)::float8 AS "chargedReplies"
      FROM "AiCreditLedger" l
      JOIN "AiCreditRequest" r ON r."tenantId" = l."tenantId" AND r.id = l."requestId"
      WHERE l."tenantId" = ${tenantId} AND l.kind = 'COMMIT'
        AND l."createdAt" >= ${start} AND l."createdAt" <= ${end}
        AND r.channel IN ('TEST', 'CONTACT_ASSISTANT') ${creditChannel}
      GROUP BY GROUPING SETS ((), (to_char(l."createdAt", 'YYYY-MM-DD')))
    `),
    client.$queryRaw<ProviderRow[]>(Prisma.sql`
      SELECT to_char("createdAt", 'YYYY-MM-DD') AS date,
        COUNT(*)::float8 AS "providerCalls",
        COALESCE(SUM("inputTokens"), 0)::float8 AS "inputTokens",
        COALESCE(SUM("outputTokens"), 0)::float8 AS "outputTokens",
        COUNT(*) FILTER (WHERE "inputTokens" IS NULL OR "outputTokens" IS NULL)::float8 AS "unknownTokenCalls",
        COUNT(*) FILTER (WHERE status = 'STARTED')::float8 AS "inProgressCalls",
        COUNT(*) FILTER (WHERE status IN ('HTTP_ERROR', 'TRANSPORT_ERROR', 'INVALID_RESPONSE'))::float8 AS "failedCalls"
      FROM "AiProviderUsage"
      WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${start} AND "createdAt" <= ${end}
        AND channel IN ('TEST', 'CONTACT_ASSISTANT') ${providerChannel}
      GROUP BY GROUPING SETS ((), (to_char("createdAt", 'YYYY-MM-DD')))
    `),
  ])
  // SUM over no credit rows is SQL NULL; an empty committed ledger means zero
  // recorded spending, independently of the current wallet's allowance/balance.
  const normalizedCredits = credits.map(row => ({ ...row, creditsUsed: row.creditsUsed ?? 0 }))
  return buildAiUsageAnalytics(normalizedCredits, providers, dates)
}
