import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { getServiceOverviewPriority } from "./service-overview-priority.js"

const NOW = new Date("2026-08-31T18:00:00.000Z").getTime()

const openStep = {
  title: "Confirm documents",
  status: "ACTIVE" as const,
  dueAt: "2026-09-01T18:00:00.000Z",
}

describe("service overview priority", () => {
  test("prioritizes workflow failures over every other condition", () => {
    const priority = getServiceOverviewPriority({
      followUpRunStatus: "FAILED",
      failureMessage: "Automation stopped.",
      failedAt: "2026-08-31T16:00:00.000Z",
      followUpSteps: [{ ...openStep, dueAt: "2026-08-30T18:00:00.000Z" }],
      completedStepCount: 0,
      requiredMissingCount: 2,
      nowMs: NOW,
    })

    assert.equal(priority.kind, "WORKFLOW_ATTENTION")
    assert.equal(priority.action, "FOLLOW_UP")

    const needsReview = getServiceOverviewPriority({
      followUpRunStatus: "NEEDS_REVIEW",
      followUpSteps: [openStep],
      completedStepCount: 0,
      requiredMissingCount: 0,
      nowMs: NOW,
    })

    assert.equal(needsReview.kind, "WORKFLOW_ATTENTION")
    assert.equal(needsReview.title, "Follow-up workflow needs review")
  })

  test("prioritizes an overdue step over missing requirements", () => {
    const priority = getServiceOverviewPriority({
      followUpSteps: [{ ...openStep, dueAt: "2026-08-30T18:00:00.000Z" }],
      completedStepCount: 0,
      requiredMissingCount: 1,
      nowMs: NOW,
    })

    assert.equal(priority.kind, "OVERDUE_FOLLOW_UP")
  })

  test("promotes explicitly missing required checklist items", () => {
    const priority = getServiceOverviewPriority({
      followUpSteps: [openStep],
      completedStepCount: 0,
      requiredMissingCount: 2,
      nowMs: NOW,
    })

    assert.equal(priority.kind, "MISSING_REQUIREMENTS")
    assert.equal(priority.action, "CHECKLIST")
  })

  test("uses the next open follow-up when there are no blockers", () => {
    const priority = getServiceOverviewPriority({
      followUpSteps: [openStep],
      completedStepCount: 0,
      requiredMissingCount: 0,
      nextFollowUpAt: "2026-09-01T18:00:00.000Z",
      nowMs: NOW,
    })

    assert.equal(priority.kind, "NEXT_FOLLOW_UP")
    assert.equal(priority.dateAt, "2026-09-01T18:00:00.000Z")
  })

  test("recognizes completed and unconfigured workflows", () => {
    const completed = getServiceOverviewPriority({
      followUpSteps: [
        { title: "Done", status: "COMPLETED", dueAt: null },
        { title: "Not needed", status: "SKIPPED", dueAt: null },
      ],
      completedStepCount: 2,
      requiredMissingCount: 0,
      nowMs: NOW,
    })
    const unconfigured = getServiceOverviewPriority({
      followUpSteps: [],
      completedStepCount: 0,
      requiredMissingCount: 0,
      nowMs: NOW,
    })

    assert.equal(completed.kind, "FOLLOW_UP_COMPLETE")
    assert.equal(unconfigured.kind, "NO_WORKFLOW")
  })
})
