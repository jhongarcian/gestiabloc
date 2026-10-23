import { Router, type Response } from "express"
import { z } from "zod"
import { prisma } from "../lib/prisma.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"
import {
  canManageContactServices,
  type ContactServicePermissionMembership,
} from "../lib/contact-service-permissions.js"
import {
  FinancialReasonSchema,
  FinancialWriteSchema,
  ServicePaymentTermsSchema,
  resolvePaymentSettings,
  reviseServicePaymentPlan,
  tenantDateOnly,
} from "../lib/service-billing.js"
import {
  assertFinancialRevision,
  getBillingSummaryTx,
  lockBillingAccountTx,
  replacePaymentPlanTx,
  replayFinancialWriteTx,
  saveFinancialChangeTx,
} from "../lib/service-billing-account.js"
import { previewServiceBillingTx } from "../lib/service-billing-preview.js"
import { readBillingSnapshot } from "../lib/service-configuration-inheritance.js"
import { ServiceCollectionError } from "../lib/service-configuration-collections.js"
import { ServiceTransactionAmountCentsSchema } from "../lib/service-transactions.js"

const pathSchema = z.object({
  tenantId: z.string().min(1),
  contactServiceId: z.uuid(),
})
const previewSchema = z
  .object({
    serviceId: z.uuid(),
    paymentTerms: ServicePaymentTermsSchema.optional(),
    initialPaymentCents: ServiceTransactionAmountCentsSchema.default(0),
    purchasedAt: z.iso.datetime().nullable().optional(),
  })
  .strict()
