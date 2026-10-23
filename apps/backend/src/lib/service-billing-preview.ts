import { Prisma } from "../generated/prisma/index.js"
import {
  loadEffectiveServiceConfiguration,
  pickBilling,
} from "./service-configuration-inheritance.js"
import { ServiceCollectionError } from "./service-configuration-collections.js"
import { configurationDigest } from "./service-configuration-digest.js"
import {
  buildServicePaymentPlan,
  resolvePaymentSettings,
  tenantDateOnly,
  type ServicePaymentTerms,
} from "./service-billing.js"

export async function previewServiceBillingTx(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string
    serviceId: string
    terms?: ServicePaymentTerms
    initialPaymentCents: number
    purchasedAt?: string | null
  },
) {
  const [service, tenant] = await Promise.all([
    loadEffectiveServiceConfiguration(tx, input.tenantId, input.serviceId),
    tx.tenant.findUniqueOrThrow({
      where: { id: input.tenantId },
      select: {
        timezone: true,
        taxEnabled: true,
        taxLabel: true,
        defaultTaxRateBps: true,
      },
    }),
  ])
  const totalPriceCents =
    service.basePriceCents +
    (tenant.taxEnabled &&
    !service.isTaxExempt &&
    tenant.defaultTaxRateBps !== null
      ? Math.round((service.basePriceCents * tenant.defaultTaxRateBps) / 10000)
      : 0)
  const settings = resolvePaymentSettings(service)
  const today = tenantDateOnly(
    tenant.timezone,
    input.purchasedAt ? new Date(input.purchasedAt) : new Date(),
  )
  let result
  try {
    result = buildServicePaymentPlan({
      totalPriceCents,
      initialPaymentCents: input.initialPaymentCents,
      settings,
      terms: input.terms ?? { type: settings.defaultType },
      today,
    })
  } catch (error) {
    throw new ServiceCollectionError(
      error instanceof Error ? error.message : "INVALID_PAYMENT_TERMS",
    )
  }
  return {
    ...result,
    totalPriceCents,
    currency: service.currency,
    settings,
    today,
    configurationVersion: configurationDigest({
      ...pickBilling(service),
      ...tenant,
      billingDate: today,
    }),
  }
}
