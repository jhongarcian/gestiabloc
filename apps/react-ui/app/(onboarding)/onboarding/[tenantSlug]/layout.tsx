import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api, type MeResponse, type OnboardingResponse } from "@/lib/api"

import { OnboardingProvider } from "./_components/onboarding-provider"
import { OnboardingShell } from "./_components/onboarding-shell"

export const metadata: Metadata = {
  title: "Workspace setup",
  description: "Prepare your Gestiabloc workspace for your team.",
}

export default async function OnboardingLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}>) {
  const { tenantSlug } = await params
  const cookie = (await headers()).get("cookie") ?? ""

  let user: MeResponse["user"] | null = null
  try {
    const { data } = await api.get<MeResponse>("/api/auth/me", {
      headers: { cookie },
    })
    user = data.user
  } catch {
    user = null
  }

  if (!user) redirect("/login")

  const membership = user.memberships.find(
    (item) => item.tenant.slug === tenantSlug,
  )
  if (!membership) {
    const fallbackSlug = user.memberships[0]?.tenant.slug
    redirect(fallbackSlug ? `/app/${fallbackSlug}` : "/login")
  }
  if (membership.role !== "TENANT_ADMIN" || membership.status !== "ACTIVE") {
    redirect(`/app/${tenantSlug}`)
  }

  let initialData: OnboardingResponse
  try {
    const { data } = await api.get<OnboardingResponse>(
      `/api/onboarding/${membership.tenant.id}`,
      { headers: { cookie } },
    )
    initialData = data
  } catch {
    throw new Error("Could not load workspace setup.")
  }

  return (
    <OnboardingProvider
      initialData={initialData}
      tenantSlug={tenantSlug}
      adminName={user.name}
    >
      <OnboardingShell>{children}</OnboardingShell>
    </OnboardingProvider>
  )
}
