import { permanentRedirect } from "next/navigation"

import { appendSearchParams, getServiceTransactionsHref } from "@/lib/routes"

export default async function LegacyBillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenantSlug } = await params
  permanentRedirect(
    appendSearchParams(getServiceTransactionsHref(tenantSlug), await searchParams),
  )
}
