import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"

import { AutomationFlowBuilder } from "../../_components/automation-flow-builder"
import { parseLibraryLocation, serializeLibraryLocation } from "@/lib/automation-library"

export default async function NewAutomationPage({ params, searchParams }: { params: Promise<{ tenantSlug: string }>; searchParams: Promise<{ view?: string; folder?: string; open?: string | string[] }> }) {
  const { tenantSlug } = await params
  const query = await searchParams
  const urlParams = new URLSearchParams()
  if (query.view) urlParams.set("view", query.view)
  if (query.folder) urlParams.set("folder", query.folder)
  for (const id of [query.open].flat().filter((value): value is string => typeof value === "string")) urlParams.append("open", id)
  const location = parseLibraryLocation(urlParams)
  const libraryQuery = serializeLibraryLocation(location)
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
  return <AutomationFlowBuilder tenantId={membership.tenant.id} tenantSlug={tenantSlug} timezone={membership.tenant.timezone} libraryQuery={libraryQuery} newFolderId={location.view === "grid" ? location.folderId : null} />
}
