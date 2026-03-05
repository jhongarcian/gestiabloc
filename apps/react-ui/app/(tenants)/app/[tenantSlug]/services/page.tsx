import { redirect } from "next/navigation"

import { getTenantMembershipContext } from "../_lib/tenant-session"
import { ServicesProductsPanel } from "./_components/services-products-panel"

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
    <section className="flex h-full min-h-0 flex-col gap-4">
      <ServicesProductsPanel tenantId={membership.tenant.id} />
    </section>
  )
}
