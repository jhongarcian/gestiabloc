import { ContactServicesPanel } from "../_components/contact-services-panel"
import { getContactDetailsContext } from "../_lib/contact-details"

export default async function ContactServicesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
}) {
  const { tenantSlug, contactId } = await params
  const { tenantId } = await getContactDetailsContext(tenantSlug, contactId)

  return <ContactServicesPanel tenantId={tenantId} contactId={contactId} />
}
