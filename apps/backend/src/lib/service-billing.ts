import { z } from "zod"
import {
  ServiceTransactionDateOnlySchema,
  ServiceTransactionAmountCentsSchema,
} from "./service-transactions.js"

export const ServicePaymentTypeSchema = z.enum([
  "SINGLE_PAYMENT",
  "INSTALLMENTS",
  "FLEXIBLE",
])
export type ServicePaymentType = z.infer<typeof ServicePaymentTypeSchema>
export const PaymentFrequencySchema = z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"])
export const ServicePaymentSettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    enabledTypes: z.array(ServicePaymentTypeSchema).min(1).max(3),
    defaultType: ServicePaymentTypeSchema,
    suggestedDepositCents: ServiceTransactionAmountCentsSchema,
    installmentCount: z.number().int().min(1).max(120),
    installmentFrequency: PaymentFrequencySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !value.enabledTypes.includes("SINGLE_PAYMENT") ||
      new Set(value.enabledTypes).size !== value.enabledTypes.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["enabledTypes"],
        message: "Single payment must be enabled and options must be unique.",
      })
    if (!value.enabledTypes.includes(value.defaultType))
      ctx.addIssue({
        code: "custom",
        path: ["defaultType"],
        message: "Choose an enabled payment option.",
      })
  })
export type ServicePaymentSettings = z.infer<
  typeof ServicePaymentSettingsSchema
>
export const ServicePaymentTermsSchema = z
  .object({
    type: ServicePaymentTypeSchema,
    installmentCount: z.number().int().min(1).max(120).optional(),
    firstDueDate: ServiceTransactionDateOnlySchema.optional(),
    monthlyAnchorDay: z.number().int().min(1).max(31).optional(),
  })
  .strict()
export type ServicePaymentTerms = z.infer<typeof ServicePaymentTermsSchema>
export const FinancialWriteSchema = z.object({
  requestKey: z.uuid(),
  expectedRevision: z.number().int().min(0),
})
export const FinancialReasonSchema = z.string().trim().min(1).max(1000)
export type DueInput = {
  label: string
  amountCents: number
  dueDate: string | null
  sortOrder: number
}
export type BillingPlan = {
  schemaVersion: 1
  type: ServicePaymentType
  installmentCount: number
  installmentFrequency: z.infer<typeof PaymentFrequencySchema> | null
  firstDueDate: string | null
  monthlyAnchorDay: number | null
}

export function resolvePaymentSettings(service: {
  paymentSettings?: unknown
  allowPartialPayments?: boolean
  minimumPartialPaymentCents?: number | null
  installmentCount?: number | null
  installmentFrequency?: string | null
}): ServicePaymentSettings {
  const parsed = ServicePaymentSettingsSchema.safeParse(service.paymentSettings)
  if (parsed.success) return parsed.data
  const frequency = PaymentFrequencySchema.safeParse(
    service.installmentFrequency,
  )
  const installments =
    !!service.allowPartialPayments &&
    !!service.installmentCount &&
    frequency.success
  return {
    schemaVersion: 1,
    enabledTypes: service.allowPartialPayments
      ? ["SINGLE_PAYMENT", installments ? "INSTALLMENTS" : "FLEXIBLE"]
      : ["SINGLE_PAYMENT"],
    defaultType: service.allowPartialPayments
      ? installments
        ? "INSTALLMENTS"
        : "FLEXIBLE"
      : "SINGLE_PAYMENT",
    suggestedDepositCents: service.minimumPartialPaymentCents ?? 0,
    installmentCount: Math.min(120, Math.max(1, service.installmentCount ?? 4)),
    installmentFrequency: frequency.success ? frequency.data : "MONTHLY",
  }
}

export function legacyPaymentFields(settings: ServicePaymentSettings) {
  return {
    allowPartialPayments: settings.enabledTypes.some(
      (type) => type !== "SINGLE_PAYMENT",
    ),
    minimumPartialPaymentCents: settings.enabledTypes.includes("INSTALLMENTS")
      ? settings.suggestedDepositCents
      : null,
    installmentCount: settings.enabledTypes.includes("INSTALLMENTS")
      ? settings.installmentCount
      : null,
    installmentFrequency: settings.enabledTypes.includes("INSTALLMENTS")
      ? settings.installmentFrequency
      : null,
  }
}

