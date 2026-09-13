import { redirect } from "next/navigation"

import { getTenantMembershipContext } from "../_lib/tenant-session"
import { ServicesRegistryPanel } from "./_components/services-registry-panel"

export default async function ServicesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { membership } = await getTenantMembershipContext(tenantSlug)

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      <ServicesRegistryPanel
        tenantId={membership.tenant.id}
        tenantSlug={tenantSlug}
      />
    </div>
  )
}
