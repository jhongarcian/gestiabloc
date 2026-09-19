import { z } from "zod"

export type ServiceTransactionPaymentState = "UNPAID" | "PARTIAL" | "PAID"
export type ServiceTransactionPaymentValidationError =
  | "PAYMENT_EXCEEDS_SERVICE_TOTAL"
  | "SERVICE_DOES_NOT_ALLOW_PARTIAL_PAYMENTS"
  | "PAYMENT_BELOW_MINIMUM"

export const SERVICE_TRANSACTION_SEARCH_MAX_LENGTH = 120
export const SERVICE_TRANSACTION_NOTES_MAX_LENGTH = 4000
export const SERVICE_TRANSACTION_PAYMENT_NOTE_MAX_LENGTH = 1000
export const SERVICE_TRANSACTION_MAX_AMOUNT_CENTS = 1_000_000_000
export const SERVICE_TRANSACTION_SORTS = [
  "PURCHASED_DESC",
  "PURCHASED_ASC",
  "CONTACT_ASC",
  "SERVICE_ASC",
  "TOTAL_DESC",
] as const

export type ServiceTransactionSort = (typeof SERVICE_TRANSACTION_SORTS)[number]
export const ServiceTransactionSortSchema = z.enum(SERVICE_TRANSACTION_SORTS)

const INVISIBLE_OR_CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu
const HTML_TAGS = /<[^>]*>/g

function normalizeServiceTransactionPlainText(value: string) {
  return value.normalize("NFKC").replace(HTML_TAGS, " ")
}

export function sanitizeServiceTransactionSearch(value: string) {
  return normalizeServiceTransactionPlainText(value)
    .replace(INVISIBLE_OR_CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SERVICE_TRANSACTION_SEARCH_MAX_LENGTH)
}

export function sanitizeServiceTransactionMultilineText(value: string) {
  return normalizeServiceTransactionPlainText(value)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(INVISIBLE_OR_CONTROL_CHARACTERS, " ")
        .replace(/[^\S\n]+/g, " ")
        .trim(),
    )
    .join("\n")
    .trim()
}

function optionalSanitizedMultilineTextSchema(maxLength: number) {
  return z.preprocess((value) => {
    if (value === null || value === undefined || typeof value !== "string") {
      return value
    }

    const sanitized = sanitizeServiceTransactionMultilineText(value)
    return sanitized.length ? sanitized : null
  }, z.string().max(maxLength).nullable().optional())
}

export const ServiceTransactionNotesSchema = optionalSanitizedMultilineTextSchema(
  SERVICE_TRANSACTION_NOTES_MAX_LENGTH,
)

export const ServiceTransactionPaymentNoteSchema =
  optionalSanitizedMultilineTextSchema(SERVICE_TRANSACTION_PAYMENT_NOTE_MAX_LENGTH)

export const ServiceTransactionAmountCentsSchema = z
  .number()
  .int()
  .min(0)
  .max(SERVICE_TRANSACTION_MAX_AMOUNT_CENTS)

export const ServiceTransactionPositiveAmountCentsSchema =
  ServiceTransactionAmountCentsSchema.min(1)

export const ServiceTransactionIdSchema = z.string().trim().uuid()

export const ServiceTransactionDateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    )
  }, "Invalid calendar date")

export function getServiceTransactionFinancials(
  totalCents: number,
  payments: Array<{ amountCents: number }>,
) {
  const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0)

  return {
    paidCents,
    remainingCents: Math.max(0, totalCents - paidCents),
    paymentState: getServiceTransactionPaymentState(totalCents, paidCents),
  }
}

export function getServiceTransactionPaymentValidationError({
  totalPriceCents,
  alreadyPaidCents,
  paymentAmountCents,
  allowPartialPayments,
  minimumPartialPaymentCents,
}: {
  totalPriceCents: number
  alreadyPaidCents: number
  paymentAmountCents: number
  allowPartialPayments: boolean
  minimumPartialPaymentCents: number | null
}): ServiceTransactionPaymentValidationError | null {
  const nextPaidCents = alreadyPaidCents + paymentAmountCents

  if (nextPaidCents > totalPriceCents) return "PAYMENT_EXCEEDS_SERVICE_TOTAL"
  if (paymentAmountCents === 0 || nextPaidCents >= totalPriceCents) return null
  if (!allowPartialPayments) return "SERVICE_DOES_NOT_ALLOW_PARTIAL_PAYMENTS"
  if (
    minimumPartialPaymentCents !== null &&
    paymentAmountCents < minimumPartialPaymentCents
  ) {
    return "PAYMENT_BELOW_MINIMUM"
  }

  return null
}

export function getServiceTransactionPaymentState(
  totalCents: number,
  paidCents: number,
): ServiceTransactionPaymentState {
  if (totalCents <= 0 || paidCents >= totalCents) return "PAID"
  if (paidCents <= 0) return "UNPAID"
  return "PARTIAL"
}

export function getServiceTransactionContactName(contact: {
  firstName?: string | null
  middleName?: string | null
  lastName?: string | null
}) {
  return [contact.firstName, contact.middleName, contact.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ") || "Unnamed contact"
}