export function tenantDateOnly(
  timezone: string | null | undefined,
  now = new Date(),
) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

// Always calculate from the original anchor, so January 31 → February 28 → March 31.
export function installmentDate(
  anchor: string,
  frequency: z.infer<typeof PaymentFrequencySchema>,
  offset: number,
  originalDay?: number,
) {
  const [year, month, day] = anchor.split("-").map(Number)
  if (frequency === "MONTHLY") {
    const target = new Date(Date.UTC(year, month - 1 + offset, 1))
    const lastDay = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
    ).getUTCDate()
    target.setUTCDate(Math.min(originalDay ?? day, lastDay))
    return target.toISOString().slice(0, 10)
  }
  return new Date(
    Date.UTC(year, month - 1, day + offset * (frequency === "WEEKLY" ? 7 : 14)),
  )
    .toISOString()
    .slice(0, 10)
}

export function buildServicePaymentPlan(input: {
  totalPriceCents: number
  initialPaymentCents: number
  settings: ServicePaymentSettings
  terms: ServicePaymentTerms
  today: string
}): { plan: BillingPlan; dues: DueInput[] } {
  const {
    totalPriceCents: total,
    initialPaymentCents: initial,
    settings,
    terms,
    today,
  } = input
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(initial) ||
    initial < 0 ||
    initial > total
  )
    throw new Error("INVALID_INITIAL_PAYMENT")
  if (!settings.enabledTypes.includes(terms.type))
    throw new Error("PAYMENT_OPTION_NOT_ENABLED")
  const frequency =
    terms.type === "INSTALLMENTS" ? settings.installmentFrequency : null
  const count =
    terms.type === "INSTALLMENTS"
      ? (terms.installmentCount ?? settings.installmentCount)
      : 1
  const first =
    terms.type === "FLEXIBLE"
      ? null
      : (terms.firstDueDate ??
        (frequency ? installmentDate(today, frequency, 1) : today))
  const monthlyAnchorDay =
    frequency === "MONTHLY"
      ? (terms.monthlyAnchorDay ??
        Number((terms.firstDueDate ?? today).slice(8, 10)))
      : null
  if (
    monthlyAnchorDay &&
    first &&
    installmentDate(first, "MONTHLY", 0, monthlyAnchorDay) !== first
  )
    throw new Error("INVALID_MONTHLY_ANCHOR")
  const plan: BillingPlan = {
    schemaVersion: 1,
    type: terms.type,
    installmentCount: count,
    installmentFrequency: frequency,
    firstDueDate: first,
    monthlyAnchorDay,
  }
  if (total === 0) return { plan, dues: [] }
  if (terms.type !== "INSTALLMENTS")
    return {
      plan,
      dues: [
        {
          label:
            terms.type === "FLEXIBLE" ? "Flexible balance" : "Service payment",
          amountCents: total,
          dueDate: first,
          sortOrder: 0,
        },
      ],
    }
  const remaining = total - initial
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 120 ||
    (remaining > 0 && count > remaining)
  )
    throw new Error("INVALID_INSTALLMENT_COUNT")
  const dues: DueInput[] =
    initial > 0
      ? [
          {
            label: "Payment at enrollment",
            amountCents: initial,
            dueDate: today,
            sortOrder: 0,
          },
        ]
      : []
  if (remaining > 0) {
    const amount = Math.floor(remaining / count)
    for (let i = 0; i < count; i++)
      dues.push({
        label: `Payment ${i + 1} of ${count}`,
        amountCents:
          i === count - 1 ? remaining - amount * (count - 1) : amount,
        dueDate: installmentDate(
          first!,
          frequency!,
          i,
          monthlyAnchorDay ?? undefined,
        ),
        sortOrder: dues.length,
      })
  }
  return { plan, dues }
}

