import { ContactServiceDetailsPanel } from "../../_components/contact-service-details-panel"
import { getContactDetailsContext } from "../../_lib/contact-details"

export default async function ContactServiceDetailsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contactId: string; contactServiceId: string }>
}) {
  const { tenantSlug, contactId, contactServiceId } = await params
  const { tenantId, membershipSecurityLevel } = await getContactDetailsContext(tenantSlug, contactId)

  return (
    <ContactServiceDetailsPanel
      tenantId={tenantId}
      tenantSlug={tenantSlug}
      contactId={contactId}
      contactServiceId={contactServiceId}
      membershipSecurityLevel={membershipSecurityLevel}
    />
  )
}
