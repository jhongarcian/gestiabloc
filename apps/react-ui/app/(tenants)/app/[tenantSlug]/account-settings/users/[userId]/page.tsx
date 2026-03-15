import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"
import { UserDetailsView } from "../../_components/user-details-view"

type UserDetailsResponse = {
  ok: boolean
  user: {
    id: string
    name: string
    email: string
    avatar: string | null
    emailVerified: boolean
    isOnline: boolean
    sessionCreatedAt: string | null
    role: string
    accountStatus: string
    securityLevel: "LOW" | "MEDIUM" | "MAX"
    lastLoginAt: string | null
    createdAt: string
    updatedAt: string
    timezone: string | null
    activity: {
      recentSessions: Array<{
        id: string
        createdAt: string
        expiresAt: string
        ipAddress: string | null
        userAgent: string | null
        isActive: boolean
      }>
    }
    auditHistory: Array<{
      id: string
      type: string
      title: string
      detail: string
      at: string
    }>
  }
}

export default async function AccountSettingsUserDetailsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; userId: string }>
}) {
  const { tenantSlug, userId } = await params

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

  let userDetails: UserDetailsResponse["user"] | null = null

  try {
    const cookie = (await headers()).get("cookie") ?? ""
    const { data } = await api.get<UserDetailsResponse>(
      `/api/account-settings/${membership.tenant.id}/users/${userId}`,
      {
        headers: { cookie },
      },
    )
    userDetails = data?.user ?? null
  } catch {
    notFound()
  }

  if (!userDetails) {
    notFound()
  }

  return (
    <section className="space-y-4">
      <UserDetailsView
        tenantId={membership.tenant.id}
        tenantSlug={tenantSlug}
        userId={userId}
        initialUser={userDetails}
      />
    </section>
  )
}
