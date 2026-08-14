"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

type ContactDetailNavigationProps = {
  tenantSlug: string
  contactId: string
}

type ContactDetailSection = {
  key: string
  label: string
}

const CONTACT_SECTIONS: ContactDetailSection[] = [
  { key: "overview", label: "Overview" },
  { key: "opportunities", label: "Opportunities" },
  { key: "notes", label: "Notes" },
  { key: "appointments", label: "Appointments" },
  { key: "tasks", label: "Tasks" },
  { key: "services", label: "Services" },
  { key: "ai-qualification", label: "AI Qualification" },
  { key: "follow-ups", label: "Follow-Ups" },
  { key: "relationships", label: "Relationships" },
]

export function ContactDetailNavigation({
  tenantSlug,
  contactId,
}: ContactDetailNavigationProps) {
  const pathname = usePathname() ?? ""
  const baseHref = `/app/${tenantSlug}/contacts/${contactId}`

  return (
    <nav
      aria-label="Contact detail sections"
      className="relative min-w-0 shrink-0 overflow-hidden border-y border-blue-200/80 bg-[#e4efff]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -bottom-24 size-48 rounded-full bg-blue-300/20 blur-3xl"
      />

      <div className="relative overflow-x-auto px-3 py-3 [scrollbar-width:none] md:px-5 [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max items-center gap-1">
          {CONTACT_SECTIONS.map((section) => {
            const href = `${baseHref}/${section.key}`
            const isActive =
              pathname === href ||
              pathname.startsWith(`${href}/`) ||
              (section.key === "overview" && pathname === baseHref)

            return (
              <Link
                key={section.key}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#e4efff]",
                  isActive
                    ? "bg-blue-950 text-white shadow-sm hover:bg-blue-900"
                    : "text-slate-600 hover:bg-white/75 hover:text-slate-950",
                )}
              >
                {section.label}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
