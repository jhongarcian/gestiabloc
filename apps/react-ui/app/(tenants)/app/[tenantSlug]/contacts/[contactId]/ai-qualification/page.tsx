import { ContactAiQualificationPanel } from "../_components/contact-ai-qualification-panel"
import { getContactDetailsContext } from "../_lib/contact-details"
import { getTenantMembershipContext } from "../../../_lib/tenant-session"
import { api } from "@/lib/api"
import { defaultAiHelperIdentity, type AiHelperIdentity } from "@/lib/ai-helper"

export default async function ContactAiQualificationPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
}) {
  const { tenantSlug, contactId } = await params
  const { cookie, tenantId } = await getTenantMembershipContext(tenantSlug)
  const [details, identity] = await Promise.all([
    getContactDetailsContext(tenantSlug, contactId),
    api.get<{ helper: AiHelperIdentity }>(`/api/services/${tenantId}/fit-scan/helper`, {
      headers: { cookie },
    }).catch(() => null),
  ])
  const helper = identity?.data.helper ?? defaultAiHelperIdentity
  const { contact, currentUserId, tenantTimezone, membershipRole, membershipSecurityLevel } = details

  return (
    <ContactAiQualificationPanel
      key={contactId}
      tenantId={tenantId}
      tenantSlug={tenantSlug}
      contactId={contactId}
      contactName={contact.fullName}
      initialHelper={helper}
      canStartService={membershipRole === "TENANT_ADMIN" || membershipSecurityLevel !== "LOW"}
      bookingContext={{ currentUserId, tenantTimezone, contact: { id: contactId, fullName: contact.fullName, phoneNumber: contact.phoneNumber, email: contact.email } }}
    />
  )
}
