import { redirect } from "next/navigation"

import { getTenantMembershipContext } from "../../../_lib/tenant-session"
import { ContactServiceDetailsPanel } from "./_components/contact-service-details-panel"

export default async function ServiceEnrollmentDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; contactServiceId: string }>
  searchParams?: Promise<{ returnTo?: string | string[] }>
}) {
  const { tenantSlug, contactServiceId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const { membership, tenantId } = await getTenantMembershipContext(tenantSlug)

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  const rawReturnTo = resolvedSearchParams?.returnTo
  const returnTo = Array.isArray(rawReturnTo) ? rawReturnTo[0] : rawReturnTo

  return (
    <ContactServiceDetailsPanel
      tenantId={tenantId}
      tenantSlug={tenantSlug}
      contactServiceId={contactServiceId}
      membershipSecurityLevel={membership.securityLevel}
      returnTo={returnTo ?? null}
    />
  )
}
