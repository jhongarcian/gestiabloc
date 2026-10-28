import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import {
  ChangeServiceStepDeadlineSchema,
  serviceStepDeadlineDate,
} from "./service-step-deadlines.js"

test("deadline durations start at entry and default restoration uses the frozen entry deadline", () => {
  const occurrence = {
    enteredAt: new Date("2026-01-01T12:00:00Z"),
    defaultDueAt: new Date("2026-01-04T12:00:00Z"),
  }
  assert.equal(
    serviceStepDeadlineDate(occurrence, {
      mode: "DURATION",
      amount: 20,
      unit: "DAYS",
    }).toISOString(),
    "2026-01-21T12:00:00.000Z",
  )
  assert.equal(
    serviceStepDeadlineDate(occurrence, {
      mode: "DURATION",
      amount: 90,
      unit: "MINUTES",
    }).toISOString(),
    "2026-01-01T13:30:00.000Z",
  )
  assert.equal(
    serviceStepDeadlineDate(occurrence, {
      mode: "DURATION",
      amount: 2,
      unit: "HOURS",
    }).toISOString(),
    "2026-01-01T14:00:00.000Z",
  )
  assert.equal(serviceStepDeadlineDate(occurrence, { mode: "DEFAULT" }), occurrence.defaultDueAt)
  // An overdue deadline after entry is valid; it need not be a future automation wait.
  assert.equal(
    serviceStepDeadlineDate(occurrence, {
      mode: "FIXED_DATE",
      dateTime: "2026-01-02T07:00:00-05:00",
    }).toISOString(),
    "2026-01-02T12:00:00.000Z",
  )
  for (const dateTime of ["2026-01-01T11:59:59Z", "2026-01-01T12:00:00Z", "2037-01-01T12:00:00Z"])
    assert.throws(
      () => serviceStepDeadlineDate(occurrence, { mode: "FIXED_DATE", dateTime }),
      /INVALID_SERVICE_STEP_DEADLINE/,
    )
})

test("deadline requests reject invalid durations, revisions and dates, and canonicalize offsets", () => {
  const base = { requestId: randomUUID(), expectedDeadlineRevision: 0 }
  for (const amount of [0, -1, 1.5, 3651])
    assert.equal(
      ChangeServiceStepDeadlineSchema.safeParse({
        ...base,
        schedule: { mode: "DURATION", amount, unit: "DAYS" },
      }).success,
      false,
    )
  for (const expectedDeadlineRevision of [-1, 1.5])
    assert.equal(
      ChangeServiceStepDeadlineSchema.safeParse({
        ...base,
        expectedDeadlineRevision,
        schedule: { mode: "DEFAULT" },
      }).success,
      false,
    )
  for (const dateTime of ["2026-02-30T12:00:00Z", "2026-01-02T12:00", "invalid"])
    assert.equal(
      ChangeServiceStepDeadlineSchema.safeParse({
        ...base,
        schedule: { mode: "FIXED_DATE", dateTime },
      }).success,
      false,
    )
  assert.deepEqual(
    ChangeServiceStepDeadlineSchema.parse({
      ...base,
      schedule: { mode: "FIXED_DATE", dateTime: "2026-01-02T07:00:00-05:00" },
    }).schedule,
    { mode: "FIXED_DATE", dateTime: "2026-01-02T12:00:00.000Z" },
  )
  assert.equal(
    ChangeServiceStepDeadlineSchema.safeParse({ ...base, schedule: { mode: "DEFAULT", amount: 1 } })
      .success,
    false,
  )
})
