import { isAxiosError } from "axios"
import { headers } from "next/headers"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { api, type MeResponse } from "@/lib/api"

type ContactDetailsPageProps = {
  params: Promise<{ tenantSlug: string; contactId: string }>
}

type ContactDetailsResponse = {
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
    createdAt: string
    updatedAt: string
  }
}

const formatDate = (value: string | null) => {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date)
}

const formatDateTime = (value: string) => {
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

export default async function ContactDetailsPage({ params }: ContactDetailsPageProps) {
  const { tenantSlug, contactId } = await params
  const cookie = (await headers()).get("cookie") ?? ""

  let me: MeResponse["user"] | null = null
  try {
    const { data } = await api.get<MeResponse>("/api/auth/me", {
      headers: { cookie },
    })
    me = data?.user ?? null
  } catch {
    redirect("/login")
  }

  if (!me?.memberships?.length) {
    redirect("/login")
  }

  const membership = me.memberships.find(
    (item) => item.tenant?.slug === tenantSlug,
  )

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}/contacts`)
  }

  let details: ContactDetailsResponse["contact"] | null = null
  try {
    const { data } = await api.get<ContactDetailsResponse>(
      `/api/contacts/${membership.tenant.id}/${contactId}`,
      {
        headers: { cookie },
      },
    )
    details = data.contact
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) {
      notFound()
    }
    redirect(`/app/${tenantSlug}/contacts`)
  }

  if (!details) {
    notFound()
  }

  const addressLine = [
    details.address.addressLine1,
    details.address.addressLine2,
    details.address.city,
    details.address.state,
    details.address.postalCode,
    details.address.country,
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="space-y-0.5">
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
          {details.fullName}
        </h1>
        <p className="max-w-2xl text-sm text-slate-500">
          Contact details and profile information.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 rounded-xl bg-white p-4 md:p-6">
        <div className="flex h-full w-full min-h-0 flex-col gap-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Contact ID</p>
              <p className="font-mono text-sm text-slate-700">{details.id}</p>
            </div>
            <span
              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={
                details.statusBgColor && details.statusTextColor
                  ? {
                      backgroundColor: details.statusBgColor,
                      color: details.statusTextColor,
                    }
                  : undefined
              }
            >
              {details.status}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-slate-500">First Name</p>
              <p className="text-sm text-slate-900">{details.firstName}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-slate-500">Middle Name</p>
              <p className="text-sm text-slate-900">{details.middleName ?? "—"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-slate-500">Last Name</p>
              <p className="text-sm text-slate-900">{details.lastName}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-slate-500">Date of Birth</p>
              <p className="text-sm text-slate-900">{formatDate(details.dateOfBirth)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-slate-500">Phone</p>
              <p className="text-sm text-slate-900">{details.phoneNumber ?? "—"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-slate-500">Secondary Phone</p>
              <p className="text-sm text-slate-900">
                {details.secondaryPhoneNumber ?? "—"}
              </p>
            </div>
            <div className="space-y-1 md:col-span-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">Email</p>
              <p className="text-sm text-slate-900">{details.email ?? "—"}</p>
            </div>
            <div className="space-y-1 md:col-span-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">Address</p>
              <p className="text-sm text-slate-900">{addressLine || "—"}</p>
            </div>
          </div>

          <div className="mt-auto flex flex-col gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <div>Created: {formatDateTime(details.createdAt)}</div>
            <div>Updated: {formatDateTime(details.updatedAt)}</div>
            <Link
              href={`/app/${tenantSlug}/contacts`}
              className="text-blue-950 hover:underline"
            >
              Back to Contacts
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
