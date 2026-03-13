import { redirect } from "next/navigation"

import { api } from "@/lib/api"
import { getTenantMembershipContext } from "../_lib/tenant-session"
import { ContactsTable } from "./_components/contacts-table"

type ContactStatusConfigResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    bgColor: string
    textColor: string
    isActive: boolean
    sortOrder: number
  }>
}

type ContactTagsFilterResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    bgColor: string
    textColor: string
    sortOrder: number
  }>
}

export default async function ContactsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { cookie, membership } = await getTenantMembershipContext(tenantSlug)

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  let statusOptions: Array<{
    label: string
    value: string
    bgColor?: string
    textColor?: string
  }> = [
    { label: "All Statuses", value: "ALL" },
  ]

  try {
    const { data } = await api.get<ContactStatusConfigResponse>(
      `/api/contacts/${membership.tenant.id}/statuses`,
      {
        headers: { cookie },
      },
    )

    statusOptions = [
      { label: "All Statuses", value: "ALL" },
      ...data.items.map((status) => ({
        label: status.name,
        value: status.id,
        bgColor: status.bgColor,
        textColor: status.textColor,
      })),
    ]
  } catch {
    // Fallback keeps the filter usable even if status lookup fails.
  }

  let tagOptions: Array<{
    label: string
    value: string
    bgColor?: string
    textColor?: string
  }> = []

  try {
    const { data } = await api.get<ContactTagsFilterResponse>(
      `/api/contacts/${membership.tenant.id}/tags`,
      {
        headers: { cookie },
      },
    )

    tagOptions = data.items.map((tag) => ({
      label: tag.name,
      value: tag.id,
      bgColor: tag.bgColor,
      textColor: tag.textColor,
    }))
  } catch {
    // Optional enhancement: contacts can still load without tag filter options.
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 rounded-xl bg-white p-2 md:p-4">
        <div className="flex h-full w-full min-h-0 flex-col">
          <ContactsTable
            tenantSlug={tenantSlug}
            tenantId={membership.tenant.id}
            statusOptions={statusOptions}
            tagOptions={tagOptions}
          />
        </div>
      </div>
    </section>
  )
}
