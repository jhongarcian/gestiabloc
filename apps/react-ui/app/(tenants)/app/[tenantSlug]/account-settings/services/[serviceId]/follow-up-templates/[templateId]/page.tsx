import { isAxiosError } from "axios"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"

import { ServiceFollowUpTemplateFlowBuilder } from "../../../../_components/service-followup-template-flow-builder"

type FollowUpTemplateResponse = {
  ok: boolean
  template: {
    id: string
    name: string
    sortOrder: number
    isPublished: boolean
    publishedAt: string | null
    needsRepair: boolean
    activeVersion: { id: string; versionNumber: number; schemaVersion?: number; checksum: string; publishedAt: string } | null
    flowNodes: unknown[]
    flowEdges: unknown[]
  }
}

export default async function FollowUpTemplateBuilderPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; serviceId: string; templateId: string }>
}) {
  const { tenantSlug, serviceId, templateId } = await params

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
    const { data } = await api.get<FollowUpTemplateResponse>(
      `/api/account-settings/${membership.tenant.id}/services/${serviceId}/follow-up-templates/${templateId}`,
      {
        headers: { cookie },
      },
    )

    return (
      <ServiceFollowUpTemplateFlowBuilder
        tenantId={membership.tenant.id}
        tenantSlug={tenantSlug}
        serviceId={serviceId}
        template={data.template}
      />
    )
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) {
      redirect(`/app/${tenantSlug}/account-settings/services/${serviceId}`)
    }

    redirect(`/app/${tenantSlug}/account-settings/services/${serviceId}`)
  }
}
