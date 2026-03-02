import crypto from "crypto"

type EncryptedJsonValue = {
  valueCiphertext: string
  valueIv: string
  valueAuthTag: string
  valueKeyVersion: number
}

let cachedEncryptionKey: Buffer | null = null

function getEncryptionKey() {
  if (cachedEncryptionKey) {
    return cachedEncryptionKey
  }

  const raw = process.env.CONTACT_CUSTOM_FIELD_ENCRYPTION_KEY
  if (!raw) {
    throw new Error("CONTACT_CUSTOM_FIELD_ENCRYPTION_KEY missing")
  }

  const key = Buffer.from(raw, "base64")
  if (key.length !== 32) {
    throw new Error(
      "CONTACT_CUSTOM_FIELD_ENCRYPTION_KEY must be base64 for 32 bytes",
    )
  }

  cachedEncryptionKey = key
  return key
}

export function encryptCustomFieldValue(value: unknown): EncryptedJsonValue {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const plaintext = JSON.stringify(value)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return {
    valueCiphertext: ciphertext.toString("base64"),
    valueIv: iv.toString("base64"),
    valueAuthTag: authTag.toString("base64"),
    valueKeyVersion: 1,
  }
}

export function decryptCustomFieldValue(data: {
  valueCiphertext: string | null
  valueIv: string | null
  valueAuthTag: string | null
  valueKeyVersion: number | null
}) {
  if (
    !data.valueCiphertext ||
    !data.valueIv ||
    !data.valueAuthTag ||
    !data.valueKeyVersion
  ) {
    return null
  }

  if (data.valueKeyVersion !== 1) {
    throw new Error(
      `Unsupported contact custom field key version: ${data.valueKeyVersion}`,
    )
  }

  const key = getEncryptionKey()
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(data.valueIv, "base64"),
  )
  decipher.setAuthTag(Buffer.from(data.valueAuthTag, "base64"))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(data.valueCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8")

  return JSON.parse(decrypted) as unknown
}
