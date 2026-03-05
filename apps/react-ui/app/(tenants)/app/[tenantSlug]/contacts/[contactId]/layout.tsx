import Link from "next/link"
import { ArrowLeft, ChevronDown } from "lucide-react"

import { formatPhoneNumber } from "@/lib/format-phone-number"
import { ContactBreadcrumbSync } from "./_components/contact-breadcrumb-sync"
import { ContactDetailTabs } from "./_components/contact-detail-tabs"
import { ContactRelationshipsSection } from "./_components/contact-relationships-section"
import { ContactTagsSection } from "./_components/contact-tags-section"
import {
  formatContactDate,
  formatContactDateTime,
  getContactDetailsContext,
} from "./_lib/contact-details"

export default async function ContactDetailsLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ tenantSlug: string; contactId: string }>
}>) {
  const { tenantSlug, contactId } = await params
  const { tenantId, contact, canManageContactTags } = await getContactDetailsContext(
    tenantSlug,
    contactId,
  )

  const addressLine = [
    contact.address.addressLine1,
    contact.address.addressLine2,
    contact.address.city,
    contact.address.state,
    contact.address.postalCode,
    contact.address.country,
  ]
    .filter(Boolean)
    .join(", ")
  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <ContactBreadcrumbSync label={contact.fullName} />
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="self-start rounded-2xl border border-slate-200/70 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_45%,#fff7ed_100%)] p-5 md:p-6 lg:sticky lg:top-20">
          <div className="flex h-full flex-col gap-6">
            <div className="space-y-5">
              <div className="border-b border-slate-100 pb-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/app/${tenantSlug}/contacts`}
                        aria-label="Back to contacts"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </Link>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Contact
                      </p>
                    </div>
                    <span
                      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm"
                      style={
                        contact.statusBgColor && contact.statusTextColor
                          ? {
                              backgroundColor: contact.statusBgColor,
                              color: contact.statusTextColor,
                            }
                          : undefined
                      }
                    >
                      {contact.status}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xl font-semibold tracking-tight text-slate-950">
                      {contact.fullName}
                    </p>
                    <p className="text-sm text-slate-500">
                      Overview and relationship context
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Primary Details
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Email
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900 break-words">
                      {contact.email ?? "—"}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Phone
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {formatPhoneNumber(contact.phoneNumber)}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Date of Birth
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      {formatContactDate(contact.dateOfBirth)}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Address
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-900">
                      {addressLine || "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              <div className="space-y-1 pb-1">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Supporting Sections
                </p>
              </div>

              <ContactRelationshipsSection
                tenantId={tenantId}
                tenantSlug={tenantSlug}
                contactId={contactId}
                initialRelationships={contact.relationships}
              />

              <ContactTagsSection
                tenantId={tenantId}
                contactId={contactId}
                initialTags={contact.tags}
                canManageTags={canManageContactTags}
              />

              <details className="group rounded-lg py-1">
                <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-2 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-50">
                  <span className="flex items-center gap-2">
                    <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
                    Follow Ups
                  </span>
                </summary>
                <p className="mt-1 pl-8 text-sm leading-6 text-slate-500">
                  No follow-up activity available yet.
                </p>
              </details>
            </div>

            <div className="mt-auto flex flex-col gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500">
              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="uppercase tracking-wide text-slate-400">
                    Created
                  </span>
                  <span>{formatContactDateTime(contact.createdAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="uppercase tracking-wide text-slate-400">
                    Updated
                  </span>
                  <span>{formatContactDateTime(contact.updatedAt)}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="space-y-3 border-b border-slate-100 pb-4">
            <ContactDetailTabs tenantSlug={tenantSlug} contactId={contactId} />
          </div>
          <div className="min-h-0 flex-1 pt-5">{children}</div>
        </div>
      </div>
    </section>
  )
}
