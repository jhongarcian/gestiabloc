import assert from "node:assert/strict"
import { test } from "node:test"
import {
  fixedStepDeadline,
  latestStepDeadline,
  previewStepDeadline,
  type StepDeadlineOccurrence,
} from "./service-step-deadline"

const occurrence: StepDeadlineOccurrence = {
  id: "entry-one",
  enteredAt: "2026-01-01T12:00:00.000Z",
  defaultDueAt: "2026-01-04T12:00:00.000Z",
  dueAt: "2026-01-04T12:00:00.000Z",
  deadlineOverride: null,
  deadlineRevision: 0,
  deadlineChanges: [],
  status: "ACTIVE",
}

test("deadline previews count elapsed time from entry and restoration returns the saved default", () => {
  assert.equal(
    previewStepDeadline(occurrence, { mode: "DURATION", amount: 20, unit: "DAYS" }),
    "2026-01-21T12:00:00.000Z",
  )
  assert.equal(
    previewStepDeadline(occurrence, { mode: "DURATION", amount: 90, unit: "MINUTES" }),
    "2026-01-01T13:30:00.000Z",
  )
  assert.equal(previewStepDeadline(occurrence, { mode: "DEFAULT" }), occurrence.defaultDueAt)
  for (const amount of [0, -1, 1.5, Number.NaN, 3651])
    assert.equal(previewStepDeadline(occurrence, { mode: "DURATION", amount, unit: "DAYS" }), null)
})

test("fixed deadlines use tenant time, accept overdue work and reject nonexistent local times", () => {
  assert.deepEqual(
    fixedStepDeadline({ date: "01/02/2026", time: "07:00" }, occurrence, "America/New_York"),
    { mode: "FIXED_DATE", dateTime: "2026-01-02T12:00:00.000Z" },
  )
  assert.equal(
    fixedStepDeadline({ date: "03/08/2026", time: "02:30" }, occurrence, "America/New_York"),
    null,
  )
  assert.equal(
    fixedStepDeadline({ date: "01/01/2026", time: "06:59" }, occurrence, "America/New_York"),
    null,
  )
  assert.equal(fixedStepDeadline({ date: "02/30/2026", time: "12:00" }, occurrence, "UTC"), null)
})

test("saved deadline fallback cannot overwrite newer revisions, completed status, or a revisit", () => {
  const saved = {
    ...occurrence,
    deadlineRevision: 1,
    dueAt: "2026-01-21T12:00:00.000Z",
    deadlineOverride: { mode: "DURATION" as const, amount: 20, unit: "DAYS" as const },
  }
  assert.equal(latestStepDeadline(occurrence, saved).dueAt, saved.dueAt)
  assert.equal(
    latestStepDeadline({ ...occurrence, status: "COMPLETED" }, saved).status,
    "COMPLETED",
  )
  assert.equal(latestStepDeadline({ ...occurrence, id: "revisit" }, saved).dueAt, occurrence.dueAt)
  assert.equal(
    latestStepDeadline({ ...occurrence, deadlineRevision: 2 }, saved).deadlineRevision,
    2,
  )
})
