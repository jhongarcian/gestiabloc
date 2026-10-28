"use client"

import { useId } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { serviceActionPickerOptions } from "@/lib/service-automation-action"
import { type EnrollmentServiceTriggerType, type ServiceTriggerConfig } from "@/lib/service-automation-trigger"
import type { AutomationCatalog } from "./automation-types"

export function ServiceTriggerEditor({ draft, catalog, onChange }: {
  draft: { triggerType: EnrollmentServiceTriggerType; serviceGroupId?: string; serviceOfferingId?: string | null; serviceTriggerConfig?: ServiceTriggerConfig }
  catalog: AutomationCatalog
  onChange: (patch: { serviceGroupId?: string; serviceOfferingId?: string | null; serviceTriggerConfig?: ServiceTriggerConfig }) => void
}) {
  const id = useId()
  const config = draft.serviceTriggerConfig ?? {}
  const groups = (catalog.serviceStepServices ?? []).map(group => ({ ...group, subServices: group.subServices.filter(offering => offering.steps.length > 0) })).filter(group => group.subServices.length > 0)
  const selected = groups.find(group => group.id === draft.serviceGroupId)
  const options = serviceActionPickerOptions(catalog.serviceActionOfferings ?? [], undefined, draft.serviceOfferingId, draft.serviceGroupId)
  const update = (patch: Partial<ServiceTriggerConfig>) => onChange({ serviceTriggerConfig: { ...config, ...patch } })
  const picker = (label: string, value: string, choices: Array<{ id: string; name: string }>, change: (value: string) => void, disabled = false) => <Field>
    <FieldLabel htmlFor={`${id}-${label}`}>{label}</FieldLabel>
    <Select value={value} onValueChange={change} disabled={disabled}>
      <SelectTrigger id={`${id}-${label}`} className="w-full"><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger>
      <SelectContent><SelectGroup>
        {value && !choices.some(choice => choice.id === value) ? <SelectItem value={value} disabled>{label === "Checklist item" ? catalog.serviceChecklistReferences?.find(item => item.id === value)?.name ?? "Unavailable selection" : "Unavailable selection"}</SelectItem> : null}
        {choices.map(choice => <SelectItem key={choice.id} value={choice.id}>{choice.name}</SelectItem>)}
      </SelectGroup></SelectContent>
    </Select>
  </Field>
  const statuses = draft.triggerType === "SERVICE_CHECKLIST_STATUS_CHANGED" ? ["NOT_RECEIVED", "INFORMED", "MISSING", "RECEIVED"] : ["IN_PROGRESS", "PENDING_PAYMENT", "COMPLETED", "CANCELED"]
  const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ")
  return <FieldGroup>
    {picker("Service", draft.serviceGroupId ?? "", groups, value => onChange({ serviceGroupId: value, serviceOfferingId: null, serviceTriggerConfig: { ...config, ...(draft.triggerType === "SERVICE_CHECKLIST_STATUS_CHANGED" ? { checklistItemId: null } : {}) } }))}
    {picker("Sub-service", draft.serviceOfferingId === null ? "all" : draft.serviceOfferingId ?? "", [{ id: "all", name: "All sub-services" }, ...(selected?.subServices ?? [])], value => onChange({ serviceOfferingId: value === "all" ? null : value, serviceTriggerConfig: { ...config, ...(draft.triggerType === "SERVICE_CHECKLIST_STATUS_CHANGED" ? { checklistItemId: null } : {}) } }), !selected)}
    {draft.triggerType === "SERVICE_CHECKLIST_STATUS_CHANGED" ? picker("Checklist item", config.checklistItemId || "any", [{ id: "any", name: "Any item" }, ...options.checklistItems], value => update({ checklistItemId: value === "any" ? null : value }), !selected) : null}
    {draft.triggerType === "SERVICE_STATUS_CHANGED" || draft.triggerType === "SERVICE_CHECKLIST_STATUS_CHANGED" ? <>
      {picker("From status", config.previousStatus || "any", [{ id: "any", name: "Any status" }, ...statuses.map(value => ({ id: value, name: label(value) }))], value => update({ previousStatus: value === "any" ? null : value }))}
      {picker("To status", config.status || "any", [{ id: "any", name: "Any status" }, ...statuses.map(value => ({ id: value, name: label(value) }))], value => update({ status: value === "any" ? null : value }))}
    </> : null}
    {draft.triggerType === "SERVICE_PAYMENT_CHANGED" ? <>
      <FieldSet><FieldLegend>Payment changes</FieldLegend><FieldGroup>
        {(["ADDED", "UPDATED", "REMOVED"] as const).map(change => <Field key={change} orientation="horizontal">
          <Checkbox id={`${id}-${change}`} checked={(config.changes ?? ["ADDED", "UPDATED", "REMOVED"]).includes(change)} onCheckedChange={checked => update({ changes: checked ? [...new Set([...(config.changes ?? ["ADDED", "UPDATED", "REMOVED"]), change])] : (config.changes ?? ["ADDED", "UPDATED", "REMOVED"]).filter(value => value !== change) })} />
          <FieldLabel htmlFor={`${id}-${change}`}>{change === "UPDATED" ? "Edited" : label(change)}</FieldLabel>
        </Field>)}
        <FieldDescription>Choose at least one. Added includes initial payments. Edited includes amount, date, method, and note changes.</FieldDescription>
      </FieldGroup></FieldSet>
      {picker("Resulting payment balance", config.paymentState || "any", [{ id: "any", name: "Any balance" }, { id: "UNPAID", name: "Unpaid" }, { id: "PARTIAL", name: "Partly paid" }, { id: "PAID", name: "Paid in full" }], value => update({ paymentState: value === "any" ? null : value as ServiceTriggerConfig["paymentState"] }))}
    </> : null}
    <FieldDescription>Runs for changes to enrollments using service steps. Actions apply to that exact enrollment. This workflow does not delay step progression.</FieldDescription>
  </FieldGroup>
}
