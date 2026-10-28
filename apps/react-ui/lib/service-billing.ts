import { isAxiosError } from "axios"

export type ServicePaymentType = "SINGLE_PAYMENT" | "INSTALLMENTS" | "FLEXIBLE"
export type PaymentSettings = {
  schemaVersion: 1
  enabledTypes: ServicePaymentType[]
  defaultType: ServicePaymentType
  suggestedDepositCents: number
  installmentCount: number
  installmentFrequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY"
}
export type PaymentTerms = {
  type: ServicePaymentType
  installmentCount?: number
  firstDueDate?: string
  monthlyAnchorDay?: number
}
export type EnrollmentBillingValue = {
  paymentTerms: PaymentTerms
  initialPaymentCents: number
  initialPaymentMethod: string | null
  initialPaymentNote: string | null
  configurationVersion: string
}
export type BillingDue = {
  id: string
  label: string
  amountCents: number
  paidCents: number
  remainingCents: number
  dueDate: string | null
  sortOrder: number
  state: "PAID" | "PARTIAL" | "SCHEDULED" | "OVERDUE"
}
export type BillingSummary = {
  totalPriceCents: number
  paidCents: number
  remainingCents: number
  currency: string
  financialRevision: number
  paymentType: ServicePaymentType | null
  scheduleNeedsReview: boolean
  paymentState: "UNPAID" | "PARTIAL" | "PAID"
  workState: "CANCELED" | "FINISHED" | "IN_PROGRESS"
  nextDueDate: string | null
  nextDueCents: number
  dueTodayCents: number
  overdueCents: number
  schedule: BillingDue[]
  today: string
  timezone: string
}
export type ServicePayment = {
  id: string
  amountCents: number
  paidAt: string
  paymentMethod: string | null
  note: string | null
  voidedAt: string | null
  voidReason: string | null
  replacesPaymentId: string | null
  recordedBy: { name: string } | null
}
export type BillingAccount = {
  summary: BillingSummary
  plan: PaymentTerms | null
  settings: PaymentSettings
  payments: ServicePayment[]
  changes: Array<{
    id: string
    kind: string
    revision: number
    reason: string | null
    actorName: string
    createdAt: string
    previous: unknown
    next: unknown
  }>
  pagination: { page: number; totalPages: number; totalPayments: number }
  permissions: { canRecord: boolean; canRevisePlan: boolean }
}
export const PAYMENT_TYPE_LABELS: Record<ServicePaymentType, string> = {
  SINGLE_PAYMENT: "Single payment",
  INSTALLMENTS: "Payment plan",
  FLEXIBLE: "Flexible payments",
}
export const PAYMENT_METHODS = [
  "CASH",
  "CARD",
  "CHECK",
  "TRANSFER",
  "ACH",
] as const
export function billingMoney(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(cents / 100)
  } catch {
    return `${currency || "USD"} ${(cents / 100).toFixed(2)}`
  }
}
export function billingDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
    : "No scheduled due date"
}
export function billingError(error: unknown) {
  const code = isAxiosError(error) ? error.response?.data?.error : null
  if (code === "FINANCIAL_REVISION_CONFLICT")
    return "This account changed. Review the updated balance and try again."
  if (code === "BILLING_CONFIGURATION_CHANGED")
    return "The service price or terms changed. Review the refreshed payment preview."
  if (code === "IDEMPOTENCY_KEY_REUSED")
    return "This request was already recorded with different details. Refresh the account before continuing."
  return typeof code === "string"
    ? code
        .toLowerCase()
        .replaceAll("_", " ")
        .replace(/^./, (letter) => letter.toUpperCase())
    : "Could not save. Check your connection and try again."
}
export function defaultPaymentSettings(service: {
  paymentSettings?: PaymentSettings
  allowPartialPayments?: boolean
  minimumPartialPaymentCents?: number | null
  installmentCount?: number | null
  installmentFrequency?: PaymentSettings["installmentFrequency"] | null
}): PaymentSettings {
  if (service.paymentSettings) return service.paymentSettings
  const scheduled =
    !!service.allowPartialPayments &&
    !!service.installmentCount &&
    !!service.installmentFrequency
  return {
    schemaVersion: 1,
    enabledTypes: service.allowPartialPayments
      ? ["SINGLE_PAYMENT", scheduled ? "INSTALLMENTS" : "FLEXIBLE"]
      : ["SINGLE_PAYMENT"],
    defaultType: service.allowPartialPayments
      ? scheduled
        ? "INSTALLMENTS"
        : "FLEXIBLE"
      : "SINGLE_PAYMENT",
    suggestedDepositCents: service.minimumPartialPaymentCents ?? 0,
    installmentCount: Math.min(120, Math.max(1, service.installmentCount ?? 4)),
    installmentFrequency: service.installmentFrequency ?? "MONTHLY",
  }
}

export function paymentOptionsLabel(
  service: Parameters<typeof defaultPaymentSettings>[0],
) {
  return defaultPaymentSettings(service)
    .enabledTypes.map((type) => PAYMENT_TYPE_LABELS[type])
    .join(" · ")
}
