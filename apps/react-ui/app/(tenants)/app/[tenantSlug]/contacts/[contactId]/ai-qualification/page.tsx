import { ContactAiQualificationPanel } from "../_components/contact-ai-qualification-panel"
import { getContactDetailsContext } from "../_lib/contact-details"

export default async function ContactAiQualificationPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
}) {
  const { tenantSlug, contactId } = await params
  const { tenantId, contact } = await getContactDetailsContext(tenantSlug, contactId)

  return (
    <ContactAiQualificationPanel
      tenantId={tenantId}
      tenantSlug={tenantSlug}
      contactId={contactId}
      contactName={contact.fullName}
    />
  )
}
