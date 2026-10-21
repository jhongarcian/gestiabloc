import assert from "node:assert/strict"
import { test } from "node:test"
import { fixedWaitSchedule, waitChangeTarget } from "./service-step-wait"

test("wait changes retain the exact displayed wait and schedule", () => {
  assert.deepEqual(
    waitChangeTarget({
      runId: "root-run",
      automationId: "completion-workflow",
      waitingNodeExecutionId: "first-wait",
      resumeAt: "2026-10-21T10:00:00.000Z",
      status: "WAITING",
    }),
    {
      runId: "root-run",
      waitingNodeExecutionId: "first-wait",
      expectedResumeAt: "2026-10-21T10:00:00.000Z",
    },
  )
})

test("fixed wait schedules use the tenant time zone and reject invalid, past or nonexistent times", () => {
  const now = Date.UTC(2026, 0, 1)
  assert.deepEqual(
    fixedWaitSchedule({ date: "10/21/2026", time: "09:30" }, "America/Chicago", now),
    {
      mode: "FIXED_DATE",
      dateTime: "2026-10-21T14:30:00.000Z",
    },
  )
  assert.deepEqual(
    fixedWaitSchedule({ date: "12/21/2026", time: "09:30" }, "America/Chicago", now),
    {
      mode: "FIXED_DATE",
      dateTime: "2026-12-21T15:30:00.000Z",
    },
  )
  for (const draft of [
    { date: "02/31/2026", time: "10:00" },
    { date: "12/31/2025", time: "10:00" },
    { date: "03/08/2026", time: "02:30" },
    { date: "10/21/2026", time: "25:00" },
    { date: "", time: "" },
  ])
    assert.equal(fixedWaitSchedule(draft, "America/Chicago", now), null)
})
