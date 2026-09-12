import { redirect } from "next/navigation"

import { getTenantMembershipContext } from "../../_lib/tenant-session"
import { FollowUpsTable } from "../../followups/_components/followups-table"

export default async function ServiceFollowUpsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { membership, tenantTimezone } = await getTenantMembershipContext(tenantSlug)

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <FollowUpsTable
        tenantSlug={tenantSlug}
        tenantId={membership.tenant.id}
        tenantTimezone={tenantTimezone}
      />
    </section>
  )
}
