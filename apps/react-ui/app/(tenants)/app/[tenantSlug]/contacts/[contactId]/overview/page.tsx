import { headers } from "next/headers"
import { FileText } from "lucide-react"

import { api } from "@/lib/api"
import { getContactDetailsContext } from "../_lib/contact-details"
import { ContactOverviewForm } from "./_components/contact-overview-form"

type ContactStatusesResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
  }>
}

export default async function ContactOverviewPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
}) {
  const { tenantSlug, contactId } = await params
  const {
    tenantId,
    contact,
    currentUserId,
    membershipSecurityLevel,
    canApproveSensitiveFieldAccess,
    canManageContactTags,
  } = await getContactDetailsContext(tenantSlug, contactId)
  const cookie = (await headers()).get("cookie") ?? ""

  let statusOptions: Array<{ label: string; value: string }> = []

  try {
    const statusesResponse = await api.get<ContactStatusesResponse>(
      `/api/contacts/${tenantId}/statuses`,
      {
        headers: { cookie },
      },
    )

    statusOptions = statusesResponse.data.items.map((status) => ({
      label: status.name,
      value: status.id,
    }))
  } catch {
    statusOptions = []
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Contact Overview
            </p>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
                Profile details
              </h1>
              <p className="text-sm text-slate-600">
                Review and update the main profile details and custom fields for this contact.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm md:self-center">
            <span className="inline-flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-500" />
              <span className="font-semibold text-slate-950">
                {contact.customFields.length}
              </span>{" "}
              custom fields
            </span>
          </div>
        </div>
      </div>

      <ContactOverviewForm
        tenantId={tenantId}
        contactId={contactId}
        currentUserId={currentUserId}
        membershipSecurityLevel={membershipSecurityLevel}
        canApproveSensitiveFieldAccess={canApproveSensitiveFieldAccess}
        canManageTags={canManageContactTags}
        initialContact={contact}
        statusOptions={statusOptions}
      />
    </section>
  )
}
