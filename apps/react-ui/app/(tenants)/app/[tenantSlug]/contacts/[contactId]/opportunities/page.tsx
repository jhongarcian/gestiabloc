import { headers } from "next/headers"

import { api } from "@/lib/api"
import {
  type ContactOpportunitiesResponse,
  parseContactOpportunityPage,
  parseContactOpportunityPageSize,
  parseContactOpportunitySort,
} from "../_lib/contact-opportunities"
import { getContactDetailsContext } from "../_lib/contact-details"
import { ContactOpportunitiesPageContent } from "./_components/contact-opportunities-content"

type SearchParams = Record<string, string | string[] | undefined>

function getSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function ContactOpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
  searchParams: Promise<SearchParams>
}) {
  const [{ tenantSlug, contactId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ])
  const { tenantId, contact, membershipSecurityLevel } =
    await getContactDetailsContext(tenantSlug, contactId)
  const cookie = (await headers()).get("cookie") ?? ""
  const search = getSearchParam(resolvedSearchParams.search)?.trim() ?? ""
  const sort = parseContactOpportunitySort(getSearchParam(resolvedSearchParams.sort))
  const page = parseContactOpportunityPage(getSearchParam(resolvedSearchParams.page))
  const pageSize = parseContactOpportunityPageSize(
    getSearchParam(resolvedSearchParams.pageSize),
  )

  let initialData: ContactOpportunitiesResponse = {
    ok: true,
    items: [],
    pagination: {
      page,
      pageSize,
      total: 0,
      totalPages: 1,
    },
    summary: {
      active: 0,
      assignedPipelineIds: [],
    },
  }
  let initialLoadFailed = false

  try {
    const { data } = await api.get<ContactOpportunitiesResponse>(
      `/api/opportunities/${tenantId}/contact/${contactId}`,
      {
        headers: { cookie },
        params: { search, sort, page, pageSize },
      },
    )
    initialData = data
  } catch {
    initialLoadFailed = true
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
      initialData={initialData}
      initialQuery={{ search, sort, page, pageSize }}
      initialLoadFailed={initialLoadFailed}
      canManageOpportunities={membershipSecurityLevel !== "LOW"}
    />
  )
}
