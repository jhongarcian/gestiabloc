import type {
  ServiceFitFieldDefinition,
  ServiceFitRuleDraft,
} from "../../_components/service-fit-rules-tab"
import type { AiQualification } from "./skills"

export const ruleKey = (value: string | null) =>
  value?.trim().toLowerCase() ?? ""
export const branchKey = (rule: ServiceFitRuleDraft) =>
  ruleKey(rule.requiredBranch) || ruleKey(rule.requiredGroup)
export function qualificationGroups(value: AiQualification) {
  const groups = new Map<
    string,
    {
      name: string
      rules: ServiceFitRuleDraft[]
      options: Map<string, { name: string; rules: ServiceFitRuleDraft[] }>
    }
  >()
  for (const rule of value.rules) {
    if (!rule.required || !ruleKey(rule.requiredGroup)) continue
    const key = ruleKey(rule.requiredGroup)
    const group: NonNullable<ReturnType<typeof groups.get>> = groups.get(
      key,
    ) ?? {
      name: rule.requiredGroup!.trim(),
      rules: [],
      options: new Map(),
    }
    const optionKey = branchKey(rule)
    const option = group.options.get(optionKey) ?? {
      name: rule.requiredBranch?.trim() || rule.requiredGroup!.trim(),
      rules: [],
    }
    option.rules.push(rule)
    group.rules.push(rule)
    group.options.set(optionKey, option)
    groups.set(key, group)
  }
  return [...groups.values()].map((group) => ({
    ...group,
    options: [...group.options.values()],
  }))
}
export function newCondition(
  field: ServiceFitFieldDefinition,
  required: boolean,
  group: string | null = null,
  option: string | null = null,
): ServiceFitRuleDraft {
  const operator = field.operators[0]
  return {
    id: crypto.randomUUID(),
    source: field.source,
    fieldKey: field.fieldKey,
    valueType: field.valueType,
    operator,
    compareValue: ["is_true", "is_false", "is_empty", "is_not_empty"].includes(
      operator,
    )
      ? null
      : field.valueType === "stringArray"
        ? []
        : "",
    required,
    requiredGroup: group,
    requiredBranch: option,
    weight: 1,
    label: null,
    explanation: null,
  }
}
export function requirementDescription(value: AiQualification, name: string) {
  return (
    value.requirementMetadata.find(
      (item) => ruleKey(item.name) === ruleKey(name),
    )?.description ?? ""
  )
}
export function optionDescription(
  value: AiQualification,
  group: string,
  option: string,
) {
  return (
    value.optionMetadata.find(
      (item) =>
        ruleKey(item.requirementName) === ruleKey(group) &&
        ruleKey(item.optionName) === ruleKey(option),
    )?.description ?? ""
  )
}
export function setRequirementDescription(
  value: AiQualification,
  name: string,
  description: string,
): AiQualification {
  return {
    ...value,
    requirementMetadata: [
      ...value.requirementMetadata.filter(
        (item) => ruleKey(item.name) !== ruleKey(name),
      ),
      { name, description },
    ],
  }
}
export function setOptionDescription(
  value: AiQualification,
  group: string,
  option: string,
  description: string,
): AiQualification {
  return {
    ...value,
    optionMetadata: [
      ...value.optionMetadata.filter(
        (item) =>
          !(
            ruleKey(item.requirementName) === ruleKey(group) &&
            ruleKey(item.optionName) === ruleKey(option)
          ),
      ),
      { requirementName: group, optionName: option, description },
    ],
  }
}
export function renameRequirement(
  value: AiQualification,
  previous: string,
  name: string,
): AiQualification {
  const key = ruleKey(previous)
  return {
    ...value,
    rules: value.rules.map((rule) =>
      rule.required && ruleKey(rule.requiredGroup) === key
        ? {
            ...rule,
            requiredGroup: name,
            // Pin the implicit option's old name so renaming a requirement to
            // another option's name cannot merge OR branches into one AND branch.
            requiredBranch: rule.requiredBranch?.trim() || previous.trim(),
          }
        : rule,
    ),
    requirementMetadata: value.requirementMetadata.map((item) =>
      ruleKey(item.name) === key ? { ...item, name } : item,
    ),
    optionMetadata: value.optionMetadata.map((item) =>
      ruleKey(item.requirementName) === key
        ? {
            ...item,
            requirementName: name,
          }
        : item,
    ),
  }
}
export function renameOption(
  value: AiQualification,
  group: string,
  previous: string,
  name: string,
): AiQualification {
  return {
    ...value,
    rules: value.rules.map((rule) =>
      rule.required &&
      ruleKey(rule.requiredGroup) === ruleKey(group) &&
      branchKey(rule) === ruleKey(previous)
        ? { ...rule, requiredBranch: name }
        : rule,
    ),
    optionMetadata: value.optionMetadata.map((item) =>
      ruleKey(item.requirementName) === ruleKey(group) &&
      ruleKey(item.optionName) === ruleKey(previous)
        ? { ...item, optionName: name }
        : item,
    ),
  }
}
export function uniqueRuleName(names: string[], label: string) {
  let n = 1
  while (names.some((name) => ruleKey(name) === ruleKey(`${label} ${n}`))) n++
  return `${label} ${n}`
}
export function validRuleDate(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false
  const day = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/)
  if (day) {
    const date = new Date(`${day[1]}-${day[2]}-${day[3]}T12:00:00Z`)
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== day[0].slice(0, 10)
    )
      return false
  }
  if (/^[\d/]+$/.test(value)) {
    const us = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    return us ? validRuleDate(`${us[3]}-${us[1]}-${us[2]}`) : false
  }
  return !Number.isNaN(new Date(value).getTime())
}
export function conditionError(
  rule: ServiceFitRuleDraft,
  fields: ServiceFitFieldDefinition[],
) {
  const field = fields.find(
    (item) => item.source === rule.source && item.fieldKey === rule.fieldKey,
  )
  if (!field)
    return "This saved field is no longer available. Choose another field or remove the condition."
  if (field.valueType !== rule.valueType)
    return "This field’s type has changed. Choose the field again to update the condition."
  if (!field.operators.includes(rule.operator))
    return "Choose an operator supported by this field."
  if (
    ["is_true", "is_false", "is_empty", "is_not_empty"].includes(rule.operator)
  )
    return ""
  const validValue = (value: unknown) =>
    field.valueType === "number"
      ? (typeof value === "string" || typeof value === "number") &&
        String(value).trim() !== "" &&
        /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(
          String(value).trim(),
        ) &&
        Number.isFinite(Number(value))
      : field.valueType === "date"
        ? validRuleDate(value)
        : typeof value === "string" && Boolean(value.trim())
  if (rule.operator === "between") {
    const range = rule.compareValue as { min?: unknown; max?: unknown } | null
    if (!range || !validValue(range.min) || !validValue(range.max))
      return "Enter a valid minimum and maximum."
    if (
      field.valueType === "number"
        ? Number(range.min) > Number(range.max)
        : new Date(String(range.min)).getTime() >
          new Date(String(range.max)).getTime()
    )
      return "The minimum must be at or below the maximum."
    return ""
  }
  if (field.valueType === "stringArray")
    return Array.isArray(rule.compareValue) && rule.compareValue.length > 0
      ? ""
      : "Choose at least one value."
  return validValue(rule.compareValue) ? "" : "Enter a valid comparison value."
}
export function qualificationErrors(
  value: AiQualification,
  fields: ServiceFitFieldDefinition[],
) {
  return Object.fromEntries(
    value.rules
      .map((rule) => [rule.id, conditionError(rule, fields)])
      .filter(([, error]) => error),
  )
}
