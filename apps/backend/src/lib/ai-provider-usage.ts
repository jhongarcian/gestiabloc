import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import type { RequestHandler } from "express"
import type { AuthedRequest } from "../middleware/requireAuth.js"

export type ProviderUsageRecord = {
  id: string; logicalRequestId: string; tenantId: string | null; actorId: string | null
  channel: string; purpose: string; provider: "groq"; requestedModel: string; model: string | null
  status: string; httpStatus: number | null; durationMs: number
  inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null
  reasoningTokens: number | null; estimatedCostUsd: string | null; upperBoundCostUsd: string | null
  rateVersion: string
}
export type UsageRecorder = (record: ProviderUsageRecord) => Promise<void>
type Context = { tenantId?: string; actorId?: string; channel: string; requestId?: string; logicalRequestId?: string; creditRequestId?: string }
type Scope = Context & { logicalRequestId: string; input: number; output: number; record?: UsageRecorder }
const storage = new AsyncLocalStorage<Scope>()

export function withAiUsage<T>(context: Context, action: () => T, record?: UsageRecorder): T {
  return storage.run({ ...context, logicalRequestId: context.logicalRequestId ?? randomUUID(), input: 0, output: 0, record }, action)
}
export const currentAiUsage = () => storage.getStore()

export function aiUsageContext(channel: string): RequestHandler {
  return (req, _res, next) => withAiUsage({
    tenantId: String(req.params.tenantId), actorId: (req as AuthedRequest).user.id,
    channel,
  }, next)
}

export async function writeProviderUsage(record: ProviderUsageRecord) {
  const observer = storage.getStore()?.record
  if (observer) return observer({ ...record })
  if (process.env.AI_PROVIDER_METERING_ENABLED !== "true") return
  // Write STARTED before contacting the provider. A failed final write leaves an
  // explicit uncertain attempt, never a fabricated zero-cost completion.
  const { prisma } = await import("./prisma.js")
  await prisma.aiProviderUsage.upsert({ where: { id: record.id }, create: record, update: record })
}
