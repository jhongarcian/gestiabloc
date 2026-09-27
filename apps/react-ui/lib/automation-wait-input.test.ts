import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { parseAutomationWaitIntegerDraft } from "./automation-wait-input.js"

describe("parseAutomationWaitIntegerDraft", () => {
  test("keeps the input empty while the user replaces a value", () => {
    const parsed = parseAutomationWaitIntegerDraft("")
    assert.equal(parsed?.draft, "")
    assert.equal(Number.isNaN(parsed?.value), true)
  })

  test("accepts a replacement integer without retaining the previous zero", () => {
    assert.deepEqual(parseAutomationWaitIntegerDraft("1"), { draft: "1", value: 1 })
    assert.deepEqual(parseAutomationWaitIntegerDraft("01"), { draft: "1", value: 1 })
  })

  test("rejects non-integer characters", () => {
    assert.equal(parseAutomationWaitIntegerDraft("1.5"), null)
    assert.equal(parseAutomationWaitIntegerDraft("two"), null)
  })
})
