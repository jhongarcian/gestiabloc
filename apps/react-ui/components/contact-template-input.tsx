"use client"

import { useMemo, useRef, useState, type ChangeEvent } from "react"
import { Braces, Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AppPhoneInput } from "@/components/ui/phone-input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  ContactDateValueInput,
  type ContactDateValue,
} from "@/components/contact-date-value-input"
import {
  buildDateTemplateToken,
  buildContactTemplateToken,
  buildAutomationValueToken,
  partitionContactTemplateFields,
  uniqueAutomationOutputs,
  type ContactTemplateCatalog,
  type ContactTemplateFieldType,
} from "@/lib/contact-template"
import { cn } from "@/lib/utils"

const COMPACT_PRIMARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 transition hover:bg-blue-900 hover:text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"

const COMPACT_SECONDARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"

const COMPACT_SELECT_TRIGGER_CLASS =
  "h-8 w-full cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950"

type TemplateField = {
  key: string
  label: string
  fieldType: ContactTemplateFieldType
}

type TemplateSource = "CONTACT" | "CUSTOM_FIELD" | "DATE" | "AUTOMATION_VALUE"
type ContactTemplateInputProps = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  catalog: ContactTemplateCatalog
  maxLength: number
  multiline?: boolean
  phonePicker?: boolean
  placeholder?: string
  error?: string | null
  timezone?: string | null
  automationOutputs?: Array<{ key: string; label: string }>
}

