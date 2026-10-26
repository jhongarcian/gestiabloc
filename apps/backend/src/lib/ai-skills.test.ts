import assert from "node:assert/strict"
import { test } from "node:test"
import {
  AiQualificationSchema,
  AiQualificationUpdateSchema,
  AiSkillError,
  aiSkillRevision,
  mergeAiQualification,
  qualificationFields,
  qualificationReadOnlyReason,
} from "./ai-skills.js"
import {
  buildServiceFitFieldCatalog,
  evaluateServiceFitProfile,
  normalizeServiceFitProfile,
} from "./service-fit.js"

const fields = buildServiceFitFieldCatalog({
  statuses: [],
  tags: [],
  customFields: [],
})
const raw = {
  enabled: true,
  summary: "Existing eligibility",
  rules: [
    {
      id: "age",
      source: "derived",
      fieldKey: "ageYears",
      valueType: "number",
      operator: "greater_than_or_equal",
      compareValue: 18,
      required: true,
      requiredGroup: "Eligibility",
      requiredBranch: null,
      weight: 1,
      label: "Adult",
      explanation: "At least 18",
      extension: { kept: true },
    },
    {
      id: "email",
      source: "core",
      fieldKey: "email",
      valueType: "string",
      operator: "is_not_empty",
      compareValue: null,
      required: false,
      weight: 8,
      label: "Email",
      explanation: "For communication",
    },
  ],
  requirementMetadata: [{ name: "Eligibility", description: "Must qualify" }],
  optionMetadata: [
    {
      requirementName: "Eligibility",
      optionName: "Eligibility",
      description: "Adult option",
    },
  ],
  knowledgeProfile: {
    overview: "Existing knowledge",
    faqNotes: "Unstructured legacy FAQ",
    future: { intact: true },
  },
  verificationProfile: {
    mode: "ALWAYS",
    sourceUrls: ["https://example.test"],
    future: [1, 2],
  },
  futureTopLevel: { preserved: true },
}
const qualification = () => qualificationFields(normalizeServiceFitProfile(raw))

test("qualification revisions are stable across object key order and change with any saved profile data", () => {
  assert.equal(
    aiSkillRevision({ b: [1, { y: 2, x: 1 }], a: true }),
    aiSkillRevision({ a: true, b: [1, { x: 1, y: 2 }] }),
  )
  assert.notEqual(
    aiSkillRevision(raw),
    aiSkillRevision({ ...raw, knowledgeProfile: {} }),
  )
  assert.notEqual(aiSkillRevision([1, 2]), aiSkillRevision([2, 1]))
})
test("qualification saves preserve legacy knowledge, verification, extensions, descriptions, and weighted rules", () => {
  const updated = mergeAiQualification(raw, qualification(), fields)
  assert.deepEqual(updated.knowledgeProfile, raw.knowledgeProfile)
  assert.deepEqual(updated.verificationProfile, raw.verificationProfile)
  assert.deepEqual(updated.futureTopLevel, raw.futureTopLevel)
  const normalized = normalizeServiceFitProfile(updated)
  assert.deepEqual(qualificationFields(normalized), qualification())
  assert.deepEqual(
    (updated.rules as Array<Record<string, unknown>>)[0].extension,
    { kept: true },
  )
  assert.equal(normalized.rules[1].weight, 8)
})
test("saved qualification changes are used by the existing deterministic engine", () => {
  const catalog = fields
  const contact = {
    id: "contact",
    firstName: "Case",
    middleName: null,
    lastName: "Test",
    dateOfBirth: "1980-01-01",
    email: "case@example.test",
    phoneNumber: null,
    secondaryPhoneNumber: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    statusConfigId: null,
    tagIds: [],
    customFieldValues: {},
  }
  const before = evaluateServiceFitProfile({
    profile: normalizeServiceFitProfile(raw),
    catalog,
    contact,
    timezone: "UTC",
  })
  const changed = qualification()
  changed.rules[0].compareValue = 100
  const saved = mergeAiQualification(raw, changed, fields)
  const after = evaluateServiceFitProfile({
    profile: normalizeServiceFitProfile(saved),
    catalog,
    contact,
    timezone: "UTC",
  })
  assert.equal(before.eligibilityStatus, "ELIGIBLE")
  assert.equal(after.eligibilityStatus, "NOT_ELIGIBLE")
})
test("strict request schema rejects duplicate condition IDs, unknown writes, and invalid revisions", () => {
  const value = qualification()
  assert.equal(
    AiQualificationSchema.safeParse({
      ...value,
      rules: [value.rules[0], value.rules[0]],
    }).success,
    false,
  )
  assert.equal(
    AiQualificationUpdateSchema.safeParse({
      revision: aiSkillRevision(raw),
      qualification: value,
      fitProfile: {},
    }).success,
    false,
  )
  assert.equal(
    AiQualificationUpdateSchema.safeParse({
      revision: "stale",
      qualification: value,
    }).success,
    false,
  )
})
test("unsupported legacy conditions stay read-only instead of disappearing on save", () => {
  assert.equal(qualificationReadOnlyReason(null), null)
  assert.equal(qualificationReadOnlyReason(raw), null)
  for (const saved of [
    "bad",
    { rules: "bad" },
    { rules: [{ id: "unsupported", source: "unknown" }] },
    { ...raw, rules: [raw.rules[0], raw.rules[0]] },
  ]) {
    assert.ok(qualificationReadOnlyReason(saved))
    assert.throws(
      () => mergeAiQualification(saved, qualification(), fields),
      (error) =>
        error instanceof AiSkillError &&
        error.code === "AI_PROFILE_REVIEW_REQUIRED",
    )
  }
})
test("qualification-only saves reject bad numbers, reversed ranges, field types, operators, and unavailable fields", () => {
  for (const patch of [
    { compareValue: "18years" },
    { compareValue: "0x10" },
    { compareValue: "" },
    { operator: "between", compareValue: { min: 65, max: 18 } },
    { operator: "between", compareValue: { min: 18 } },
    { valueType: "string", compareValue: "18" },
    { operator: "contains" },
    { fieldKey: "unavailable" },
  ]) {
    const value = qualification()
    Object.assign(value.rules[0], patch)
    assert.throws(
      () => mergeAiQualification(raw, value, fields),
      (error) => error instanceof AiSkillError && error.status === 400,
    )
  }
})
test("date comparisons reject impossible dates and compare range instants instead of lexical strings", () => {
  for (const compareValue of [
    "2026-02-30",
    "02/30/2026",
    "03/2",
    "2026-01-01Tbad",
  ]) {
    const value = qualification()
    Object.assign(value.rules[0], {
      source: "core",
      fieldKey: "dateOfBirth",
      valueType: "date",
      compareValue,
    })
    assert.throws(() => mergeAiQualification(raw, value, fields))
  }
  const value = qualification()
  Object.assign(value.rules[0], {
    source: "core",
    fieldKey: "dateOfBirth",
    valueType: "date",
    operator: "between",
    compareValue: { min: "12/01/2025", max: "01/01/2026" },
  })
  assert.doesNotThrow(() => mergeAiQualification(raw, value, fields))
  Object.assign(value.rules[0], {
    compareValue: { min: "01/01/2026", max: "12/01/2025" },
  })
  assert.throws(() => mergeAiQualification(raw, value, fields))
})
