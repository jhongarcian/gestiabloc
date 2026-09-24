import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  buildContactTemplateToken,
  buildDateTemplateToken,
  partitionContactTemplateFields,
  validateContactTemplate,
} from "./contact-template"

const catalog = {
  customFields: [
    { key: "birthday", label: "Birthday", fieldType: "DATE" as const },
    { key: "balance", label: "Balance", fieldType: "CURRENCY" as const },
  ],
  templateFields: {
    contact: [
      { key: "name", label: "Full name", fieldType: "TEXT" as const },
      { key: "phone", label: "Phone", fieldType: "PHONE" as const },
      { key: "date_of_birth", label: "Date of birth", fieldType: "DATE" as const },
    ],
    dateFormats: [
      { value: "short" },
      { value: "medium" },
      { value: "long" },
      { value: "weekday" },
      { value: "iso" },
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
    assert.equal(
      buildDateTemplateToken({ kind: "CURRENT" }),
      "{date.current|date:medium}",
    )
    assert.equal(
      buildDateTemplateToken({ kind: "SPECIFIC", date: "2026-09-23", format: "iso" }),
      "{date.specific.2026-09-23|date:iso}",
    )
    assert.equal(buildDateTemplateToken({ kind: "SPECIFIC", date: "2026-02-30" }), "")
  })

  test("puts all date-valued fields only in the date category", () => {
    const fields = partitionContactTemplateFields(catalog)
    assert.deepEqual(fields.contactFields.map((field) => field.key), ["name", "phone"])
    assert.deepEqual(fields.customFields.map((field) => field.key), ["balance"])
    assert.deepEqual(
      fields.dateFields.map((field) => [field.source, field.key]),
      [["CONTACT", "date_of_birth"], ["CUSTOM_FIELD", "birthday"]],
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
    assert.equal(
      validateContactTemplate("Today {date.current|date:weekday}; fixed {date.specific.2026-09-23|date:long}.", catalog),
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
    assert.match(
      validateContactTemplate("{date.specific.2026-02-30|date:medium}", catalog) ?? "",
      /not a valid template value/,
    )
    assert.match(
      validateContactTemplate("{date.current|phone:national}", catalog) ?? "",
      /not a valid template value/,
    )
  })
})
