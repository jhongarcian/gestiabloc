import { ContactServicesPanel } from "../_components/contact-services-panel"
import { getContactDetailsContext } from "../_lib/contact-details"

export default async function ContactServicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
  searchParams?: Promise<{ create?: string; serviceId?: string }>
}) {
  const { tenantSlug, contactId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const { tenantId, membershipSecurityLevel } = await getContactDetailsContext(tenantSlug, contactId)

  return (
    <ContactServicesPanel
      tenantId={tenantId}
      tenantSlug={tenantSlug}
      contactId={contactId}
      membershipSecurityLevel={membershipSecurityLevel}
      initialCreateOpen={resolvedSearchParams?.create === "1"}
      initialCreateServiceId={resolvedSearchParams?.serviceId ?? null}
    />
  )
}
