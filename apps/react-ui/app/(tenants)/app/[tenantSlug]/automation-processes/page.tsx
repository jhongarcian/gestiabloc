import { redirect } from "next/navigation"

import { getTenantMembershipContext } from "../_lib/tenant-session"
import { AutomationProcessHistory } from "./_components/automation-process-history"

export default async function AutomationProcessesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { membership } = await getTenantMembershipContext(tenantSlug)

  if (!membership?.tenant?.id) redirect(`/app/${tenantSlug}`)

  return (
    <AutomationProcessHistory
      tenantId={membership.tenant.id}
      tenantSlug={tenantSlug}
    />
  )
}
