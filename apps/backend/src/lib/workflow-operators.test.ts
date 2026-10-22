import assert from "node:assert/strict"
import { test } from "node:test"
import { evaluateWorkflowOperator as evaluate } from "./workflow-operators.js"

test("ordinary workflow conditions retain text, numeric, boolean, date and empty comparisons", () => {
  assert.equal(evaluate({ operator: "includes", valueType: "string", compareValue: "MEDICARE" }, "Medicare Advantage"), true)
  assert.equal(evaluate({ operator: "not_includes", valueType: "string", compareValue: "part b" }, "Medicare Advantage"), true)
  assert.equal(evaluate({ operator: "eq", valueType: "string", compareValue: "ACTIVE" }, "active"), true)
  assert.equal(evaluate({ operator: "gte", valueType: "number", compareValue: "10" }, 10), true)
  assert.equal(evaluate({ operator: "gt", valueType: "number", compareValue: 10 }, "not a number"), false)
  assert.equal(evaluate({ operator: "eq", valueType: "boolean", compareValue: "true" }, true), true)
  assert.equal(evaluate({ operator: "neq", valueType: "boolean", compareValue: true }, false), true)
  assert.equal(evaluate({ operator: "eq", valueType: "dateTime", compareValue: "2026-10-22T12:00:00Z" }, "2026-10-22T07:00:00-05:00"), true)
  assert.equal(evaluate({ operator: "lt", valueType: "dateTime", compareValue: "2026-10-22" }, "invalid"), false)
  for (const value of [null, undefined, " ", []]) assert.equal(evaluate({ operator: "is_empty", valueType: "string" }, value), true)
  assert.equal(evaluate({ operator: "is_not_empty", valueType: "number" }, 0), true)
})
