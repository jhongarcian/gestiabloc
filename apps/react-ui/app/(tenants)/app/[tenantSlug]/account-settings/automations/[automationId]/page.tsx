import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"

import { AutomationFlowBuilder } from "../../_components/automation-flow-builder"
import { parseLibraryLocation, serializeLibraryLocation } from "@/lib/automation-library"

export default async function EditAutomationPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; automationId: string }>
  searchParams: Promise<{ view?: string; folder?: string; open?: string | string[] }>
}) {
  const { tenantSlug, automationId } = await params
  const query = await searchParams
  const urlParams = new URLSearchParams()
  if (query.view) urlParams.set("view", query.view)
  if (query.folder) urlParams.set("folder", query.folder)
  for (const id of [query.open].flat().filter((value): value is string => typeof value === "string")) urlParams.append("open", id)
  const libraryQuery = serializeLibraryLocation(parseLibraryLocation(urlParams))
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
      timezone={membership.tenant.timezone}
      libraryQuery={libraryQuery}
    />
  )
}
