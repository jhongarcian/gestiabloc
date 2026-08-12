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

export type TaskStatusOption = {
  label: string
  value: string
  bgColor?: string
  textColor?: string
}

type TaskStatusSelectProps = {
  id?: string
  value: string
  onValueChange: (value: string) => void
  options: TaskStatusOption[]
  disabled?: boolean
  noneValue?: string
  noneLabel?: string
  placeholder?: string
  triggerClassName?: string
  contentClassName?: string
  ariaInvalid?: boolean
}

export function TaskStatusSelect({
  id,
  value,
  onValueChange,
  options,
  disabled = false,
  noneValue = "__none__",
  noneLabel = "No status",
  placeholder = "Select a status",
  triggerClassName,
  contentClassName,
  ariaInvalid = false,
}: TaskStatusSelectProps) {
  const selectedStatus = options.find((option) => option.value === value)

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-invalid={ariaInvalid}
        className={cn(
          "h-11 w-full rounded-xl border-0 px-3 shadow-none",
          selectedStatus ? "border-transparent" : undefined,
          triggerClassName,
        )}
        style={
          selectedStatus?.bgColor && selectedStatus.textColor
            ? {
                backgroundColor: selectedStatus.bgColor,
                color: selectedStatus.textColor,
              }
            : {
                backgroundColor: "#F1F5F9",
                color: "#334155",
              }
        }
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        className={cn("rounded-2xl border-slate-200 p-1.5 shadow-lg", contentClassName)}
      >
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
                    : undefined
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
