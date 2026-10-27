import assert from "node:assert/strict"
import { test } from "node:test"
import { buildServiceFitFieldCatalog, evaluateServiceFitProfile, normalizeServiceFitProfile, type ServiceFitContactSnapshot } from "./service-fit.js"
import { buildContactAssistantContext, contactContextForPrompt, explainContactService, presentContactScanItems, resolveContactServiceScope } from "./contact-assistant-context.js"

const catalog = buildServiceFitFieldCatalog({ statuses: [], tags: [], customFields:
  ["disability", "partA", "partB", "protected"].map((key) => ({ id: key, key, label: key === "disability" ? "Disability" : key, description: null, fieldType: "CHECKBOX", options: [] })) })
const profile = normalizeServiceFitProfile({ enabled: true, rules: [
  { id: "age", source: "derived", fieldKey: "ageYears", valueType: "number", operator: "greater_than_or_equal", compareValue: 64, required: true, requiredGroup: "Age or disability", requiredBranch: "Age" },
  { id: "disability", source: "custom", fieldKey: "disability", valueType: "boolean", operator: "is_true", required: true, requiredGroup: "Age or disability", requiredBranch: "Disability" },
  ...[false, true].flatMap((partA) => [
    { id: `a-${partA}`, source: "custom", fieldKey: "partA", valueType: "boolean", operator: partA ? "is_true" : "is_false", required: true, requiredGroup: "Coverage", requiredBranch: String(partA) },
    { id: `b-${partA}`, source: "custom", fieldKey: "partB", valueType: "boolean", operator: "is_false", required: true, requiredGroup: "Coverage", requiredBranch: String(partA) },
  ]),
] })
function fixture(values: Record<string, unknown> = { disability: false, partA: false, partB: false }, rules = profile) {
  const contact: ServiceFitContactSnapshot = { id: "contact", firstName: "Morgan", middleName: null, lastName: "Reed", email: null, phoneNumber: null, secondaryPhoneNumber: null,
    dateOfBirth: `${new Date().getUTCFullYear() - 56}-01-01`, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, country: null, statusConfigId: null, tagIds: [], customFieldValues: values }
  const result = evaluateServiceFitProfile({ profile: rules, contact, catalog, timezone: "UTC" })
  const item = { ...result, serviceId: "medicare", serviceName: "Medicare", summary: "", explanation: null, fitProfile: rules,
    recommendedUpdates: [], configurationGapNotes: [], hasPurchased: false, hasActiveEnrollment: false, currentContactServiceStatus: null }
  const context = buildContactAssistantContext({ contact, catalog, items: [item], restrictedCustomKeys: ["protected"], timezone: "UTC" })
  return { contact, item, context, service: context.services[0]! }
}

test("explains actual age and every alternative, preserving the canonical qualification result", () => {
  const { context, service, item } = fixture()
  assert.equal(item.eligibilityStatus, "NOT_ELIGIBLE")
  assert.equal(service.groups[0]?.ways.length, 2)
  const answer = explainContactService(context, service)
  assert.match(answer, /Morgan Reed is 56 years old/)
  assert.match(answer, /at least 64/)
  assert.match(answer, /Disability is No/)
  assert.doesNotMatch(answer, /does not satisfy|is greater_than|configured rules/)
  const [presented] = presentContactScanItems([item], context)
  assert.equal(presented?.eligibilityStatus, item.eligibilityStatus)
  assert.equal(presented?.fitScore, item.fitScore)
  assert.equal(presented?.explanation, answer)
})

test("a complete alternate path qualifies, while a missing disability value stays unknown", () => {
  for (const partA of [false, true]) {
    const { service } = fixture({ disability: true, partA, partB: false })
    assert.equal(service.status, "ELIGIBLE")
  }
  const { context, service } = fixture({ partA: false, partB: false })
  assert.equal(service.status, "NEEDS_INFO")
  const disability = service.groups[0]!.ways[1]!.checks[0]!
  assert.equal(disability.outcome, "missing")
  assert.match(explainContactService(context, service), /Disability is not recorded/)
  assert.equal(fixture({ disability: true, partA: true, partB: true }).service.status, "NOT_ELIGIBLE")
})

