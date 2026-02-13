import crypto from "crypto"
import type { SecurityLevel } from "../generated/prisma/index.js"

export type SsnReadAccess = "NONE" | "MASKED" | "FULL"

type EncryptedSsn = {
  ssnLast4: string
  ssnCiphertext: string
  ssnIv: string
  ssnAuthTag: string
  ssnKeyVersion: number
}

let cachedSsnKey: Buffer | null = null

function getSsnEncryptionKey() {
  if (cachedSsnKey) return cachedSsnKey

  const raw = process.env.CONTACT_SSN_ENCRYPTION_KEY
  if (!raw) {
    throw new Error("CONTACT_SSN_ENCRYPTION_KEY missing")
  }

  const key = Buffer.from(raw, "base64")
  if (key.length !== 32) {
    throw new Error("CONTACT_SSN_ENCRYPTION_KEY must be base64 for 32 bytes")
  }

  cachedSsnKey = key
  return key
}

export function normalizeSsnDigits(value: string) {
  const digits = value.replace(/\D/g, "")
  if (!/^\d{9}$/.test(digits)) {
    throw new Error("SSN must contain exactly 9 digits")
  }

  return digits
}

export function encryptSsn(value: string): EncryptedSsn {
  const digits = normalizeSsnDigits(value)
  const key = getSsnEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(digits, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    ssnLast4: digits.slice(-4),
    ssnCiphertext: ciphertext.toString("base64"),
    ssnIv: iv.toString("base64"),
    ssnAuthTag: authTag.toString("base64"),
    ssnKeyVersion: 1,
  }
}

export function decryptSsn(data: {
  ssnCiphertext: string | null
  ssnIv: string | null
  ssnAuthTag: string | null
  ssnKeyVersion: number | null
}) {
  if (!data.ssnCiphertext || !data.ssnIv || !data.ssnAuthTag || !data.ssnKeyVersion) {
    return null
  }

  if (data.ssnKeyVersion !== 1) {
    throw new Error(`Unsupported ssn key version: ${data.ssnKeyVersion}`)
  }

  const key = getSsnEncryptionKey()
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(data.ssnIv, "base64"),
  )
  decipher.setAuthTag(Buffer.from(data.ssnAuthTag, "base64"))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(data.ssnCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8")

  return normalizeSsnDigits(decrypted)
}

export function maskSsnFromLast4(ssnLast4: string | null) {
  if (!ssnLast4 || !/^\d{4}$/.test(ssnLast4)) return null
  return `***-**-${ssnLast4}`
}

export function getSsnReadAccessForSecurityLevel(level: SecurityLevel): SsnReadAccess {
  if (level === "MAX") return "FULL"
  if (level === "MEDIUM") return "MASKED"
  return "NONE"
}
