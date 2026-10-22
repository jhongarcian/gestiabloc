import { Prisma } from "../generated/prisma/index.js"
import { ServiceCollectionError } from "./service-configuration-collections.js"
import { getServiceTransactionPaymentValidationError } from "./service-transactions.js"
import { emitServiceAutomationEventTx } from "./service-automation-events.js"
import { reconcileServiceStepEnrollmentTx } from "./service-step-progression.js"
import { readBillingSnapshot } from "./service-configuration-inheritance.js"

type PaymentInput = { amountCents?: number; paidAt?: string; paymentMethod?: string | null; note?: string | null }
export async function mutateServicePaymentTx(tx: Prisma.TransactionClient, input: {
  tenantId: string; contactServiceId: string; paymentId?: string; operation: "ADDED" | "UPDATED" | "REMOVED"; payload?: PaymentInput; actorUserId: string
}) {
  const { tenantId, contactServiceId, operation } = input
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ContactService" WHERE "tenantId"=${tenantId} AND id=${contactServiceId} FOR UPDATE`)
  const enrollment = await tx.contactService.findFirst({ where: { tenantId, id: contactServiceId }, include: { service: { select: { minimumPartialPaymentCents: true } } } })
  if (!enrollment) throw new ServiceCollectionError("CONTACT_SERVICE_NOT_FOUND", 404)
  const previous = input.paymentId ? await tx.contactServicePayment.findFirst({ where: { tenantId, contactServiceId, id: input.paymentId } }) : null
  if (operation !== "ADDED" && !previous) throw new ServiceCollectionError("CONTACT_SERVICE_PAYMENT_NOT_FOUND", 404)
  const payload = input.payload ?? {}
  const data = {
    amountCents: payload.amountCents ?? previous?.amountCents ?? 0,
    paidAt: payload.paidAt ? new Date(payload.paidAt) : previous?.paidAt ?? new Date(),
    paymentMethod: payload.paymentMethod !== undefined ? payload.paymentMethod : previous?.paymentMethod ?? null,
    note: payload.note !== undefined ? payload.note : previous?.note ?? null,
  }
  const changed = operation !== "UPDATED" || !previous || previous.amountCents !== data.amountCents || previous.paidAt.getTime() !== data.paidAt.getTime() || previous.paymentMethod !== data.paymentMethod || previous.note !== data.note
  if (!changed) return { payment: previous, changed: false, enrollment }
  if (operation !== "REMOVED" && (operation === "ADDED" || previous?.amountCents !== data.amountCents)) {
    const others = await tx.contactServicePayment.aggregate({ where: { tenantId, contactServiceId, ...(previous ? { id: { not: previous.id } } : {}) }, _sum: { amountCents: true } })
    const error = getServiceTransactionPaymentValidationError({ totalPriceCents: enrollment.totalPriceCents, alreadyPaidCents: others._sum.amountCents ?? 0, paymentAmountCents: data.amountCents, allowPartialPayments: enrollment.allowPartialPayments, minimumPartialPaymentCents: (readBillingSnapshot(enrollment.billingSnapshot) ?? enrollment.service).minimumPartialPaymentCents })
    if (error) throw new ServiceCollectionError(error)
  }
  const payment = operation === "REMOVED"
    ? await tx.contactServicePayment.delete({ where: { id: previous!.id } })
    : operation === "UPDATED" ? await tx.contactServicePayment.update({ where: { id: previous!.id }, data })
    : await tx.contactServicePayment.create({ data: { ...data, tenantId, contactServiceId, recordedById: input.actorUserId } })
  await reconcileServiceStepEnrollmentTx(tx, tenantId, contactServiceId, { actor: { actorUserId: input.actorUserId } })
  await emitServiceAutomationEventTx(tx, { tenantId, contactServiceId, triggerType: "SERVICE_PAYMENT_CHANGED", recordId: payment.id, change: operation, previous: operation === "ADDED" ? null : previous, next: operation === "REMOVED" ? null : payment, actor: { actorUserId: input.actorUserId } })
  return { payment, changed: true, enrollment }
}
