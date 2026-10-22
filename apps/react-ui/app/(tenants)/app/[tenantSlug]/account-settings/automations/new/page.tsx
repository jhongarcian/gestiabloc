import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"

import { AutomationFlowBuilder } from "../../_components/automation-flow-builder"
import { parseLibraryLocation, serializeLibraryLocation } from "@/lib/automation-library"

export default async function NewAutomationPage({ params, searchParams }: { params: Promise<{ tenantSlug: string }>; searchParams: Promise<{ view?: string; folder?: string; open?: string | string[]; serviceGroupId?: string; serviceOfferingId?: string; serviceStepId?: string; stepEvent?: string }> }) {
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
  const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  const newServiceStepTrigger = uuid(query.serviceGroupId) && uuid(query.serviceStepId) && ["entered", "completed"].includes(query.stepEvent ?? "") ? { serviceGroupId: query.serviceGroupId, serviceStepId: query.serviceStepId, ...(uuid(query.serviceOfferingId) ? { serviceOfferingId: query.serviceOfferingId } : {}), type: query.stepEvent === "completed" ? "SERVICE_STEP_COMPLETED" as const : "SERVICE_STEP_ENTERED" as const } : undefined
  return <AutomationFlowBuilder newServiceStepTrigger={newServiceStepTrigger} tenantId={membership.tenant.id} tenantSlug={tenantSlug} timezone={membership.tenant.timezone} libraryQuery={libraryQuery} newFolderId={location.view === "grid" ? location.folderId : null} />
}
