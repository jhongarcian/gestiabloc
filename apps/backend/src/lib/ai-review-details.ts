import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto"
import { z } from "zod"

export const AiReviewReasonSchema = z.enum(["MISSING_KNOWLEDGE", "OUT_OF_SCOPE", "POLICY_EXCEPTION", "AGENCY_HELP", "ASSISTANT_UNAVAILABLE", "OTHER"])
export type AiReviewReason = z.infer<typeof AiReviewReasonSchema>
export const AI_REVIEW_TTL_MS = 30 * 86400000
export const AiReviewDetailsSchema = z.object({
  question: z.string().min(1).max(2000), answer: z.string().min(1).max(24000),
  contactId: z.uuid().optional(), serviceName: z.string().max(200).optional(),
  sourceLabels: z.array(z.string().max(320)).max(9).default([]),
}).strict()
export type AiReviewDetails = z.input<typeof AiReviewDetailsSchema>
type Identity = { tenantId: string; actorId: string; channel: string; requestId: string }
export type ReviewPayload = { reviewCiphertext: string | null; reviewIv: string | null; reviewAuthTag: string | null; reviewKeyVersion: number | null; reviewExpiresAt: Date | null }
function key(env: Record<string, string | undefined>) {
  const raw = env.AI_REPLAY_ENCRYPTION_KEY ?? ""
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw) || Buffer.from(raw, "base64").length !== 32) throw new Error("AI_REVIEW_KEY_UNAVAILABLE")
  return createHmac("sha256", Buffer.from(raw, "base64")).update("ai-answer-review-key-v1").digest()
}
export function aiReviewCaptureAvailable(env: Record<string, string | undefined> = process.env) {
  try { key(env); return true } catch { return false }
}
const aad = (identity: Identity, expires: Date) => Buffer.from(JSON.stringify(["ai-answer-review-v1", identity.tenantId, identity.actorId, identity.channel, identity.requestId, expires.toISOString()]))
export function encryptReviewDetails(details: AiReviewDetails, identity: Identity, now = new Date(), env: Record<string, string | undefined> = process.env) {
  const plaintext = JSON.stringify(AiReviewDetailsSchema.parse(details))
  const reviewExpiresAt = new Date(now.getTime() + AI_REVIEW_TTL_MS)
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(env), iv)
  cipher.setAAD(aad(identity, reviewExpiresAt))
  return { reviewCiphertext: Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64"), reviewIv: iv.toString("base64"), reviewAuthTag: cipher.getAuthTag().toString("base64"), reviewKeyVersion: 1, reviewExpiresAt }
}
export function decryptReviewDetails(payload: ReviewPayload, identity: Identity, now = new Date(), env: Record<string, string | undefined> = process.env) {
  if (payload.reviewKeyVersion !== 1 || !payload.reviewCiphertext || !payload.reviewIv || !payload.reviewAuthTag || !payload.reviewExpiresAt || payload.reviewExpiresAt <= now) throw new Error("AI_REVIEW_DETAILS_UNAVAILABLE")
  const decipher = createDecipheriv("aes-256-gcm", key(env), Buffer.from(payload.reviewIv, "base64"))
  decipher.setAAD(aad(identity, payload.reviewExpiresAt))
  decipher.setAuthTag(Buffer.from(payload.reviewAuthTag, "base64"))
  return AiReviewDetailsSchema.parse(JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.reviewCiphertext, "base64")), decipher.final()]).toString("utf8")))
}
export const emptyReviewDetails = { reviewCiphertext: null, reviewIv: null, reviewAuthTag: null, reviewKeyVersion: null }
