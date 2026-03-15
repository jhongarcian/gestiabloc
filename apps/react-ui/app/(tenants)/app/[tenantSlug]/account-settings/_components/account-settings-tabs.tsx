"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

import { ACCOUNT_SETTINGS_TABS } from "../config"

type AccountSettingsTabsProps = {
  tenantSlug: string
}

export function AccountSettingsTabs({ tenantSlug }: AccountSettingsTabsProps) {
  const pathname = usePathname() ?? ""
  const isTabActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)

  return (
    <nav aria-label="Account settings sections" className="w-full">
      <div className="overflow-x-auto pb-1 md:hidden">
        <div className="inline-flex min-w-max items-center gap-2 px-1">
          {ACCOUNT_SETTINGS_TABS.map((tab) => {
            const href = `/app/${tenantSlug}/account-settings/${tab.key}`
            const isActive = isTabActive(href)

            return (
              <Link
                key={tab.key}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition",
                  "text-slate-600 hover:bg-blue-900/10 hover:text-slate-900",
                  isActive &&
                    "bg-blue-950 text-white hover:bg-blue-950/90 hover:text-white",
                )}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
      </div>

      <div className="hidden flex-wrap items-center gap-2 md:flex">
        {ACCOUNT_SETTINGS_TABS.map((tab) => {
          const href = `/app/${tenantSlug}/account-settings/${tab.key}`
          const isActive = isTabActive(href)

          return (
            <Link
              key={tab.key}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium transition",
                "text-slate-600 hover:bg-blue-900/10 hover:text-slate-900",
                isActive &&
                  "bg-blue-950 text-white hover:bg-blue-950/90 hover:text-white",
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
