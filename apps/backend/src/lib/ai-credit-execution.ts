import type { PrismaClient } from "../generated/prisma/index.js"
import { z } from "zod"
import { getBillingConfiguration } from "./billing-config.js"
import { AiCreditError, reserveAiCredit, settleAiCredit, type AiCreditRequestKey } from "./ai-credit-wallet.js"
import { aiCreditFingerprint, encryptAiReply, decryptAiReply, emptyAiReply } from "./ai-credit-replay.js"
import { withAiUsage } from "./ai-provider-usage.js"
import { findAiModel, isAiModelApproved, modelApprovalKey, modelKey, type AiModelSelection } from "./ai-model-catalog.js"

type Database = Pick<PrismaClient, "$transaction" | "aiCreditRequest">
export type AiReplyExecutor = <T>(fingerprint: unknown, generate: () => Promise<T>, model?: AiModelSelection) => Promise<T>
type Identity = Omit<AiCreditRequestKey, "requestHash" | "requestId"> & { requestId?: string; conversationId?: string }
type Options = { signal?: AbortSignal; env?: Record<string, string | undefined>; now?: () => Date }
export function createAiReplyExecutor(db: Database, identity: Identity, options: Options = {}): AiReplyExecutor {
  return async <T>(fingerprint: unknown, generate: () => Promise<T>, selection?: AiModelSelection): Promise<T> => {
    const env = options.env ?? process.env, now = options.now ?? (() => new Date())
    let config: ReturnType<typeof getBillingConfiguration>
    try { config = getBillingConfiguration(env) } catch { throw new AiCreditError(503, "AI_BILLING_UNAVAILABLE") }
    if (!config.creditEnforcementEnabled) return generate()
    const model = findAiModel(selection)
    if (!model || !isAiModelApproved(model, env)) throw new AiCreditError(503, "AI_BILLING_UNAVAILABLE")
    if (!z.uuid().safeParse(identity.requestId).success || !z.uuid().safeParse(identity.conversationId).success)
      throw new AiCreditError(400, "AI_REQUEST_ID_REQUIRED")
    const p: AiCreditRequestKey = { ...identity, requestId: identity.requestId!, requestHash: aiCreditFingerprint({ identity, fingerprint, model: modelKey(model), policy: modelApprovalKey(model), credits: model.creditsPerReply }, env) }
    options.signal?.throwIfAborted()
    let hold: Awaited<ReturnType<typeof reserveAiCredit>>
    try { hold = await reserveAiCredit(db, p, options.now?.(), model.creditsPerReply) } catch (error) {
      if (error instanceof AiCreditError) throw error
      throw new AiCreditError(503, "AI_BILLING_UNAVAILABLE")
    }
    if (hold.duplicate) {
      const r = hold.request
      if (r.status === "RESERVED") throw new AiCreditError(409, "AI_REQUEST_IN_PROGRESS")
      if (!r.responseCiphertext || !r.responseIv || !r.responseAuthTag || !r.responseKeyVersion || !r.responseExpiresAt || r.responseExpiresAt <= now()) {
        if (r.responseExpiresAt && r.responseExpiresAt <= now())
          await db.aiCreditRequest.updateMany({ where: { id: r.id, tenantId: p.tenantId, responseExpiresAt: { lte: now() } }, data: emptyAiReply })
        throw new AiCreditError(409, "AI_RESPONSE_EXPIRED")
      }
      try { return decryptAiReply<T>({ responseCiphertext: r.responseCiphertext, responseIv: r.responseIv, responseAuthTag: r.responseAuthTag, responseKeyVersion: r.responseKeyVersion, responseExpiresAt: r.responseExpiresAt }, p, now(), env) }
      catch { throw new AiCreditError(409, "AI_RESPONSE_EXPIRED") }
    }
    try {
      const reply = await withAiUsage({ tenantId: p.tenantId, actorId: p.actorId, channel: p.channel, logicalRequestId: hold.request.id, creditRequestId: hold.request.id, billingModelKey: modelKey(model), billingPolicyVersion: model.policyVersion }, async () => {
        options.signal?.throwIfAborted()
        return generate()
      })
      options.signal?.throwIfAborted()
      try {
        const encrypted = encryptAiReply(reply, p, now(), env)
        await db.$transaction(async tx => {
          const request = await settleAiCredit(tx, p, "COMMIT", options.now?.())
          // A single transaction makes the debit and replay durable together.
          await tx.aiCreditRequest.update({ where: { id: request.id }, data: encrypted })
        })
      } catch (error) {
        if (error instanceof AiCreditError) throw error
        throw new AiCreditError(503, "AI_BILLING_UNAVAILABLE")
      }
      return reply
    } catch (error) {
      // An ambiguous commit may already be durable. RELEASE never refunds a
      // committed request, so a subsequent retry can safely recover its reply.
      try { await settleAiCredit(db, p, "RELEASE", options.now?.()) }
      catch { throw new AiCreditError(503, "AI_BILLING_UNAVAILABLE") }
      throw error
    }
  }
}
