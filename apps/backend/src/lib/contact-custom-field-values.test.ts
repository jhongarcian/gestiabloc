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

  test("normalizes every custom-field type used by multi-field automation actions", () => {
    const base = { id: "field", label: "Field", isRequired: false, options: [] as string[] }
    assert.deepEqual(
      normalizeCustomFieldValue({ ...base, fieldType: "TEXT" }, "  Text  "),
      { ok: true, value: "Text" },
    )
    assert.deepEqual(
      normalizeCustomFieldValue({ ...base, fieldType: "TEXTAREA" }, "Line 1\nLine 2"),
      { ok: true, value: "Line 1\nLine 2" },
    )
    assert.deepEqual(
      normalizeCustomFieldValue({ ...base, fieldType: "PHONE" }, "+15413134664"),
      { ok: true, value: "+15413134664" },
    )
    assert.deepEqual(
      normalizeCustomFieldValue({ ...base, fieldType: "CURRENCY" }, "125.50"),
      { ok: true, value: 125.5 },
    )
    const date = normalizeCustomFieldValue({ ...base, fieldType: "DATE" }, "2026-09-24")
    assert.equal(date.ok, true)
    if (date.ok) assert.match(String(date.value), /^2026-09-24T/)
    assert.deepEqual(
      normalizeCustomFieldValue(
        { ...base, fieldType: "MULTI_SELECT", options: ["Checking", "Savings"] },
        ["Checking", "Savings"],
      ),
      { ok: true, value: ["Checking", "Savings"] },
    )
    assert.deepEqual(
      normalizeCustomFieldValue(
        { ...base, fieldType: "RADIO", options: ["Yes", "No"] },
        "Yes",
      ),
      { ok: true, value: "Yes" },
    )
    assert.deepEqual(
      normalizeCustomFieldValue({ ...base, fieldType: "CHECKBOX" }, false),
      { ok: true, value: false },
    )
  })
})
