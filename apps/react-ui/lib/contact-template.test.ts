import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { buildContactTemplateToken, validateContactTemplate } from "./contact-template"

const catalog = {
  customFields: [
    { key: "birthday", label: "Birthday", fieldType: "DATE" as const },
    { key: "balance", label: "Balance", fieldType: "CURRENCY" as const },
  ],
  templateFields: {
    contact: [
      { key: "name", label: "Full name", fieldType: "TEXT" as const },
      { key: "phone", label: "Phone", fieldType: "PHONE" as const },
    ],
    dateFormats: [
      { value: "short" },
      { value: "medium" },
    ],
    phoneFormats: [
      { value: "national" },
      { value: "international" },
      { value: "e164" },
    ],
  },
}

describe("contact template UI helpers", () => {
  test("builds canonical tokens with type-aware defaults", () => {
    assert.equal(
      buildContactTemplateToken({ source: "CONTACT", key: "name", fieldType: "TEXT" }),
      "{contact.name}",
    )
    assert.equal(
      buildContactTemplateToken({ source: "CUSTOM_FIELD", key: "birthday", fieldType: "DATE" }),
      "{contact.custom_field.birthday|date:medium}",
    )
    assert.equal(
      buildContactTemplateToken({ source: "CUSTOM_FIELD", key: "balance", fieldType: "CURRENCY" }),
      "{contact.custom_field.balance|currency:USD}",
    )
  })

  test("validates supported tokens and preserves ordinary braces", () => {
    assert.equal(
      validateContactTemplate("Hello {contact.name}; {ordinary braces}.", catalog),
      null,
    )
    assert.equal(
      validateContactTemplate("Call {contact.phone|phone:e164}.", catalog),
      null,
    )
    assert.match(
      validateContactTemplate("{contact.name|date:medium}", catalog) ?? "",
      /valid date format/,
    )
    assert.match(
      validateContactTemplate("{contact.custom_field.removed}", catalog) ?? "",
      /not available/,
    )
  })
})
