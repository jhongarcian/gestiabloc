import { permanentRedirect } from "next/navigation"

import { appendSearchParams, getServiceFollowUpsHref } from "@/lib/routes"

export default async function LegacyFollowUpsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  permanentRedirect(
    appendSearchParams(getServiceFollowUpsHref(tenantSlug), await searchParams),
  )
}
