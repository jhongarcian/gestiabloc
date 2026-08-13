import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { normalizeCustomFieldValue } from "./contact-custom-field-values.js"

describe("normalizeCustomFieldValue", () => {
  test("normalizes typed automation values", () => {
    const numberResult = normalizeCustomFieldValue(
      { id: "number", label: "Score", fieldType: "NUMBER", isRequired: false, options: [] },
      "42",
    )
    assert.deepEqual(numberResult, { ok: true, value: 42 })

    const selectResult = normalizeCustomFieldValue(
      {
        id: "select",
        label: "Tier",
        fieldType: "SELECT",
        isRequired: true,
        options: ["Gold", "Silver"],
      },
      "Gold",
    )
    assert.deepEqual(selectResult, { ok: true, value: "Gold" })
  })

  test("rejects invalid options and required empty values", () => {
    const invalidOption = normalizeCustomFieldValue(
      {
        id: "select",
        label: "Tier",
        fieldType: "SELECT",
        isRequired: false,
        options: ["Gold"],
      },
      "Bronze",
    )
    assert.equal(invalidOption.ok, false)

    const required = normalizeCustomFieldValue(
      { id: "text", label: "Code", fieldType: "TEXT", isRequired: true, options: [] },
      "",
    )
    assert.equal(required.ok, false)
  })
})
