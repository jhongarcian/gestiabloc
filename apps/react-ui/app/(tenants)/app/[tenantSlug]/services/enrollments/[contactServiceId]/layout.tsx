import { Suspense } from "react"
import { redirect } from "next/navigation"

import { getTenantMembershipContext } from "../../../_lib/tenant-session"
import { ServiceEnrollmentWorkspace } from "./_components/service-enrollment-workspace"

export default async function ServiceEnrollmentLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ tenantSlug: string; contactServiceId: string }>
}>) {
  const { tenantSlug, contactServiceId } = await params
  const { membership, tenantId } = await getTenantMembershipContext(tenantSlug)

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  return (
    <>
      <Suspense
        fallback={(
          <section className="rounded-[26px] border border-slate-200 bg-white p-5 text-sm text-slate-500">
            Loading service enrollment...
          </section>
        )}
      >
        <ServiceEnrollmentWorkspace
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          contactServiceId={contactServiceId}
          membershipSecurityLevel={membership.securityLevel}
        />
      </Suspense>
      {children}
    </>
  )
}