const revisionSchema = FinancialWriteSchema.extend({
  paymentTerms: ServicePaymentTermsSchema,
  reason: FinancialReasonSchema,
}).strict()
export function createServiceBillingRouter(
  requireMembership: (
    req: AuthedRequest,
    res: Response,
    tenantId: string,
  ) => Promise<ContactServicePermissionMembership | null>,
) {
  const router = Router()
  router.post(
    "/:tenantId/billing-preview",
    requireAuth,
    async (req, res, next) => {
      try {
        const tenantId = z.string().min(1).parse(req.params.tenantId)
        const member = await requireMembership(
          req as AuthedRequest,
          res,
          tenantId,
        )
        if (!member) return
        const body = previewSchema.parse(req.body)
        if (body.initialPaymentCents > 0 && !canManageContactServices(member))
          return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
        const preview = await prisma.$transaction((tx) =>
          previewServiceBillingTx(tx, {
            ...body,
            tenantId,
            terms: body.paymentTerms,
          }),
        )
        res.json({
          ok: true,
          ...preview,
          permissions: { canRecord: canManageContactServices(member) },
        })
      } catch (error) {
        if (error instanceof ServiceCollectionError)
          return res.status(error.status).json({ error: error.code })
        next(error)
      }
    },
  )
  router.get(
    "/:tenantId/contact-services/:contactServiceId/billing",
    requireAuth,
    async (req, res, next) => {
      try {
        const { tenantId, contactServiceId } = pathSchema.parse(req.params)
        const member = await requireMembership(
          req as AuthedRequest,
          res,
          tenantId,
        )
        if (!member) return
        const page = z.coerce
          .number()
          .int()
          .min(1)
          .max(1000000)
          .default(1)
          .parse(req.query.page)
        const data = await prisma.$transaction(async (tx) => {
          const summary = await getBillingSummaryTx(
            tx,
            tenantId,
            contactServiceId,
          )
          const [account, payments, paymentCount, changeCount, changes] =
            await Promise.all([
              tx.contactService.findFirstOrThrow({
                where: { tenantId, id: contactServiceId },
                select: { paymentPlan: true, billingSnapshot: true },
              }),
              tx.contactServicePayment.findMany({
                where: { tenantId, contactServiceId },
                orderBy: [
                  { paidAt: "desc" },
                  { createdAt: "desc" },
                  { id: "desc" },
                ],
                skip: (page - 1) * 20,
                take: 20,
                include: { recordedBy: { select: { name: true } } },
              }),
              tx.contactServicePayment.count({
                where: { tenantId, contactServiceId },
              }),
              tx.contactServiceFinancialChange.count({
                where: { tenantId, contactServiceId },
              }),
              tx.contactServiceFinancialChange.findMany({
                where: { tenantId, contactServiceId },
                orderBy: { revision: "desc" },
                skip: (page - 1) * 20,
                take: 20,
                select: {
                  id: true,
                  kind: true,
                  revision: true,
                  reason: true,
                  actorUserId: true,
                  createdAt: true,
                  previous: true,
                  next: true,
                },
              }),
            ])
          const actors = await tx.user.findMany({
            where: {
              id: {
                in: [...new Set(changes.map((change) => change.actorUserId))],
              },
            },
            select: { id: true, name: true },
          })
          return {
            summary,
            plan: account.paymentPlan,
            settings: resolvePaymentSettings(
              readBillingSnapshot(account.billingSnapshot) ?? {},
            ),
            payments,
            changes: changes.map((change) => ({
              ...change,
              actorName:
                actors.find((actor) => actor.id === change.actorUserId)?.name ??
                "Former staff member",
            })),
            pagination: {
              page,
              totalPages: Math.max(
                1,
                Math.ceil(Math.max(paymentCount, changeCount) / 20),
              ),
              totalPayments: paymentCount,
            },
          }
        })
        res.json({
          ok: true,
          ...data,
          permissions: {
            canRecord: canManageContactServices(member),
            canRevisePlan: member.role === "TENANT_ADMIN",
          },
        })
      } catch (error) {
        if (error instanceof ServiceCollectionError)
          return res.status(error.status).json({ error: error.code })
        next(error)
      }
    },
  )
  router.patch(
    "/:tenantId/contact-services/:contactServiceId/billing-plan",
    requireAuth,
    async (req, res, next) => {
      try {
        const { tenantId, contactServiceId } = pathSchema.parse(req.params)
        const member = await requireMembership(
          req as AuthedRequest,
          res,
          tenantId,
        )
        if (!member) return
        if (member.role !== "TENANT_ADMIN")
          return res.status(403).json({ error: "TENANT_ADMIN_REQUIRED" })
        const body = revisionSchema.parse(req.body)
        const command = {
          tenantId,
          contactServiceId,
          ...body,
          actorUserId: (req as AuthedRequest).user.id,
        }
        const result = await prisma.$transaction(async (tx) => {
          const replay = await replayFinancialWriteTx(
            tx,
            tenantId,
            body.requestKey,
            command,
          )
          if (replay) return replay
          const account = await lockBillingAccountTx(
            tx,
            tenantId,
            contactServiceId,
          )
          assertFinancialRevision(
            account.financialRevision,
            body.expectedRevision,
          )
          const before = await getBillingSummaryTx(
            tx,
            tenantId,
            contactServiceId,
          )
          if (account.status === "CANCELED")
            throw new ServiceCollectionError(
              "CANCELED_SERVICE_PLAN_READ_ONLY",
              409,
            )
          if (before.remainingCents <= 0)
            throw new ServiceCollectionError("NO_REMAINING_BALANCE", 409)
          const tenant = await tx.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: { timezone: true },
          })
          const settings = resolvePaymentSettings(
            readBillingSnapshot(account.billingSnapshot) ?? {},
          )
          // An admin may introduce a new arrangement without changing the enrolled price or tax.
          settings.enabledTypes = ["SINGLE_PAYMENT", "INSTALLMENTS", "FLEXIBLE"]
          let revised
          try {
            revised = reviseServicePaymentPlan({
              totalPriceCents: account.totalPriceCents,
              paidCents: before.paidCents,
              dues: before.schedule,
              settings,
              terms: body.paymentTerms,
              today: tenantDateOnly(tenant.timezone),
            })
          } catch (error) {
            throw new ServiceCollectionError(
              error instanceof Error ? error.message : "INVALID_PAYMENT_TERMS",
            )
          }
          await replacePaymentPlanTx(tx, {
            tenantId,
            contactServiceId,
            ...revised,
            paidCents: before.paidCents,
          })
          const summary = await getBillingSummaryTx(
            tx,
            tenantId,
            contactServiceId,
          )
          const response = { ok: true, summary }
          await saveFinancialChangeTx(tx, {
            tenantId,
            contactServiceId,
            requestKey: body.requestKey,
            command,
            kind: "PLAN_REVISED",
            revision: summary.financialRevision,
            actorUserId: command.actorUserId,
            reason: body.reason,
            previous: { plan: account.paymentPlan, schedule: before.schedule },
            next: { plan: revised.plan, schedule: summary.schedule },
            result: response,
          })
          return response
        })
        res.json(result)
      } catch (error) {
        if (error instanceof ServiceCollectionError)
          return res.status(error.status).json({ error: error.code })
        next(error)
      }
    },
  )
  return router
}
