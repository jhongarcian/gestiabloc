"use client"

import { useId, useState } from "react"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { offeringsInGroup, serviceGroups, type ServiceOfferingOption } from "@/lib/service-hierarchy"

export function ServiceScopeFields({ options, groupId, offeringId, onChange, disabled, required = false }: {
  options: ServiceOfferingOption[]; groupId: string; offeringId: string
  onChange: (groupId: string, offeringId: string) => void; disabled?: boolean; required?: boolean
}) {
  const id = useId()
  const groups = serviceGroups(options)
  const offerings = offeringsInGroup(options, groupId)
  return <FieldGroup className="grid gap-3 sm:grid-cols-2">
    <Field><FieldLabel htmlFor={`${id}-group`}>Service</FieldLabel>
      <Select value={groupId || "ALL"} disabled={disabled} onValueChange={value => onChange(value === "ALL" ? "" : value, "")}>
        <SelectTrigger id={`${id}-group`}><SelectValue placeholder="Choose a service" /></SelectTrigger>
        <SelectContent><SelectGroup><SelectItem value="ALL">{required ? "Choose a service" : "All services"}</SelectItem>{groups.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </Field>
    <Field><FieldLabel htmlFor={`${id}-offering`}>Sub-service</FieldLabel>
      <Select value={offeringId || "ALL"} disabled={disabled || (required && !groupId)} onValueChange={value => {
        const selected = options.find(item => item.id === value)
        onChange(selected?.parentService?.id ?? groupId, value === "ALL" ? "" : value)
      }}>
        <SelectTrigger id={`${id}-offering`}><SelectValue placeholder="Choose a sub-service" /></SelectTrigger>
        <SelectContent><SelectGroup><SelectItem value="ALL">{required ? "Choose a sub-service" : "All sub-services"}</SelectItem>{offerings.map(item => <SelectItem key={item.id} value={item.id}>{!groupId && item.parentService ? `${item.parentService.name} / ` : ""}{item.name}{item.isActive === false ? " (inactive)" : ""}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </Field>
  </FieldGroup>
}

export function ServiceOfferingPicker({ options, value, onValueChange, disabled }: {
  options: ServiceOfferingOption[]; value: string; onValueChange: (value: string) => void; disabled?: boolean
}) {
  const [chosenGroup, setChosenGroup] = useState("")
  const groupId = options.find(item => item.id === value)?.parentService?.id ?? chosenGroup
  return <ServiceScopeFields options={options} groupId={groupId} offeringId={value} disabled={disabled} required onChange={(group, offering) => { setChosenGroup(group); onValueChange(offering) }} />
}
