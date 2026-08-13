import { redirect } from "next/navigation"

export default async function OnboardingIndexPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  redirect(`/onboarding/${tenantSlug}/welcome`)
}
