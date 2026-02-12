import { redirect } from "next/navigation"
import { headers } from "next/headers"

import { api } from "@/lib/api"
import { TenantShell } from "./_components/tenant-shell"

export default async function TenantLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}>) {
  let user: {
    id: string
    name: string
    email: string
    image?: string | null
    platformRole?: string | null
    emailVerified: boolean
    createdAt?: string
    updatedAt?: string
    memberships?: Array<{
      role: string
      status: string
      securityLevel?: "LOW" | "MEDIUM" | "MAX"
      tenant: { id: string; slug: string; name: string }
    }>
  } | null = null

  try {
    const cookie = (await headers()).get("cookie") ?? ""
    const { data } = await api.get("/api/auth/me", {
      headers: { cookie },
    })
    if (!data?.user?.id) {
      redirect("/login")
    }
    user = data.user
  } catch {
    redirect("/login")
  }

  if (!user) {
    redirect("/login")
  }

  const { tenantSlug: slug } = await params

  const membership =
    user.memberships?.find((item) => item.tenant?.slug === slug) ??
    user.memberships?.[0]
  const role = membership?.role ?? null

  if (!membership?.tenant?.slug) {
    redirect("/login")
  }

  if (!slug || slug !== membership.tenant.slug) {
    redirect(`/app/${membership.tenant.slug}`)
  }

  return (
    <TenantShell
      tenantSlug={slug}
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        role,
        image: user.image ?? null,
        platformRole: user.platformRole ?? null,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        memberships: user.memberships ?? [],
      }}
    >
      {children}
    </TenantShell>
  )
}
