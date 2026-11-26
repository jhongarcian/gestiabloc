"use client"

import Link from "next/link"
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock3,
  Mail,
  MapPin,
  Phone,
  ShoppingBag,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"

import { StackedAvatarGroup, type StackedAvatarGroupItem } from "@/components/stacked-avatar-group"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { LabeledProgress } from "@/components/ui/labeled-progress"
import { formatPhoneNumber } from "@/lib/format-phone-number"
import { getServiceEnrollmentFollowUpHref, getServiceEnrollmentHref } from "@/lib/routes"
import { cn } from "@/lib/utils"
import type { ContactDetailsResponse } from "../_lib/contact-details"

export type ContactSidebarFollowUp = {
  id: string
  name: string
  completed: number
  total: number
  percentage: number
  currentStepTitle: string | null
  currentStepDueAt: string | null
  currentStepIsScheduled: boolean
  isOverdue: boolean
  collaborators: StackedAvatarGroupItem[]
}

type Contact = ContactDetailsResponse["contact"]
type ContactSupportingSidebarProps = {
  tenantSlug: string
  contactId: string
  tenantTimezone: string | null
  contact: Pick<Contact, "email" | "phoneNumber" | "secondaryPhoneNumber" | "address" | "mailingAddress" | "tags" | "relationships">
  dateOfBirthLabel: string
  services: Array<{ id: string; name: string; status: string }> | null
  followUpServices: ContactSidebarFollowUp[]
}

const SERVICE_STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: "In progress",
  PENDING_PAYMENT: "Pending payment",
  COMPLETED: "Completed",
  CANCELED: "Canceled",
}

