import { Suspense } from "react"
import { redirect } from "next/navigation"

import { getTenantMembershipContext } from "../../_lib/tenant-session"
import { TransactionsRegister } from "./_components/transactions-register"

export default async function ServiceTransactionsPage({
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
      <Suspense fallback={<div className="min-h-[520px] rounded-[26px] border border-slate-200 bg-white" />}>
        <TransactionsRegister
          tenantId={membership.tenant.id}
          tenantSlug={tenantSlug}
          tenantTimezone={tenantTimezone}
        />
      </Suspense>
    </section>
  )
}
