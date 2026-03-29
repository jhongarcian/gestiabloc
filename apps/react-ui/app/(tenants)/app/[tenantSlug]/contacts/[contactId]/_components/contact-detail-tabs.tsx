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
  { key: "relationships", label: "Relationships" },
] as const

export function ContactDetailTabs({
  tenantSlug,
  contactId,
}: ContactDetailTabsProps) {
  const pathname = usePathname() ?? ""

  return (
    <nav aria-label="Contact detail sections" className="w-full">
      <div className="overflow-x-auto">
        <div className="inline-flex min-w-full items-end gap-1 border-b border-slate-200 px-1">
        {TABS.map((tab) => {
          const href = `/app/${tenantSlug}/contacts/${contactId}/${tab.key}`
          const isActive = pathname === href || pathname.startsWith(`${href}/`)

          return (
            <Link
              key={tab.key}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex h-10 shrink-0 items-center rounded-t-[18px] border border-transparent px-4 text-sm font-medium transition",
                "bg-transparent text-slate-500 hover:text-slate-900",
                isActive &&
                  "-mb-px h-11 border-blue-200 border-b-white bg-white text-blue-950 shadow-[0_-1px_0_rgba(255,255,255,0.85),0_8px_16px_rgba(15,23,42,0.06)] hover:border-blue-200 hover:border-b-white hover:bg-white hover:text-blue-950",
              )}
            >
              {tab.label}
            </Link>
          )
        })}
        </div>
      </div>
    </nav>
  )
}
