import { ContactFollowUpsPanel } from "../_components/contact-followups-panel"
import { getContactDetailsContext } from "../_lib/contact-details"

export default async function ContactFollowUpsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
}) {
  const { tenantSlug, contactId } = await params
  const { tenantId } = await getContactDetailsContext(tenantSlug, contactId)

  return <ContactFollowUpsPanel tenantId={tenantId} contactId={contactId} />
}
