import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { normalizeImportPhone, parseImportDate, prepareImportRow, suggestImportMappings, type ImportCatalog, type ImportMapping, type ImportSettings } from "./contact-import-fields.js"

const settings: ImportSettings = {
  dateFormat: "MM/DD/YYYY", phoneCountry: "US", multiSelectSeparator: ";", defaultStatusConfigId: "status-active",
}
const catalog: ImportCatalog = {
  statuses: [{ id: "status-active", name: "Active" }], leadSources: [{ name: "Referral" }],
  customFields: [{ id: "favorite-colors", key: "favorite_colors", label: "Favorite colors", fieldType: "MULTI_SELECT", isEncrypted: false, isSensitive: false, isRequired: false, options: ["Blue", "Green"] }],
}

describe("contact import field matching", () => {
  it("suggests standard and custom matches without assigning one target twice", () => {
    const mapping = suggestImportMappings(["First Name", "first_name", "Favorite colors", "Something else"], catalog.customFields)
    assert.deepEqual(mapping.map((item) => item.target), [
      { kind: "CONTACT_FIELD", key: "firstName" }, { kind: "IGNORE" },
      { kind: "CUSTOM_FIELD", fieldId: "favorite-colors" }, { kind: "IGNORE" },
    ])
  })

  it("normalizes names, email, phone, status, and custom options", () => {
    const mappings: ImportMapping[] = [
      { sourceIndex: 0, sourceHeader: "First", target: { kind: "CONTACT_FIELD", key: "firstName" } },
      { sourceIndex: 1, sourceHeader: "Last", target: { kind: "CONTACT_FIELD", key: "lastName" } },
      { sourceIndex: 2, sourceHeader: "Email", target: { kind: "CONTACT_FIELD", key: "email" } },
      { sourceIndex: 3, sourceHeader: "Phone", target: { kind: "CONTACT_FIELD", key: "phone" } },
      { sourceIndex: 4, sourceHeader: "Colors", target: { kind: "CUSTOM_FIELD", fieldId: "favorite-colors" } },
    ]
    const result = prepareImportRow([" Ada ", " Lovelace ", " ADA@example.com ", "(202) 555-0123", "blue; GREEN"], mappings, settings, catalog)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.row.email, "ada@example.com")
    assert.equal(result.row.phone, "+12025550123")
    assert.deepEqual(result.row.customValues[0].value, ["Blue", "Green"])
  })

  it("rejects impossible dates and missing names", () => {
    assert.equal(parseImportDate("02/30/2026", "MM/DD/YYYY"), null)
    assert.equal(parseImportDate("2026-02-30", "MM/DD/YYYY"), null)
    const result = prepareImportRow(["Ada", ""], [
      { sourceIndex: 0, sourceHeader: "First", target: { kind: "CONTACT_FIELD", key: "firstName" } },
      { sourceIndex: 1, sourceHeader: "Last", target: { kind: "CONTACT_FIELD", key: "lastName" } },
    ], settings, catalog)
    assert.deepEqual(result, { ok: false, code: "MISSING_NAME", message: "First name and last name are required." })
  })

  it("accepts contact-style and ISO dates without shifting the calendar day", () => {
    assert.equal(parseImportDate("10/05/2026", "MM/DD/YYYY")?.toISOString(), "2026-10-05T12:00:00.000Z")
    assert.equal(parseImportDate("2026-10-05", "MM/DD/YYYY")?.toISOString(), "2026-10-05T12:00:00.000Z")
    assert.equal(parseImportDate("05/10/2026", "DD/MM/YYYY")?.toISOString(), "2026-10-05T12:00:00.000Z")
    assert.equal(parseImportDate("10/05/2026", "YYYY-MM-DD"), null)
  })

  it("normalizes possible national phone numbers using the chosen country", () => {
    assert.equal(normalizeImportPhone("020 7946 0958", "GB"), "+442079460958")
    assert.equal(normalizeImportPhone("1234567890", "US"), "+11234567890")
    assert.equal(normalizeImportPhone("123", "US"), null)
    assert.equal(normalizeImportPhone("1234567890", "ZZ"), null)
  })

  it("prepares an ISO birth date and a formatted national phone in one CSV row", () => {
    const result = prepareImportRow(["Ada", "Lovelace", "2026-10-05", "020 7946 0958"], [
      { sourceIndex: 0, sourceHeader: "First", target: { kind: "CONTACT_FIELD", key: "firstName" } },
      { sourceIndex: 1, sourceHeader: "Last", target: { kind: "CONTACT_FIELD", key: "lastName" } },
      { sourceIndex: 2, sourceHeader: "DOB", target: { kind: "CONTACT_FIELD", key: "dateOfBirth" } },
      { sourceIndex: 3, sourceHeader: "Phone", target: { kind: "CONTACT_FIELD", key: "phone" } },
    ], { ...settings, phoneCountry: "GB" }, catalog)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal((result.row.contact.dateOfBirth as Date).toISOString(), "2026-10-05T12:00:00.000Z")
    assert.equal(result.row.phone, "+442079460958")
  })

  it("rejects an empty mapped required custom field", () => {
    const requiredCatalog = { ...catalog, customFields: [{ ...catalog.customFields[0], isRequired: true }] }
    const result = prepareImportRow(["Ada", "Lovelace", ""], [
      { sourceIndex: 0, sourceHeader: "First", target: { kind: "CONTACT_FIELD", key: "firstName" } },
      { sourceIndex: 1, sourceHeader: "Last", target: { kind: "CONTACT_FIELD", key: "lastName" } },
      { sourceIndex: 2, sourceHeader: "Colors", target: { kind: "CUSTOM_FIELD", fieldId: "favorite-colors" } },
    ], settings, requiredCatalog)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, "MISSING_REQUIRED_VALUE")
  })
})
