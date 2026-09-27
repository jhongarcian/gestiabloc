import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { waitingRunCountdown } from "./automation-waiting-runs.js"

describe("waitingRunCountdown", () => {
  const now = Date.parse("2026-09-27T15:00:00.000Z")

  test("uses ceiling rounding for remaining minutes", () => {
    assert.equal(waitingRunCountdown("2026-09-27T15:00:00.001Z", now), "1 min remaining")
    assert.equal(waitingRunCountdown("2026-09-27T15:01:00.001Z", now), "2 min remaining")
  })

  test("changes to Due now at and after the scheduled instant", () => {
    assert.equal(waitingRunCountdown("2026-09-27T15:00:00.000Z", now), "Due now")
    assert.equal(waitingRunCountdown("2026-09-27T14:59:00.000Z", now), "Due now")
  })

  test("handles missing or invalid schedules without showing zero", () => {
    assert.equal(waitingRunCountdown(null, now), "Schedule unavailable")
    assert.equal(waitingRunCountdown("not-a-date", now), "Schedule unavailable")
  })
})
