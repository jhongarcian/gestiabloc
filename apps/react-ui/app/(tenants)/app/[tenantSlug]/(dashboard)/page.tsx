import { getOnboarding, type OnboardingResponse } from "@/lib/api"
import { redirect } from "next/navigation"
import { getOnboardingPath } from "@/lib/onboarding"

import { getTenantMembershipContext } from "../_lib/tenant-session"
import { DashboardOnboardingChecklist } from "./_components/dashboard-onboarding-checklist"

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { cookie, user, membership, tenantId } =
    await getTenantMembershipContext(tenantSlug)

  if (
    membership.role === "TENANT_ADMIN" &&
    (membership.tenant.onboardingStatus === "NOT_STARTED" ||
      membership.tenant.onboardingStatus === "IN_PROGRESS")
  ) {
    redirect(
      getOnboardingPath(
        tenantSlug,
        membership.tenant.onboardingCurrentStep ?? "welcome",
      ),
    )
  }

  let onboarding: OnboardingResponse | null = null
  if (
    membership.role === "TENANT_ADMIN" &&
    membership.tenant.onboardingStatus === "SKIPPED"
  ) {
    try {
      onboarding = await getOnboarding(tenantId, cookie)
    } catch {
      onboarding = null
    }
  }

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white px-5 py-5 sm:px-7">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
          {membership.tenant.name}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
          Welcome back, {user.name.trim().split(/\s+/)[0]}.
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Your workspace is ready for today&apos;s contacts, tasks, services, and
          follow-ups.
        </p>
      </header>

      {onboarding ? (
        <DashboardOnboardingChecklist
          initialData={onboarding}
          tenantSlug={tenantSlug}
        />
      ) : null}
    </div>
  )
}
