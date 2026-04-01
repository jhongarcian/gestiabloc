import { isAxiosError } from "axios"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"

import { EMPTY_SERVICE_FIT_PROFILE } from "../../_components/service-fit-rules-tab"
import { ServiceDetailsPanelClient } from "./_components/service-details-panel-client"

type ServiceDetailsResponse = {
  ok: boolean
  service: {
    id: string
    name: string
    description: string | null
    fitProfile?: {
      enabled: boolean
      summary: string
      rules: Array<{
        id: string
        source: "core" | "status" | "tags" | "custom" | "derived"
        fieldKey: string
        valueType: "string" | "number" | "date" | "boolean" | "stringArray"
        operator:
          | "equals"
          | "not_equals"
          | "contains"
          | "not_contains"
          | "greater_than"
          | "greater_than_or_equal"
          | "less_than"
          | "less_than_or_equal"
          | "between"
          | "includes_any"
          | "includes_all"
          | "excludes_all"
          | "is_true"
          | "is_false"
          | "is_empty"
          | "is_not_empty"
        compareValue: unknown
        required: boolean
        requiredGroup: string | null
        requiredBranch: string | null
        weight: number
        label: string | null
        explanation: string | null
      }>
    }
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
    followUpTemplateSteps: Array<{
      id: string
      title: string
      notesTemplate: string | null
      dueDaysFromStart: number
      sortOrder: number
    }>
    followUpTemplates: Array<{
      id: string
      name: string
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
        email: string
      } | null
    }>
    tenantBilling: {
      taxEnabled: boolean
      taxLabel: string | null
      defaultTaxRatePercent: number | null
    }
    configStatus: {
      overviewComplete: boolean
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
      <ServiceDetailsPanelClient
        tenantId={membership.tenant.id}
        tenantSlug={tenantSlug}
        service={{
          ...data.service,
          fitProfile: data.service.fitProfile ?? EMPTY_SERVICE_FIT_PROFILE,
        }}
      />
    )
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) {
      redirect(`/app/${tenantSlug}/account-settings/services`)
    }

    redirect(`/app/${tenantSlug}/account-settings/services`)
  }
}
