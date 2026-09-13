import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  appendSearchParams,
  getContactServicesHref,
  getSafeContactServicesReturnTo,
  getSafeServiceEnrollmentReturnTo,
  getServiceEnrollmentsHref,
  getServiceEnrollmentFollowUpHref,
  getServiceEnrollmentHref,
  getServiceFollowUpsHref,
  getServiceTransactionsHref,
  getServicesOverviewHref,
} from "./routes.js"

describe("service enrollment routes", () => {
  test("builds the canonical enrollment route with an optional return path", () => {
    const returnTo = getContactServicesHref({
      tenantSlug: "north-agency",
      contactId: "contact-1",
      page: 3,
      pageSize: 25,
    })

    assert.equal(
      getServiceEnrollmentHref({
        tenantSlug: "north-agency",
        contactServiceId: "enrollment-1",
        returnTo,
      }),
      "/app/north-agency/services/enrollments/enrollment-1/overview?returnTo=%2Fapp%2Fnorth-agency%2Fcontacts%2Fcontact-1%2Fservices%3Fpage%3D3%26pageSize%3D25",
    )
  })

  test("builds every canonical enrollment view route", () => {
    const views = ["overview", "transaction", "follow-up", "notes"] as const

    for (const view of views) {
      assert.equal(
        getServiceEnrollmentHref({
          tenantSlug: "north-agency",
          contactServiceId: "enrollment-1",
          view,
        }),
        `/app/north-agency/services/enrollments/enrollment-1/${view}`,
      )
    }
  })

  test("builds the dedicated enrollment follow-up route", () => {
    assert.equal(
      getServiceEnrollmentFollowUpHref({
        tenantSlug: "north-agency",
        contactServiceId: "enrollment-1",
        returnTo: "/app/north-agency/contacts/contact-1/services?page=2&pageSize=10",
      }),
      "/app/north-agency/services/enrollments/enrollment-1/follow-up?returnTo=%2Fapp%2Fnorth-agency%2Fcontacts%2Fcontact-1%2Fservices%3Fpage%3D2%26pageSize%3D10",
    )
  })

  test("preserves complete query state when redirecting legacy enrollment views", () => {
    const searchParams = {
      returnTo: "/app/north-agency/services/transactions?search=Garcia&page=3",
      focus: ["history", "latest"],
      empty: undefined,
    }

    assert.equal(
      appendSearchParams(
        getServiceEnrollmentHref({
          tenantSlug: "north-agency",
          contactServiceId: "enrollment-1",
          view: "transaction",
        }),
        searchParams,
      ),
      "/app/north-agency/services/enrollments/enrollment-1/transaction?returnTo=%2Fapp%2Fnorth-agency%2Fservices%2Ftransactions%3Fsearch%3DGarcia%26page%3D3&focus=history&focus=latest",
    )
  })

  test("accepts and normalizes a return path for the same contact", () => {
    assert.equal(
      getSafeContactServicesReturnTo({
        returnTo: "/app/north-agency/contacts/contact-1/services?page=3&pageSize=25",
        tenantSlug: "north-agency",
        contactId: "contact-1",
      }),
      "/app/north-agency/contacts/contact-1/services?page=3&pageSize=25",
    )
  })

  test("rejects external, cross-tenant, and cross-contact return paths", () => {
    const fallback = "/app/north-agency/contacts/contact-1/services"
    const attempts = [
      "https://example.com/app/north-agency/contacts/contact-1/services",
      "/app/south-agency/contacts/contact-1/services?page=2&pageSize=10",
      "/app/north-agency/contacts/contact-2/services?page=2&pageSize=10",
    ]

    for (const returnTo of attempts) {
      assert.equal(
        getSafeContactServicesReturnTo({
          returnTo,
          tenantSlug: "north-agency",
          contactId: "contact-1",
        }),
        fallback,
      )
    }
  })

  test("builds canonical services workspace routes", () => {
    assert.equal(getServicesOverviewHref("north agency"), "/app/north%20agency/services")
    assert.equal(
      getServiceEnrollmentsHref("north agency"),
      "/app/north%20agency/services/enrollments",
    )
    assert.equal(
      getServiceTransactionsHref("north agency"),
      "/app/north%20agency/services/transactions",
    )
    assert.equal(
      getServiceFollowUpsHref("north agency"),
      "/app/north%20agency/services/follow-ups",
    )
  })

  test("preserves legacy route filters, pagination, and repeated values", () => {
    assert.equal(
      appendSearchParams(getServiceTransactionsHref("north agency"), {
        page: "3",
        status: "COMPLETED",
        serviceId: ["service-1", "service-2"],
        empty: undefined,
      }),
      "/app/north%20agency/services/transactions?page=3&status=COMPLETED&serviceId=service-1&serviceId=service-2",
    )
  })

  test("keeps safe service workspace return paths and query state", () => {
    assert.equal(
      getSafeServiceEnrollmentReturnTo({
        tenantSlug: "north-agency",
        contactId: "contact-1",
        returnTo:
          "/app/north-agency/services/enrollments?search=Garcia&statuses=IN_PROGRESS%2CCOMPLETED&page=3&pageSize=25",
      }),
      "/app/north-agency/services/enrollments?search=Garcia&statuses=IN_PROGRESS%2CCOMPLETED&page=3&pageSize=25",
    )
    assert.equal(
      getSafeServiceEnrollmentReturnTo({
        tenantSlug: "north-agency",
        contactId: "contact-1",
        returnTo:
          "/app/north-agency/services/transactions?search=Garcia&page=3&pageSize=25",
      }),
      "/app/north-agency/services/transactions?search=Garcia&page=3&pageSize=25",
    )
    assert.equal(
      getSafeServiceEnrollmentReturnTo({
        tenantSlug: "north-agency",
        contactId: "contact-1",
        returnTo: "/app/north-agency/services/follow-ups?dueDatePreset=TODAY",
      }),
      "/app/north-agency/services/follow-ups?dueDatePreset=TODAY",
    )
    assert.equal(
      getSafeServiceEnrollmentReturnTo({
        tenantSlug: "north-agency",
        contactId: "contact-1",
        returnTo: "/app/north-agency/contacts/contact-1/services?page=2",
      }),
      "/app/north-agency/contacts/contact-1/services?page=2",
    )
  })

  test("rejects cross-tenant and unrelated service return paths", () => {
    const fallback = "/app/north-agency/services/enrollments"
    const attempts = [
      "https://example.com/app/north-agency/services/transactions",
      "/app/south-agency/services/transactions",
      "/app/north-agency/contacts/contact-2/services",
      "/app/north-agency/account-settings/services",
    ]

    for (const returnTo of attempts) {
      assert.equal(
        getSafeServiceEnrollmentReturnTo({
          tenantSlug: "north-agency",
          contactId: "contact-1",
          returnTo,
        }),
        fallback,
      )
    }
  })
})
