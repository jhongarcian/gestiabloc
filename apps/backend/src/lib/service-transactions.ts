export type ServiceTransactionPaymentState = "UNPAID" | "PARTIAL" | "PAID"

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
