import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { isAxiosError } from "axios"

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
    <ContactNotesPanel
      tenantId={tenantId}
      contactId={contactId}
      currentUserRole={membership.role}
      initialData={initialData}
    />
  )
}
