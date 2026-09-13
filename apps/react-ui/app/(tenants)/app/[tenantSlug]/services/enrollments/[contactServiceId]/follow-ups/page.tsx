import { permanentRedirect } from "next/navigation"

import { appendSearchParams, getServiceEnrollmentFollowUpHref } from "@/lib/routes"

export default async function LegacyServiceEnrollmentFollowUpsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; contactServiceId: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug, contactServiceId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}

  permanentRedirect(
    appendSearchParams(
      getServiceEnrollmentFollowUpHref({ tenantSlug, contactServiceId }),
      resolvedSearchParams,
    ),
  )
}
