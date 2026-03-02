"use client"

import { format, isValid, parse } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export function formatDateInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8)
  const month = digits.slice(0, 2)
  const day = digits.slice(2, 4)
  const year = digits.slice(4, 8)

  if (digits.length <= 2) {
    return month
  }

  if (digits.length <= 4) {
    return `${month}/${day}`
  }

  return `${month}/${day}/${year}`
}

export function parseDateInput(value: string) {
  if (value.trim().length === 0) {
    return undefined
  }

  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    return null
  }

  const parsedDate = parse(value, "MM/dd/yyyy", new Date())

  if (!isValid(parsedDate) || format(parsedDate, "MM/dd/yyyy") !== value) {
    return null
  }

  return parsedDate
}

export function parseStoredDate(value: string | null) {
  if (!value) {
    return undefined
  }

  const parsedDate = new Date(value)
  if (Number.isNaN(parsedDate.getTime())) {
    return undefined
  }

  return new Date(
    parsedDate.getUTCFullYear(),
    parsedDate.getUTCMonth(),
    parsedDate.getUTCDate(),
  )
}

export function serializeDateOnly(value: Date | undefined) {
  if (!value) {
    return null
  }

  return new Date(
    Date.UTC(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      12,
      0,
      0,
      0,
    ),
  ).toISOString()
}

type DateInputProps = {
  id?: string
  value: string
  onValueChange: (value: string) => void
  onDateChange: (value: Date | undefined) => void
  placeholder?: string
  disabled?: boolean
  ariaInvalid?: boolean
  className?: string
}

export function DateInput({
  id,
  value,
  onValueChange,
  onDateChange,
  placeholder = "MM/DD/YYYY",
  disabled = false,
  ariaInvalid = false,
  className,
}: DateInputProps) {
  const parsedDate = parseDateInput(value)
  const calendarMonth =
    parsedDate && parsedDate !== null ? parsedDate : undefined

  return (
    <div className={cn("flex gap-2", className)}>
      <Input
        id={id}
        inputMode="numeric"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          const formattedValue = formatDateInput(event.target.value)
          onValueChange(formattedValue)

          const nextDate = parseDateInput(formattedValue)
          if (nextDate === undefined) {
            onDateChange(undefined)
          } else if (nextDate !== null) {
            onDateChange(nextDate)
          }
        }}
        aria-invalid={ariaInvalid}
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label="Open date picker"
            aria-invalid={ariaInvalid}
            className={cn(
              "shrink-0 px-3",
              ariaInvalid ? "border-destructive ring-destructive/20" : undefined,
            )}
          >
            <CalendarIcon className="h-4 w-4 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={parsedDate && parsedDate !== null ? parsedDate : undefined}
            month={calendarMonth}
            captionLayout="dropdown"
            onSelect={(date) => {
              onDateChange(date)
              onValueChange(date ? format(date, "MM/dd/yyyy") : "")
            }}
            disabled={(date) => date > new Date()}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
