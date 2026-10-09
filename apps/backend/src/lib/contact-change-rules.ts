export type ContactChangeSnapshot = {
  firstName?: string | null
  middleName?: string | null
  lastName?: string | null
  statusConfigId: string | null
  assignedToUserId: string | null
  tags: Array<{ tagId: string }>
  customFieldValues: Array<{ fieldId: string; value: unknown }>
  [key: string]: unknown
}

export type ContactChangeRule = {
  source: "CONTACT_FIELD" | "CONTACT_CUSTOM_FIELD" | "CONTACT_STATUS" | "CONTACT_ASSIGNEE" | "CONTACT_TAGS"
  operator: "HAS_CHANGED" | "HAS_CHANGED_TO" | "ADDED" | "REMOVED"
  fieldKey?: string | null
  customFieldId?: string | null
  statusConfigId?: string | null
  assignedUserId?: string | null
  tagId?: string | null
  compareValue?: unknown
}

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value ?? null
}

function equal(left: unknown, right: unknown) {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right))
}

function fieldValue(snapshot: ContactChangeSnapshot, rule: ContactChangeRule) {
  if (rule.source === "CONTACT_FIELD") return rule.fieldKey ? comparable(snapshot[rule.fieldKey]) : null
  if (rule.source === "CONTACT_CUSTOM_FIELD") {
    return snapshot.customFieldValues.find((item) => item.fieldId === rule.customFieldId)?.value ?? null
  }
  if (rule.source === "CONTACT_STATUS") return snapshot.statusConfigId
  return snapshot.assignedToUserId
}

export function matchesContactChangeRules(
  rules: ContactChangeRule[],
  before: ContactChangeSnapshot,
  after: ContactChangeSnapshot,
) {
  if (rules.length === 0) return false
  return rules.every((rule) => {
    if (rule.source === "CONTACT_TAGS") {
      const previous = new Set(before.tags.map((item) => item.tagId))
      const current = new Set(after.tags.map((item) => item.tagId))
      if (rule.operator === "ADDED") {
        return rule.tagId
          ? !previous.has(rule.tagId) && current.has(rule.tagId)
          : [...current].some((id) => !previous.has(id))
      }
      if (rule.operator === "REMOVED") {
        return rule.tagId
          ? previous.has(rule.tagId) && !current.has(rule.tagId)
          : [...previous].some((id) => !current.has(id))
      }
      return false
    }
    const oldValue = fieldValue(before, rule)
    const newValue = fieldValue(after, rule)
    if (equal(oldValue, newValue)) return false
    if (rule.operator === "HAS_CHANGED") return true
    if (rule.operator !== "HAS_CHANGED_TO") return false
    const target = rule.source === "CONTACT_STATUS"
      ? rule.statusConfigId
      : rule.source === "CONTACT_ASSIGNEE"
        ? rule.assignedUserId
        : rule.compareValue
    return equal(newValue, target)
  })
}

export function contactSnapshotsDiffer(before: ContactChangeSnapshot, after: ContactChangeSnapshot) {
  if (!equal(before.statusConfigId, after.statusConfigId) || !equal(before.assignedToUserId, after.assignedToUserId)) return true
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  keys.delete("tags")
  keys.delete("customFieldValues")
  keys.delete("updatedAt")
  for (const key of keys) if (!equal(before[key], after[key])) return true
  if (!equal(before.tags.map((item) => item.tagId).sort(), after.tags.map((item) => item.tagId).sort())) return true
  const previous = new Map(before.customFieldValues.map((item) => [item.fieldId, item.value]))
  const current = new Map(after.customFieldValues.map((item) => [item.fieldId, item.value]))
  for (const key of new Set([...previous.keys(), ...current.keys()])) if (!equal(previous.get(key), current.get(key))) return true
  return false
}
