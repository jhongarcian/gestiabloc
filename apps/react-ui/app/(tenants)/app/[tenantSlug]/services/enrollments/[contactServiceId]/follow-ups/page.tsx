import { permanentRedirect } from "next/navigation"

import { getServiceEnrollmentFollowUpsHref } from "@/lib/routes"

export default async function ServiceEnrollmentFollowUpsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; contactServiceId: string }>
  searchParams?: Promise<{ returnTo?: string | string[] }>
}) {
  const { tenantSlug, contactServiceId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const rawReturnTo = resolvedSearchParams?.returnTo
  const returnTo = Array.isArray(rawReturnTo) ? rawReturnTo[0] : rawReturnTo

  permanentRedirect(
    getServiceEnrollmentFollowUpsHref({
      tenantSlug,
      contactServiceId,
      returnTo,
    }),
  )
}
