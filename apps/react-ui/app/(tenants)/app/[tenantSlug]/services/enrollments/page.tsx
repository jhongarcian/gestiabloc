import { Suspense } from "react"
import { redirect } from "next/navigation"

import { getTenantMembershipContext } from "../../_lib/tenant-session"
import { EnrollmentsRegister } from "./_components/enrollments-register"

export default async function ServiceEnrollmentsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { membership, tenantTimezone } = await getTenantMembershipContext(tenantSlug)

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <Suspense
        fallback={(
          <div className="min-h-[520px] rounded-[26px] border border-slate-200 bg-white" />
        )}
      >
        <EnrollmentsRegister
          tenantId={membership.tenant.id}
          tenantSlug={tenantSlug}
          tenantTimezone={tenantTimezone}
        />
      </Suspense>
    </section>
  )
}
