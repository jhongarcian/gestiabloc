import { isAxiosError } from "axios"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"

import { ServiceDetailsPanel } from "../../_components/service-details-panel"

type ServiceDetailsResponse = {
  ok: boolean
  service: {
    id: string
    name: string
    description: string | null
    basePriceCents: number
    currency: string
    allowPartialPayments: boolean
    minimumPartialPaymentCents: number | null
    isActive: boolean
    checklistItems: Array<{
      id: string
      label: string
      isRequired: boolean
      sortOrder: number
    }>
    configStatus: {
      checklistComplete: boolean
      followUpsComplete: boolean
      professionalsComplete: boolean
      isComplete: boolean
    }
  }
}

export default async function AccountSettingsServiceDetailsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; serviceId: string }>
}) {
  const { tenantSlug, serviceId } = await params

  let me: MeResponse["user"] | null = null
  const cookie = (await headers()).get("cookie") ?? ""

  try {
    const { data } = await api.get<MeResponse>("/api/auth/me", {
      headers: { cookie },
    })

    me = data?.user ?? null
  } catch {
    redirect("/login")
  }

  if (!me?.memberships?.length) {
    redirect("/login")
  }

  const membership = me.memberships.find((item) => item.tenant?.slug === tenantSlug)

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  try {
    const { data } = await api.get<ServiceDetailsResponse>(
      `/api/account-settings/${membership.tenant.id}/services/${serviceId}`,
      {
        headers: { cookie },
      },
    )

    return (
      <ServiceDetailsPanel
        tenantId={membership.tenant.id}
        tenantSlug={tenantSlug}
        service={data.service}
      />
    )
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) {
      redirect(`/app/${tenantSlug}/account-settings/services`)
    }

    redirect(`/app/${tenantSlug}/account-settings/services`)
  }
}
