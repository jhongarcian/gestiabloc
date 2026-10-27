import {
  evaluateServiceFitProfile, resolveServiceFitRuleValue,
  type ServiceFitContactSnapshot, type ServiceFitFieldDefinition, type ServiceFitRule,
} from "./service-fit.js"
import type { ServiceFitAssistantScanItem } from "./service-fit-assistant.js"

export type ContactRuleEvidence = {
  id: string; label: string; current: string; needs: string
  outcome: "matched" | "blocked" | "missing" | "protected"
  explanation: string
}
export type ContactServiceEvidence = {
  serviceId: string; serviceName: string; status: string; score: number
  required: ContactRuleEvidence[]
  groups: { name: string; ways: { name: string; checks: ContactRuleEvidence[] }[] }[]
  preferences: ContactRuleEvidence[]
}
export type ContactAssistantContext = {
  contactName: string
  facts: { detail: string; value: string }[]
  services: ContactServiceEvidence[]
  skills?: { serviceId: string; serviceName: string }[]
}

function displayValue(value: unknown, field: ServiceFitFieldDefinition): string {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return "not recorded"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => displayValue(item, field)).join(", ")
  if (field.valueType === "date") {
    const date = new Date(String(value))
    return Number.isNaN(date.getTime()) ? "not recorded" : date.toISOString().slice(0, 10)
  }
  return (field.options.find((option) => option.value === String(value))?.label ?? String(value)).slice(0, 1000)
}
function expectedValue(rule: ServiceFitRule, field: ServiceFitFieldDefinition) {
  if (rule.operator === "is_true") return "Yes"
  if (rule.operator === "is_false") return "No"
  if (rule.operator === "is_empty") return "to be empty"
  if (rule.operator === "is_not_empty") return "to be provided"
  if (rule.operator === "between") {
    const range = rule.compareValue as { min: unknown; max: unknown }
    return `between ${displayValue(range.min, field)} and ${displayValue(range.max, field)} (including both limits)`
  }
  const comparison = displayValue(rule.compareValue, field)
  const verbs = { equals: "equal to", not_equals: "different from", contains: "to contain", not_contains: "not to contain", greater_than: "more than", greater_than_or_equal: "at least", less_than: "less than", less_than_or_equal: "at most", includes_any: "at least one of", includes_all: "all of", excludes_all: "none of" }
  return `${verbs[rule.operator as keyof typeof verbs]} ${comparison}`
}

export function buildContactAssistantContext(params: {
  contact: ServiceFitContactSnapshot
  catalog: ServiceFitFieldDefinition[]
  restrictedCustomKeys: string[]
  items: ServiceFitAssistantScanItem[]
  skills?: ContactAssistantContext["skills"]
  timezone?: string | null
}): ContactAssistantContext {
  const { contact, catalog, items, timezone } = params
  const restricted = new Set(params.restrictedCustomKeys)
  const fields = new Map(catalog.map((field) => [`${field.source}:${field.fieldKey}`, field]))
  const name = [contact.firstName, contact.middleName, contact.lastName].filter(Boolean).join(" ").trim().slice(0, 160) || "This contact"
  const evidence = (rule: ServiceFitRule): ContactRuleEvidence => {
    const field = fields.get(`${rule.source}:${rule.fieldKey}`)
    if (!field || (rule.source === "custom" && restricted.has(rule.fieldKey))) return {
      id: rule.id, label: "Protected or unavailable detail", current: "unavailable to the assistant", needs: "review in the contact record", outcome: "protected",
      explanation: "A check uses protected or unavailable information. Its value is not available to the assistant.",
    }
    const result = evaluateServiceFitProfile({
      profile: { enabled: true, summary: "", rules: [{ ...rule, required: true, requiredGroup: null, requiredBranch: null }], requirementMetadata: [], optionMetadata: [], verificationProfile: { mode: "NONE", guidance: "", sourceUrls: [], triggerKeywords: [] }, knowledgeProfile: { overview: "", pricingNotes: "", workflowNotes: "", faqNotes: "", adapter: "NONE" } },
      contact, catalog, timezone,
    })
    const outcome = result.matchedRules.length ? "matched" : result.missingRules.length ? "missing" : "blocked"
    const current = displayValue(resolveServiceFitRuleValue(rule, contact, timezone), field)
    const needs = expectedValue(rule, field)
    const label = field.label
    const isAge = rule.source === "derived" && rule.fieldKey === "ageYears"
    const explanation = outcome === "missing"
      ? `${label} is not recorded; this check needs ${needs}.`
      : isAge ? `${name} is ${current} years old; this check needs an age ${needs}.`
        : `${label} is ${current}; this check needs ${needs}.`
    return { id: rule.id, label, current, needs, outcome, explanation }
  }
  const services = items.map((item): ContactServiceEvidence => {
    const rules = item.fitProfile?.rules ?? []
    const groups = new Map<string, { name: string; ways: Map<string, { name: string; checks: ContactRuleEvidence[] }> }>()
    for (const rule of rules.filter((rule) => rule.required && rule.requiredGroup?.trim())) {
      const groupName = rule.requiredGroup!.trim(), wayName = rule.requiredBranch?.trim() || groupName
      const key = groupName.toLowerCase(), wayKey = wayName.toLowerCase()
      const group = groups.get(key) ?? { name: groupName, ways: new Map() }
      const way = group.ways.get(wayKey) ?? { name: wayName, checks: [] }
      way.checks.push(evidence(rule)); group.ways.set(wayKey, way); groups.set(key, group)
    }
    return { serviceId: item.serviceId, serviceName: item.serviceName, status: item.eligibilityStatus, score: item.fitScore,
      required: rules.filter((rule) => rule.required && !rule.requiredGroup?.trim()).map(evidence),
      groups: [...groups.values()].map((group) => ({ name: group.name, ways: [...group.ways.values()] })),
      preferences: rules.filter((rule) => !rule.required).map(evidence) }
  })
  const facts = catalog.filter((field) => !(field.source === "custom" && restricted.has(field.fieldKey)))
    .map((field) => ({ detail: field.label, value: displayValue(resolveServiceFitRuleValue({ source: field.source, fieldKey: field.fieldKey } as ServiceFitRule, contact, timezone), field) }))
    .filter((fact) => fact.value !== "not recorded")
  return { contactName: name, facts, services, skills: params.skills }
}

