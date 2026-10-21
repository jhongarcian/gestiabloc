"use client"

import { useId } from "react"
import { DateTimeInput } from "@/components/ui/date-time-input"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { dateTimeDraftToUtcIso, formatUtcIsoToDateTimeDraft } from "@/lib/date-time"
import { terminalServiceAction, type ServiceActionConfig } from "@/lib/service-automation-action"
import type { AutomationAction, AutomationCatalog } from "./automation-types"

export function ServiceActionEditor({ action, catalog, onChange, timezone }: {
  action: AutomationAction; catalog: AutomationCatalog; onChange: (action: AutomationAction) => void; timezone?: string | null
}) {
  const id = useId()
  const config = action.serviceConfig ?? {}
  const update = (patch: Partial<ServiceActionConfig>) => onChange({ ...action, serviceConfig: { ...config, ...patch } })
  const options = catalog.serviceActionOptions ?? { steps: [], professionals: [], checklistItems: [] }
  const picker = (label: string, value: string, choices: Array<{ id: string; name: string }>, change: (value: string) => void, clear = false) => (
    <Field>
      <FieldLabel htmlFor={`${id}-${label}`}>{label}</FieldLabel>
      <Select value={value || (clear ? "unassigned" : "")} onValueChange={value => change(value === "unassigned" ? "" : value)}>
        <SelectTrigger id={`${id}-${label}`} className="w-full"><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger>
        <SelectContent>
          {clear ? <SelectItem value="unassigned">Unassigned</SelectItem> : null}
          {value && !choices.some(item => item.id === value) ? <SelectItem value={value} disabled>Unavailable selection</SelectItem> : null}
          {choices.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  )
  const schedule = config.schedule ?? { mode: "DURATION" as const, amount: 1, unit: "DAYS" as const }
  return <>
    <FieldDescription>Applies to the enrollment that started this workflow. Selections use its saved service configuration.</FieldDescription>
    {action.type === "MOVE_SERVICE_STEP" ? picker("Destination step", config.targetSourceStepId ?? "", options.steps, value => update({ targetSourceStepId: value })) : null}
    {action.type === "MOVE_SERVICE_STEP" || action.type === "SKIP_SERVICE_STEP" ? <Field>
      <FieldLabel htmlFor={`${id}-reason`}>Reason</FieldLabel>
      <Textarea id={`${id}-reason`} maxLength={1000} value={config.reason ?? ""} onChange={event => update({ reason: event.target.value })} />
      <FieldDescription>Saved in the enrollment history. Moving to an earlier step starts a new entry.</FieldDescription>
    </Field> : null}
    {action.type === "SET_SERVICE_STEP_OWNER" || action.type === "SET_SERVICE_COORDINATOR" ? picker(action.type === "SET_SERVICE_STEP_OWNER" ? "Step owner" : "Coordinator", config.assignedToUserId ?? "", catalog.users.map(user => ({ id: user.id, name: user.name || user.email })), value => update({ assignedToUserId: value || null }), true) : null}
    {action.type === "SET_SERVICE_PROFESSIONAL" ? picker("Professional", config.professionalId ?? "", options.professionals, value => update({ professionalId: value || null }), true) : null}
    {action.type === "SET_SERVICE_CHECKLIST_STATUS" ? <>
      {picker("Checklist item", config.checklistItemId ?? "", options.checklistItems, value => update({ checklistItemId: value }))}
      {picker("Checklist status", config.status ?? "", [{ id: "NOT_RECEIVED", name: "Not received" }, { id: "INFORMED", name: "Informed" }, { id: "MISSING", name: "Missing" }, { id: "RECEIVED", name: "Received" }], value => update({ status: value as ServiceActionConfig["status"] }))}
    </> : null}
    {action.type === "SET_SERVICE_STATUS" ? <>
      {picker("Service status", config.status ?? "", [{ id: "IN_PROGRESS", name: "In progress" }, { id: "CANCELED", name: "Canceled" }], value => update({ status: value as ServiceActionConfig["status"] }))}
      <FieldDescription>In progress requires unfinished steps. Completion and payment statuses are calculated automatically.</FieldDescription>
    </> : null}
    {action.type === "SCHEDULE_SERVICE_STEP" ? <>
      {picker("Schedule by", schedule.mode, [{ id: "DURATION", name: "Duration from entry" }, { id: "FIXED_DATE", name: "Date and time" }, { id: "DEFAULT", name: "Restore default" }], value => update({ schedule: value === "DEFAULT" ? { mode: value } : value === "FIXED_DATE" ? { mode: value, dateTime: "" } : { mode: "DURATION", amount: 1, unit: "DAYS" } }))}
      {schedule.mode === "DURATION" ? <>
        <Field><FieldLabel htmlFor={`${id}-duration`}>Timeframe</FieldLabel><Input id={`${id}-duration`} type="number" min={1} step={1} value={schedule.amount} onChange={event => update({ schedule: { ...schedule, amount: Number(event.target.value) } })} /></Field>
        {picker("Unit", schedule.unit, [{ id: "MINUTES", name: "Minutes" }, { id: "HOURS", name: "Hours" }, { id: "DAYS", name: "Days" }], value => update({ schedule: { ...schedule, unit: value as typeof schedule.unit } }))}
      </> : schedule.mode === "FIXED_DATE" ? <Field>
        <FieldLabel htmlFor={`${id}-date`}>Deadline date and time</FieldLabel><FieldLabel className="sr-only" htmlFor={`${id}-time`}>Deadline time</FieldLabel>
        <DateTimeInput id={`${id}-date`} timeId={`${id}-time`} timezone={timezone || "UTC"} value={schedule.dateTime ? formatUtcIsoToDateTimeDraft(schedule.dateTime, timezone || "UTC") : { date: "", time: "" }} onValueChange={value => update({ schedule: { mode: "FIXED_DATE", dateTime: dateTimeDraftToUtcIso(value, timezone || "UTC") ?? "" } })} />
      </Field> : null}
      <FieldDescription>Changes the triggering entry’s deadline. Duration is counted from entry, up to ten years. Wait actions keep their own schedules.</FieldDescription>
    </> : null}
    {terminalServiceAction(action) ? <p role="note" className="rounded-lg border bg-muted/40 p-3 text-sm">This action ends this workflow. Completion and destination-entry automations handle subsequent work.</p> : null}
  </>
}
