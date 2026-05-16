import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api, type MeResponse, type SubscriptionResponse } from "@/lib/api"

import { SubscriptionDashboard } from "../_components/subscription-dashboard"

export default async function AccountSettingsSubscriptionPage({
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

  const tenantId = membership.tenant.id
  const cookie = (await headers()).get("cookie") ?? ""

  let subscription: SubscriptionResponse["subscription"] | null = null

  try {
    const { data } = await api.get<SubscriptionResponse>(
      `/api/account-settings/${tenantId}/subscription`,
      { headers: { cookie } },
    )
    subscription = data?.subscription ?? null
  } catch {
    // subscription fetch failed — show page without data
  }

  return (
    <SubscriptionDashboard
      tenantId={tenantId}
      tenantSlug={tenantSlug}
      subscription={subscription}
      userRole={membership.role}
    />
  )
}
