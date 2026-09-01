import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  getContactServicesHref,
  getSafeContactServicesReturnTo,
  getServiceEnrollmentHref,
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
      "/app/north-agency/services/enrollments/enrollment-1?returnTo=%2Fapp%2Fnorth-agency%2Fcontacts%2Fcontact-1%2Fservices%3Fpage%3D3%26pageSize%3D25",
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
})
