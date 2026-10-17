import assert from "node:assert/strict"
import { test } from "node:test"

import { hasTaskEnteredCompletedStatus } from "./task-priority-values.js"

test("task completion fires only when an existing task enters Completed", () => {
  assert.equal(hasTaskEnteredCompletedStatus("To Do", "Completed"), true)
  assert.equal(hasTaskEnteredCompletedStatus("In Progress", " completed "), true)
  assert.equal(hasTaskEnteredCompletedStatus("To Do", "To Do"), false)
  assert.equal(hasTaskEnteredCompletedStatus("Completed", "Completed"), false)
  assert.equal(hasTaskEnteredCompletedStatus("Completed", "In Progress"), false)
  assert.equal(hasTaskEnteredCompletedStatus("In Progress", "Completed"), true)
})
