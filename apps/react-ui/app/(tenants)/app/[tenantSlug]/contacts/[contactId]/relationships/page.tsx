import { ContactRelationshipsSection } from "../_components/contact-relationships-section"
import { getContactDetailsContext } from "../_lib/contact-details"

export default async function ContactRelationshipsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
}) {
  const { tenantSlug, contactId } = await params
  const { tenantId, contact } = await getContactDetailsContext(tenantSlug, contactId)

  return (
    <ContactRelationshipsSection
      tenantId={tenantId}
      tenantSlug={tenantSlug}
      contactId={contactId}
      initialRelationships={contact.relationships}
      variant="page"
    />
  )
}
