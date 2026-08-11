"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Briefcase,
  Calendar,
  Clock3,
  Contact2,
  ListTodo,
  NotebookPen,
  Sparkles,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

type ContactDetailNavigationProps = {
  tenantSlug: string
  contactId: string
}

type ContactDetailSection = {
  key: string
  label: string
  icon: LucideIcon
}

const CONTACT_SECTIONS: ContactDetailSection[] = [
  { key: "overview", label: "Overview", icon: Contact2 },
  { key: "opportunities", label: "Opportunities", icon: Target },
  { key: "notes", label: "Notes", icon: NotebookPen },
  { key: "appointments", label: "Appointments", icon: Calendar },
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "services", label: "Services", icon: Briefcase },
  { key: "ai-qualification", label: "AI Qualification", icon: Sparkles },
  { key: "follow-ups", label: "Follow-Ups", icon: Clock3 },
  { key: "relationships", label: "Relationships", icon: Users },
]

export function ContactDetailNavigation({
  tenantSlug,
  contactId,
}: ContactDetailNavigationProps) {
  const pathname = usePathname() ?? ""
  const router = useRouter()
  const baseHref = `/app/${tenantSlug}/contacts/${contactId}`
  const activeSection =
    CONTACT_SECTIONS.find(({ key }) => {
      const href = `${baseHref}/${key}`
      return pathname === href || pathname.startsWith(`${href}/`)
    }) ?? CONTACT_SECTIONS[0]
  const handleMobileSectionChange = (key: string) => {
    if (key === activeSection.key) return
    router.push(`${baseHref}/${key}`)
  }

  return (
    <>
      <nav
        aria-label="Contact detail sections"
        className="rounded-t-2xl border-b border-blue-100 bg-[#f1f7ff] p-4 md:p-5 lg:hidden"
      >
        <div className="flex flex-col gap-2">
          <p
            id="contact-section-select-label"
            className="text-xs font-semibold uppercase tracking-wider text-slate-400"
          >
            Contact record
          </p>
          <Select
            value={activeSection.key}
            onValueChange={handleMobileSectionChange}
          >
            <SelectTrigger
              className="h-10 w-full border-white/80 bg-white/85 text-slate-700 shadow-sm focus-visible:border-slate-300 focus-visible:ring-slate-200/70 [&_svg]:text-slate-500"
              aria-labelledby="contact-section-select-label"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Contact sections</SelectLabel>
                {CONTACT_SECTIONS.map((section) => {
                  const Icon = section.icon

                  return (
                    <SelectItem key={section.key} value={section.key}>
                      <Icon aria-hidden="true" />
                      <span>{section.label}</span>
                    </SelectItem>
                  )
                })}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </nav>

      <aside className="hidden w-56 shrink-0 rounded-l-2xl bg-[#f1f7ff] text-slate-700 lg:block">
        <nav
          aria-label="Contact detail sections"
          className="sticky top-20 px-2 py-2"
        >
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Contact record
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {CONTACT_SECTIONS.map((section) => {
                  const Icon = section.icon
                  const href = `${baseHref}/${section.key}`
                  const isActive = activeSection.key === section.key

                  return (
                    <SidebarMenuItem key={section.key}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        className="h-10 text-sm font-semibold text-slate-600 hover:bg-blue-100/70 hover:text-slate-950 data-[active=true]:bg-blue-950 data-[active=true]:text-white data-[active=true]:shadow-sm data-[active=true]:hover:bg-blue-900"
                      >
                        <Link
                          href={href}
                          aria-current={isActive ? "page" : undefined}
                        >
                          <Icon aria-hidden="true" className="opacity-95" />
                          <span>{section.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </aside>
    </>
  )
}
