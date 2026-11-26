import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto"
import type { AiCreditRequestKey } from "./ai-credit-wallet.js"

export const AI_REPLAY_TTL_MS = 15 * 60000
export type EncryptedAiReply = {
  responseCiphertext: string; responseIv: string; responseAuthTag: string
  responseKeyVersion: number; responseExpiresAt: Date
}
function key(env: Record<string, string | undefined>) {
  const raw = env.AI_REPLAY_ENCRYPTION_KEY ?? ""
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw) || Buffer.from(raw, "base64").length !== 32) throw new Error("AI_REPLAY_KEY_UNAVAILABLE")
  return Buffer.from(raw, "base64")
}
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`
  return JSON.stringify(value) ?? "null"
}
export function aiCreditFingerprint(value: unknown, env: Record<string, string | undefined> = process.env) {
  // HMAC prevents guessing short questions/contact values from database hashes.
  return createHmac("sha256", key(env)).update("ai-credit-request-v1\0").update(canonical(value)).digest("hex")
}
const aad = (p: AiCreditRequestKey, expiresAt: Date) => Buffer.from(canonical(["ai-credit-reply-v1", p.tenantId, p.actorId, p.channel, p.requestId, p.requestHash, expiresAt]))
export function encryptAiReply(value: unknown, p: AiCreditRequestKey, now = new Date(), env: Record<string, string | undefined> = process.env): EncryptedAiReply {
  const plaintext = JSON.stringify(value)
  if (!plaintext || Buffer.byteLength(plaintext) > 128 * 1024) throw new Error("AI_REPLAY_TOO_LARGE")
  const responseExpiresAt = new Date(now.getTime() + AI_REPLAY_TTL_MS)
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(env), iv)
  cipher.setAAD(aad(p, responseExpiresAt))
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return { responseCiphertext: ciphertext.toString("base64"), responseIv: iv.toString("base64"), responseAuthTag: cipher.getAuthTag().toString("base64"), responseKeyVersion: 1, responseExpiresAt }
}
export function decryptAiReply<T>(value: EncryptedAiReply, p: AiCreditRequestKey, now = new Date(), env: Record<string, string | undefined> = process.env): T {
  if (value.responseKeyVersion !== 1 || value.responseExpiresAt <= now) throw new Error("AI_RESPONSE_EXPIRED")
  const decipher = createDecipheriv("aes-256-gcm", key(env), Buffer.from(value.responseIv, "base64"))
  decipher.setAAD(aad(p, value.responseExpiresAt))
  decipher.setAuthTag(Buffer.from(value.responseAuthTag, "base64"))
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.responseCiphertext, "base64")), decipher.final()]).toString("utf8")) as T
}
export const emptyAiReply = { responseCiphertext: null, responseIv: null, responseAuthTag: null, responseKeyVersion: null, responseExpiresAt: null }
