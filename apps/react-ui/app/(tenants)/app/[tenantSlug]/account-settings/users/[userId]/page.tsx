import { headers } from "next/headers"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import { api, type MeResponse } from "@/lib/api"
import { UserSecurityLevelControl } from "../../_components/user-security-level-control"

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
  }
}

const formatSegment = (segment: string) =>
  segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

const formatDateTime = (value: string | null) => {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Never"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

const formatSecurityLevelLabel = (level: "LOW" | "MEDIUM" | "MAX") =>
  level === "LOW" ? "Low" : level === "MEDIUM" ? "Medium" : "Max"

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
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{userDetails.name}</h2>
          <p className="text-sm text-slate-500">{userDetails.email}</p>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href={`/app/${tenantSlug}/account-settings/users`}>Back to Users</Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Role</p>
          <p className="mt-1 text-sm font-medium text-slate-900">{formatSegment(userDetails.role)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Security Level</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {formatSecurityLevelLabel(userDetails.securityLevel)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Account Status</p>
          <p className="mt-1 text-sm font-medium text-slate-900">{formatSegment(userDetails.accountStatus)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Email Verification</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {userDetails.emailVerified ? "Verified" : "Not Verified"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Session</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {userDetails.isOnline ? "Online" : "Offline"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Last Login</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {formatDateTime(userDetails.lastLoginAt)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">Online Since</p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {formatDateTime(userDetails.sessionCreatedAt)}
          </p>
        </div>
      </div>

      <UserSecurityLevelControl
        tenantId={membership.tenant.id}
        userId={userDetails.id}
        role={userDetails.role}
        initialSecurityLevel={userDetails.securityLevel}
      />
    </section>
  )
}
