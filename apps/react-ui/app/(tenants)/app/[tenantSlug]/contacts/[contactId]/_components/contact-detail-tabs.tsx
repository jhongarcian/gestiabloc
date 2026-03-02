"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

type ContactDetailTabsProps = {
  tenantSlug: string
  contactId: string
}

const TABS = [{ key: "overview", label: "Overview" }] as const

export function ContactDetailTabs({
  tenantSlug,
  contactId,
}: ContactDetailTabsProps) {
  const pathname = usePathname() ?? ""

  return (
    <nav aria-label="Contact detail sections" className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((tab) => {
          const href = `/app/${tenantSlug}/contacts/${contactId}/${tab.key}`
          const isActive = pathname === href || pathname.startsWith(`${href}/`)

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
