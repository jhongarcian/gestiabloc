import { headers } from "next/headers"

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
  const { tenantId, contact } = await getContactDetailsContext(tenantSlug, contactId)
  const cookie = (await headers()).get("cookie") ?? ""

  let statusOptions: Array<{ label: string; value: string }> = []

  try {
    const { data } = await api.get<ContactStatusesResponse>(
      `/api/contacts/${tenantId}/statuses`,
      {
        headers: { cookie },
      },
    )

    statusOptions = data.items.map((status) => ({
      label: status.name,
      value: status.id,
    }))
  } catch {
    statusOptions = []
  }

  return (
    <ContactOverviewForm
      tenantId={tenantId}
      contactId={contactId}
      initialContact={contact}
      statusOptions={statusOptions}
    />
  )
}
