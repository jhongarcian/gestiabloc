import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { isAxiosError } from "axios"
import { StickyNote } from "lucide-react"

import { api } from "@/lib/api"
import { getTenantMembershipContext } from "../../../_lib/tenant-session"
import { ContactNotesPanel } from "./_components/contact-notes-panel"

type ContactNotesResponse = {
  ok: boolean
  items: Array<{
    id: string
    title: string
    body: string
    createdAt: string
    updatedAt: string
    author: {
      id: string
      name: string
      email: string
    }
    permissions: {
      canEdit: boolean
      canDelete: boolean
    }
    source: {
      type: "CONTACT" | "SERVICE"
      contactServiceId?: string
      serviceName?: string
    }
    attachments: Array<{
      id: string
      fileId: string
      key: string
      fileName: string
      contentType: string
      size: number | null
    }>
  }>
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export default async function ContactNotesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
}) {
  const { tenantSlug, contactId } = await params
  const { cookie, membership, tenantId } = await getTenantMembershipContext(tenantSlug)
  const requestCookie = (await headers()).get("cookie") ?? cookie
  let initialData: Pick<ContactNotesResponse, "items" | "pagination"> = {
    items: [],
    pagination: {
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 1,
    },
  }

  try {
    const { data } = await api.get<ContactNotesResponse>(
      `/api/contacts/${tenantId}/${contactId}/notes`,
      {
        headers: { cookie: requestCookie },
      },
    )
    initialData = {
      items: data.items,
      pagination: data.pagination,
    }
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) {
      notFound()
    }
    throw error
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Contact Notes
            </p>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
                Notes and attachments
              </h1>
              <p className="text-sm text-slate-600">
                Keep context, uploads, and activity notes attached to this contact in one place.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm md:self-center">
            <span className="inline-flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-slate-500" />
              <span className="font-semibold text-slate-950">
                {initialData.pagination.total}
              </span>{" "}
              notes
            </span>
          </div>
        </div>
      </div>

      <ContactNotesPanel
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        contactId={contactId}
        currentUserRole={membership.role}
        initialData={initialData}
      />
    </section>
  )
}
