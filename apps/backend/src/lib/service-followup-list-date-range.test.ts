import assert from "node:assert/strict"
import test from "node:test"

import { getFollowUpListDateRanges } from "./service-followup-list-date-range.js"

test("builds today and next-seven-day boundaries in the tenant timezone", () => {
  const range = getFollowUpListDateRanges(
    "America/Chicago",
    new Date("2026-09-10T04:30:00.000Z"),
  )

  assert.equal(range.today.start.toISOString(), "2026-09-09T05:00:00.000Z")
  assert.equal(range.today.end.toISOString(), "2026-09-10T05:00:00.000Z")
  assert.equal(range.nextSevenDaysEnd.toISOString(), "2026-09-16T05:00:00.000Z")
})

test("keeps local-midnight boundaries correct across daylight saving time", () => {
  const range = getFollowUpListDateRanges(
    "America/Chicago",
    new Date("2026-10-31T18:00:00.000Z"),
  )

  assert.equal(range.today.start.toISOString(), "2026-10-31T05:00:00.000Z")
  assert.equal(range.today.end.toISOString(), "2026-11-01T05:00:00.000Z")
  assert.equal(range.nextSevenDaysEnd.toISOString(), "2026-11-07T06:00:00.000Z")
})
