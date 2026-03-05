import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"

import { ServiceProfessionalsPanel } from "../_components/service-professionals-panel"

export default async function AccountSettingsProfessionalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ serviceId?: string }>
}) {
  const { tenantSlug } = await params
  const { serviceId } = await searchParams

  let me: MeResponse["user"] | null = null

  try {
    const cookie = (await headers()).get("cookie") ?? ""
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

  return (
    <ServiceProfessionalsPanel
      tenantId={membership.tenant.id}
      tenantSlug={tenantSlug}
      initialServiceId={serviceId}
    />
  )
}
