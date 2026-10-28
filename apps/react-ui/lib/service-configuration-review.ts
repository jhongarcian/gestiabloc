export type ConfigurationDifference = {
  section: string; label: string; kind: "ADD" | "UPDATE" | "REMOVE" | "PRESERVE"
  before: unknown; after: unknown; explanation?: string
}
export type ConfigurationPreview = {
  previewId: string; expiresAt: string; contactServiceId: string; serviceName: string; contactName: string
  canApply: boolean; hasChanges: boolean; blockers: string[]; differences: ConfigurationDifference[]; preserved: string[]
  references: Record<string, string>
}

const label = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase())
const fieldLabels: Record<string, string> = { isEnabled: "Published", sortOrder: "Order", serviceStepId: "Step", serviceGroupId: "Service", serviceOfferingId: "Sub-service", serviceTriggerConfig: "Trigger options", checklistItemId: "Checklist item", professionalId: "Professional", serviceConfig: "Options", targetSourceStepId: "Destination step", assignedToUserId: "Assignee", completionDuration: "Timeframe", completionUnit: "Unit", isRequired: "Required", customFieldId: "Contact custom field", tagId: "Tag", statusConfigId: "Contact status", assignedUserId: "User" }
export function configurationReviewValue(value: unknown, references: Record<string, string> = {}): string {
  if (value === null || value === undefined) return "None"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) return value.length ? value.map((item, index) => `${index + 1}. ${configurationReviewValue(item, references)}`).join("\n\n") : "None"
  if (typeof value === "object") return Object.entries(value)
    .filter(([key]) => !["id", "nodeKey", "tenantId", "automationId", "schemaVersion"].includes(key))
    .filter(([key, item]) => item !== null || !["serviceStepId", "serviceGroupId", "serviceTriggerConfig"].includes(key))
    .map(([key, item]) => `${fieldLabels[key] ?? label(key)}: ${item === null && key === "serviceOfferingId" ? "All sub-services" : item === null && ["previousStatus", "status", "checklistItemId", "paymentState"].includes(key) ? "Any" : configurationReviewValue(item, references)}`).join("\n") || "None"
  if (typeof value === "string" && references[value]) return references[value]
  if (value === "PARTIAL") return "Partly paid"
  if (value === "PAID") return "Paid in full"
  if (typeof value === "string" && /^[A-Z][A-Z_]+$/.test(value)) return label(value.toLowerCase())
  return String(value)
}

export function configurationReviewError(code: unknown) {
  if (code === "CONFIGURATION_PREVIEW_STALE") return "The enrollment or service configuration changed. Review it again before applying."
  if (code === "CONFIGURATION_PREVIEW_EXPIRED") return "This review expired. Refresh the review before applying."
  if (code === "CONFIGURATION_UPDATE_BLOCKED") return "This enrollment cannot receive the proposed changes. Refresh its review for details."
  return "We could not confirm this update. Refresh the review to check its result before trying again."
}
