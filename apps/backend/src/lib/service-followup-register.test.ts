import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  SERVICE_FOLLOW_UP_SEARCH_MAX_LENGTH,
  SERVICE_FOLLOW_UP_SORTS,
  ServiceFollowUpSortSchema,
  sanitizeServiceFollowUpSearch,
} from "./service-followup-register.js"

describe("service follow-up register inputs", () => {
  test("accepts only supported register sort values", () => {
    for (const sort of SERVICE_FOLLOW_UP_SORTS) {
      assert.equal(ServiceFollowUpSortSchema.parse(sort), sort)
    }

    assert.equal(ServiceFollowUpSortSchema.safeParse("UNKNOWN").success, false)
  })

  test("normalizes and bounds follow-up searches", () => {
    assert.equal(
      sanitizeServiceFollowUpSearch("  <b>Ａｄａ</b>\u0000\n Lovelace\u200B "),
      "Ada Lovelace",
    )
    assert.equal(
      sanitizeServiceFollowUpSearch(
        "a".repeat(SERVICE_FOLLOW_UP_SEARCH_MAX_LENGTH + 20),
      ).length,
      SERVICE_FOLLOW_UP_SEARCH_MAX_LENGTH,
    )
  })
})
