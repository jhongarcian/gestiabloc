"use client"

import { usePathname } from "next/navigation"
import { AccountSettingsTabs } from "./account-settings-tabs"

type AccountSettingsLayoutShellProps = {
  tenantSlug: string
  children: React.ReactNode
}

export function AccountSettingsLayoutShell({
  tenantSlug,
  children,
}: AccountSettingsLayoutShellProps) {
  const pathname = usePathname() ?? ""
  const isFollowUpBuilderRoute =
    pathname.includes(`/app/${tenantSlug}/account-settings/services/`) &&
    pathname.includes("/follow-up-templates/")

  if (isFollowUpBuilderRoute) {
    return <section className="flex h-full min-h-0 flex-col">{children}</section>
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
