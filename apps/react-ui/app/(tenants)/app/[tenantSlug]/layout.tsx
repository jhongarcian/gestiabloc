import { redirect } from "next/navigation"
import { headers } from "next/headers"

import { api } from "@/lib/api"
import { TenantShell } from "./_components/tenant-shell"

export default async function TenantLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: { tenantSlug: string }
}>) {
  let user: {
    name: string
    image?: string | null
    platformRole?: string | null
    memberships?: Array<{
      role: string
      tenant: { slug: string }
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

  const membership =
    user.memberships?.find((item) => item.tenant?.slug === params.tenantSlug) ??
    user.memberships?.[0]
  const role = membership?.role ?? null

  return (
    <TenantShell
      tenantSlug={params.tenantSlug}
      user={{
        name: user.name,
        role,
        image: user.image ?? null,
      }}
    >
      {children}
    </TenantShell>
  )
}
