"use client"

import Link from "next/link"
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { isAxiosError } from "axios"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react"
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { formatDateTimeForDisplay } from "@/lib/date-time"
import {
  getAppointmentAuditLogs,
  type AppointmentStatus,
  type CalendarBlockedPeriodItem,
  getCalendarEvents,
  type AppointmentAuditLogItem,
  type CalendarEventItem,
  type CalendarEventsResponse,
  type CalendarMetaResponse,
  updateAppointment,
} from "../_lib/calendar-api"
import { CreateAppointmentDialog } from "./create-appointment-dialog"
import { EditAppointmentForm } from "./edit-appointment-sheet"

type CalendarWorkspaceProps = {
  tenantSlug: string
  tenantId: string
  tenantTimezone: string | null
  currentUserId: string
  canViewAuditLogs: boolean
  meta: CalendarMetaResponse
  events: CalendarEventsResponse
}

type CalendarView = CalendarEventsResponse["filters"]["view"]
type CalendarFilterMode = CalendarEventsResponse["filters"]["filterMode"]

type CalendarRange = {
  start: Date
  end: Date
}

const VIEW_OPTIONS: Array<{ value: CalendarView; label: string }> = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "list", label: "List" },
]

const APPOINTMENT_STATUS_OPTIONS = [
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "SHOW", label: "Show" },
  { value: "NO_SHOW", label: "No Show" },
  { value: "CANCELED", label: "Canceled" },
] as const

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const DAY_VIEW_ROW_HEIGHT = 64
const DAY_VIEW_TOTAL_MINUTES = 24 * 60
const DAY_VIEW_HOURS = Array.from({ length: 24 }, (_, index) => index)

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase()
}

function formatAppointmentStatus(status: string) {
  if (status.trim().toUpperCase() === "NO_SHOW") {
    return "No Show"
  }

  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function getAppointmentStatusClass(status: string) {
  const normalized = status.trim().toUpperCase()

  if (normalized === "CANCELED") {
    return "border-rose-200 bg-rose-50 text-rose-700"
  }

  if (normalized === "NO_SHOW") {
    return "border-amber-200 bg-amber-50 text-amber-700"
  }

  if (normalized === "SHOW") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  }

  if (normalized === "CONFIRMED") {
    return "border-sky-200 bg-sky-50 text-sky-700"
  }

  return "border-blue-200 bg-blue-50 text-blue-950"
}

function getColorTintStyles(color?: string | null) {
  if (!color) return undefined

  const normalized = color.trim()

  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) {
    const hex = normalized.slice(1)
    const expanded =
      hex.length === 3
        ? hex
            .split("")
            .map((value) => value + value)
            .join("")
        : hex

    const red = Number.parseInt(expanded.slice(0, 2), 16)
    const green = Number.parseInt(expanded.slice(2, 4), 16)
    const blue = Number.parseInt(expanded.slice(4, 6), 16)

    return {
      backgroundColor: `rgba(${red}, ${green}, ${blue}, 0.08)`,
      borderColor: `rgba(${red}, ${green}, ${blue}, 0.18)`,
    }
  }

  if (normalized.startsWith("rgb(") || normalized.startsWith("rgba(")) {
    const values = normalized.match(/[\d.]+/g)
    if (!values || values.length < 3) return undefined

    const [red, green, blue] = values
    return {
      backgroundColor: `rgba(${red}, ${green}, ${blue}, 0.08)`,
      borderColor: `rgba(${red}, ${green}, ${blue}, 0.18)`,
    }
  }

  return undefined
}

function getAppointmentCardStyles(item: CalendarEventItem) {
  if (item.status === "CANCELED") {
    return {
      backgroundColor: "rgba(244, 63, 94, 0.10)",
      borderColor: "rgba(244, 63, 94, 0.24)",
    }
  }

  return getColorTintStyles(item.assignedToColor)
}

function getCheckboxColorProps(color?: string | null) {
  const resolvedColor = color?.trim() || "#172554"

  return {
    className:
      "border-[var(--checkbox-color)] bg-white text-transparent data-[state=checked]:border-[var(--checkbox-color)] data-[state=checked]:bg-[var(--checkbox-color)] data-[state=checked]:text-white",
    style: {
      "--checkbox-color": resolvedColor,
    } as CSSProperties,
  }
}

function getDateKey(value: Date | string, timezone?: string | null) {
  const date = typeof value === "string" ? new Date(value) : value

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone?.trim() || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function formatTimeLabel(value: string, timezone?: string | null) {
  const date = new Date(value)

  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone?.trim() || undefined,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function getDayOfWeekInTimezone(value: Date | string, timezone?: string | null) {
  const date = typeof value === "string" ? new Date(value) : value
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone?.trim() || undefined,
    weekday: "short",
  }).format(date)

  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }

  return dayMap[weekday] ?? 0
}

function formatHourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`
}

function getMinutesFromDate(value: string, timezone?: string | null) {
  const date = new Date(value)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone?.trim() || undefined,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date)

  const getPart = (type: string) => parts.find((part) => part.type === type)?.value ?? "00"
  return Number(getPart("hour")) * 60 + Number(getPart("minute"))
}

function buildDayViewEventLayouts(
  items: CalendarEventItem[],
  tenantTimezone: string | null,
) {
  const sorted = items
    .map((item, index) => ({
      index,
      item,
      startMinutes: getMinutesFromDate(item.startAt, tenantTimezone),
      endMinutes: Math.max(
        getMinutesFromDate(item.endAt, tenantTimezone),
        getMinutesFromDate(item.startAt, tenantTimezone) + 15,
      ),
    }))
    .sort((left, right) => left.startMinutes - right.startMinutes)

  const layouts = new Map<
    string,
    {
      topPx: number
      heightPx: number
      leftPercent: number
      widthPercent: number
    }
  >()

  let cluster: Array<{ id: string; column: number; startMinutes: number; endMinutes: number }> = []
  let active: Array<{ id: string; column: number; endMinutes: number }> = []
  let maxColumns = 0

  const finalizeCluster = () => {
    if (cluster.length === 0) return

    const widthPercent = 100 / Math.max(maxColumns, 1)
    for (const entry of cluster) {
      const durationMinutes = Math.max(entry.endMinutes - entry.startMinutes, 15)
      layouts.set(entry.id, {
        topPx: (entry.startMinutes / 60) * DAY_VIEW_ROW_HEIGHT,
        heightPx: (durationMinutes / 60) * DAY_VIEW_ROW_HEIGHT,
        leftPercent: entry.column * widthPercent,
        widthPercent,
      })
    }

    cluster = []
    active = []
    maxColumns = 0
  }

  for (const entry of sorted) {
    active = active.filter((activeEntry) => activeEntry.endMinutes > entry.startMinutes)

    if (active.length === 0 && cluster.length > 0) {
      finalizeCluster()
    }

    const usedColumns = new Set(active.map((activeEntry) => activeEntry.column))
    let column = 0
    while (usedColumns.has(column)) {
      column += 1
    }

    cluster.push({
      id: entry.item.id,
      column,
      startMinutes: entry.startMinutes,
      endMinutes: entry.endMinutes,
    })
    active.push({
      id: entry.item.id,
      column,
      endMinutes: entry.endMinutes,
    })
    maxColumns = Math.max(maxColumns, column + 1)
  }

  finalizeCluster()
  return layouts
}

function getRangeForView(view: CalendarView, cursorDate: Date): CalendarRange {
  if (view === "month") {
    const start = startOfMonth(cursorDate)
    return {
      start,
      end: addMonths(start, 1),
    }
  }

  if (view === "day") {
    const start = startOfDay(cursorDate)
    return {
      start,
      end: addDays(start, 1),
    }
  }

  const start = startOfWeek(cursorDate)
  return {
    start,
    end: addWeeks(start, 1),
  }
}

function shiftCursorDate(view: CalendarView, cursorDate: Date, direction: -1 | 1) {
  if (view === "month") {
    return addMonths(cursorDate, direction)
  }

  if (view === "day") {
    return addDays(cursorDate, direction)
  }

  return addWeeks(cursorDate, direction)
}

function formatRangeLabel(view: CalendarView, cursorDate: Date, timezone?: string | null) {
  const timeZone = timezone?.trim() || undefined

  if (view === "month") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "long",
      year: "numeric",
    }).format(cursorDate)
  }

  if (view === "day") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(cursorDate)
  }

  const start = startOfWeek(cursorDate)
  const end = addDays(start, 6)
  const startMonth = format(start, "MMM")
  const endMonth = format(end, "MMM")
  const startDay = format(start, "d")
  const endDay = format(end, "d")
  const endYear = format(end, "yyyy")

  return startMonth === endMonth
    ? `${startMonth} ${startDay} - ${endDay}, ${endYear}`
    : `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${endYear}`
}

function groupEventsByDay(items: CalendarEventItem[], timezone?: string | null) {
  return items.reduce<Record<string, CalendarEventItem[]>>((accumulator, item) => {
    const key = getDateKey(item.startAt, timezone)
    const existing = accumulator[key] ?? []
    accumulator[key] = [...existing, item]
    return accumulator
  }, {})
}

function groupBlockedPeriodsByDay(items: CalendarBlockedPeriodItem[], timezone?: string | null) {
  return items.reduce<Record<string, CalendarBlockedPeriodItem[]>>((accumulator, item) => {
    const key = getDateKey(item.startsAt, timezone)
    const existing = accumulator[key] ?? []
    accumulator[key] = [...existing, item]
    return accumulator
  }, {})
}

function formatBlockedPeriodLabel(item: CalendarBlockedPeriodItem, tenantTimezone: string | null) {
  if (item.isAllDay) {
    return `${item.title} · All day`
  }

  return `${item.title} · ${formatTimeLabel(item.startsAt, tenantTimezone)} - ${formatTimeLabel(item.endsAt, tenantTimezone)}`
}

function BlockedPeriodPill({
  item,
  tenantTimezone,
}: {
  item: CalendarBlockedPeriodItem
  tenantTimezone: string | null
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-tight text-amber-800">
      {formatBlockedPeriodLabel(item, tenantTimezone)}
    </div>
  )
}

function CalendarEventCard({
  item,
  tenantTimezone,
  compact = false,
  showContact = false,
  showStatus = false,
  variant = "default",
  onSelect,
  className,
}: {
  item: CalendarEventItem
  tenantTimezone: string | null
  compact?: boolean
  showContact?: boolean
  showStatus?: boolean
  variant?: "default" | "day-grid" | "week-grid"
  onSelect: (item: CalendarEventItem) => void
  className?: string
}) {
  if (variant === "week-grid") {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onSelect(item)
        }}
        className={cn(
          "flex h-full w-full cursor-pointer items-center overflow-hidden rounded-2xl border border-slate-200 px-2 py-1.5 text-left transition hover:border-slate-300 hover:brightness-[0.97] hover:shadow-sm",
          className,
        )}
        style={getAppointmentCardStyles(item)}
      >
        <p className="truncate text-xs font-semibold text-slate-900">{item.title}</p>
      </button>
    )
  }

  if (variant === "day-grid") {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onSelect(item)
        }}
        className={cn(
          "flex h-full w-full cursor-pointer items-center gap-3 overflow-hidden rounded-2xl border border-slate-200 px-3 py-2 text-left transition hover:border-slate-300 hover:brightness-[0.97] hover:shadow-sm",
          className,
        )}
        style={getAppointmentCardStyles(item)}
      >
        <TooltipProvider delayDuration={120}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="inline-flex shrink-0 self-center">
                <Avatar size="sm" className="h-7 w-7 border border-white/80 shadow-sm">
                  <AvatarImage
                    src={item.assignedToImage ?? undefined}
                    alt={item.assignedToLabel}
                  />
                  <AvatarFallback>{getInitials(item.assignedToLabel)}</AvatarFallback>
                </Avatar>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              Assigned to {item.assignedToLabel}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="min-w-0 flex flex-1 items-center gap-3 self-center">
          <p className="truncate text-sm font-semibold text-slate-900">
            {item.title}
          </p>
          <p className="shrink-0 text-xs font-medium text-slate-600">
            {formatTimeLabel(item.startAt, tenantTimezone)} to{" "}
            {formatTimeLabel(item.endAt, tenantTimezone)}
          </p>
        </div>

        {showStatus ? (
          <Badge
            variant="secondary"
            className={`shrink-0 self-center rounded-full border px-2 py-0.5 text-[10px] ${getAppointmentStatusClass(item.status)}`}
          >
            {formatAppointmentStatus(item.status)}
          </Badge>
        ) : null}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onSelect(item)
      }}
      className={cn(
        "w-full cursor-pointer rounded-xl border border-slate-200 bg-slate-50 text-left transition hover:border-slate-300 hover:brightness-[0.97] hover:shadow-sm",
        compact ? "px-2 py-1.5" : "p-3",
        className,
      )}
      style={getAppointmentCardStyles(item)}
    >
      <div className="flex items-center gap-2">
        <Avatar size="sm" className="shrink-0 border border-white/80 shadow-sm">
          <AvatarImage src={item.assignedToImage ?? undefined} alt={item.assignedToLabel} />
          <AvatarFallback>{getInitials(item.assignedToLabel)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={cn("truncate leading-tight font-semibold text-slate-900", compact ? "text-[11px]" : "text-sm")}>
              {item.title}
            </p>
            {!compact ? (
              <span className="shrink-0 text-[11px] leading-none text-slate-500">
                {formatTimeLabel(item.startAt, tenantTimezone)}
              </span>
            ) : null}
          </div>
          {showStatus ? (
            <div className="mt-1">
              <Badge
                variant="secondary"
                className={`w-fit rounded-full border px-2 py-0.5 text-[10px] ${getAppointmentStatusClass(item.status)}`}
              >
                {formatAppointmentStatus(item.status)}
              </Badge>
            </div>
          ) : null}
          <p className={cn("truncate leading-tight text-slate-500", compact ? "mt-0.5 text-[10px]" : "mt-1 text-xs")}>
            {compact
              ? formatTimeLabel(item.startAt, tenantTimezone)
              : `${formatTimeLabel(item.startAt, tenantTimezone)} to ${formatTimeLabel(item.endAt, tenantTimezone)}`}
          </p>
          {showContact ? (
            <p className="mt-1 truncate text-xs leading-tight text-slate-500">
              {item.contactName}
              {item.serviceName ? ` • ${item.serviceName}` : ""}
            </p>
          ) : null}
        </div>
      </div>
    </button>
  )
}

function MonthView({
  cursorDate,
  eventsByDay,
  blockedPeriodsByDay,
  closedDayOfWeeks,
  tenantTimezone,
  onSelect,
  onSelectDay,
}: {
  cursorDate: Date
  eventsByDay: Record<string, CalendarEventItem[]>
  blockedPeriodsByDay: Record<string, CalendarBlockedPeriodItem[]>
  closedDayOfWeeks: Set<number>
  tenantTimezone: string | null
  onSelect: (item: CalendarEventItem) => void
  onSelectDay: (day: Date) => void
}) {
  const monthDays = useMemo(() => {
    const monthStart = startOfMonth(cursorDate)
    const monthEnd = endOfMonth(cursorDate)
    const gridStart = startOfWeek(monthStart)
    const gridEnd = endOfWeek(monthEnd)

    return eachDayOfInterval({
      start: gridStart,
      end: gridEnd,
    })
  }, [cursorDate])

  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50/50">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-100/70">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {monthDays.map((day) => {
          const dayKey = getDateKey(day, tenantTimezone)
          const dayEvents = eventsByDay[dayKey] ?? []
          const dayBlockedPeriods = blockedPeriodsByDay[dayKey] ?? []
          const isClosedDay = closedDayOfWeeks.has(
            getDayOfWeekInTimezone(day, tenantTimezone),
          )

          return (
            <div
              key={day.toISOString()}
              onClick={() => onSelectDay(day)}
              className={cn(
                "min-h-[132px] cursor-pointer border-b border-r border-slate-200 bg-white p-2 align-top transition hover:bg-slate-50/80",
                isClosedDay && "bg-slate-100/85 hover:bg-slate-100",
                !isSameMonth(day, cursorDate) && "bg-slate-50/80",
                !isSameMonth(day, cursorDate) && isClosedDay && "bg-slate-200/60",
              )}
            >
              <div className="mb-2 flex items-center justify-between">
                <span
                  className={cn(
                    "inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-medium text-slate-700",
                    isToday(day) && "bg-blue-950 text-white",
                    !isSameMonth(day, cursorDate) && "text-slate-400",
                  )}
                >
                  {format(day, "d")}
                </span>
                {dayEvents.length > 0 ? (
                  <span className="text-[11px] font-medium text-slate-400">
                    {dayEvents.length}
                  </span>
                ) : null}
              </div>

              <div className="space-y-1.5">
                {dayBlockedPeriods.slice(0, 2).map((item) => (
                  <BlockedPeriodPill
                    key={item.id}
                    item={item}
                    tenantTimezone={tenantTimezone}
                  />
                ))}

                {dayBlockedPeriods.length > 2 ? (
                  <p className="px-1 text-[11px] font-medium text-amber-700">
                    +{dayBlockedPeriods.length - 2} more blocked
                  </p>
                ) : null}

                {dayEvents.slice(0, 3).map((item) => (
                  <CalendarEventCard
                    key={item.id}
                    item={item}
                    tenantTimezone={tenantTimezone}
                    compact
                    onSelect={onSelect}
                  />
                ))}

                {dayEvents.length > 3 ? (
                  <p className="px-1 text-[11px] font-medium text-slate-500">
                    +{dayEvents.length - 3} more
                  </p>
                ) : null}

              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekView({
  cursorDate,
  eventsByDay,
  blockedPeriodsByDay,
  closedDayOfWeeks,
  tenantTimezone,
  onSelect,
  onSelectDay,
  onSelectSlot,
}: {
  cursorDate: Date
  eventsByDay: Record<string, CalendarEventItem[]>
  blockedPeriodsByDay: Record<string, CalendarBlockedPeriodItem[]>
  closedDayOfWeeks: Set<number>
  tenantTimezone: string | null
  onSelect: (item: CalendarEventItem) => void
  onSelectDay: (day: Date) => void
  onSelectSlot: (day: Date, hour: number) => void
}) {
  const weekDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(cursorDate),
        end: addDays(startOfWeek(cursorDate), 6),
      }),
    [cursorDate],
  )

  const eventLayoutsByDay = useMemo(
    () =>
      weekDays.reduce<Record<string, ReturnType<typeof buildDayViewEventLayouts>>>(
        (accumulator, day) => {
          const dayKey = getDateKey(day, tenantTimezone)
          accumulator[dayKey] = buildDayViewEventLayouts(
            eventsByDay[dayKey] ?? [],
            tenantTimezone,
          )
          return accumulator
        },
        {},
      ),
    [eventsByDay, tenantTimezone, weekDays],
  )

  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
      <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))] border-b border-slate-200">
        <div className="border-r border-slate-200 bg-slate-50/80" />
        {weekDays.map((day) => {
          const isClosedDay = closedDayOfWeeks.has(
            getDayOfWeekInTimezone(day, tenantTimezone),
          )

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelectDay(day)}
              className={cn(
                "border-r border-slate-200 bg-slate-50/60 px-3 py-3 text-left transition hover:bg-slate-100/80 last:border-r-0",
                isClosedDay && "bg-slate-200/70 hover:bg-slate-200/80",
              )}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {format(day, "EEE")}
              </p>
              <p
                className={cn(
                  "mt-1 text-lg font-semibold text-slate-950",
                  isToday(day) && "text-blue-950",
                )}
              >
                {format(day, "d")}
              </p>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-[72px_repeat(7,minmax(0,1fr))]">
        <div className="border-r border-slate-200 bg-slate-50/80">
          {DAY_VIEW_HOURS.map((hour) => (
            <div
              key={hour}
              className="flex items-start justify-end border-b border-slate-100 pr-3 pt-1.5 text-xs font-medium text-slate-500"
              style={{ height: `${DAY_VIEW_ROW_HEIGHT}px` }}
            >
              {formatHourLabel(hour)}
            </div>
          ))}
        </div>

        {weekDays.map((day) => {
          const dayKey = getDateKey(day, tenantTimezone)
          const dayEvents = eventsByDay[dayKey] ?? []
          const dayBlockedPeriods = blockedPeriodsByDay[dayKey] ?? []
          const dayEventLayouts = eventLayoutsByDay[dayKey]
          const isClosedDay = closedDayOfWeeks.has(
            getDayOfWeekInTimezone(day, tenantTimezone),
          )

          return (
            <div
              key={day.toISOString()}
              className={cn(
                "relative border-r border-slate-200 bg-white last:border-r-0",
                isClosedDay && "bg-slate-100/85",
                isToday(day) && "bg-blue-50/20",
                isToday(day) && isClosedDay && "bg-slate-200/70",
              )}
              style={{ height: `${DAY_VIEW_HOURS.length * DAY_VIEW_ROW_HEIGHT}px` }}
            >
              {DAY_VIEW_HOURS.map((hour) => (
                <button
                  key={`${day.toISOString()}-${hour}`}
                  type="button"
                  onClick={() => onSelectSlot(day, hour)}
                  className="absolute inset-x-0 border-b border-slate-100 text-left transition hover:bg-blue-50/60"
                  style={{
                    top: `${hour * DAY_VIEW_ROW_HEIGHT}px`,
                    height: `${DAY_VIEW_ROW_HEIGHT}px`,
                  }}
                >
                  <span className="sr-only">{`Create appointment on ${format(day, "EEEE")} at ${formatHourLabel(hour)}`}</span>
                </button>
              ))}

              {dayBlockedPeriods.map((item) => {
                const startMinutes = getMinutesFromDate(item.startsAt, tenantTimezone)
                const endMinutes = Math.max(
                  getMinutesFromDate(item.endsAt, tenantTimezone),
                  item.isAllDay ? DAY_VIEW_TOTAL_MINUTES : startMinutes + 15,
                )

                return (
                  <div
                    key={item.id}
                    className="pointer-events-none absolute inset-x-1 rounded-2xl border border-amber-200 bg-amber-50/80 px-2 py-1.5 text-xs text-amber-800"
                    style={{
                      top: `${(startMinutes / 60) * DAY_VIEW_ROW_HEIGHT + 2}px`,
                      height: `${Math.max(
                        (Math.max(endMinutes - startMinutes, 15) / 60) * DAY_VIEW_ROW_HEIGHT - 4,
                        2,
                      )}px`,
                    }}
                  >
                    <p className="truncate font-semibold">{item.title}</p>
                    <p className="mt-0.5 truncate text-[10px] text-amber-700">
                      {item.isAllDay
                        ? "All day"
                        : `${formatTimeLabel(item.startsAt, tenantTimezone)} - ${formatTimeLabel(item.endsAt, tenantTimezone)}`}
                    </p>
                  </div>
                )
              })}

              {dayEvents.map((item) => {
                const layout = dayEventLayouts?.get(item.id)
                if (!layout) return null

                return (
                  <div
                    key={item.id}
                    className="absolute px-1"
                    style={{
                      top: `${layout.topPx + 2}px`,
                      left: `calc(${layout.leftPercent}% + 2px)`,
                      width: `calc(${layout.widthPercent}% - 4px)`,
                      height: `${Math.max(layout.heightPx - 4, 2)}px`,
                    }}
                  >
                    <CalendarEventCard
                      item={item}
                      tenantTimezone={tenantTimezone}
                      onSelect={onSelect}
                      variant="week-grid"
                      className="h-full"
                    />
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DayView({
  cursorDate,
  items,
  blockedPeriods,
  closedDayOfWeeks,
  tenantTimezone,
  onSelect,
  onSelectSlot,
}: {
  cursorDate: Date
  items: CalendarEventItem[]
  blockedPeriods: CalendarBlockedPeriodItem[]
  closedDayOfWeeks: Set<number>
  tenantTimezone: string | null
  onSelect: (item: CalendarEventItem) => void
  onSelectSlot: (day: Date, hour: number) => void
}) {
  const dayItems = useMemo(
    () => items.filter((item) => isSameDay(new Date(item.startAt), cursorDate)),
    [cursorDate, items],
  )
  const dayBlockedPeriods = useMemo(
    () => blockedPeriods.filter((item) => isSameDay(new Date(item.startsAt), cursorDate)),
    [blockedPeriods, cursorDate],
  )
  const eventLayouts = useMemo(
    () => buildDayViewEventLayouts(dayItems, tenantTimezone),
    [dayItems, tenantTimezone],
  )
  const isClosedDay = closedDayOfWeeks.has(
    getDayOfWeekInTimezone(cursorDate, tenantTimezone),
  )

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
      <div className="mb-5 border-b border-slate-100 pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Day agenda
        </p>
        <h3 className="mt-1 text-xl font-semibold text-slate-950">
          {format(cursorDate, "EEEE, MMMM d")}
        </h3>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-slate-200">
        <div className="grid grid-cols-[72px_minmax(0,1fr)]">
          <div className="border-r border-slate-200 bg-slate-50/80">
            <div className="h-10 border-b border-slate-200" />
            {DAY_VIEW_HOURS.map((hour) => (
              <div
                key={hour}
                className="flex items-start justify-end border-b border-slate-100 pr-3 pt-1.5 text-xs font-medium text-slate-500"
                style={{ height: `${DAY_VIEW_ROW_HEIGHT}px` }}
              >
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>

          <div className={cn("relative bg-white", isClosedDay && "bg-slate-100/85")}>
            <div className={cn(
              "flex h-10 items-center border-b border-slate-200 bg-slate-50/60 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500",
              isClosedDay && "bg-slate-200/70",
            )}>
              Click an hour to create an appointment
            </div>

            <div
              className="relative"
              style={{ height: `${DAY_VIEW_HOURS.length * DAY_VIEW_ROW_HEIGHT}px` }}
            >
              {DAY_VIEW_HOURS.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  onClick={() => onSelectSlot(cursorDate, hour)}
                  className="absolute inset-x-0 border-b border-slate-100 text-left transition hover:bg-blue-50/60"
                  style={{
                    top: `${hour * DAY_VIEW_ROW_HEIGHT}px`,
                    height: `${DAY_VIEW_ROW_HEIGHT}px`,
                  }}
                >
                  <span className="sr-only">{`Create appointment at ${formatHourLabel(hour)}`}</span>
                </button>
              ))}

              {dayBlockedPeriods.map((item) => {
                const startMinutes = getMinutesFromDate(item.startsAt, tenantTimezone)
                const endMinutes = Math.max(
                  getMinutesFromDate(item.endsAt, tenantTimezone),
                  item.isAllDay ? DAY_VIEW_TOTAL_MINUTES : startMinutes + 15,
                )
                const top = (startMinutes / DAY_VIEW_TOTAL_MINUTES) * 100
                const height = (Math.max(endMinutes - startMinutes, 15) / DAY_VIEW_TOTAL_MINUTES) * 100

                return (
                  <div
                    key={item.id}
                    className="pointer-events-none absolute inset-x-2 rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-800"
                    style={{
                      top: `${(startMinutes / 60) * DAY_VIEW_ROW_HEIGHT + 2}px`,
                      height: `${Math.max(
                        (Math.max(endMinutes - startMinutes, 15) / 60) * DAY_VIEW_ROW_HEIGHT - 4,
                        2,
                      )}px`,
                    }}
                  >
                    <p className="font-semibold">{item.title}</p>
                    <p className="mt-1 text-[11px] text-amber-700">
                      {item.isAllDay
                        ? "All day"
                        : `${formatTimeLabel(item.startsAt, tenantTimezone)} - ${formatTimeLabel(item.endsAt, tenantTimezone)}`}
                    </p>
                  </div>
                )
              })}

              {dayItems.map((item) => {
                const layout = eventLayouts.get(item.id)
                if (!layout) return null

                return (
                  <div
                    key={item.id}
                    className="absolute px-2"
                    style={{
                      top: `${layout.topPx + 2}px`,
                      left: `calc(${layout.leftPercent}% + 2px)`,
                      width: `calc(${layout.widthPercent}% - 4px)`,
                      height: `${Math.max(layout.heightPx - 4, 2)}px`,
                    }}
                  >
                    <CalendarEventCard
                      item={item}
                      tenantTimezone={tenantTimezone}
                      showContact
                      showStatus
                      onSelect={onSelect}
                      variant="day-grid"
                      className="h-full"
                    />
                  </div>
                )
              })}

              {dayItems.length === 0 && dayBlockedPeriods.length === 0 ? (
                <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/90 px-5 py-4 text-center">
                  <p className="font-medium text-slate-900">No appointments for this day.</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Click any hour to create a new appointment.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ListView({
  cursorDate,
  items,
  blockedPeriods,
  closedDayOfWeeks,
  tenantTimezone,
  onSelect,
  onSelectDay,
}: {
  cursorDate: Date
  items: CalendarEventItem[]
  blockedPeriods: CalendarBlockedPeriodItem[]
  closedDayOfWeeks: Set<number>
  tenantTimezone: string | null
  onSelect: (item: CalendarEventItem) => void
  onSelectDay: (day: Date) => void
}) {
  const weekDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(cursorDate),
        end: addDays(startOfWeek(cursorDate), 6),
      }),
    [cursorDate],
  )

  return (
    <div className="space-y-4">
      {weekDays.map((day) => {
        const dayItems = items.filter((item) => isSameDay(new Date(item.startAt), day))
        const dayBlockedPeriods = blockedPeriods.filter((item) =>
          isSameDay(new Date(item.startsAt), day),
        )
        const isClosedDay = closedDayOfWeeks.has(
          getDayOfWeekInTimezone(day, tenantTimezone),
        )

        return (
          <section
            key={day.toISOString()}
            onClick={() => onSelectDay(day)}
            className={cn(
              "cursor-pointer rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm transition hover:bg-slate-50/80 md:p-5",
              isClosedDay && "bg-slate-100/85 hover:bg-slate-100",
            )}
          >
            <div className="mb-4 border-b border-slate-100 pb-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {format(day, "EEEE")}
              </p>
              <h3 className="mt-1 text-lg font-semibold text-slate-950">
                {format(day, "MMMM d")}
              </h3>
            </div>

            <div className="space-y-3">
              {dayBlockedPeriods.map((item) => (
                <BlockedPeriodPill
                  key={item.id}
                  item={item}
                  tenantTimezone={tenantTimezone}
                />
              ))}

              {dayItems.map((item) => (
                  <CalendarEventCard
                    key={item.id}
                    item={item}
                    tenantTimezone={tenantTimezone}
                    showContact
                    showStatus
                    onSelect={onSelect}
                  />
                ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function CalendarLoadingSkeleton({ view }: { view: CalendarView }) {
  if (view === "month") {
    return (
      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50/50">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-100/70">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"
            >
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: 35 }).map((_, index) => (
            <div
              key={index}
              className="min-h-[132px] border-b border-r border-slate-200 bg-white p-2"
            >
              <div className="mb-3 flex items-center justify-between">
                <Skeleton className="h-7 w-7 rounded-full" />
                <Skeleton className="h-3 w-5 rounded-md" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-11 rounded-xl" />
                <Skeleton className="h-11 rounded-xl" />
                <Skeleton className="h-11 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (view === "week") {
    return (
      <div className="grid gap-3 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, index) => (
          <div
            key={index}
            className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-4 border-b border-slate-100 pb-3">
              <Skeleton className="h-3 w-14 rounded-md" />
              <Skeleton className="mt-2 h-7 w-8 rounded-md" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (view === "day") {
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="mb-5 border-b border-slate-100 pb-4">
          <Skeleton className="h-3 w-24 rounded-md" />
          <Skeleton className="mt-2 h-8 w-56 rounded-md" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-[24px]" />
          <Skeleton className="h-20 rounded-[24px]" />
          <Skeleton className="h-20 rounded-[24px]" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <section
          key={index}
          className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5"
        >
          <div className="mb-4 border-b border-slate-100 pb-3">
            <Skeleton className="h-3 w-20 rounded-md" />
            <Skeleton className="mt-2 h-7 w-32 rounded-md" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        </section>
      ))}
    </div>
  )
}

function AuditTrailDialogContent({
  logs,
  tenantTimezone,
  isLoading,
  error,
}: {
  logs: AppointmentAuditLogItem[]
  tenantTimezone: string | null
  isLoading: boolean
  error: string | null
}) {
  return (
    <div className="space-y-1">
      <DialogHeader>
        <DialogTitle>Audit Log</DialogTitle>
        <DialogDescription>
          Review the appointment activity history for this booking.
        </DialogDescription>
      </DialogHeader>

      {isLoading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
        </div>
      ) : error ? (
        <p className="mt-4 text-sm text-rose-600">{error}</p>
      ) : logs.length > 0 ? (
        <div className="mt-4 space-y-4">
          {logs.map((log) => (
            <div
              key={log.id}
              className="border-b border-slate-100 pb-4 last:border-b-0 last:pb-0"
            >
              <p className="text-sm leading-6 text-slate-700">{log.message}</p>
              <p className="mt-1 text-xs text-slate-400">
                {formatDateTimeForDisplay(log.createdAt, tenantTimezone)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">
          No audit activity has been recorded for this appointment.
        </p>
      )}
    </div>
  )
}

export function CalendarWorkspace({
  tenantSlug,
  tenantId,
  tenantTimezone,
  currentUserId,
  canViewAuditLogs,
  meta,
  events,
}: CalendarWorkspaceProps) {
  const safeMetaFilters = {
    users: Array.isArray(meta.filters?.users) ? meta.filters.users : [],
    groups: Array.isArray(meta.filters?.groups) ? meta.filters.groups : [],
    services: Array.isArray(meta.filters?.services) ? meta.filters.services : [],
  } satisfies CalendarMetaResponse["filters"]
  const accountWeeklyAvailability = Array.isArray(meta.availability?.weeklyAvailability)
    ? meta.availability.weeklyAvailability
    : Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        enabled: dayOfWeek >= 1 && dayOfWeek <= 5,
        startTime: "09:00",
        endTime: "17:00",
      }))

  const safeFilters = {
    view: events.filters?.view ?? "month",
    filterMode: events.filters?.filterMode ?? "users",
    assignedToUserId: events.filters?.assignedToUserId ?? null,
    assignedToUserIds: Array.isArray(events.filters?.assignedToUserIds)
      ? events.filters.assignedToUserIds
      : [],
    groupIds: Array.isArray(events.filters?.groupIds) ? events.filters.groupIds : [],
    contactId: events.filters?.contactId ?? null,
    serviceId: events.filters?.serviceId ?? null,
  } satisfies CalendarEventsResponse["filters"]

  const initialSelectedUserIds =
    safeFilters.assignedToUserIds.length > 0
      ? safeFilters.assignedToUserIds
      : safeFilters.assignedToUserId
        ? [safeFilters.assignedToUserId]
        : []

  const [selectedView, setSelectedView] = useState<CalendarView>(safeFilters.view || "month")
  const [selectedFilterMode, setSelectedFilterMode] = useState<CalendarFilterMode>(
    safeFilters.filterMode || "users",
  )
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(initialSelectedUserIds)
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>(
    safeFilters.groupIds ?? [],
  )
  const [selectedServiceId, setSelectedServiceId] = useState<string>(safeFilters.serviceId ?? "ALL")
  const [cursorDate, setCursorDate] = useState<Date>(events.range.from ? new Date(events.range.from) : new Date())
  const [miniCalendarMonth, setMiniCalendarMonth] = useState<Date>(
    startOfMonth(events.range.from ? new Date(events.range.from) : new Date()),
  )
  const [eventsData, setEventsData] = useState<CalendarEventsResponse>(events)
  const [isLoadingEvents, setIsLoadingEvents] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedAppointment, setSelectedAppointment] = useState<CalendarEventItem | null>(null)
  const [selectedAppointmentAuditLogs, setSelectedAppointmentAuditLogs] = useState<
    AppointmentAuditLogItem[]
  >([])
  const [isLoadingAppointmentAuditLogs, setIsLoadingAppointmentAuditLogs] =
    useState(false)
  const [appointmentAuditLogsError, setAppointmentAuditLogsError] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<AppointmentStatus>("SCHEDULED")
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const [isEditingAppointment, setIsEditingAppointment] = useState(false)
  const [isCancelingAppointment, setIsCancelingAppointment] = useState(false)
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false)
  const [isAuditDialogOpen, setIsAuditDialogOpen] = useState(false)
  const [isCreateAppointmentOpen, setIsCreateAppointmentOpen] = useState(false)
  const [createAppointmentSeedDate, setCreateAppointmentSeedDate] = useState<Date | null>(null)
  const [createAppointmentSeedTime, setCreateAppointmentSeedTime] = useState<string | null>(null)
  const [isUsersSectionOpen, setIsUsersSectionOpen] = useState(true)
  const [isGroupsSectionOpen, setIsGroupsSectionOpen] = useState(true)
  const drawerAppointment = selectedAppointment

  const activeRange = useMemo(
    () => getRangeForView(selectedView, cursorDate),
    [cursorDate, selectedView],
  )

  const rangeLabel = useMemo(
    () => formatRangeLabel(selectedView, cursorDate, tenantTimezone),
    [cursorDate, selectedView, tenantTimezone],
  )

  const activeFilterCount = useMemo(() => {
    let count = 0
    count += selectedFilterMode === "users" ? selectedUserIds.length : selectedGroupIds.length
    if (selectedServiceId !== "ALL") count += 1
    return count
  }, [selectedFilterMode, selectedGroupIds.length, selectedServiceId, selectedUserIds.length])

  const activeFilterBadges = useMemo(() => {
    const badges: Array<{
      key: string
      label: string
      removable: boolean
      onRemove: () => void
    }> = []

    if (selectedFilterMode === "users") {
      if (selectedUserIds.length === 0) {
        badges.push({
          key: "all-team",
          label: "Team: All team",
          removable: false,
          onRemove: () => {},
        })
      } else {
        const selectedUsers = safeMetaFilters.users.filter((user) => selectedUserIds.includes(user.id))
        for (const user of selectedUsers) {
          badges.push({
            key: `user-${user.id}`,
            label: user.label,
            removable: true,
            onRemove: () => {
              setSelectedFilterMode("users")
              setSelectedUserIds((current) => current.filter((value) => value !== user.id))
            },
          })
        }
      }
    } else {
      if (selectedGroupIds.length === 0) {
        badges.push({
          key: "all-groups",
          label: "Groups: All groups",
          removable: false,
          onRemove: () => {},
        })
      } else {
        const selectedGroups = safeMetaFilters.groups.filter((group) => selectedGroupIds.includes(group.id))
        for (const group of selectedGroups) {
          badges.push({
            key: `group-${group.id}`,
            label: group.name,
            removable: true,
            onRemove: () => {
              setSelectedFilterMode("groups")
              setSelectedGroupIds((current) => current.filter((value) => value !== group.id))
            },
          })
        }
      }
    }

      if (selectedServiceId !== "ALL") {
      const selectedService = safeMetaFilters.services.find((service) => service.id === selectedServiceId)
      if (selectedService) {
        badges.push({
          key: `service-${selectedService.id}`,
          label: `Service: ${selectedService.name}`,
          removable: true,
          onRemove: () => {
            setSelectedServiceId("ALL")
          },
        })
      }
    }

    return badges
  }, [
    safeMetaFilters.groups,
    safeMetaFilters.services,
    safeMetaFilters.users,
    selectedFilterMode,
    selectedGroupIds,
    selectedServiceId,
    selectedUserIds,
  ])

  const selectedAssignee = useMemo(
    () =>
      drawerAppointment?.assignedToUserId
        ? safeMetaFilters.users.find((user) => user.id === drawerAppointment.assignedToUserId) ?? null
        : null,
    [drawerAppointment, safeMetaFilters.users],
  )

  const loadEvents = useCallback(async () => {
    setIsLoadingEvents(true)
    setLoadError(null)

    try {
      const response = await getCalendarEvents(tenantId, {
        view: selectedView,
        filterMode: selectedFilterMode,
        assignedToUserIds: selectedFilterMode === "users" ? selectedUserIds : undefined,
        groupIds: selectedFilterMode === "groups" ? selectedGroupIds : undefined,
        serviceId: selectedServiceId !== "ALL" ? selectedServiceId : undefined,
        from: activeRange.start.toISOString(),
        to: activeRange.end.toISOString(),
      })

      setEventsData(response)
    } catch {
      setLoadError("Could not load this calendar range.")
    } finally {
      setIsLoadingEvents(false)
    }
  }, [
    activeRange.end,
    activeRange.start,
    selectedFilterMode,
    selectedGroupIds,
    selectedServiceId,
    selectedUserIds,
    selectedView,
    tenantId,
  ])

  useEffect(() => {
    void loadEvents()
  }, [loadEvents])

  useEffect(() => {
    setMiniCalendarMonth(startOfMonth(cursorDate))
  }, [cursorDate])

  useEffect(() => {
    if (!selectedAppointment) {
      setSelectedAppointmentAuditLogs([])
      setAppointmentAuditLogsError(null)
      setIsLoadingAppointmentAuditLogs(false)
      setSelectedStatus("SCHEDULED")
      setIsUpdatingStatus(false)
      setIsEditingAppointment(false)
      setIsCancelDialogOpen(false)
      setIsAuditDialogOpen(false)
      return
    }

    setSelectedStatus(
      (selectedAppointment.status as AppointmentStatus) ?? "SCHEDULED",
    )
  }, [selectedAppointment])

  const eventsByDay = useMemo(
    () => groupEventsByDay(eventsData.items, tenantTimezone),
    [eventsData.items, tenantTimezone],
  )
  const blockedPeriodsByDay = useMemo(
    () => groupBlockedPeriodsByDay(eventsData.blockedPeriods ?? [], tenantTimezone),
    [eventsData.blockedPeriods, tenantTimezone],
  )
  const closedDayOfWeeks = useMemo(() => {
    const enabledDays = new Set(
      accountWeeklyAvailability
        .filter((item) => item.enabled)
        .map((item) => item.dayOfWeek),
    )

    return new Set(
      Array.from({ length: 7 }, (_, dayOfWeek) => dayOfWeek).filter(
        (dayOfWeek) => !enabledDays.has(dayOfWeek),
      ),
    )
  }, [accountWeeklyAvailability])

  const onSelectDay = (day: Date) => {
    setSelectedView("day")
    setCursorDate(startOfDay(day))
  }

  const onSelectDayHour = (day: Date, hour: number) => {
    const seededDate = startOfDay(day)
    seededDate.setHours(hour, 0, 0, 0)
    setCreateAppointmentSeedDate(seededDate)
    setCreateAppointmentSeedTime(`${String(hour).padStart(2, "0")}:00`)
    setIsCreateAppointmentOpen(true)
  }

  const onPrevious = () => {
    setCursorDate((current) => shiftCursorDate(selectedView, current, -1))
  }

  const onNext = () => {
    setCursorDate((current) => shiftCursorDate(selectedView, current, 1))
  }

  const onToday = () => {
    setCursorDate(new Date())
  }

  const onClearFilters = () => {
    setSelectedFilterMode("users")
    setSelectedUserIds([])
    setSelectedGroupIds([])
    setSelectedServiceId("ALL")
  }

  const onSelectMiniCalendarDate = (day?: Date) => {
    if (!day) return
    setCursorDate(startOfDay(day))
    setMiniCalendarMonth(startOfMonth(day))
  }

  const onToggleUser = (userId: string, checked: boolean) => {
    setSelectedFilterMode("users")
    setSelectedGroupIds([])
    setSelectedUserIds((current) =>
      checked ? [...new Set([...current, userId])] : current.filter((value) => value !== userId),
    )
  }

  const onToggleGroup = (groupId: string, checked: boolean) => {
    setSelectedFilterMode("groups")
    setSelectedUserIds([])
    setSelectedGroupIds((current) =>
      checked ? [...new Set([...current, groupId])] : current.filter((value) => value !== groupId),
    )
  }

  const renderView = () => {
    if (selectedView === "month") {
      return (
        <MonthView
          cursorDate={cursorDate}
          eventsByDay={eventsByDay}
          blockedPeriodsByDay={blockedPeriodsByDay}
          closedDayOfWeeks={closedDayOfWeeks}
          tenantTimezone={tenantTimezone}
          onSelect={setSelectedAppointment}
          onSelectDay={onSelectDay}
        />
      )
    }

    if (selectedView === "week") {
      return (
        <WeekView
          cursorDate={cursorDate}
          eventsByDay={eventsByDay}
          blockedPeriodsByDay={blockedPeriodsByDay}
          closedDayOfWeeks={closedDayOfWeeks}
          tenantTimezone={tenantTimezone}
          onSelect={setSelectedAppointment}
          onSelectDay={onSelectDay}
          onSelectSlot={onSelectDayHour}
        />
      )
    }

    if (selectedView === "day") {
      return (
        <DayView
          cursorDate={cursorDate}
          items={eventsData.items}
          blockedPeriods={eventsData.blockedPeriods ?? []}
          closedDayOfWeeks={closedDayOfWeeks}
          tenantTimezone={tenantTimezone}
          onSelect={setSelectedAppointment}
          onSelectSlot={onSelectDayHour}
        />
      )
    }

    return (
      <ListView
        cursorDate={cursorDate}
        items={eventsData.items}
        blockedPeriods={eventsData.blockedPeriods ?? []}
        closedDayOfWeeks={closedDayOfWeeks}
        tenantTimezone={tenantTimezone}
        onSelect={setSelectedAppointment}
        onSelectDay={onSelectDay}
      />
    )
  }

  const onCancelAppointment = async () => {
    if (!drawerAppointment) return

    setIsCancelingAppointment(true)
    try {
      await updateAppointment(tenantId, drawerAppointment.id, {
        status: "CANCELED",
      })

      toast.success("Appointment canceled.")
      setIsCancelDialogOpen(false)
      setSelectedAppointment(null)
      await loadEvents()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not cancel appointment.",
        )
      } else {
        toast.error("Could not cancel appointment.")
      }
    } finally {
      setIsCancelingAppointment(false)
    }
  }

  const onOpenAuditLog = async () => {
    if (!drawerAppointment || !canViewAuditLogs) return

    setIsAuditDialogOpen(true)
    setSelectedAppointmentAuditLogs([])
    setAppointmentAuditLogsError(null)
    setIsLoadingAppointmentAuditLogs(true)

    try {
      const response = await getAppointmentAuditLogs(tenantId, drawerAppointment.id)
      setSelectedAppointmentAuditLogs(response.items)
    } catch {
      setAppointmentAuditLogsError(
        "Could not load the audit trail for this appointment.",
      )
    } finally {
      setIsLoadingAppointmentAuditLogs(false)
    }
  }

  const onUpdateStatus = async () => {
    if (!drawerAppointment || selectedStatus === drawerAppointment.status) return

    setIsUpdatingStatus(true)
    try {
      const response = await updateAppointment(tenantId, drawerAppointment.id, {
        status: selectedStatus,
      })

      setSelectedAppointment((current) =>
        current
          ? {
              ...current,
              status: response.item.status,
            }
          : current,
      )
      toast.success("Appointment status updated.")
      await loadEvents()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (
          error.response?.status === 409 &&
          backendError === "APPOINTMENT_TIME_UNAVAILABLE"
        ) {
          setSelectedStatus(drawerAppointment.status)
          toast.error("This slot has been taken already. Choose another time.")
          return
        }
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not update appointment status.",
        )
      } else {
        toast.error("Could not update appointment status.")
      }

      setSelectedStatus(drawerAppointment.status)
    } finally {
      setIsUpdatingStatus(false)
    }
  }

  return (
    <section className="grid h-full min-h-0 gap-4 xl:grid-cols-[292px_minmax(0,1fr)] xl:items-start">
      <aside className="xl:sticky xl:top-6 xl:self-start">
        <div className="flex flex-col rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm md:px-5 md:py-5">
        <CreateAppointmentDialog
          tenantId={tenantId}
          tenantTimezone={tenantTimezone}
          currentUserId={currentUserId}
          open={isCreateAppointmentOpen}
          onOpenChange={setIsCreateAppointmentOpen}
          initialDate={createAppointmentSeedDate}
          initialAssignedToUserId={
            selectedFilterMode === "users" && selectedUserIds.length === 1
              ? selectedUserIds[0]
              : currentUserId
          }
          preferredSlotTime={createAppointmentSeedTime}
          triggerLabel="Create appointment"
          triggerClassName="h-11 w-full justify-center gap-2 rounded-2xl px-4 text-sm font-medium"
          meetingIntervalMinutes={meta.settings.meetingIntervalMinutes}
          meetingDurationMinutes={meta.settings.meetingDurationMinutes}
          serviceOptions={safeMetaFilters.services}
          assigneeOptions={safeMetaFilters.users}
          onCreated={loadEvents}
        />

        <div className="mt-5 pt-2">
          <Calendar
            mode="single"
            selected={cursorDate}
            month={miniCalendarMonth}
            onMonthChange={setMiniCalendarMonth}
            onSelect={onSelectMiniCalendarDate}
            className="w-full"
            classNames={{
              root: "w-full",
              month: "w-full gap-3",
              table: "w-full",
              head_row: "grid grid-cols-7",
              row: "grid grid-cols-7 mt-2",
              cell: "text-center",
              day: "aspect-square",
            }}
          />
        </div>

        <div className="mt-5 flex min-h-0 flex-1 flex-col overflow-hidden pt-3">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-950">Calendar filters</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
              onClick={onClearFilters}
            >
              Clear
            </Button>
          </div>

          <div>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-between py-4 text-left"
              onClick={() => setIsUsersSectionOpen((current) => !current)}
            >
              <div>
                <p className="text-sm font-semibold text-slate-950">Users</p>
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-slate-500 transition-transform",
                  isUsersSectionOpen && "rotate-180",
                )}
              />
            </button>

            {isUsersSectionOpen ? (
              <div className="py-1">
                <label className="flex cursor-pointer items-center gap-3 py-3">
                  <Checkbox
                    {...getCheckboxColorProps("#172554")}
                    checked={selectedFilterMode === "users" && selectedUserIds.length === 0}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedFilterMode("users")
                        setSelectedGroupIds([])
                        setSelectedUserIds([])
                      }
                    }}
                  />
                  <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">
                    All team
                  </span>
                </label>

                <div className="max-h-64 overflow-y-auto">
                  {safeMetaFilters.users.map((user) => (
                    <label
                      key={user.id}
                      className="flex cursor-pointer items-center gap-3 py-3"
                    >
                      <Checkbox
                        {...getCheckboxColorProps(user.color)}
                        checked={
                          selectedFilterMode === "users" &&
                          selectedUserIds.includes(user.id)
                        }
                        onCheckedChange={(checked) => onToggleUser(user.id, Boolean(checked))}
                      />
                      <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">
                        {user.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-2">
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-between py-4 text-left"
              onClick={() => setIsGroupsSectionOpen((current) => !current)}
            >
              <div>
                <p className="text-sm font-semibold text-slate-950">Groups</p>
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-slate-500 transition-transform",
                  isGroupsSectionOpen && "rotate-180",
                )}
              />
            </button>

            {isGroupsSectionOpen ? (
              <div className="py-1">
                <label className="flex cursor-pointer items-center gap-3 py-3">
                  <Checkbox
                    checked={selectedFilterMode === "groups" && selectedGroupIds.length === 0}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedFilterMode("groups")
                        setSelectedUserIds([])
                        setSelectedGroupIds([])
                      }
                    }}
                  />
                  <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">
                    All groups
                  </span>
                </label>

                <div className="max-h-64 overflow-y-auto">
                  {safeMetaFilters.groups.length > 0 ? (
                    safeMetaFilters.groups.map((group) => (
                      <label
                        key={group.id}
                        className="flex cursor-pointer items-center gap-3 py-3"
                      >
                        <Checkbox
                          checked={
                            selectedFilterMode === "groups" &&
                            selectedGroupIds.includes(group.id)
                          }
                          onCheckedChange={(checked) => onToggleGroup(group.id, Boolean(checked))}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {group.name}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-400">
                            {group.members.length} member
                            {group.members.length === 1 ? "" : "s"}
                          </p>
                        </div>
                      </label>
                    ))
                  ) : (
                    <p className="py-4 text-sm text-slate-500">No groups created yet.</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-2 py-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-950">Service</p>
            </div>
            <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
              <SelectTrigger className="mt-3 border-blue-200 focus-visible:ring-blue-200">
                <SelectValue placeholder="Choose service" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All services</SelectItem>
                {safeMetaFilters.services.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col rounded-[24px] bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4 md:px-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-[20px] border border-slate-200 bg-slate-50/60 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="icon" onClick={onPrevious}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" onClick={onToday}>
                  Today
                </Button>
                <Button type="button" variant="outline" size="icon" onClick={onNext}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <div className="ml-2">
                  <p className="text-sm font-semibold text-slate-950">{rangeLabel}</p>
                  <p className="text-xs text-slate-500">
                    {eventsData.items.length} appointment
                    {eventsData.items.length === 1 ? "" : "s"} in this range
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {VIEW_OPTIONS.map((option) => {
                  const isActive = selectedView === option.value

                  return (
                    <Button
                      key={option.value}
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn(
                        "cursor-pointer border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950",
                        isActive && "bg-blue-950 text-white hover:bg-blue-900 hover:text-white",
                      )}
                      onClick={() => {
                        if (selectedView !== option.value) {
                          setSelectedView(option.value)
                        }
                      }}
                    >
                      {option.label}
                    </Button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                Active filters
              </span>
              {activeFilterBadges.map((badge) => (
                <Badge
                  key={badge.key}
                  variant="secondary"
                  className={cn(
                    "gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700",
                    badge.removable && "transition hover:bg-slate-100",
                  )}
                >
                  <span>{badge.label}</span>
                  {badge.removable ? (
                    <button
                      type="button"
                      aria-label={`Remove ${badge.label} filter`}
                      onClick={badge.onRemove}
                      className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </Badge>
              ))}
              {activeFilterCount === 0 ? (
                <span className="text-sm text-slate-500">No extra filters applied.</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-4 md:p-6">
          {loadError ? (
            <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-6 py-5 text-rose-800">
              <p className="font-medium">{loadError}</p>
              <p className="mt-1 text-sm">
                Try another range or refresh the page.
              </p>
            </div>
          ) : isLoadingEvents ? (
            <CalendarLoadingSkeleton view={selectedView} />
          ) : (
            renderView()
          )}
        </div>

        <Sheet
          open={Boolean(selectedAppointment)}
          onOpenChange={(open) => {
            if (!open) {
              setIsEditingAppointment(false)
              setSelectedAppointment(null)
            }
          }}
        >
          <SheetContent side="right" className="flex h-full flex-col overflow-hidden p-0 gap-0 sm:max-w-lg">
            {drawerAppointment ? (
              <>
                <SheetHeader className="border-b border-slate-200 bg-slate-50 px-6 text-left">
                  <SheetTitle className="text-xl font-semibold text-slate-950">
                    {isEditingAppointment ? "Edit Appointment" : "Appointment Details"}
                  </SheetTitle>
                  <SheetDescription className="mt-1">
                    {isEditingAppointment
                      ? "Update the assignment, slot, service, and notes while keeping booking conflicts protected."
                      : "Review the appointment details for this booking."}
                  </SheetDescription>
                </SheetHeader>

                {isEditingAppointment ? (
                  <EditAppointmentForm
                    tenantId={tenantId}
                    tenantTimezone={tenantTimezone}
                    appointment={drawerAppointment}
                    meetingIntervalMinutes={meta.settings.meetingIntervalMinutes}
                    meetingDurationMinutes={meta.settings.meetingDurationMinutes}
                    serviceOptions={safeMetaFilters.services}
                    assigneeOptions={safeMetaFilters.users}
                    onCancel={() => setIsEditingAppointment(false)}
                    onUpdated={async () => {
                      setIsEditingAppointment(false)
                      setSelectedAppointment(null)
                      await loadEvents()
                    }}
                  />
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <section className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
                    <Badge
                      variant="secondary"
                      className={`w-fit rounded-full border px-3 py-1 ${getAppointmentStatusClass(drawerAppointment.status)}`}
                    >
                      {formatAppointmentStatus(drawerAppointment.status)}
                    </Badge>
                    {canViewAuditLogs ? (
                      <Button
                        type="button"
                        variant="link"
                        className="p-0 text-blue-600 hover:text-blue-700"
                        onClick={() => void onOpenAuditLog()}
                      >
                        View Audit Log
                      </Button>
                    ) : null}
                  </section>

                  <section className="border-b border-slate-200 px-6 py-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Appointment
                    </p>
                      <div className="mt-3 space-y-4">
                        <p className="text-lg font-semibold leading-tight text-slate-950">
                          {drawerAppointment.title}
                        </p>
                      {drawerAppointment.serviceName ? (
                        <p className="text-sm text-slate-600">
                          Related service: {drawerAppointment.serviceName}
                        </p>
                      ) : null}
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Status
                          </p>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <Select
                              value={selectedStatus}
                              onValueChange={(value) =>
                                setSelectedStatus(
                                  value as AppointmentStatus,
                                )
                              }
                            >
                              <SelectTrigger className="border-blue-200 focus-visible:ring-blue-200 sm:w-[220px]">
                                <SelectValue placeholder="Select status" />
                              </SelectTrigger>
                              <SelectContent>
                                {APPOINTMENT_STATUS_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              type="button"
                              variant="outline"
                              className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
                              disabled={
                                isUpdatingStatus ||
                                selectedStatus === drawerAppointment.status
                              }
                              onClick={() => void onUpdateStatus()}
                            >
                              {isUpdatingStatus ? "Saving..." : "Save status"}
                            </Button>
                          </div>
                        </div>
                        {drawerAppointment.notes ? (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Notes
                            </p>
                            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">
                              {drawerAppointment.notes}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    </section>

                    <section className="border-b border-slate-200 px-6 py-6">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Schedule
                      </p>
                      <div className="mt-4 flex flex-wrap gap-8">
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-medium text-slate-900">Start</p>
                          <p className="text-sm text-slate-600">
                            {formatDateTimeForDisplay(drawerAppointment.startAt, tenantTimezone)}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-medium text-slate-900">End</p>
                          <p className="text-sm text-slate-600">
                            {formatDateTimeForDisplay(drawerAppointment.endAt, tenantTimezone)}
                          </p>
                        </div>
                      </div>
                    </section>

                    <section className="border-b border-slate-200 px-6 py-6">
                      <div className="flex items-center gap-4">
                        <Avatar size="lg" className="shrink-0 border border-slate-200 shadow-sm">
                          <AvatarImage
                            src={drawerAppointment.assignedToImage ?? undefined}
                            alt={drawerAppointment.assignedToLabel}
                          />
                          <AvatarFallback>
                            {getInitials(drawerAppointment.assignedToLabel)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Assigned Staff
                          </p>
                          <p className="mt-1 text-base font-semibold text-slate-950">
                            {drawerAppointment.assignedToLabel}
                          </p>
                          {selectedAssignee?.email ? (
                            <p className="mt-1 truncate text-sm text-slate-500">
                              {selectedAssignee.email}
                            </p>
                          ) : (
                            <p className="mt-1 text-sm text-slate-400">No email available</p>
                          )}
                        </div>
                      </div>
                    </section>

                    <section className="px-6 py-6">
                      <div className="flex items-center gap-4">
                        <Avatar size="lg" className="shrink-0 border border-slate-200 shadow-sm">
                          <AvatarFallback>
                            {getInitials(drawerAppointment.contactName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Contact
                          </p>
                          <Link
                            href={`/app/${tenantSlug}/contacts/${drawerAppointment.contactId}/overview`}
                            className="mt-1 block truncate text-base font-semibold text-slate-950 transition hover:text-blue-950 hover:underline"
                          >
                            {drawerAppointment.contactName}
                          </Link>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-500">
                            <span>{drawerAppointment.contactEmail ?? "No email available"}</span>
                            <span>{drawerAppointment.contactPhone ?? "No phone available"}</span>
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                )}
              </>
            ) : null}
            {!isEditingAppointment && drawerAppointment ? (
              <SheetFooter className="border-t border-slate-200 px-6 py-4">
                {drawerAppointment.status !== "CANCELED" ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                    disabled={isCancelingAppointment}
                    onClick={() => setIsCancelDialogOpen(true)}
                  >
                    {isCancelingAppointment ? "Canceling..." : "Cancel appointment"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  className="bg-blue-950 text-white hover:bg-blue-900"
                  onClick={() => setIsEditingAppointment(true)}
                >
                  Edit appointment
                </Button>
              </SheetFooter>
            ) : null}
          </SheetContent>
        </Sheet>

        <Dialog open={isAuditDialogOpen} onOpenChange={setIsAuditDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <AuditTrailDialogContent
              logs={selectedAppointmentAuditLogs}
              tenantTimezone={tenantTimezone}
              isLoading={isLoadingAppointmentAuditLogs}
              error={appointmentAuditLogsError}
            />
          </DialogContent>
        </Dialog>

        <Dialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Cancel appointment</DialogTitle>
              <DialogDescription>
                {drawerAppointment
                  ? `Are you sure you want to cancel "${drawerAppointment.title}"?`
                  : "Are you sure you want to cancel this appointment?"}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCancelDialogOpen(false)}
              >
                Keep appointment
              </Button>
              <Button
                type="button"
                className="bg-rose-700 text-white hover:bg-rose-800"
                disabled={isCancelingAppointment}
                onClick={() => void onCancelAppointment()}
              >
                {isCancelingAppointment ? "Canceling..." : "Yes, cancel appointment"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </section>
  )
}
