import assert from "node:assert/strict"
import { test } from "node:test"
import {
  ContinueServiceStepWaitSchema,
  RescheduleServiceStepWaitSchema,
} from "./service-step-waits.js"

const target = {
  runId: "00000000-0000-4000-8000-000000000001",
  waitingNodeExecutionId: "00000000-0000-4000-8000-000000000002",
  expectedResumeAt: "2026-10-21T10:00:00.000Z",
}

test("wait controls require the exact run, wait execution and displayed schedule", () => {
  assert.deepEqual(ContinueServiceStepWaitSchema.parse(target), target)
  for (const field of Object.keys(target)) {
    const value = { ...target } as Record<string, unknown>
    delete value[field]
    assert.equal(ContinueServiceStepWaitSchema.safeParse(value).success, false)
  }
  assert.equal(
    ContinueServiceStepWaitSchema.safeParse({ ...target, contactServiceId: "ignored" }).success,
    false,
  )
})

test("reschedules accept bounded durations or an absolute date with a time zone", () => {
  for (const unit of ["SECONDS", "MINUTES", "HOURS", "DAYS"]) {
    assert.equal(
      RescheduleServiceStepWaitSchema.safeParse({
        ...target,
        schedule: { mode: "DURATION", amount: 20, unit },
      }).success,
      true,
    )
  }
  for (const amount of [0, -1, 1.5, 3651, Infinity]) {
    assert.equal(
      RescheduleServiceStepWaitSchema.safeParse({
        ...target,
        schedule: { mode: "DURATION", amount, unit: "DAYS" },
      }).success,
      false,
    )
  }
  assert.equal(
    RescheduleServiceStepWaitSchema.safeParse({
      ...target,
      schedule: { mode: "FIXED_DATE", dateTime: "2026-10-21T10:00:00-05:00" },
    }).success,
    true,
  )
  assert.equal(
    RescheduleServiceStepWaitSchema.safeParse({
      ...target,
      schedule: { mode: "FIXED_DATE", dateTime: "2026-10-21T10:00" },
    }).success,
    false,
  )
})
