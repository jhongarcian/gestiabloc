import { redirect } from "next/navigation"

import { getTenantMembershipContext } from "../../_lib/tenant-session"
import { AutomationProcessDetails } from "../_components/automation-process-details"

export default async function AutomationProcessDetailsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; processId: string }>
}) {
  const { tenantSlug, processId } = await params
  const { membership } = await getTenantMembershipContext(tenantSlug)

  if (!membership?.tenant?.id) redirect(`/app/${tenantSlug}`)

  return (
    <AutomationProcessDetails
      tenantId={membership.tenant.id}
      tenantSlug={tenantSlug}
      processId={processId}
    />
  )
}
