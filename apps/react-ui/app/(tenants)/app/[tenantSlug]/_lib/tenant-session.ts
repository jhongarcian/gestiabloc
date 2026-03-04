import { cache } from "react"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"

export const getAuthedTenantUser = cache(async () => {
  const cookie = (await headers()).get("cookie") ?? ""

  try {
    const { data } = await api.get<MeResponse>("/api/auth/me", {
      headers: { cookie },
    })

    if (!data?.user?.id) {
      redirect("/login")
    }

    return {
      cookie,
      user: data.user,
    }
  } catch {
    redirect("/login")
  }
})

export const getTenantMembershipContext = cache(async (tenantSlug: string) => {
  const { cookie, user } = await getAuthedTenantUser()

  if (!user.memberships?.length) {
    redirect("/login")
  }

  const membership = user.memberships.find(
    (item) => item.tenant?.slug === tenantSlug,
  )

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  return {
    cookie,
    user,
    membership,
    tenantId: membership.tenant.id,
    tenantTimezone: membership.tenant.timezone ?? null,
  }
})
