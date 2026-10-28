import { Prisma } from "../generated/prisma/index.js"
import { ServiceCollectionError } from "./service-configuration-collections.js"
import { emitServiceAutomationEventTx } from "./service-automation-events.js"
import { reconcileServiceStepEnrollmentTx } from "./service-step-progression.js"
import {
  assertFinancialRevision,
  getBillingSummaryTx,
  lockBillingAccountTx,
  reconcilePaymentAllocationsTx,
  replayFinancialWriteTx,
  saveFinancialChangeTx,
} from "./service-billing-account.js"

type PaymentInput = {
  amountCents?: number
  paidAt?: string
  paymentMethod?: string | null
  note?: string | null
}
type PaymentMutationInput = {
  tenantId: string
  contactServiceId: string
  paymentId?: string
  operation: "ADDED" | "UPDATED" | "REMOVED"
  payload?: PaymentInput
  actorUserId: string
  requestKey: string
  expectedRevision: number
  reason?: string
}
export async function mutateServicePaymentTx(
  tx: Prisma.TransactionClient,
  input: PaymentMutationInput,
) {
  const { tenantId, contactServiceId } = input
  const replay = await replayFinancialWriteTx(
    tx,
    tenantId,
    input.requestKey,
    input,
  )
  if (replay)
    return replay as unknown as Awaited<
      ReturnType<typeof executePaymentMutationTx>
    >
  return executePaymentMutationTx(tx, input)
}

async function executePaymentMutationTx(
  tx: Prisma.TransactionClient,
  input: PaymentMutationInput,
) {
  const { tenantId, contactServiceId, operation } = input
  const enrollment = await lockBillingAccountTx(tx, tenantId, contactServiceId)
  assertFinancialRevision(enrollment.financialRevision, input.expectedRevision)
  if (operation !== "ADDED" && !input.reason?.trim())
    throw new ServiceCollectionError("FINANCIAL_REASON_REQUIRED")
  const previous = input.paymentId
    ? await tx.contactServicePayment.findFirst({
        where: {
          tenantId,
          contactServiceId,
          id: input.paymentId,
          voidedAt: null,
        },
      })
    : null
  if (operation !== "ADDED" && !previous)
    throw new ServiceCollectionError("CONTACT_SERVICE_PAYMENT_NOT_FOUND", 404)
  const payload = input.payload ?? {}
  const data = {
    amountCents: payload.amountCents ?? previous?.amountCents ?? 0,
    paidAt: payload.paidAt
      ? new Date(payload.paidAt)
      : (previous?.paidAt ?? new Date()),
    paymentMethod:
      payload.paymentMethod !== undefined
        ? payload.paymentMethod
        : (previous?.paymentMethod ?? null),
    note: payload.note !== undefined ? payload.note : (previous?.note ?? null),
  }
  if (operation !== "REMOVED") {
    if (!Number.isSafeInteger(data.amountCents) || data.amountCents <= 0)
      throw new ServiceCollectionError("INVALID_PAYMENT_AMOUNT")
    const others = await tx.contactServicePayment.aggregate({
      where: {
        tenantId,
        contactServiceId,
        voidedAt: null,
        ...(previous ? { id: { not: previous.id } } : {}),
      },
      _sum: { amountCents: true },
    })
    if (
      (others._sum.amountCents ?? 0) + data.amountCents >
      enrollment.totalPriceCents
    )
      throw new ServiceCollectionError("PAYMENT_EXCEEDS_SERVICE_TOTAL")
  }
  if (
    operation === "UPDATED" &&
    previous &&
    previous.amountCents === data.amountCents &&
    previous.paidAt.getTime() === data.paidAt.getTime() &&
    previous.paymentMethod === data.paymentMethod &&
    previous.note === data.note
  ) {
    await tx.contactService.update({
      where: { id: contactServiceId },
      data: { financialRevision: { increment: 1 } },
    })
    const summary = await getBillingSummaryTx(tx, tenantId, contactServiceId)
    const result = { payment: previous, changed: false, enrollment, summary }
    await saveFinancialChangeTx(tx, {
      ...input,
      command: input,
      kind: "PAYMENT_REVIEWED",
      revision: summary.financialRevision,
      previous,
      next: previous,
      result,
    })
    return result
  }
  if (previous)
    await tx.contactServicePayment.update({
      where: { id: previous.id },
      data: {
        voidedAt: new Date(),
        voidedById: input.actorUserId,
        voidReason: input.reason!.trim(),
      },
    })
  const payment =
    operation === "REMOVED"
      ? await tx.contactServicePayment.findUniqueOrThrow({
          where: { id: previous!.id },
        })
      : await tx.contactServicePayment.create({
          data: {
            ...data,
            tenantId,
            contactServiceId,
            recordedById: input.actorUserId,
            replacesPaymentId: previous?.id ?? null,
          },
        })
  await tx.contactService.update({
    where: { id: contactServiceId },
    data: { financialRevision: { increment: 1 } },
  })
  await reconcilePaymentAllocationsTx(tx, tenantId, contactServiceId)
  await reconcileServiceStepEnrollmentTx(tx, tenantId, contactServiceId, {
    actor: { actorUserId: input.actorUserId },
  })
  await emitServiceAutomationEventTx(tx, {
    tenantId,
    contactServiceId,
    triggerType: "SERVICE_PAYMENT_CHANGED",
    recordId: payment.id,
    change: operation,
    previous: operation === "ADDED" ? null : previous,
    next: operation === "REMOVED" ? null : payment,
    actor: { actorUserId: input.actorUserId },
  })
  const summary = await getBillingSummaryTx(tx, tenantId, contactServiceId)
  const result = { payment, changed: true, enrollment, summary }
  await saveFinancialChangeTx(tx, {
    ...input,
    command: input,
    kind: `PAYMENT_${operation}`,
    revision: summary.financialRevision,
    previous,
    next: operation === "REMOVED" ? null : payment,
    result,
  })
  return result
}
