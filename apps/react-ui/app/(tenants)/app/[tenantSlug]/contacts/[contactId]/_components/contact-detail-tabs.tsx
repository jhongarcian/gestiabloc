"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Sparkles, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

type ContactDetailTabsProps = {
  tenantSlug: string
  contactId: string
}

type ContactDetailTab = {
  key: string
  label: string
  icon?: LucideIcon
}

const TABS: ContactDetailTab[] = [
  { key: "overview", label: "Overview" },
  { key: "notes", label: "Notes" },
  { key: "appointments", label: "Appointments" },
  { key: "tasks", label: "Tasks" },
  { key: "services", label: "Services" },
  { key: "ai-qualification", label: "AI Qualification", icon: Sparkles },
  { key: "follow-ups", label: "Follow-Ups" },
  { key: "relationships", label: "Relationships" },
]

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
                "inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition",
                "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900",
                isActive &&
                  "border-blue-950 bg-blue-950 text-white shadow-sm hover:border-blue-950 hover:bg-blue-950/90 hover:text-white",
              )}
            >
              {tab.icon ? <tab.icon className="h-4 w-4" /> : null}
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