export function ContactTemplateInput({
  id,
  label,
  value,
  onChange,
  catalog,
  maxLength,
  multiline = false,
  phonePicker = false,
  placeholder,
  error,
  timezone,
  automationOutputs = [],
}: ContactTemplateInputProps) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<TemplateSource>("CONTACT")
  const [selectedKey, setSelectedKey] = useState("")
  const [dateValue, setDateValue] = useState<ContactDateValue>({ type: "CURRENT_DATE" })
  const [format, setFormat] = useState("")
  const [selection, setSelection] = useState({ start: value.length, end: value.length })
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  const { contactFields, customFields } = useMemo(
    () => partitionContactTemplateFields(catalog),
    [catalog],
  )
  const availableAutomationOutputs = useMemo(
    () => uniqueAutomationOutputs(automationOutputs),
    [automationOutputs],
  )
  const fields = useMemo(
    () => source === "CONTACT" ? contactFields : source === "CUSTOM_FIELD" ? customFields : [],
    [contactFields, customFields, source],
  )
  const selectedField = useMemo(
    () => fields.find((field) => field.key === selectedKey) ?? fields[0] ?? null,
    [fields, selectedKey],
  ) as TemplateField | null
  const formatOptions = source === "DATE"
    ? catalog.templateFields.dateFormats
    : selectedField?.fieldType === "PHONE"
      ? catalog.templateFields.phoneFormats
      : []
  const selectedFormat = formatOptions.some((option) => option.value === format)
    ? format
    : source === "DATE"
      ? formatOptions.find((option) => option.value === "medium")?.value ?? formatOptions[0]?.value ?? ""
      : formatOptions[0]?.value ?? ""
  const token = source === "DATE"
    ? dateValue.type === "CONTACT_FIELD" || dateValue.type === "CUSTOM_FIELD"
      ? dateValue.key
        ? buildContactTemplateToken({
            source: dateValue.type === "CONTACT_FIELD" ? "CONTACT" : "CUSTOM_FIELD",
            key: dateValue.key,
            fieldType: "DATE",
            format: selectedFormat,
          })
        : ""
      : buildDateTemplateToken({
          kind: dateValue.type === "CURRENT_DATE"
            ? "CURRENT"
            : dateValue.type === "RELATIVE_DATE"
              ? "RELATIVE"
              : "SPECIFIC",
          format: selectedFormat,
          date: dateValue.type === "SPECIFIC_DATE" ? dateValue.date : undefined,
          amount: dateValue.type === "RELATIVE_DATE" ? dateValue.amount : undefined,
          unit: dateValue.type === "RELATIVE_DATE" ? dateValue.unit : undefined,
        })
    : source === "AUTOMATION_VALUE"
      ? buildAutomationValueToken(selectedKey || availableAutomationOutputs[0]?.key || "")
    : selectedField
      ? buildContactTemplateToken({
          source,
          key: selectedField.key,
          fieldType: selectedField.fieldType,
          format: selectedFormat,
        })
      : ""
  const selectedLength = Math.max(0, selection.end - selection.start)
  const usesPhonePicker = phonePicker && !value.includes("{")
  const insertionLength = usesPhonePicker
    ? token.length
    : value.length - selectedLength + token.length
  const canInsert = Boolean(token) && insertionLength <= maxLength

  const rememberSelection = () => {
    const input = inputRef.current
    if (!input) return
    setSelection({
      start: input.selectionStart ?? value.length,
      end: input.selectionEnd ?? value.length,
    })
  }

  const selectSource = (nextSource: TemplateSource) => {
    const nextFields = nextSource === "CONTACT" ? contactFields : nextSource === "CUSTOM_FIELD" ? customFields : []
    setSource(nextSource)
    setSelectedKey(
      nextSource === "AUTOMATION_VALUE"
        ? availableAutomationOutputs[0]?.key ?? ""
        : nextFields[0]?.key ?? "",
    )
    setFormat("")
  }

  const selectField = (field: TemplateField) => {
    setSelectedKey(field.key)
    setFormat("")
  }

  const insertField = () => {
    if (!canInsert || !token) return
    const start = Math.min(selection.start, value.length)
    const end = Math.min(selection.end, value.length)
    const nextValue = usesPhonePicker
      ? token
      : `${value.slice(0, start)}${token}${value.slice(end)}`
    const nextCursor = usesPhonePicker ? token.length : start + token.length
    onChange(nextValue)
    setOpen(false)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(nextCursor, nextCursor)
      setSelection({ start: nextCursor, end: nextCursor })
    })
  }

  const picker = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={COMPACT_SECONDARY_BUTTON_CLASS}
          onMouseDown={rememberSelection}
        >
          <Braces data-icon="inline-start" aria-hidden="true" />
          Insert field
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 rounded-2xl p-3">
        <Field className="gap-1.5">
          <FieldLabel className="text-xs">Source</FieldLabel>
          <Select value={source} onValueChange={(next) => selectSource(next as TemplateSource)}>
            <SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CONTACT">Contact field</SelectItem>
              <SelectItem value="CUSTOM_FIELD" disabled={customFields.length === 0}>Custom field</SelectItem>
              <SelectItem value="DATE">Date</SelectItem>
              <SelectItem value="AUTOMATION_VALUE" disabled={availableAutomationOutputs.length === 0}>
                Automation value
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {source === "DATE" ? (
          <>
            <ContactDateValueInput
              idPrefix={`${id}-template-date`}
              value={dateValue}
              onChange={setDateValue}
              catalog={catalog}
              timezone={timezone}
              allowRelative
            />
          </>
        ) : source === "AUTOMATION_VALUE" ? (
          <Field className="gap-1.5">
            <FieldLabel className="text-xs">Value</FieldLabel>
            <Select value={selectedKey || availableAutomationOutputs[0]?.key || ""} onValueChange={setSelectedKey}>
              <SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder="Select a value" />
              </SelectTrigger>
              <SelectContent>
                {availableAutomationOutputs.map((output) => (
                  <SelectItem key={output.key} value={output.key}>
                    {output.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <Command>
              <CommandInput placeholder="Search fields" />
              <CommandList className="max-h-44">
                <CommandEmpty>No fields found.</CommandEmpty>
                <CommandGroup>
                  {fields.map((field) => (
                    <CommandItem
                      key={`${source}-${field.key}`}
                      value={`${field.label} ${field.key}`}
                      onSelect={() => selectField(field)}
                    >
                      <Check
                        className={cn(
                          "size-4",
                          selectedField?.key === field.key ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{field.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        )}

        {formatOptions.length > 0 ? (
          <Field className="gap-1.5">
            <FieldLabel className="text-xs">Format</FieldLabel>
            <Select value={selectedFormat} onValueChange={setFormat}>
              <SelectTrigger className={COMPACT_SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {formatOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label ?? option.value}
                    {option.preview ? ` · ${option.preview}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            className={COMPACT_PRIMARY_BUTTON_CLASS}
            disabled={!canInsert}
            onClick={insertField}
          >
            Insert
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )

  const sharedInputProps = {
    id,
    value,
    maxLength,
    placeholder,
    "aria-invalid": Boolean(error),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    onSelect: rememberSelection,
    onClick: rememberSelection,
    onKeyUp: rememberSelection,
    onBlur: rememberSelection,
  }

  return (
    <Field className="gap-2" data-invalid={Boolean(error)}>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {picker}
      </div>
      {multiline ? (
        <Textarea
          {...sharedInputProps}
          ref={(node) => { inputRef.current = node }}
          className="min-h-28 resize-y rounded-xl"
        />
      ) : usesPhonePicker ? (
        <AppPhoneInput
          id={id}
          defaultCountry="US"
          countryCallingCodeEditable={false}
          value={value}
          onChange={(nextValue) => onChange(nextValue ?? "")}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
        />
      ) : (
        <Input
          {...sharedInputProps}
          ref={(node) => { inputRef.current = node }}
          className="h-8 rounded-full"
        />
      )}
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </Field>
  )
}
