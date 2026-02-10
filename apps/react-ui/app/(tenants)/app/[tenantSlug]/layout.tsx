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
  try {
    const cookie = (await headers()).get("cookie") ?? ""
    const { data } = await api.get("/api/auth/me", {
      headers: { cookie },
    })
    if (!data?.user?.id) {
      redirect("/login")
    }
  } catch {
    redirect("/login")
  }

  return (
    <TenantShell tenantSlug={params.tenantSlug}>{children}</TenantShell>
  )
}
