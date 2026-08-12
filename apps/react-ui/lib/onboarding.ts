import type { MeResponse, OnboardingStep } from "@/lib/api"

export const ONBOARDING_STEPS: Array<{
  key: OnboardingStep
  label: string
  eyebrow: string
}> = [
  { key: "welcome", label: "Welcome", eyebrow: "01" },
  { key: "business-profile", label: "Business profile", eyebrow: "02" },
  { key: "workflow", label: "Workflow", eyebrow: "03" },
  { key: "ready", label: "Ready", eyebrow: "04" },
]

export function getOnboardingPath(tenantSlug: string, step: string) {
  const validStep = ONBOARDING_STEPS.some((item) => item.key === step)
    ? step
    : "welcome"
  return `/onboarding/${tenantSlug}/${validStep}`
}

export function getTenantEntryPath(
  membership: MeResponse["user"]["memberships"][number],
) {
  const tenant = membership.tenant
  const shouldOnboard =
    membership.role === "TENANT_ADMIN" &&
    (tenant.onboardingStatus === "NOT_STARTED" ||
      tenant.onboardingStatus === "IN_PROGRESS")

  return shouldOnboard
    ? getOnboardingPath(
        tenant.slug,
        tenant.onboardingCurrentStep ?? "welcome",
      )
    : `/app/${tenant.slug}`
}
