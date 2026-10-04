import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { Suspense } from "react"

import { api, type MeResponse } from "@/lib/api"

import { AutomationsPanel } from "../_components/automations-panel"

export default async function AccountSettingsAutomationsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const cookie = (await headers()).get("cookie") ?? ""
  let me: MeResponse["user"] | null = null
  try {
    const { data } = await api.get<MeResponse>("/api/auth/me", { headers: { cookie } })
    me = data.user ?? null
  } catch {
    redirect("/login")
  }
  const membership = me?.memberships?.find((item) => item.tenant?.slug === tenantSlug)
  if (!membership?.tenant?.id) redirect(`/app/${tenantSlug}`)
  return <Suspense fallback={<div className="h-48 animate-pulse rounded-[26px] bg-slate-100" />}><AutomationsPanel tenantId={membership.tenant.id} tenantSlug={tenantSlug} /></Suspense>
}