function SidebarSection({
  title,
  icon: Icon,
  children,
  collapsible = true,
}: {
  title: string
  icon: LucideIcon
  children: ReactNode
  collapsible?: boolean
}) {
  const [open, setOpen] = useState(true)

  if (!collapsible) {
    return (
      <section className="flex min-w-0 flex-col gap-3 px-4 py-5">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900">
          <Icon className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
          {title}
        </h2>
        {children}
      </section>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section className="min-w-0 px-4 py-5">
        <h2>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" className="w-full justify-between gap-2 px-0">
              <span className="flex min-w-0 items-center gap-2">
                <Icon data-icon="inline-start" aria-hidden="true" />
                {title}
              </span>
              <ChevronDown
                data-icon="inline-end"
                aria-hidden="true"
                className={cn("shrink-0 transition-transform", open && "rotate-180")}
              />
            </Button>
          </CollapsibleTrigger>
        </h2>
        <CollapsibleContent>
          <div className="flex min-w-0 flex-col gap-3 pt-3">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

function ContactInfoRow({
  label,
  icon: Icon,
  children,
}: {
  label: string
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-slate-500">{label}</dt>
        <dd className="mt-0.5 text-sm leading-5 text-slate-800 [overflow-wrap:anywhere]">{children}</dd>
      </div>
    </div>
  )
}

function AddressLines({ address }: { address: Contact["address"] }) {
  const locality = [address.city, address.state, address.postalCode].filter(Boolean).join(" ")
  return (
    <>
      {[address.addressLine1, address.addressLine2, locality, address.country].filter(Boolean).map((line, index) => (
        <span key={index} className="block">{line}</span>
      ))}
    </>
  )
}

export function ContactSupportingSidebar({
  tenantSlug,
  contactId,
  tenantTimezone,
  contact,
  dateOfBirthLabel,
  services,
  followUpServices,
}: ContactSupportingSidebarProps) {
  const baseHref = `/app/${tenantSlug}/contacts/${contactId}`
  const tags = [...contact.tags].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  const relationships = [...contact.relationships].sort(
    (a, b) => a.relationshipLabel.localeCompare(b.relationshipLabel) || a.relatedContact.fullName.localeCompare(b.relatedContact.fullName),
  )
  const hasAddress = Object.values(contact.address).some(Boolean)
  const hasMailingAddress = Object.values(contact.mailingAddress).some(Boolean)

  const formatDueDate = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return "Unknown date"
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: tenantTimezone?.trim() || "America/Chicago",
    }).format(date)
  }

  return (
    <aside
      aria-label="Contact summary"
      className="order-first min-w-0 border-b border-slate-200/80 bg-[linear-gradient(160deg,#f8fafc_0%,#f1f6fd_55%,#fffaf5_100%)] xl:order-last xl:w-72 xl:shrink-0 xl:border-b-0 xl:border-l 2xl:w-80"
    >
      <div className="divide-y divide-slate-200/70 xl:sticky xl:top-[calc(var(--tenant-shell-header-height)+57px)] xl:max-h-[calc(100dvh-var(--tenant-shell-header-height)-57px)] xl:overflow-y-auto xl:overscroll-contain">
        <SidebarSection title="Contact info" icon={UserRound} collapsible={false}>
          <dl className="flex flex-col gap-3">
            <ContactInfoRow label="Email" icon={Mail}>
              {contact.email || "Not provided"}
            </ContactInfoRow>
            <ContactInfoRow label="Phone" icon={Phone}>
              {contact.phoneNumber ? formatPhoneNumber(contact.phoneNumber) : "Not provided"}
            </ContactInfoRow>
            {contact.secondaryPhoneNumber ? (
              <ContactInfoRow label="Secondary phone" icon={Phone}>
                {formatPhoneNumber(contact.secondaryPhoneNumber)}
              </ContactInfoRow>
            ) : null}
            <ContactInfoRow label="Date of birth" icon={CalendarDays}>
              {dateOfBirthLabel === "—" ? "Not provided" : dateOfBirthLabel}
            </ContactInfoRow>
            {hasAddress ? <ContactInfoRow label="Address" icon={MapPin}><AddressLines address={contact.address} /></ContactInfoRow> : null}
            {hasMailingAddress ? <ContactInfoRow label="Mailing address" icon={MapPin}><AddressLines address={contact.mailingAddress} /></ContactInfoRow> : null}
          </dl>
          {tags.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-slate-500">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Badge key={tag.id} className="max-w-full" style={{ backgroundColor: tag.bgColor, color: tag.textColor }}>
                    <span className="truncate">{tag.name}</span>
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </SidebarSection>

        <SidebarSection title="Services" icon={ShoppingBag}>
          {services === null ? (
            <p role="status" className="text-xs leading-5 text-slate-500">Service information is currently unavailable.</p>
          ) : services.length === 0 ? (
            <p className="text-xs leading-5 text-slate-500">No services yet. <Link href={`${baseHref}/services?create=1`} className="font-medium text-blue-950 underline underline-offset-4">Add a service</Link></p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-2">
              {services.slice(0, 4).map((service) => (
                <li key={service.id} className="min-w-0">
                  <Link href={getServiceEnrollmentHref({ tenantSlug, contactServiceId: service.id })} className="group flex min-w-0 items-start justify-between gap-2 rounded-xl border border-white/80 bg-white/80 p-3 shadow-sm transition-colors hover:border-blue-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <p className="text-sm font-medium leading-5 text-slate-900 [overflow-wrap:anywhere]">{service.name}</p>
                      <Badge variant="secondary">{SERVICE_STATUS_LABELS[service.status] ?? service.status}</Badge>
                    </div>
                    <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {services && services.length > 4 ? <Link href={`${baseHref}/services`} className="text-xs font-medium text-blue-950 hover:underline">View all {services.length} services</Link> : null}
        </SidebarSection>

        <SidebarSection title="Relationships" icon={Users}>
          {relationships.length === 0 ? (
            <p className="text-xs leading-5 text-slate-500">No relationships yet. <Link href={`${baseHref}/relationships`} className="font-medium text-blue-950 underline underline-offset-4">Add a relationship</Link></p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-2.5">
              {relationships.slice(0, 4).map((relationship) => (
                <li key={relationship.id} className="min-w-0">
                  <Link href={`/app/${tenantSlug}/contacts/${relationship.relatedContact.id}/overview`} className="group flex min-w-0 items-center justify-between gap-2 rounded-lg px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500">{relationship.relationshipLabel}</p>
                      <p className="mt-0.5 text-sm font-medium text-slate-800 group-hover:text-blue-950 group-hover:underline [overflow-wrap:anywhere]">{relationship.relatedContact.fullName}</p>
                    </div>
                    <ChevronRight className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {relationships.length > 4 ? <Link href={`${baseHref}/relationships`} className="text-xs font-medium text-blue-950 hover:underline">View all {relationships.length} relationships</Link> : null}
        </SidebarSection>

        <SidebarSection title="Service follow-ups" icon={Clock3}>
          {services === null ? (
            <p role="status" className="text-xs leading-5 text-slate-500">Follow-up information is currently unavailable.</p>
          ) : followUpServices.length === 0 ? (
            <p className="text-xs leading-5 text-slate-500">No active service follow-ups.</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-3">
              {followUpServices.slice(0, 4).map((service) => (
                <li key={service.id} className="min-w-0">
                  <Link href={getServiceEnrollmentFollowUpHref({ tenantSlug, contactServiceId: service.id })} className={cn("flex min-w-0 flex-col gap-2.5 rounded-xl border bg-white/80 p-3 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", service.isOverdue ? "border-rose-200 hover:border-rose-300" : "border-white/80 hover:border-blue-200")}>
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <p className="min-w-0 text-sm font-medium leading-5 text-slate-900 [overflow-wrap:anywhere]">{service.name}</p>
                      {service.collaborators.length > 0 ? <StackedAvatarGroup items={service.collaborators} avatarSize="sm" maxVisible={2} className="shrink-0 pl-0" /> : null}
                    </div>
                    {service.currentStepTitle ? <p className="text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">{service.currentStepTitle}</p> : null}
                    <LabeledProgress
                      value={service.percentage}
                      size="compact"
                      ariaLabel={`${service.name} follow-up progress`}
                      ariaValueText={`${service.percentage}% complete, ${service.completed} of ${service.total} steps`}
                      summaryLabel={`${service.completed} of ${service.total} steps`}
                    />
                    <p className={cn("text-xs", service.isOverdue ? "font-medium text-rose-700" : "text-slate-500")}>
                      {service.currentStepDueAt
                        ? `${service.isOverdue ? "Past due" : service.currentStepIsScheduled ? "Scheduled" : "Due"} ${formatDueDate(service.currentStepDueAt)}`
                        : "No due date"}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {followUpServices.length > 4 ? <Link href={`${baseHref}/follow-ups`} className="text-xs font-medium text-blue-950 hover:underline">View all {followUpServices.length} service follow-ups</Link> : null}
        </SidebarSection>
      </div>
    </aside>
  )
}
