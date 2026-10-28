import assert from "node:assert/strict"
import { test } from "node:test"
import {
  branchKey,
  conditionError,
  qualificationGroups,
  renameOption,
  renameRequirement,
  validRuleDate,
} from "./qualification"
import type { AiQualification } from "./skills"
import type {
  ServiceFitFieldDefinition,
  ServiceFitRuleDraft,
} from "../../_components/service-fit-rules-tab"

const rule = (
  id: string,
  group: string | null,
  branch: string | null,
  required = true,
): ServiceFitRuleDraft => ({
  id,
  source: "derived",
  fieldKey: "ageYears",
  valueType: "number",
  operator: "greater_than_or_equal",
  compareValue: 18,
  required,
  requiredGroup: group,
  requiredBranch: branch,
  weight: required ? 1 : 7,
  label: null,
  explanation: null,
})
const profile = (): AiQualification => ({
  enabled: true,
  summary: "Eligibility",
  rules: [
    rule("implicit", "Eligibility", null),
    rule("explicit", "Eligibility", "Eligibility"),
    rule("alternative", "Eligibility", "Other"),
    rule("global", null, "Legacy branch"),
    rule("scored", "Unused", "Unused", false),
  ],
  requirementMetadata: [
    { name: "Eligibility", description: "Requirement notes" },
  ],
  optionMetadata: [
    {
      requirementName: "Eligibility",
      optionName: "Eligibility",
      description: "Option notes",
    },
  ],
})
const fields: ServiceFitFieldDefinition[] = [
  {
    source: "derived",
    fieldKey: "ageYears",
    label: "Age",
    description: "Age",
    valueType: "number",
    operators: ["between", "greater_than_or_equal"],
    options: [],
  },
]

test("groups follow engine semantics: implicit/explicit options merge, shared and scored rules stay separate", () => {
  const groups = qualificationGroups(profile())
  assert.equal(groups.length, 1)
  assert.deepEqual(
    groups[0].options.map((option) => option.rules.map((item) => item.id)),
    [["implicit", "explicit"], ["alternative"]],
  )
})
test("renaming requirements keeps legacy AND membership, descriptions, and optional weights", () => {
  const next = renameRequirement(profile(), "Eligibility", "Updated")
  const group = qualificationGroups(next)[0]
  assert.equal(group.name, "Updated")
  assert.deepEqual(
    group.options[0].rules.map((item) => item.id),
    ["implicit", "explicit"],
  )
  assert.equal(next.requirementMetadata[0].description, "Requirement notes")
  assert.equal(next.optionMetadata[0].optionName, "Eligibility")
  assert.deepEqual(next.rules[4], profile().rules[4])
})
test("renaming a requirement to an existing option never merges alternative branches", () => {
  const next = renameRequirement(profile(), "Eligibility", "Other")
  assert.deepEqual(
    qualificationGroups(next)[0].options.map((option) =>
      option.rules.map((item) => item.id),
    ),
    [["implicit", "explicit"], ["alternative"]],
  )
})
test("renaming implicit options updates all conditions and their description", () => {
  const next = renameOption(profile(), "Eligibility", "Eligibility", "Adult")
  assert.equal(branchKey(next.rules[0]), "adult")
  assert.equal(branchKey(next.rules[1]), "adult")
  assert.equal(next.optionMetadata[0].optionName, "Adult")
  assert.equal(next.optionMetadata[0].description, "Option notes")
})
test("comparison validation rejects partial numbers, missing fields, unsupported operators and reversed ranges", () => {
  const base = rule("test", null, null)
  assert.equal(conditionError(base, fields), "")
  for (const patch of [
    { compareValue: "18years" },
    { compareValue: "0x12" },
    { operator: "between", compareValue: { min: 65, max: 18 } },
    { fieldKey: "missing" },
    { operator: "contains" },
  ]) {
    assert.ok(
      conditionError({ ...base, ...patch } as ServiceFitRuleDraft, fields),
    )
  }
})
test("date validation allows complete dates and rejects impossible dates and partial input", () => {
  for (const value of [
    "2026-02-30",
    "02/30/2026",
    "03/2",
    "2026-01-01Tbad",
    "",
    null,
  ])
    assert.equal(validRuleDate(value), false)
  for (const value of ["2024-02-29", "02/28/2026", "2026-03-01T12:00:00Z"])
    assert.equal(validRuleDate(value), true)
})
