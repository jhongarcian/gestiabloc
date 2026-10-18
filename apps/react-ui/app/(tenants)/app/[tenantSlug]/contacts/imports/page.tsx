import { redirect } from "next/navigation"

import { getTenantMembershipContext } from "../../_lib/tenant-session"
import { ContactImportWorkspace } from "./_components/contact-import-workspace"

export default async function ContactImportsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params
  const { membership } = await getTenantMembershipContext(tenantSlug)
  if (membership.role !== "TENANT_ADMIN") redirect(`/app/${tenantSlug}/contacts`)
  return <ContactImportWorkspace tenantId={membership.tenant.id} tenantSlug={tenantSlug} />
}
