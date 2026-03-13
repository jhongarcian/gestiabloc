"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

type ContactDetailTabsProps = {
  tenantSlug: string
  contactId: string
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "services", label: "Services" },
  { key: "follow-ups", label: "Follow-Ups" },
  { key: "notes", label: "Notes" },
  { key: "tasks", label: "Tasks" },
] as const

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
                "inline-flex h-10 items-center rounded-xl border px-3.5 text-sm font-medium transition",
                "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900",
                isActive &&
                  "border-blue-950 bg-blue-950 text-white shadow-sm hover:border-blue-950 hover:bg-blue-950/90 hover:text-white",
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
