"use client"

import { Check } from "lucide-react"
import { useMemo, useState } from "react"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { DateInput, parseDateInput } from "@/components/ui/date-input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  partitionContactTemplateFields,
  type ContactTemplateCatalog,
} from "@/lib/contact-template"
import { cn } from "@/lib/utils"

const COMPACT_SELECT_TRIGGER_CLASS =
  "h-8 w-full cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"

export type ContactDateValue =
  | { type: "CURRENT_DATE" }
  | { type: "RELATIVE_DATE"; amount: number; unit: "DAYS" | "WEEKS" | "MONTHS" }
  | { type: "CONTACT_FIELD"; key: string }
  | { type: "CUSTOM_FIELD"; key: string }
  | { type: "SPECIFIC_DATE"; date: string; timezone: string }

type DateKind = "CURRENT" | "RELATIVE" | "FIELD" | "SPECIFIC"

function dateKind(value: ContactDateValue): DateKind {
  if (value.type === "CURRENT_DATE") return "CURRENT"
  if (value.type === "RELATIVE_DATE") return "RELATIVE"
  if (value.type === "SPECIFIC_DATE") return "SPECIFIC"
  return "FIELD"
}

function dateInputValue(value: ContactDateValue) {
  if (value.type !== "SPECIFIC_DATE" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return ""
  const [year, month, day] = value.date.split("-")
  return `${month}/${day}/${year}`
}

export function ContactDateValueInput({
  value,
  onChange,
  catalog,
  timezone,
  idPrefix,
  allowRelative = false,
}: {
  value: ContactDateValue
  onChange: (value: ContactDateValue) => void
  catalog: ContactTemplateCatalog
  timezone?: string | null
  idPrefix: string
  allowRelative?: boolean
}) {
  const { dateFields } = useMemo(() => partitionContactTemplateFields(catalog), [catalog])
  const kind = dateKind(value)
  const selectedFieldId = value.type === "CONTACT_FIELD" || value.type === "CUSTOM_FIELD"
    ? `${value.type}:${value.key}`
    : ""
  const safeTimezone = timezone?.trim() || "America/Chicago"
  const [specificInput, setSpecificInput] = useState(() => dateInputValue(value))

  const setKind = (nextKind: DateKind) => {
    if (nextKind === "CURRENT") {
      onChange({ type: "CURRENT_DATE" })
      return
    }
    if (nextKind === "SPECIFIC") {
      setSpecificInput("")
      onChange({ type: "SPECIFIC_DATE", date: "", timezone: safeTimezone })
      return
    }
    if (nextKind === "RELATIVE") {
      onChange({ type: "RELATIVE_DATE", amount: 1, unit: "DAYS" })
      return
    }
    const first = dateFields[0]
    if (first) {
      onChange({
        type: first.source === "CONTACT" ? "CONTACT_FIELD" : "CUSTOM_FIELD",
        key: first.key,
      })
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${idPrefix}-date-kind`} className="text-xs">Date type</FieldLabel>
        <Select value={kind} onValueChange={(next) => setKind(next as DateKind)}>
          <SelectTrigger id={`${idPrefix}-date-kind`} className={COMPACT_SELECT_TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CURRENT">Current date</SelectItem>
            {allowRelative ? <SelectItem value="RELATIVE">After action runs</SelectItem> : null}
            <SelectItem value="FIELD" disabled={dateFields.length === 0}>Date field</SelectItem>
            <SelectItem value="SPECIFIC">Specific date</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {kind === "FIELD" ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <Command>
            <CommandInput placeholder="Search date fields" />
            <CommandList className="max-h-44">
              <CommandEmpty>No date fields found.</CommandEmpty>
              <CommandGroup>
                {dateFields.map((field) => {
                  const source = field.source === "CONTACT" ? "CONTACT_FIELD" : "CUSTOM_FIELD"
                  const fieldId = `${source}:${field.key}`
                  return (
                    <CommandItem
                      key={fieldId}
                      value={`${field.label} ${field.sourceLabel} ${field.key}`}
                      onSelect={() => onChange({ type: source, key: field.key })}
                    >
                      <Check
                        className={cn("size-4", selectedFieldId === fieldId ? "opacity-100" : "opacity-0")}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{field.label}</span>
                      <span className="text-[11px] text-slate-400">{field.sourceLabel}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      ) : null}

      {value.type === "RELATIVE_DATE" ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-2">
          <Input
            id={`${idPrefix}-relative-amount`}
            aria-label="Relative date amount"
            type="number"
            min={1}
            max={10_000}
            step={1}
            value={Number.isFinite(value.amount) ? value.amount : ""}
            onChange={(event) => onChange({
              ...value,
              amount: event.target.value === "" ? Number.NaN : event.target.valueAsNumber,
            })}
            className="h-8 rounded-full"
          />
          <Select
            value={value.unit}
            onValueChange={(unit) => onChange({
              ...value,
              unit: unit as "DAYS" | "WEEKS" | "MONTHS",
            })}
          >
            <SelectTrigger
              id={`${idPrefix}-relative-unit`}
              aria-label="Relative date unit"
              className={COMPACT_SELECT_TRIGGER_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DAYS">Days</SelectItem>
              <SelectItem value="WEEKS">Weeks</SelectItem>
              <SelectItem value="MONTHS">Months</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {value.type === "SPECIFIC_DATE" ? (
        <Field className="gap-1.5">
          <FieldLabel className="text-xs">Specific date</FieldLabel>
          <DateInput
            value={specificInput}
            onValueChange={(input) => {
              setSpecificInput(input)
              const parsed = parseDateInput(input)
              const date = parsed
                ? `${String(parsed.getFullYear()).padStart(4, "0")}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`
                : ""
              onChange({ ...value, date, timezone: value.timezone || safeTimezone })
            }}
            onDateChange={() => undefined}
            disabledDate={() => false}
            ariaInvalid={!value.date}
            className="[&_input]:h-8 [&_input]:rounded-full [&_button]:h-8 [&_button]:rounded-full"
          />
        </Field>
      ) : null}

      {value.type === "CURRENT_DATE" ? (
        <p className="text-xs text-slate-500">Uses {safeTimezone} when this step runs.</p>
      ) : null}
    </div>
  )
}
