import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"

import { AutomationFlowBuilder } from "../../_components/automation-flow-builder"

export default async function EditAutomationPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; automationId: string }>
}) {
  const { tenantSlug, automationId } = await params
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
  return (
    <AutomationFlowBuilder
      tenantId={membership.tenant.id}
      tenantSlug={tenantSlug}
      automationId={automationId}
    />
  )
}
