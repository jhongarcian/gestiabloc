import { redirect } from "next/navigation"
import { headers } from "next/headers"

import { api } from "@/lib/api"

export default async function TenantLayout({
  children,
}: Readonly<{
  children: React.ReactNode
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

  return <>{children}</>
}
