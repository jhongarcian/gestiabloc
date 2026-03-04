import { cache } from "react"
import { isAxiosError } from "axios"
import { notFound, redirect } from "next/navigation"

import { api } from "@/lib/api"
import { getTenantMembershipContext } from "../../../_lib/tenant-session"

export type ContactDetailsResponse = {
  ok: boolean
  contact: {
    id: string
    firstName: string
    middleName: string | null
    lastName: string
    fullName: string
    dateOfBirth: string | null
    phoneNumber: string | null
    secondaryPhoneNumber: string | null
    email: string | null
    address: {
      addressLine1: string | null
      addressLine2: string | null
      city: string | null
      state: string | null
      postalCode: string | null
      country: string | null
    }
    status: string
    statusConfigId: string | null
    statusBgColor: string | null
    statusTextColor: string | null
    customFields: Array<{
      id: string
      key: string
      label: string
      description: string | null
      fieldType:
        | "TEXT"
        | "NUMBER"
        | "PHONE"
        | "CURRENCY"
        | "DATE"
        | "SELECT"
        | "MULTI_SELECT"
        | "RADIO"
        | "TEXTAREA"
        | "CHECKBOX"
      isRequired: boolean
      isEncrypted: boolean
      options: string[]
      sortOrder: number
      value: unknown
    }>
    relationships: Array<{
      id: string
      relatedContactId: string
      relationshipType:
        | "FATHER"
        | "MOTHER"
        | "PARENT"
        | "SON"
        | "DAUGHTER"
        | "CHILD"
        | "HUSBAND"
        | "WIFE"
        | "SPOUSE"
        | "PARTNER"
        | "BROTHER"
        | "SISTER"
        | "SIBLING"
        | "GRANDFATHER"
        | "GRANDMOTHER"
        | "GRANDPARENT"
        | "GRANDSON"
        | "GRANDDAUGHTER"
        | "GRANDCHILD"
        | "UNCLE"
        | "AUNT"
        | "AUNT_OR_UNCLE"
        | "NEPHEW"
        | "NIECE"
        | "NIECE_OR_NEPHEW"
        | "COUSIN"
        | "GUARDIAN"
        | "WARD"
        | "CAREGIVER"
        | "DEPENDENT"
        | "FRIEND"
        | "OTHER"
      relationshipLabel: string
      relatedContact: {
        id: string
        fullName: string
        phoneNumber: string | null
        email: string | null
      }
    }>
    createdAt: string
    updatedAt: string
  }
}

export const getContactDetailsContext = cache(
  async (tenantSlug: string, contactId: string) => {
    const { cookie, membership, tenantTimezone } = await getTenantMembershipContext(tenantSlug)

    if (!membership?.tenant?.id) {
      redirect(`/app/${tenantSlug}/contacts`)
    }

    try {
      const { data } = await api.get<ContactDetailsResponse>(
        `/api/contacts/${membership.tenant.id}/${contactId}`,
        {
          headers: { cookie },
        },
      )

      return {
        tenantId: membership.tenant.id,
        tenantTimezone,
        contact: data.contact,
      }
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        notFound()
      }
      redirect(`/app/${tenantSlug}/contacts`)
    }
  },
)

export const formatContactDate = (value: string | null) => {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)
}

export const formatContactDateTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}
