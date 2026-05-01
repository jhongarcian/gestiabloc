"use client"

import { format } from "date-fns"
import { CalendarIcon, Clock3 } from "lucide-react"
import { useEffect, useState } from "react"

import { Calendar } from "@/components/ui/calendar"
import { formatDateInput, parseDateInput } from "@/components/ui/date-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { DateTimeDraft } from "@/lib/date-time"

type DateTimeInputProps = {
  id?: string
  value: DateTimeDraft
  onValueChange: (value: DateTimeDraft) => void
  disabled?: boolean
  ariaInvalid?: boolean
  className?: string
  timezone?: string | null
  disabledDate?: (date: Date) => boolean
  hideTime?: boolean
  timeStepMinutes?: number
}

export function DateTimeInput({
  id,
  value,
  onValueChange,
  disabled = false,
  ariaInvalid = false,
  className,
  disabledDate = () => false,
  hideTime = false,
  timeStepMinutes = 1,
}: DateTimeInputProps) {
  const parsedDate = parseDateInput(value.date)
  const [calendarMonth, setCalendarMonth] = useState<Date | undefined>(
    parsedDate && parsedDate !== null ? parsedDate : undefined,
  )

  useEffect(() => {
    setCalendarMonth(parsedDate && parsedDate !== null ? parsedDate : undefined)
  }, [parsedDate?.getFullYear(), parsedDate?.getMonth(), parsedDate?.getDate()])

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-col items-start gap-2 sm:grid-cols-[minmax(0,1fr)_156px]">
        <div className="flex gap-2">
          <Input
            id={id}
            inputMode="numeric"
            placeholder="MM/DD/YYYY"
            value={value.date}
            disabled={disabled}
            aria-invalid={ariaInvalid}
            onChange={(event) => {
              onValueChange({
                ...value,
                date: formatDateInput(event.target.value),
              })
            }}
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
                onMonthChange={setCalendarMonth}
                onSelect={(date) => {
                  onValueChange({
                    date: date ? format(date, "MM/dd/yyyy") : "",
                    time: date ? value.time || "09:00" : value.time,
                  })
                }}
                disabled={disabledDate}
              />
            </PopoverContent>
          </Popover>
        </div>

        {!hideTime ? (
          <div className="relative">
            <Clock3 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="time"
              step={Math.max(1, timeStepMinutes) * 60}
              value={value.time}
              disabled={disabled}
              aria-invalid={ariaInvalid}
              onChange={(event) => {
                onValueChange({
                  ...value,
                  time: event.target.value,
                })
              }}
              className={cn(
                "pl-9",
                ariaInvalid ? "border-rose-300 ring-2 ring-rose-100" : undefined,
              )}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
