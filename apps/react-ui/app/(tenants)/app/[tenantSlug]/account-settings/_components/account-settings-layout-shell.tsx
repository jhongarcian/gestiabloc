"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Rocket } from "lucide-react"
import { Button } from "@/components/ui/button"
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
  const isAutomationBuilderRoute =
    pathname.includes(`/app/${tenantSlug}/account-settings/automations/`)

  if (isFollowUpBuilderRoute || isAutomationBuilderRoute) {
    return <section className="flex h-full min-h-0 flex-col">{children}</section>
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-0.5">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
            Account Settings
          </h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Manage tenant-level configuration and administrative controls.
          </p>
        </div>
        <Button asChild variant="outline" className="gap-2 self-start bg-white">
          <Link href={`/onboarding/${tenantSlug}/welcome`}>
            <Rocket className="h-4 w-4" />
            Setup guide
          </Link>
        </Button>
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
