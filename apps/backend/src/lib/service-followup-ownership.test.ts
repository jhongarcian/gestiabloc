import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import {
  buildFollowUpStepResolutionUpdate,
  isServiceFollowUpWorkflowCompleted,
  resolveUnanimousFollowUpCoordinator,
} from "./service-followup-ownership.js"

test("a completed run is locked even when step data is incomplete", () => {
  assert.equal(
    isServiceFollowUpWorkflowCompleted({
      runStatus: "COMPLETED",
      stepStatuses: ["ACTIVE"],
    }),
    true,
  )
})

test("legacy workflows are complete only when every enrolled step is resolved", () => {
  assert.equal(
    isServiceFollowUpWorkflowCompleted({
      runStatus: null,
      stepStatuses: ["COMPLETED", "SKIPPED"],
    }),
    true,
  )
  assert.equal(
    isServiceFollowUpWorkflowCompleted({
      runStatus: null,
      stepStatuses: ["COMPLETED", "PENDING"],
    }),
    false,
  )
  assert.equal(
    isServiceFollowUpWorkflowCompleted({ runStatus: null, stepStatuses: [] }),
    false,
  )
})

test("coordinator inference requires one unanimous non-null relevant assignee", () => {
  assert.equal(
    resolveUnanimousFollowUpCoordinator([
      { status: "ACTIVE", assignedToUserId: "user-1" },
      { status: "PENDING", assignedToUserId: "user-1" },
      { status: "COMPLETED", assignedToUserId: "user-2" },
    ]),
    "user-1",
  )
  assert.equal(
    resolveUnanimousFollowUpCoordinator([
      { status: "ACTIVE", assignedToUserId: "user-1" },
      { status: "PENDING", assignedToUserId: "user-2" },
    ]),
    null,
  )
  assert.equal(
    resolveUnanimousFollowUpCoordinator([
      { status: "COMPLETED", assignedToUserId: "user-1" },
      { status: "SKIPPED", assignedToUserId: "user-1" },
    ]),
    "user-1",
  )
})

test("user resolution captures the actor and reopening clears the current resolution", () => {
  const now = new Date("2026-09-01T15:30:00.000Z")
  assert.deepEqual(
    buildFollowUpStepResolutionUpdate({
      nextStatus: "COMPLETED",
      actorUserId: "user-2",
      now,
    }),
    { resolvedByUserId: "user-2", resolvedAt: now },
  )
  assert.deepEqual(
    buildFollowUpStepResolutionUpdate({
      action: "REOPEN",
      actorUserId: "user-3",
      now,
    }),
    { resolvedByUserId: null, resolvedAt: null },
  )
})

test("migration backfills only unanimous coordinators and reliable resolution actors", () => {
  const migration = readFileSync(
    resolve(
      __dirname,
      "../../prisma/migrations/20260901120000_followup_coordination_and_resolution/migration.sql",
    ),
    "utf8",
  )

  assert.match(migration, /COUNT\("assignedToUserId"\) = COUNT\(\*\)/)
  assert.match(migration, /COUNT\(DISTINCT "assignedToUserId"\) = 1/)
  assert.match(migration, /open_step\."status" NOT IN \('COMPLETED', 'SKIPPED'\)/)
  assert.match(migration, /execution_log\."eventType" = 'STEP_STATUS_UPDATED'/)
  assert.match(migration, /execution_log\."actorUserId" IS NOT NULL/)
  assert.match(migration, /step\."status"::TEXT = latest_resolution\."status"/)
})
