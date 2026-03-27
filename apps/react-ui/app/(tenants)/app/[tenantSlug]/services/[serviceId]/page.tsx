import { isAxiosError } from "axios"
import { redirect } from "next/navigation"

import { api } from "@/lib/api"

import { getTenantMembershipContext } from "../../_lib/tenant-session"
import { ServiceOverviewPanel } from "./_components/service-overview-panel"

type ServiceOverviewResponse = {
  ok: boolean
  service: {
    id: string
    name: string
    description: string | null
    basePriceCents: number
    currency: string
    isTaxExempt: boolean
    allowPartialPayments: boolean
    minimumPartialPaymentCents: number | null
    installmentCount: number | null
    installmentFrequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | null
    isActive: boolean
    checklistItems: Array<{
      id: string
      label: string
      description: string | null
      isRequired: boolean
      sortOrder: number
    }>
    followUpTemplates: Array<{
      id: string
      name: string
      isPublished: boolean
      sortOrder: number
      flowNodeCount: number
      flowEdgeCount: number
    }>
    professionals: Array<{
      id: string
      kind: "INTERNAL_USER" | "EXTERNAL"
      userId: string | null
      externalProfessionalName: string | null
      externalContact: string | null
      sortOrder: number
      user: {
        name: string | null
        email: string | null
        image: string | null
      } | null
    }>
    tenantBilling: {
      taxEnabled: boolean
      taxLabel: string | null
      defaultTaxRatePercent: number | null
    }
  }
}

type ServiceSummaryResponse = {
  ok: boolean
  summary: {
    grossSalesCents: number
    servicesSold: number
    activeFollowUpServices: number
    remainingBalanceCents: number
    range: {
      preset: "THIS_MONTH" | "LAST_MONTH" | "LAST_3_MONTHS" | "CUSTOM"
      from: string
      to: string
    }
  }
}

export default async function ServiceOverviewPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; serviceId: string }>
}) {
  const { tenantSlug, serviceId } = await params
  const { membership, cookie } = await getTenantMembershipContext(tenantSlug)

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  let data: ServiceOverviewResponse | null = null
  let initialSummary: ServiceSummaryResponse["summary"] | null = null

  try {
    const encodedTenantId = encodeURIComponent(membership.tenant.id)
    const encodedServiceId = encodeURIComponent(serviceId)
    const [serviceResponse, summaryResponse] = await Promise.allSettled([
      api.get<ServiceOverviewResponse>(
        `/api/services/${encodedTenantId}/catalog/${encodedServiceId}`,
        {
          headers: { cookie },
        },
      ),
      api.get<ServiceSummaryResponse>(
        `/api/services/${encodedTenantId}/catalog/${encodedServiceId}/summary`,
        {
          headers: { cookie },
          params: {
            preset: "THIS_MONTH",
          },
        },
      ),
    ])

    if (serviceResponse.status === "fulfilled") {
      data = serviceResponse.value.data
    } else {
      const error = serviceResponse.reason
      if (isAxiosError(error) && error.response?.status === 404) {
        redirect(`/app/${tenantSlug}/services`)
      }

      redirect(`/app/${tenantSlug}/services`)
    }

    if (summaryResponse.status === "fulfilled") {
      initialSummary = summaryResponse.value.data.summary
    }
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) {
      redirect(`/app/${tenantSlug}/services`)
    }

    redirect(`/app/${tenantSlug}/services`)
  }

  return (
    <ServiceOverviewPanel
      tenantId={membership.tenant.id}
      tenantSlug={tenantSlug}
      service={data.service}
      initialSummary={initialSummary}
    />
  )
}
