import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { api } from "@/lib/api"

import { AccountSettingsTabs } from "./_components/account-settings-tabs"

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

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="space-y-0.5">
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
          Account Settings
        </h1>
        <p className="max-w-2xl text-sm text-slate-500">
          Manage tenant-level configuration and administrative controls.
        </p>
      </div>

      <div className="rounded-xl  bg-white p-2 md:p-4">
        <AccountSettingsTabs tenantSlug={tenantSlug} />
      </div>

      <div className="flex min-h-0 flex-1 rounded-xl bg-white p-2 md:p-4">
        <div className="flex h-full w-full min-h-0 flex-col">{children}</div>
      </div>
    </section>
  )
}