export function allocateServicePayments<T extends { amountCents: number }>(
  dues: T[],
  paidCents: number,
) {
  let available = paidCents
  return dues.map((due) => {
    const paid = Math.min(due.amountCents, Math.max(0, available))
    available -= paid
    return { ...due, paidCents: paid, remainingCents: due.amountCents - paid }
  })
}

export function reviseServicePaymentPlan(input: {
  totalPriceCents: number
  paidCents: number
  dues: Array<DueInput & { paidCents: number }>
  settings: ServicePaymentSettings
  terms: ServicePaymentTerms
  today: string
}) {
  const funded: DueInput[] = input.dues
    .filter((due) => due.paidCents > 0)
    .map((due) => ({
      label: due.label,
      amountCents: due.paidCents,
      dueDate: due.dueDate,
      sortOrder: 0,
    }))
  const knownPaid = funded.reduce((sum, due) => sum + due.amountCents, 0)
  if (input.paidCents > knownPaid)
    funded.push({
      label: "Previously paid",
      amountCents: input.paidCents - knownPaid,
      dueDate: null,
      sortOrder: 0,
    })
  const future = buildServicePaymentPlan({
    ...input,
    totalPriceCents: input.totalPriceCents - input.paidCents,
    initialPaymentCents: 0,
  })
  return {
    plan: future.plan,
    dues: [...funded, ...future.dues].map((due, sortOrder) => ({
      ...due,
      sortOrder,
    })),
  }
}

export function summarizeServiceBilling(input: {
  totalPriceCents: number
  paidCents: number
  currency: string
  paymentType: ServicePaymentType | null
  financialRevision: number
  dues: Array<{
    id: string
    label: string
    amountCents: number
    dueDate: Date | string | null
    sortOrder: number
  }>
  today: string
  timezone?: string | null
  status?: string
}) {
  const remainingCents = Math.max(0, input.totalPriceCents - input.paidCents)
  const schedule = allocateServicePayments(
    [...input.dues].sort((a, b) => a.sortOrder - b.sortOrder),
    input.paidCents,
  ).map((due) => {
    const dueDate =
      due.dueDate instanceof Date
        ? due.dueDate.toISOString().slice(0, 10)
        : (due.dueDate?.slice(0, 10) ?? null)
    const overdue =
      due.remainingCents > 0 && dueDate !== null && dueDate < input.today
    return {
      ...due,
      dueDate,
      state:
        due.remainingCents === 0
          ? "PAID"
          : overdue
            ? "OVERDUE"
            : due.paidCents > 0
              ? "PARTIAL"
              : "SCHEDULED",
    }
  })
  const open = schedule.filter(
    (due) => due.remainingCents > 0 && due.dueDate !== null,
  )
  const nextDate = open.map((due) => due.dueDate!).sort()[0] ?? null
  return {
    today: input.today,
    timezone: input.timezone || "America/Chicago",
    totalPriceCents: input.totalPriceCents,
    paidCents: input.paidCents,
    remainingCents,
    currency: input.currency,
    financialRevision: input.financialRevision,
    paymentType: input.paymentType,
    scheduleNeedsReview: !input.paymentType && remainingCents > 0,
    paymentState:
      remainingCents === 0
        ? "PAID"
        : input.paidCents > 0
          ? "PARTIAL"
          : "UNPAID",
    workState:
      input.status === "CANCELED"
        ? "CANCELED"
        : ["PENDING_PAYMENT", "COMPLETED"].includes(input.status ?? "")
          ? "FINISHED"
          : "IN_PROGRESS",
    nextDueDate: nextDate,
    nextDueCents: open
      .filter((due) => due.dueDate === nextDate)
      .reduce((sum, due) => sum + due.remainingCents, 0),
    dueTodayCents: open
      .filter((due) => due.dueDate === input.today)
      .reduce((sum, due) => sum + due.remainingCents, 0),
    overdueCents: open
      .filter((due) => due.dueDate! < input.today)
      .reduce((sum, due) => sum + due.remainingCents, 0),
    schedule,
  }
}
