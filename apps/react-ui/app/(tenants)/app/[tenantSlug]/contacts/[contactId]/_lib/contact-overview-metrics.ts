import { cache } from "react"

import { api } from "@/lib/api"

export type ContactServiceSummaryItem = {
  id: string
  status: string
  totalPriceCents: number
  paidCents: number
  service: {
    id: string
    name: string
  }
  followUpSteps: Array<{
    id: string
    title: string
    status: string
    dueAt?: string | null
    availableAt?: string | null
    completedAt: string | null
    assignedToUserId?: string | null
    assignedTo?: {
      id: string
      name: string | null
      email: string | null
      image: string | null
    } | null
  }>
}

type ContactServicesPageResponse = {
  ok: boolean
  items: ContactServiceSummaryItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export type ContactOverviewMetrics = {
  totalSpendingCents: number
  lastPaymentAt: string | null
  opportunityCount: number
  openOpportunityCount: number
  activeTaskCount: number
  overdueTaskCount: number
  nextAppointment: {
    id: string
    title: string
    startAt: string
  } | null
}

type ContactOverviewMetricsResponse = {
  ok: boolean
  summary: ContactOverviewMetrics
}

export const getAllContactServices = cache(
  async (tenantId: string, contactId: string, cookie: string) => {
    const firstPage = await api.get<ContactServicesPageResponse>(
      `/api/services/${tenantId}/contact-services`,
      {
        headers: { cookie },
        params: {
          contactId,
          page: 1,
          pageSize: 25,
        },
      },
    )

    const totalPages = firstPage.data.pagination.totalPages
    if (totalPages <= 1) {
      return firstPage.data.items
    }

    const restPages = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        api.get<ContactServicesPageResponse>(
          `/api/services/${tenantId}/contact-services`,
          {
            headers: { cookie },
            params: {
              contactId,
              page: index + 2,
              pageSize: 25,
            },
          },
        ),
      ),
    )

    return [
      ...firstPage.data.items,
      ...restPages.flatMap((response) => response.data.items),
    ]
  },
)

export const getContactOverviewMetrics = cache(
  async (
    tenantId: string,
    contactId: string,
    cookie: string,
  ): Promise<ContactOverviewMetrics> => {
    const encodedTenantId = encodeURIComponent(tenantId)
    const encodedContactId = encodeURIComponent(contactId)
    const { data } = await api.get<ContactOverviewMetricsResponse>(
      `/api/contacts/${encodedTenantId}/${encodedContactId}/summary`,
      { headers: { cookie } },
    )

    return data.summary
  },
)