export function explainContactService(context: ContactAssistantContext, service: ContactServiceEvidence) {
  const sentences: string[] = []
  const requiredIssues = service.required.filter((check) => check.outcome !== "matched")
  sentences.push(...requiredIssues.map((check) => check.explanation))
  for (const group of service.groups) {
    if (group.ways.some((way) => way.checks.every((check) => check.outcome === "matched"))) continue
    sentences.push(`${group.name} can be met in one of these ways: ${group.ways.map((way) => way.checks.map((check) => check.explanation).join(" ")).join(" Alternatively, ")}`)
  }
  if (!sentences.length && service.status === "ELIGIBLE") {
    sentences.push(...service.required.slice(0, 2).map((check) => check.explanation))
    for (const group of service.groups) {
      const passed = group.ways.find((way) => way.checks.every((check) => check.outcome === "matched"))
      if (passed) sentences.push(`${group.name} is met through ${passed.name}. ${passed.checks.map((check) => check.explanation).join(" ")}`)
    }
  }
  const opening = service.status === "ELIGIBLE" ? `${context.contactName} meets the qualification checks for ${service.serviceName}.`
    : service.status === "NEEDS_INFO" ? `More information is needed to confirm whether ${context.contactName} qualifies for ${service.serviceName}.`
      : `${context.contactName} does not currently qualify for ${service.serviceName}.`
  return `${opening} ${sentences.join(" ")}`.trim()
}

export function presentContactScanItems<T extends ServiceFitAssistantScanItem>(items: T[], context?: ContactAssistantContext): T[] {
  if (!context) return items
  return items.map((item) => {
    const service = context.services.find((entry) => entry.serviceId === item.serviceId)
    if (!service) return item
    const checks = [...service.required, ...service.groups.flatMap((group) => group.ways.flatMap((way) => way.checks)), ...service.preferences]
    const present = (entries: T["matchedRules"]) => entries.map((entry) => ({ ...entry, reason: checks.find((check) => check.id === entry.ruleId)?.explanation ?? "This check needs review in the contact record." }))
    return { ...item, explanation: explainContactService(context, service), explanationSource: "deterministic", matchedRules: present(item.matchedRules), blockingRules: present(item.blockingRules), missingRules: present(item.missingRules) }
  })
}

export function contactContextForPrompt(context: ContactAssistantContext, serviceIds?: string[]) {
  const selected = serviceIds ? context.services.filter((service) => serviceIds.includes(service.serviceId)) : context.services
  const included: ContactServiceEvidence[] = []
  let size = 0
  for (const service of selected) {
    const length = JSON.stringify(service).length
    if (size + length > 22000 || included.length >= 12) continue
    included.push(service); size += length
  }
  const facts: ContactAssistantContext["facts"] = []
  let factSize = 0
  for (const fact of context.facts) {
    const length = JSON.stringify(fact).length
    if (facts.length >= 100 || factSize + length > 8000) continue
    facts.push(fact); factSize += length
  }
  const skills = context.skills ?? context.services
  return { contactName: context.contactName, facts, services: included,
    catalog: skills.slice(0, 100).map(({ serviceId, serviceName }) => ({ serviceId, serviceName,
      status: context.services.find((service) => service.serviceId === serviceId)?.status ?? "NOT_CONFIGURED" })),
    limited: included.length !== selected.length || facts.length !== context.facts.length || skills.length > 100 }
}

export function resolveContactServiceScope(question: string, items: { serviceId: string; serviceName: string }[], selectedId?: string) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  const text = ` ${normalize(question)} `
  const stop = new Set(["service", "services", "application", "assistance", "guidance", "support", "help"])
  const exact = items.filter((item) => text.includes(` ${normalize(item.serviceName)} `))
  if (exact.length === 1) return exact[0]!.serviceId
  if (exact.length > 1) return undefined
  const matches = items.filter((item) => {
    const name = normalize(item.serviceName)
    return name.split(" ").some((word) => word.length >= 4 && !stop.has(word) && text.includes(` ${word} `))
  })
  if (matches.length === 1) return matches[0]!.serviceId
  if (matches.length > 1) return undefined
  if (/\b(all|every|other|available)\s+(active\s+)?services\b|\b(todos|otros)\s+los\s+servicios\b/.test(text)) return undefined
  return selectedId
}
