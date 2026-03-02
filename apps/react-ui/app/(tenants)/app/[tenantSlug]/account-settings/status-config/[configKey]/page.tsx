import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"

import { ContactStatusConfigPanel } from "../../_components/status-config-panel"

const SUPPORTED_CONFIG_KEYS = new Set(["contacts", "tasks"])

export default async function AccountSettingsStatusConfigDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; configKey: string }>
}) {
  const { tenantSlug, configKey } = await params

  if (!SUPPORTED_CONFIG_KEYS.has(configKey)) {
    notFound()
  }

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

  if (configKey === "contacts") {
    return (
      <ContactStatusConfigPanel
        tenantId={membership.tenant.id}
        configKey="contacts"
      />
    )
  }

  if (configKey === "tasks") {
    return (
      <ContactStatusConfigPanel
        tenantId={membership.tenant.id}
        configKey="tasks"
      />
    )
  }

  notFound()
}
