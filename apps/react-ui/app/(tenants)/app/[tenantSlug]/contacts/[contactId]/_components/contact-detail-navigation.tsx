"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Briefcase,
  Calendar,
  ChevronRight,
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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

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
        className="relative overflow-hidden rounded-t-2xl bg-[#f1f7ff] p-4 text-slate-900 md:p-5 lg:hidden"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-14 -bottom-20 size-48 rounded-full bg-[#60a5fa]/20 blur-3xl"
        />

        <div className="relative flex flex-col gap-2">
          <p id="contact-section-select-label" className="sr-only">
            Contact record
          </p>
          <Select
            value={activeSection.key}
            onValueChange={handleMobileSectionChange}
          >
            <SelectTrigger
              className="h-11 w-full rounded-xl border-white/90 bg-white/75 text-slate-700 shadow-sm focus-visible:border-blue-300 focus-visible:ring-blue-200/60 [&_svg]:text-blue-700"
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

      <aside className="relative hidden w-56 shrink-0 self-start overflow-hidden rounded-l-2xl bg-[#f1f7ff] text-slate-700 lg:sticky lg:top-20 lg:block">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 bottom-10 size-52 rounded-full bg-[#60a5fa]/20 blur-3xl"
        />

        <nav
          aria-label="Contact detail sections"
          className="px-3 pt-6 pb-4"
        >
          <SidebarGroup className="px-0 py-0">
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {CONTACT_SECTIONS.map((section) => {
                  const Icon = section.icon
                  const href = `${baseHref}/${section.key}`
                  const isActive = activeSection.key === section.key

                  return (
                    <SidebarMenuItem key={section.key}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        className="min-h-11 gap-3 rounded-xl px-2.5 text-sm text-slate-600 hover:bg-blue-100/70 hover:text-slate-950 focus-visible:ring-blue-500/40 data-[active=true]:bg-blue-950 data-[active=true]:font-semibold data-[active=true]:text-white data-[active=true]:hover:bg-blue-900"
                      >
                        <Link
                          href={href}
                          aria-current={isActive ? "page" : undefined}
                        >
                          <span
                            className={cn(
                              "flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                              isActive
                                ? "border-white/80 bg-white text-blue-950"
                                : "border-blue-200/80 bg-white/65 text-slate-600",
                            )}
                          >
                            <Icon className="size-3.5" aria-hidden="true" />
                          </span>
                          <span className="truncate">{section.label}</span>
                          {isActive ? (
                            <ChevronRight
                              className="ml-auto size-4 text-blue-200"
                              aria-hidden="true"
                            />
                          ) : null}
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
