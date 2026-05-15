import { headers } from "next/headers"

import { api } from "@/lib/api"
import { getContactDetailsContext } from "../_lib/contact-details"
import { ContactOpportunitiesPageContent } from "./_components/contact-opportunities-content"

type ContactOpportunitiesResponse = {
  ok: boolean
  items: Array<{
    id: string
    pipelineId: string
    stageId: string
    valueCents: number
    result: "OPEN" | "WON" | "LOST"
    closedAt: string | null
    updatedAt: string
    pipeline: {
      id: string
      name: string
      color: string
    }
    stage: {
      id: string
      name: string
      sortOrder: number
    }
  }>
}

export default async function ContactOpportunitiesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
}) {
  const { tenantSlug, contactId } = await params
  const { tenantId, contact } = await getContactDetailsContext(tenantSlug, contactId)
  const cookie = (await headers()).get("cookie") ?? ""

  let opportunities: ContactOpportunitiesResponse["items"] = []

  try {
    const { data } = await api.get<ContactOpportunitiesResponse>(
      `/api/opportunities/${tenantId}/contact/${contactId}`,
      { headers: { cookie } },
    )
    opportunities = data.items
  } catch {
    opportunities = []
  }

  return (
    <ContactOpportunitiesPageContent
      tenantId={tenantId}
      tenantSlug={tenantSlug}
      contactId={contactId}
      contact={{
        id: contact.id,
        fullName: contact.fullName,
        email: contact.email,
        phoneNumber: contact.phoneNumber,
      }}
      opportunities={opportunities}
    />
  )
}
