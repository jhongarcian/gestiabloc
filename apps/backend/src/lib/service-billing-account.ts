import { Prisma } from "../generated/prisma/index.js"
import { ServiceCollectionError } from "./service-configuration-collections.js"
import { configurationDigest } from "./service-configuration-digest.js"
import {
  allocateServicePayments,
  summarizeServiceBilling,
  tenantDateOnly,
  type BillingPlan,
  type DueInput,
} from "./service-billing.js"

export const billingAccountSelect = {
  paymentType: true,
  paymentPlan: true,
  financialRevision: true,
  paymentDues: { orderBy: { sortOrder: "asc" as const } },
} satisfies Prisma.ContactServiceSelect

export async function lockBillingAccountTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  id: string,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "ContactService" WHERE "tenantId"=${tenantId} AND id=${id} FOR UPDATE`,
  )
  const enrollment = await tx.contactService.findFirst({
    where: { tenantId, id },
  })
  if (!enrollment)
    throw new ServiceCollectionError("CONTACT_SERVICE_NOT_FOUND", 404)
  return enrollment
}

export async function replayFinancialWriteTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  requestKey: string,
  command: unknown,
) {
  // Enrollment creation has no account row yet; serialize retries before creating one.
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${requestKey}`}, 0))`,
  )
  const previous = await tx.contactServiceFinancialChange.findUnique({
    where: { tenantId_requestKey: { tenantId, requestKey } },
  })
  if (!previous) return null
  if (previous.requestHash !== configurationDigest(command))
    throw new ServiceCollectionError("IDEMPOTENCY_KEY_REUSED", 409)
  return previous.result
}

export function assertFinancialRevision(actual: number, expected: number) {
  if (actual !== expected)
    throw new ServiceCollectionError("FINANCIAL_REVISION_CONFLICT", 409)
}

export async function saveFinancialChangeTx(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string
    contactServiceId: string
    requestKey: string
    command: unknown
    kind: string
    revision: number
    actorUserId: string
    reason?: string | null
    previous?: unknown
    next?: unknown
    result: unknown
  },
) {
  const json = (value: unknown): Prisma.InputJsonValue =>
    JSON.parse(JSON.stringify(value))
  await tx.contactServiceFinancialChange.create({
    data: {
      tenantId: input.tenantId,
      contactServiceId: input.contactServiceId,
      requestKey: input.requestKey,
      requestHash: configurationDigest(input.command),
      kind: input.kind,
      revision: input.revision,
      actorUserId: input.actorUserId,
      reason: input.reason ?? null,
      previous: input.previous == null ? Prisma.DbNull : json(input.previous),
      next: input.next == null ? Prisma.DbNull : json(input.next),
      result: json(input.result),
    },
  })
}

export async function getBillingSummaryTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contactServiceId: string,
) {
  const [account, payments, tenant] = await Promise.all([
    tx.contactService.findFirst({
      where: { tenantId, id: contactServiceId },
      select: {
        ...billingAccountSelect,
        totalPriceCents: true,
        currency: true,
        status: true,
      },
    }),
    tx.contactServicePayment.aggregate({
      where: { tenantId, contactServiceId, voidedAt: null },
      _sum: { amountCents: true },
    }),
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { timezone: true },
    }),
  ])
  if (!account)
    throw new ServiceCollectionError("CONTACT_SERVICE_NOT_FOUND", 404)
  return {
    ...summarizeServiceBilling({
      ...account,
      dues: account.paymentDues,
      paidCents: payments._sum.amountCents ?? 0,
      today: tenantDateOnly(tenant.timezone),
    }),
    timezone: tenant.timezone || "America/Chicago",
  }
}

export async function replacePaymentPlanTx(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string
    contactServiceId: string
    plan: BillingPlan
    dues: DueInput[]
    paidCents: number
  },
) {
  await tx.contactServicePaymentDue.deleteMany({
    where: {
      tenantId: input.tenantId,
      contactServiceId: input.contactServiceId,
    },
  })
  const allocated = allocateServicePayments(input.dues, input.paidCents)
  if (allocated.length)
    await tx.contactServicePaymentDue.createMany({
      data: allocated.map((due) => ({
        ...due,
        dueDate: due.dueDate ? new Date(`${due.dueDate}T00:00:00Z`) : null,
        tenantId: input.tenantId,
        contactServiceId: input.contactServiceId,
      })),
    })
  await tx.contactService.update({
    where: { id: input.contactServiceId },
    data: {
      paymentType: input.plan.type,
      paymentPlan: input.plan,
      paidCents: input.paidCents,
      financialRevision: { increment: 1 },
    },
  })
}

export async function reconcilePaymentAllocationsTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contactServiceId: string,
) {
  const [dues, payments] = await Promise.all([
    tx.contactServicePaymentDue.findMany({
      where: { tenantId, contactServiceId },
      orderBy: { sortOrder: "asc" },
    }),
    tx.contactServicePayment.aggregate({
      where: { tenantId, contactServiceId, voidedAt: null },
      _sum: { amountCents: true },
    }),
  ])
  for (const due of allocateServicePayments(
    dues,
    payments._sum.amountCents ?? 0,
  )) {
    await tx.contactServicePaymentDue.update({
      where: { id: due.id },
      data: { paidCents: due.paidCents, remainingCents: due.remainingCents },
    })
  }
  await tx.contactService.update({
    where: { id: contactServiceId },
    data: { paidCents: payments._sum.amountCents ?? 0 },
  })
}
