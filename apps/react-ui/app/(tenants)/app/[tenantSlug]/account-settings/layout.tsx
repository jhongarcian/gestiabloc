import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api } from "@/lib/api"

import { AccountSettingsLayoutShell } from "./_components/account-settings-layout-shell"

export default async function AccountSettingsLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}>) {
  const { tenantSlug } = await params

  let user: {
    memberships?: Array<{
      role: string
      status: string
      securityLevel?: "LOW" | "MEDIUM" | "MAX"
      tenant: { slug: string }
    }>
  } | null = null

  try {
    const cookie = (await headers()).get("cookie") ?? ""
    const { data } = await api.get("/api/auth/me", {
      headers: { cookie },
    })
    user = data?.user ?? null
  } catch {
    redirect("/login")
  }

  if (!user?.memberships?.length) {
    redirect("/login")
  }

  const membership = user.memberships.find(
    (item) => item.tenant?.slug === tenantSlug,
  )

  if (!membership) {
    redirect(`/app/${user.memberships[0].tenant.slug}`)
  }

  const isAllowed =
    membership.role === "TENANT_ADMIN" && membership.status === "ACTIVE"

  if (!isAllowed) {
    redirect(`/app/${tenantSlug}`)
  }

  return <AccountSettingsLayoutShell tenantSlug={tenantSlug}>{children}</AccountSettingsLayoutShell>
}
