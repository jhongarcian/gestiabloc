import assert from "node:assert/strict"
import test from "node:test"

import { buildContactAssigneeUpdate } from "./contact-assignee-update.js"

test("omitting an assignee preserves the contact assignment", () => {
  const update = buildContactAssigneeUpdate(undefined)

  assert.deepEqual(update, {})
  assert.equal(Object.hasOwn(update, "assignedToUserId"), false)
})

test("an explicit null clears the contact assignment", () => {
  assert.deepEqual(buildContactAssigneeUpdate(null), {
    assignedToUserId: null,
  })
})

test("an explicit user changes the contact assignment", () => {
  assert.deepEqual(buildContactAssigneeUpdate("user-123"), {
    assignedToUserId: "user-123",
  })
})
