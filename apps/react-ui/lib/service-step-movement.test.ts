import assert from "node:assert/strict"
import { test } from "node:test"
import { currentServiceStep, skippedByStepMove } from "./service-step-movement"

const entry = (
  id: string,
  status: string,
  progressionStatus = "NONE",
  supersededAt: string | null = null,
) => ({
  id,
  status,
  progressionStatus,
  supersededAt,
  enteredAt: "2026-10-20T12:00:00Z",
  createdAt: "2026-10-20T12:00:00Z",
})

test("current movement target follows active work even when saved step order differs from entry order", () => {
  const steps = [
    { id: "review", title: "Review", occurrences: [entry("b", "ACTIVE")] },
    {
      id: "submit",
      title: "Submit",
      occurrences: [entry("a", "CANCELED", "SUPERSEDED", "2026-10-20T12:00:00Z")],
    },
  ]
  assert.equal(currentServiceStep(steps)?.step.id, "review")
})

test("pending completion work remains movable and obsolete progression is ignored", () => {
  const steps = [
    { id: "review", title: "Review", occurrences: [entry("a", "COMPLETED", "WAITING_AUTOMATION")] },
    {
      id: "old",
      title: "Old",
      occurrences: [entry("b", "COMPLETED", "PAUSED", "2026-10-20T12:00:00Z")],
    },
  ]
  assert.equal(currentServiceStep(steps)?.entry.id, "a")
  assert.equal(currentServiceStep([]), null)
})

test("finished skipped work retains a source for reopening a pending-payment enrollment", () => {
  assert.equal(
    currentServiceStep([
      {
        id: "last",
        title: "Last",
        occurrences: [entry("last-entry", "SKIPPED", "FINISHED", "2026-10-20T12:00:00Z")],
      },
    ])?.entry.id,
    "last-entry",
  )
})

test("forward preview includes the active source and intermediate steps but preserves completed sources", () => {
  const steps = [{ id: "a" }, { id: "b" }, { id: "c" }]
  assert.deepEqual(skippedByStepMove(steps, "a", "c", true), [steps[0], steps[1]])
  assert.deepEqual(skippedByStepMove(steps, "a", "c", false), [steps[1]])
  assert.deepEqual(skippedByStepMove(steps, "c", "a", true), [])
  assert.deepEqual(skippedByStepMove(steps, "missing", "c", true), [])
})
