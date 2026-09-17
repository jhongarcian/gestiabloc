import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  SERVICE_ENROLLMENT_SORTS,
  ServiceEnrollmentsListQuerySchema,
  getLatestServiceEnrollmentActivityAt,
  getServiceEnrollmentContactName,
} from "./service-enrollments.js"

describe("service enrollment register queries", () => {
  test("applies the register defaults and parses distinct status values", () => {
    assert.deepEqual(ServiceEnrollmentsListQuerySchema.parse({}), {
      page: 1,
      pageSize: 10,
      sort: "LAST_ACTIVITY_DESC",
    })

    assert.deepEqual(
      ServiceEnrollmentsListQuerySchema.parse({
        page: "2",
        pageSize: "25",
        sort: "CONTACT_ASC",
        statuses: "COMPLETED, IN_PROGRESS,COMPLETED",
        withoutTemplate: "false",
        unassigned: "true",
      }),
      {
        page: 2,
        pageSize: 25,
        sort: "CONTACT_ASC",
        statuses: ["COMPLETED", "IN_PROGRESS"],
        withoutTemplate: false,
        unassigned: true,
      },
    )
  })

  test("rejects invalid statuses and mutually exclusive filters", () => {
    assert.equal(
      ServiceEnrollmentsListQuerySchema.safeParse({ statuses: "UNKNOWN" }).success,
      false,
    )
    assert.equal(
      ServiceEnrollmentsListQuerySchema.safeParse({
        followUpTemplateId: "template-1",
        withoutTemplate: "true",
      }).success,
      false,
    )
    assert.equal(
      ServiceEnrollmentsListQuerySchema.safeParse({
        assignedToUserId: "user-1",
        unassigned: "true",
      }).success,
      false,
    )
    assert.equal(
      ServiceEnrollmentsListQuerySchema.safeParse({ sort: "UNKNOWN" }).success,
      false,
    )
  })

  test("accepts every supported deterministic sort", () => {
    for (const sort of SERVICE_ENROLLMENT_SORTS) {
      assert.equal(ServiceEnrollmentsListQuerySchema.parse({ sort }).sort, sort)
    }
  })

  test("selects the newest persisted activity and formats contact names", () => {
    const latest = getLatestServiceEnrollmentActivityAt([
      new Date("2026-03-01T10:00:00.000Z"),
      null,
      new Date("2026-03-02T09:00:00.000Z"),
    ])

    assert.equal(latest?.toISOString(), "2026-03-02T09:00:00.000Z")
    assert.equal(
      getServiceEnrollmentContactName({
        firstName: "Ana",
        middleName: "María",
        lastName: "Garcia",
      }),
      "Ana María Garcia",
    )
  })
})
