export const CONTACT_SERVICES_PAGE_SIZES = [10, 25] as const
export const SERVICE_ENROLLMENT_VIEWS = ["overview", "payments", "notes"] as const

export type ContactServicesPageSize = (typeof CONTACT_SERVICES_PAGE_SIZES)[number]
export type ServiceEnrollmentView = (typeof SERVICE_ENROLLMENT_VIEWS)[number]

const encodePathSegment = (value: string) => encodeURIComponent(value)

export function parsePositivePage(value: string | null | undefined, fallback = 1) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function parseContactServicesPageSize(
  value: string | null | undefined,
  fallback: ContactServicesPageSize = 10,
): ContactServicesPageSize {
  const parsed = Number(value)
  return CONTACT_SERVICES_PAGE_SIZES.includes(parsed as ContactServicesPageSize)
    ? (parsed as ContactServicesPageSize)
    : fallback
}

export function getContactServicesHref({
  tenantSlug,
  contactId,
  page,
  pageSize,
}: {
  tenantSlug: string
  contactId: string
  page?: number
  pageSize?: ContactServicesPageSize
}) {
  const baseHref = `/app/${encodePathSegment(tenantSlug)}/contacts/${encodePathSegment(contactId)}/services`
  if (page === undefined && pageSize === undefined) return baseHref

  const params = new URLSearchParams({
    page: String(page ?? 1),
    pageSize: String(pageSize ?? 10),
  })
  return `${baseHref}?${params.toString()}`
}

export function getServiceEnrollmentHref({
  tenantSlug,
  contactServiceId,
  view = "overview",
  returnTo,
}: {
  tenantSlug: string
  contactServiceId: string
  view?: ServiceEnrollmentView
  returnTo?: string | null
}) {
  const baseHref = `/app/${encodePathSegment(tenantSlug)}/services/enrollments/${encodePathSegment(contactServiceId)}/${view}`
  if (!returnTo) return baseHref

  return `${baseHref}?${new URLSearchParams({ returnTo }).toString()}`
}

export function getServiceEnrollmentFollowUpsHref({
  tenantSlug,
  contactServiceId,
  returnTo,
}: {
  tenantSlug: string
  contactServiceId: string
  returnTo?: string | null
}) {
  return `${getServiceEnrollmentHref({
    tenantSlug,
    contactServiceId,
    view: "overview",
    returnTo,
  })}#service-follow-ups`
}

export function getSafeContactServicesReturnTo({
  returnTo,
  tenantSlug,
  contactId,
}: {
  returnTo: string | null | undefined
  tenantSlug: string
  contactId: string
}) {
  const fallback = getContactServicesHref({ tenantSlug, contactId })
  if (!returnTo?.startsWith("/")) return fallback

  try {
    const parsed = new URL(returnTo, "https://gestiabloc.local")
    const expectedPath = getContactServicesHref({ tenantSlug, contactId })
    if (parsed.origin !== "https://gestiabloc.local" || parsed.pathname !== expectedPath) {
      return fallback
    }

    return getContactServicesHref({
      tenantSlug,
      contactId,
      page: parsePositivePage(parsed.searchParams.get("page")),
      pageSize: parseContactServicesPageSize(parsed.searchParams.get("pageSize")),
    })
  } catch {
    return fallback
  }
}
