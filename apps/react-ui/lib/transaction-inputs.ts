export const TRANSACTION_CONTACT_SEARCH_MAX_LENGTH = 120
export const TRANSACTION_NOTES_MAX_LENGTH = 4000
export const TRANSACTION_PAYMENT_NOTE_MAX_LENGTH = 1000
export const TRANSACTION_MONEY_INPUT_MAX_LENGTH = 13
export const TRANSACTION_MAX_AMOUNT_CENTS = 1_000_000_000

const HTML_TAGS = /<[^>]*>/g
const INVISIBLE_OR_CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizePlainText(value: string) {
  return value.normalize("NFKC").replace(HTML_TAGS, " ")
}

export function sanitizeTransactionSingleLineInput(
  value: string,
  maxLength = TRANSACTION_CONTACT_SEARCH_MAX_LENGTH,
) {
  return normalizePlainText(value)
    .replace(INVISIBLE_OR_CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .replace(/^\s+/, "")
    .slice(0, maxLength)
}

export function sanitizeTransactionContactSearch(value: string) {
  return sanitizeTransactionSingleLineInput(
    value,
    TRANSACTION_CONTACT_SEARCH_MAX_LENGTH,
  ).trim()
}

export function sanitizeTransactionMultilineInput(value: string, maxLength: number) {
  const normalized = normalizePlainText(value).replace(/\r\n?/g, "\n")

  return normalized
    .split("\n")
    .map((line) =>
      line
        .replace(INVISIBLE_OR_CONTROL_CHARACTERS, " ")
        .replace(/[^\S\n]+/g, " ")
        .replace(/^\s+/, ""),
    )
    .join("\n")
    .slice(0, maxLength)
}

export function sanitizeTransactionNotes(value: string) {
  return sanitizeTransactionMultilineInput(value, TRANSACTION_NOTES_MAX_LENGTH).trim()
}

export function sanitizeTransactionPaymentNote(value: string) {
  return sanitizeTransactionMultilineInput(
    value,
    TRANSACTION_PAYMENT_NOTE_MAX_LENGTH,
  ).trim()
}

export function sanitizeTransactionMoneyInput(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[$,\s]/g, "")
    .replace(/[^\d.]/g, "")
  const decimalIndex = normalized.indexOf(".")
  const wholePart = (decimalIndex === -1 ? normalized : normalized.slice(0, decimalIndex))
    .replace(/^0+(?=\d)/, "")
    .slice(0, 10)
  const decimalPart =
    decimalIndex === -1
      ? ""
      : normalized
          .slice(decimalIndex + 1)
          .replace(/\./g, "")
          .slice(0, 2)

  if (decimalIndex === -1) return wholePart.slice(0, TRANSACTION_MONEY_INPUT_MAX_LENGTH)

  return `${wholePart || "0"}.${decimalPart}`.slice(
    0,
    TRANSACTION_MONEY_INPUT_MAX_LENGTH,
  )
}

export function parseTransactionMoneyToCents(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[$,\s]/g, "")

  if (!/^\d{1,8}(?:\.\d{0,2})?$/.test(normalized)) return null

  const [wholePart, decimalPart = ""] = normalized.split(".")
  const cents = Number(wholePart) * 100 + Number(decimalPart.padEnd(2, "0"))

  if (!Number.isSafeInteger(cents) || cents > TRANSACTION_MAX_AMOUNT_CENTS) {
    return null
  }

  return cents
}

export function sanitizeTransactionId(value: string | null | undefined) {
  if (!value) return ""
  const normalized = value.normalize("NFKC").trim()
  return UUID_PATTERN.test(normalized) ? normalized.toLowerCase() : ""
}

const PAYMENT_METHODS = ["CASH", "CARD", "CHECK", "TRANSFER", "ACH"] as const
export type TransactionPaymentMethod = (typeof PAYMENT_METHODS)[number]

export function sanitizeTransactionPaymentMethod(
  value: string | null | undefined,
): TransactionPaymentMethod | "" {
  return PAYMENT_METHODS.includes(value as TransactionPaymentMethod)
    ? (value as TransactionPaymentMethod)
    : ""
}

const PAYMENT_MODES = ["FULL", "PARTIAL", "LATER"] as const
export type TransactionPaymentMode = (typeof PAYMENT_MODES)[number]

export function sanitizeTransactionPaymentMode(value: string): TransactionPaymentMode {
  return PAYMENT_MODES.includes(value as TransactionPaymentMode)
    ? (value as TransactionPaymentMode)
    : "FULL"
}

export function sanitizePaymentEntryMode(value: string): "FULL" | "PARTIAL" {
  return value === "PARTIAL" ? "PARTIAL" : "FULL"
}
