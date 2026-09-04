import assert from "node:assert/strict"
import test from "node:test"

import { canChangeServiceFollowUpStepAssignee } from "./service-followup-step-permissions.js"

test("allows assignment changes for open follow-up steps", () => {
  assert.equal(canChangeServiceFollowUpStepAssignee("PENDING"), true)
  assert.equal(canChangeServiceFollowUpStepAssignee("ACTIVE"), true)
  assert.equal(canChangeServiceFollowUpStepAssignee("POSTPONED"), true)
})

test("locks assignment changes for completed and skipped follow-up steps", () => {
  assert.equal(canChangeServiceFollowUpStepAssignee("COMPLETED"), false)
  assert.equal(canChangeServiceFollowUpStepAssignee("SKIPPED"), false)
})
