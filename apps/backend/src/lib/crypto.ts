import crypto from "crypto"

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url")
}

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

export function generateOtp6() {
  return String(crypto.randomInt(100000, 1_000_000))
}
