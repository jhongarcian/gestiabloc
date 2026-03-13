import { ContactServicesPanel } from "../_components/contact-services-panel"
import { getContactDetailsContext } from "../_lib/contact-details"

export default async function ContactServicesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
}) {
  const { tenantSlug, contactId } = await params
  const { tenantId, membershipSecurityLevel } = await getContactDetailsContext(tenantSlug, contactId)

  return (
    <ContactServicesPanel
      tenantId={tenantId}
      tenantSlug={tenantSlug}
      contactId={contactId}
      membershipSecurityLevel={membershipSecurityLevel}
    />
  )
}