test("strict and inclusive age thresholds retain their exact meaning", () => {
  for (const [operator, wording, expected] of [["greater_than", "more than 56", "NOT_ELIGIBLE"], ["greater_than_or_equal", "at least 56", "ELIGIBLE"]] as const) {
    const rules = normalizeServiceFitProfile({ enabled: true, rules: [{ ...profile.rules[0], operator, compareValue: 56, requiredGroup: null, requiredBranch: null }] })
    const { service } = fixture({}, rules)
    assert.equal(service.status, expected)
    assert.equal(service.required[0]?.needs, wording)
  }
})

test("protected rules never reveal current values, comparisons or raw engine reasons", () => {
  const rules = normalizeServiceFitProfile({ enabled: true, rules: [{ id: "protected-rule", source: "custom", fieldKey: "protected", valueType: "string", operator: "equals", compareValue: "SECRET_EXPECTED", required: true }] })
  const { context, service, item } = fixture({ protected: "SECRET_CURRENT" }, rules)
  item.blockingRules = [{ ruleId: "protected-rule", label: "Protected", reason: "SECRET_RAW_REASON" }]
  const safe = JSON.stringify([contactContextForPrompt(context), explainContactService(context, service), presentContactScanItems([item], context)[0]?.blockingRules])
  for (const secret of ["SECRET_CURRENT", "SECRET_EXPECTED", "SECRET_RAW_REASON"]) assert.equal(safe.includes(secret), false)
  assert.equal(service.required[0]?.outcome, "protected")
})

test("prompt budgets retain whole alternative trees and flag omitted context", () => {
  const { context } = fixture()
  context.facts = Array.from({ length: 150 }, (_, index) => ({ detail: `Field ${index}`, value: "x".repeat(1000) }))
  const prompt = contactContextForPrompt(context)
  assert.ok(JSON.stringify(prompt.facts).length < 8100)
  assert.equal(prompt.services[0]?.groups[0]?.ways.length, 2)
  assert.equal(prompt.limited, true)
  context.services[0]!.required = Array.from({ length: 100 }, () => ({ id: "large", label: "Large", current: "x".repeat(1000), needs: "", explanation: "", outcome: "blocked" }))
  assert.equal(contactContextForPrompt(context).services.length, 0)
})

test("typed service names change scope; ambiguous names stay broad and exact names win", () => {
  const skills = [{ serviceId: "medicare", serviceName: "Medicare" }, { serviceId: "registration", serviceName: "Registration" }, { serviceId: "renewal", serviceName: "Registration renewal" }]
  assert.equal(resolveContactServiceScope("Why not Medicare?", skills, "registration"), "medicare")
  assert.equal(resolveContactServiceScope("And what about the minimum age?", skills, "medicare"), "medicare")
  assert.equal(resolveContactServiceScope("Compare Medicare and registration", skills, "medicare"), undefined)
  assert.equal(resolveContactServiceScope("Tell me about renewal", skills, "medicare"), "renewal")
})

test("unconfigured qualification is unknown, while other services' verdicts stay outside a selected-service prompt", () => {
  const { context } = fixture()
  context.skills = [{ serviceId: "medicare", serviceName: "Medicare" }, { serviceId: "consult", serviceName: "Consultation" }]
  const prompt = contactContextForPrompt(context, ["consult"])
  assert.deepEqual(prompt.catalog.find((service) => service.serviceId === "consult"), { serviceId: "consult", serviceName: "Consultation", qualificationConfigured: false, status: null })
  assert.equal("status" in prompt.catalog.find((service) => service.serviceId === "medicare")!, false)
  assert.equal(prompt.services.length, 0)
})
