export const CONTACT_OPPORTUNITIES_REFRESH_EVENT = "contact-opportunities-refresh"

export type ContactOpportunitiesRefreshDetail = {
  tenantId: string
  contactId: string
}

export function dispatchContactOpportunitiesRefresh(
  detail: ContactOpportunitiesRefreshDetail,
) {
  window.dispatchEvent(
    new CustomEvent<ContactOpportunitiesRefreshDetail>(
      CONTACT_OPPORTUNITIES_REFRESH_EVENT,
      { detail },
    ),
  )
}
