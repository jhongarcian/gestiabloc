import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { matchesContactChangeRules, type ContactChangeSnapshot } from "./contact-change-rules.js"

const before: ContactChangeSnapshot = {
  firstName: "Mary",
  dateOfBirth: new Date("1990-05-03T12:00:00.000Z"),
  statusConfigId: "active",
  assignedToUserId: "user-a",
  tags: [{ tagId: "old-tag" }],
  customFieldValues: [{ fieldId: "source", value: "Website" }, { fieldId: "score", value: 2 }],
}

const after: ContactChangeSnapshot = {
  ...before,
  firstName: "Maria",
  dateOfBirth: new Date("1991-05-03T12:00:00.000Z"),
  statusConfigId: "qualified",
  assignedToUserId: null,
  tags: [{ tagId: "new-tag" }],
  customFieldValues: [{ fieldId: "source", value: "Referral" }],
}

describe("contact change rules", () => {
  test("matches changed and changed-to values, including cleared fields", () => {
    assert.equal(matchesContactChangeRules([
      { source: "CONTACT_FIELD", operator: "HAS_CHANGED_TO", fieldKey: "firstName", compareValue: "Maria" },
      { source: "CONTACT_FIELD", operator: "HAS_CHANGED_TO", fieldKey: "dateOfBirth", compareValue: "1991-05-03" },
      { source: "CONTACT_CUSTOM_FIELD", operator: "HAS_CHANGED_TO", customFieldId: "score", compareValue: null },
      { source: "CONTACT_STATUS", operator: "HAS_CHANGED_TO", statusConfigId: "qualified" },
      { source: "CONTACT_ASSIGNEE", operator: "HAS_CHANGED_TO", assignedUserId: null },
    ], before, after), true)
    assert.equal(matchesContactChangeRules([
      { source: "CONTACT_CUSTOM_FIELD", operator: "HAS_CHANGED_TO", customFieldId: "source", compareValue: "Website" },
    ], before, after), false)
    assert.equal(matchesContactChangeRules([
      { source: "CONTACT_FIELD", operator: "HAS_CHANGED", fieldKey: "firstName" },
    ], after, after), false)
  })

  test("matches specific or any tag addition and removal", () => {
    assert.equal(matchesContactChangeRules([
      { source: "CONTACT_TAGS", operator: "ADDED", tagId: "new-tag" },
      { source: "CONTACT_TAGS", operator: "REMOVED", tagId: "old-tag" },
    ], before, after), true)
    assert.equal(matchesContactChangeRules([{ source: "CONTACT_TAGS", operator: "ADDED" }], before, after), true)
    assert.equal(matchesContactChangeRules([{ source: "CONTACT_TAGS", operator: "REMOVED" }], before, after), true)
    assert.equal(matchesContactChangeRules([{ source: "CONTACT_TAGS", operator: "ADDED", tagId: "old-tag" }], before, after), false)
  })

  test("requires all rules in one operation", () => {
    const rules = [
      { source: "CONTACT_FIELD" as const, operator: "HAS_CHANGED" as const, fieldKey: "firstName" },
      { source: "CONTACT_TAGS" as const, operator: "ADDED" as const, tagId: "new-tag" },
    ]
    assert.equal(matchesContactChangeRules(rules, before, after), true)
    assert.equal(matchesContactChangeRules(rules, before, { ...after, tags: before.tags }), false)
    assert.equal(matchesContactChangeRules(rules, { ...before, firstName: "Maria" }, after), false)
  })
})
