"use client"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export type ContactStatusOption = {
  label: string
  value: string
  bgColor?: string
  textColor?: string
}

type ContactStatusSelectProps = {
  id?: string
  value: string
  onValueChange: (value: string) => void
  options: ContactStatusOption[]
  disabled?: boolean
  ariaInvalid?: boolean
  noneValue?: string
  noneLabel?: string
  placeholder?: string
  triggerClassName?: string
}

const NEUTRAL_STATUS_STYLE = {
  backgroundColor: "#F1F5F9",
  color: "#334155",
}

export function ContactStatusSelect({
  id,
  value,
  onValueChange,
  options,
  disabled = false,
  ariaInvalid = false,
  noneValue = "__none__",
  noneLabel = "No status",
  placeholder = "Select a status",
  triggerClassName,
}: ContactStatusSelectProps) {
  const selectedStatus = options.find((option) => option.value === value)
  const selectedStyle =
    selectedStatus?.bgColor && selectedStatus.textColor
      ? {
          backgroundColor: selectedStatus.bgColor,
          color: selectedStatus.textColor,
        }
      : NEUTRAL_STATUS_STYLE

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-invalid={ariaInvalid}
        className={cn(
          "h-11 w-full rounded-xl border-0 px-3 shadow-none transition-[filter,box-shadow] hover:brightness-[0.98] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 data-[size=default]:h-11",
          triggerClassName,
        )}
        style={selectedStyle}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>

      <SelectContent className="rounded-2xl border-slate-200 p-1.5 shadow-lg">
        <SelectGroup>
          <SelectItem value={noneValue} className="rounded-xl py-2.5">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
              {noneLabel}
            </span>
          </SelectItem>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="rounded-xl py-2.5"
            >
              <span
                className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                style={
                  option.bgColor && option.textColor
                    ? {
                        backgroundColor: option.bgColor,
                        color: option.textColor,
                      }
                    : NEUTRAL_STATUS_STYLE
                }
              >
                {option.label}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
