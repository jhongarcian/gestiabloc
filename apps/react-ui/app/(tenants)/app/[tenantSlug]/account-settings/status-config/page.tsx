import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"

import { StatusConfigOverviewPanel } from "../_components/status-config-overview-panel"

export default async function AccountSettingsStatusConfigPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

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

  const membership = me.memberships.find(
    (item) => item.tenant?.slug === tenantSlug,
  )

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  return (
    <StatusConfigOverviewPanel
      tenantId={membership.tenant.id}
      tenantSlug={tenantSlug}
    />
  )
}
