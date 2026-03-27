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
      flowNodes: unknown[] | null
      flowEdges: unknown[] | null
    }>
    professionals: Array<{
      id: string
      kind: "INTERNAL_USER" | "EXTERNAL"
      userId: string | null
      externalProfessionalName: string | null
      externalContact: string | null
      notes: string | null
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

  try {
    const response = await api.get<ServiceOverviewResponse>(
      `/api/services/${membership.tenant.id}/catalog/${serviceId}`,
      {
        headers: { cookie },
      },
    )
    data = response.data
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
    />
  )
}
