import { permanentRedirect } from "next/navigation"

import { getContactServicesHref, getServiceEnrollmentHref } from "@/lib/routes"

export default async function ContactServiceDetailsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contactId: string; contactServiceId: string }>
}) {
  const { tenantSlug, contactId, contactServiceId } = await params

  permanentRedirect(
    getServiceEnrollmentHref({
      tenantSlug,
      contactServiceId,
      returnTo: getContactServicesHref({ tenantSlug, contactId }),
    }),
  )
}
