"use client"

import { format } from "date-fns"
import { CalendarIcon, Clock3 } from "lucide-react"

import { Calendar } from "@/components/ui/calendar"
import { formatDateInput, parseDateInput } from "@/components/ui/date-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { DateTimeDraft } from "@/lib/date-time"

type DateTimeInputProps = {
  id?: string
  timeId?: string
  value: DateTimeDraft
  onValueChange: (value: DateTimeDraft) => void
  disabled?: boolean
  ariaInvalid?: boolean
  className?: string
  timezone?: string | null
  disabledDate?: (date: Date) => boolean
  hideTime?: boolean
  timeStepMinutes?: number
  layout?: "default" | "joined"
}

export function DateTimeInput({
  id,
  timeId,
  value,
  onValueChange,
  disabled = false,
  ariaInvalid = false,
  className,
  disabledDate = () => false,
  hideTime = false,
  timeStepMinutes = 1,
  layout = "default",
}: DateTimeInputProps) {
  const parsedDate = parseDateInput(value.date)
  const resolvedTimeId = timeId ?? (id ? `${id}-time` : undefined)
  const dateInput = (
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
      className={
        layout === "joined"
          ? "h-11 rounded-none border-0 bg-transparent px-3 shadow-none focus-visible:border-transparent focus-visible:ring-0"
          : undefined
      }
    />
  )
  const datePicker = (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={layout === "joined" ? "ghost" : "outline"}
          disabled={disabled}
          aria-label="Open date picker"
          aria-invalid={ariaInvalid}
          className={cn(
            layout === "joined"
              ? "h-11 rounded-none border-l border-slate-200 px-3 hover:bg-slate-50"
              : "shrink-0 px-3",
            ariaInvalid ? "border-destructive ring-destructive/20" : undefined,
          )}
        >
          <CalendarIcon className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={parsedDate && parsedDate !== null ? parsedDate : undefined}
          defaultMonth={parsedDate && parsedDate !== null ? parsedDate : undefined}
          captionLayout="dropdown"
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
  )
  const timeInput = !hideTime ? (
    <Input
      id={resolvedTimeId}
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
        layout === "joined"
          ? "h-11 rounded-none border-0 bg-transparent pr-3 pl-9 shadow-none focus-visible:border-transparent focus-visible:ring-0"
          : "pl-9",
        ariaInvalid && layout !== "joined"
          ? "border-rose-300 ring-2 ring-rose-100"
          : undefined,
      )}
    />
  ) : null

  if (layout === "joined") {
    return (
      <div
        className={cn(
          "grid grid-cols-[minmax(0,1.35fr)_minmax(7.5rem,0.8fr)] gap-0",
          hideTime && "grid-cols-1",
          className,
        )}
      >
        <div
          className={cn(
            "flex h-11 min-w-0 overflow-hidden border bg-slate-50/60",
            hideTime ? "rounded-xl" : "rounded-l-xl",
            ariaInvalid
              ? "border-rose-300 ring-2 ring-rose-100"
              : "border-slate-200 focus-within:border-blue-400 focus-within:ring-3 focus-within:ring-blue-100",
          )}
        >
          {dateInput}
          {datePicker}
        </div>

        {!hideTime ? (
          <div
            className={cn(
              "relative h-11 min-w-0 overflow-hidden rounded-r-xl border border-l-0 bg-slate-50/60",
              ariaInvalid
                ? "border-rose-300 ring-2 ring-rose-100"
                : "border-slate-200 focus-within:border-blue-400 focus-within:ring-3 focus-within:ring-blue-100",
            )}
          >
            <Clock3 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            {timeInput}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-col items-start gap-2 sm:grid-cols-[minmax(0,1fr)_156px]">
        <div className="flex gap-2">
          {dateInput}
          {datePicker}
        </div>

        {!hideTime ? (
          <div className="relative">
            <Clock3 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            {timeInput}
          </div>
        ) : null}
      </div>
    </div>
  )
}
