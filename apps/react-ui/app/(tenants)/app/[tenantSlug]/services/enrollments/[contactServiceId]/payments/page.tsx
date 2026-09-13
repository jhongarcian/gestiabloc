import { permanentRedirect } from "next/navigation"

import { appendSearchParams, getServiceEnrollmentHref } from "@/lib/routes"

export default async function LegacyServiceEnrollmentPaymentsPage({
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
      getServiceEnrollmentHref({
        tenantSlug,
        contactServiceId,
        view: "transaction",
      }),
      resolvedSearchParams,
    ),
  )
}
