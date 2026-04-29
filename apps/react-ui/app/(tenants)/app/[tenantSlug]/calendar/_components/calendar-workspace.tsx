"use client"

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
  ChevronLeft,
  ChevronRight,
  Filter,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { cn } from "@/lib/utils"
import { formatDateTimeForDisplay } from "@/lib/date-time"
import {
  getCalendarEvents,
  type CalendarEventItem,
  type CalendarEventsResponse,
  type CalendarMetaResponse,
  updateAppointment,
} from "../_lib/calendar-api"
import { CreateAppointmentDialog } from "./create-appointment-dialog"
import { EditAppointmentForm } from "./edit-appointment-sheet"

type CalendarWorkspaceProps = {
  tenantId: string
  tenantTimezone: string | null
  currentUserId: string
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

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase()
}

function formatAppointmentStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
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

function CalendarEventCard({
  item,
  tenantTimezone,
  compact = false,
  showContact = false,
  onSelect,
}: {
  item: CalendarEventItem
  tenantTimezone: string | null
  compact?: boolean
  showContact?: boolean
  onSelect: (item: CalendarEventItem) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        "w-full cursor-pointer rounded-xl border border-slate-200 bg-slate-50 text-left transition hover:border-slate-300 hover:brightness-[0.97] hover:shadow-sm",
        compact ? "px-2 py-1.5" : "p-3",
      )}
      style={getColorTintStyles(item.assignedToColor)}
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
  tenantTimezone,
  onSelect,
}: {
  cursorDate: Date
  eventsByDay: Record<string, CalendarEventItem[]>
  tenantTimezone: string | null
  onSelect: (item: CalendarEventItem) => void
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

          return (
            <div
              key={day.toISOString()}
              className={cn(
                "min-h-[132px] border-b border-r border-slate-200 bg-white p-2 align-top",
                !isSameMonth(day, cursorDate) && "bg-slate-50/80",
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

                {dayEvents.length === 0 && isSameMonth(day, cursorDate) ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-2.5 py-3 text-center">
                    <p className="text-[11px] text-slate-400">No appointments</p>
                  </div>
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
  tenantTimezone,
  onSelect,
}: {
  cursorDate: Date
  eventsByDay: Record<string, CalendarEventItem[]>
  tenantTimezone: string | null
  onSelect: (item: CalendarEventItem) => void
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
    <div className="grid gap-3 lg:grid-cols-7">
      {weekDays.map((day) => {
        const dayKey = getDateKey(day, tenantTimezone)
        const dayEvents = eventsByDay[dayKey] ?? []

        return (
          <div
            key={day.toISOString()}
            className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-4 border-b border-slate-100 pb-3">
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
            </div>

            <div className="space-y-2">
              {dayEvents.length > 0 ? (
                dayEvents.map((item) => (
                  <CalendarEventCard
                    key={item.id}
                    item={item}
                    tenantTimezone={tenantTimezone}
                    compact
                    showContact
                    onSelect={onSelect}
                  />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center">
                  <p className="text-xs text-slate-400">No appointments</p>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DayView({
  cursorDate,
  items,
  tenantTimezone,
  onSelect,
}: {
  cursorDate: Date
  items: CalendarEventItem[]
  tenantTimezone: string | null
  onSelect: (item: CalendarEventItem) => void
}) {
  const dayItems = useMemo(
    () => items.filter((item) => isSameDay(new Date(item.startAt), cursorDate)),
    [cursorDate, items],
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

      <div className="space-y-3">
        {dayItems.length > 0 ? (
          dayItems.map((item) => (
            <CalendarEventCard
              key={item.id}
              item={item}
              tenantTimezone={tenantTimezone}
              showContact
              onSelect={onSelect}
            />
          ))
        ) : (
          <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
            <p className="font-medium text-slate-900">No appointments for this day.</p>
            <p className="mt-1 text-sm text-slate-500">
              Move to another day or create a new appointment.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function ListView({
  cursorDate,
  items,
  tenantTimezone,
  onSelect,
}: {
  cursorDate: Date
  items: CalendarEventItem[]
  tenantTimezone: string | null
  onSelect: (item: CalendarEventItem) => void
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

        return (
          <section
            key={day.toISOString()}
            className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm md:p-5"
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
              {dayItems.length > 0 ? (
                dayItems.map((item) => (
                  <CalendarEventCard
                    key={item.id}
                    item={item}
                    tenantTimezone={tenantTimezone}
                    showContact
                    onSelect={onSelect}
                  />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center">
                  <p className="text-sm text-slate-400">No appointments</p>
                </div>
              )}
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

function DetailItem({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </p>
      <p className="text-sm text-slate-700">{value}</p>
    </div>
  )
}

export function CalendarWorkspace({
  tenantId,
  tenantTimezone,
  currentUserId,
  meta,
  events,
}: CalendarWorkspaceProps) {
  const safeMetaFilters = {
    users: Array.isArray(meta.filters?.users) ? meta.filters.users : [],
    groups: Array.isArray(meta.filters?.groups) ? meta.filters.groups : [],
    services: Array.isArray(meta.filters?.services) ? meta.filters.services : [],
  } satisfies CalendarMetaResponse["filters"]

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
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false)
  const [draftView, setDraftView] = useState<CalendarView>(safeFilters.view || "month")
  const [draftFilterMode, setDraftFilterMode] = useState<CalendarFilterMode>(
    safeFilters.filterMode || "users",
  )
  const [draftUserIds, setDraftUserIds] = useState<string[]>(initialSelectedUserIds)
  const [draftGroupIds, setDraftGroupIds] = useState<string[]>(safeFilters.groupIds ?? [])
  const [userSearch, setUserSearch] = useState("")
  const [groupSearch, setGroupSearch] = useState("")
  const [draftServiceId, setDraftServiceId] = useState<string>(safeFilters.serviceId ?? "ALL")
  const [cursorDate, setCursorDate] = useState<Date>(events.range.from ? new Date(events.range.from) : new Date())
  const [eventsData, setEventsData] = useState<CalendarEventsResponse>(events)
  const [isLoadingEvents, setIsLoadingEvents] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedAppointment, setSelectedAppointment] = useState<CalendarEventItem | null>(null)
  const [isEditingAppointment, setIsEditingAppointment] = useState(false)
  const [isCancelingAppointment, setIsCancelingAppointment] = useState(false)

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
    if (selectedView !== "month") count += 1
    count += selectedFilterMode === "users" ? selectedUserIds.length : selectedGroupIds.length
    if (selectedServiceId !== "ALL") count += 1
    return count
  }, [selectedFilterMode, selectedGroupIds.length, selectedServiceId, selectedUserIds.length, selectedView])

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
              setSelectedUserIds((current) => current.filter((value) => value !== user.id))
              setDraftUserIds((current) => current.filter((value) => value !== user.id))
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
              setSelectedGroupIds((current) => current.filter((value) => value !== group.id))
              setDraftGroupIds((current) => current.filter((value) => value !== group.id))
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
            setDraftServiceId("ALL")
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

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase()
    if (!query) return safeMetaFilters.users
    return safeMetaFilters.users.filter((user) =>
      `${user.label} ${user.email}`.toLowerCase().includes(query),
    )
  }, [safeMetaFilters.users, userSearch])

  const filteredGroups = useMemo(() => {
    const query = groupSearch.trim().toLowerCase()
    if (!query) return safeMetaFilters.groups
    return safeMetaFilters.groups.filter((group) =>
      `${group.name} ${group.description ?? ""}`.toLowerCase().includes(query),
    )
  }, [groupSearch, safeMetaFilters.groups])

  const selectedAssignee = useMemo(
    () =>
      selectedAppointment?.assignedToUserId
        ? safeMetaFilters.users.find((user) => user.id === selectedAppointment.assignedToUserId) ?? null
        : null,
    [safeMetaFilters.users, selectedAppointment],
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
    if (!selectedAppointment) {
      setIsEditingAppointment(false)
    }
  }, [selectedAppointment])

  const eventsByDay = useMemo(
    () => groupEventsByDay(eventsData.items, tenantTimezone),
    [eventsData.items, tenantTimezone],
  )

  const onPrevious = () => {
    setCursorDate((current) => shiftCursorDate(selectedView, current, -1))
  }

  const onNext = () => {
    setCursorDate((current) => shiftCursorDate(selectedView, current, 1))
  }

  const onToday = () => {
    setCursorDate(new Date())
  }

  const onOpenFilters = () => {
    setDraftView(selectedView)
    setDraftFilterMode(selectedFilterMode)
    setDraftUserIds(selectedUserIds)
    setDraftGroupIds(selectedGroupIds)
    setDraftServiceId(selectedServiceId)
    setUserSearch("")
    setGroupSearch("")
    setIsFilterSheetOpen(true)
  }

  const onApplyFilters = () => {
    const viewChanged = draftView !== selectedView
    setSelectedView(draftView)
    setSelectedFilterMode(draftFilterMode)
    setSelectedUserIds(draftUserIds)
    setSelectedGroupIds(draftGroupIds)
    setSelectedServiceId(draftServiceId)
    if (viewChanged) {
      setCursorDate(new Date())
    }
    setIsFilterSheetOpen(false)
  }

  const onClearFilters = () => {
    setSelectedView("month")
    setSelectedFilterMode("users")
    setSelectedUserIds([])
    setSelectedGroupIds([])
    setSelectedServiceId("ALL")
    setDraftView("month")
    setDraftFilterMode("users")
    setDraftUserIds([])
    setDraftGroupIds([])
    setDraftServiceId("ALL")
    setUserSearch("")
    setGroupSearch("")
    setCursorDate(new Date())
  }

  const renderView = () => {
    if (selectedView === "month") {
      return (
        <MonthView
          cursorDate={cursorDate}
          eventsByDay={eventsByDay}
          tenantTimezone={tenantTimezone}
          onSelect={setSelectedAppointment}
        />
      )
    }

    if (selectedView === "week") {
      return (
        <WeekView
          cursorDate={cursorDate}
          eventsByDay={eventsByDay}
          tenantTimezone={tenantTimezone}
          onSelect={setSelectedAppointment}
        />
      )
    }

    if (selectedView === "day") {
      return (
        <DayView
          cursorDate={cursorDate}
          items={eventsData.items}
          tenantTimezone={tenantTimezone}
          onSelect={setSelectedAppointment}
        />
      )
    }

    return (
      <ListView
        cursorDate={cursorDate}
        items={eventsData.items}
        tenantTimezone={tenantTimezone}
        onSelect={setSelectedAppointment}
      />
    )
  }

  const onCancelAppointment = async () => {
    if (!selectedAppointment) return

    const shouldCancel = window.confirm("Cancel this appointment?")
    if (!shouldCancel) return

    setIsCancelingAppointment(true)
    try {
      await updateAppointment(tenantId, selectedAppointment.id, {
        status: "CANCELED",
      })

      toast.success("Appointment canceled.")
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

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col rounded-[24px] bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4 md:px-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold tracking-tight text-slate-950">
                  Calendar workspace
                </h2>
                <p className="text-sm text-slate-600">
                  Use the pagination controls to move through the selected range and manage view, assignee, and service filters from the right-side drawer.
                </p>
              </div>

              <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    className="cursor-pointer border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
                    onClick={onOpenFilters}
                  >
                    <Filter className="h-4 w-4" />
                    Filters
                    {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="cursor-pointer border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
                    onClick={onClearFilters}
                  >
                    Clear Filters
                  </Button>
                </div>

                <CreateAppointmentDialog
                  tenantId={tenantId}
                  tenantTimezone={tenantTimezone}
                  currentUserId={currentUserId}
                  meetingIntervalMinutes={meta.settings.meetingIntervalMinutes}
                  meetingDurationMinutes={meta.settings.meetingDurationMinutes}
                  serviceOptions={safeMetaFilters.services}
                  assigneeOptions={safeMetaFilters.users}
                  onCreated={loadEvents}
                />
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
            </div>

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
                    {eventsData.items.length} appointment{eventsData.items.length === 1 ? "" : "s"} in this range
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 lg:items-end">
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
                            setDraftView(option.value)
                            setCursorDate(new Date())
                          }
                        }}
                      >
                        {option.label}
                      </Button>
                    )
                  })}
                </div>

              </div>
            </div>
          </div>
        </div>

        <Sheet open={isFilterSheetOpen} onOpenChange={setIsFilterSheetOpen}>
          <SheetContent side="right" className="sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Calendar Filters</SheetTitle>
              <SheetDescription>
                Adjust the calendar view and narrow the schedule by assignee or service.
              </SheetDescription>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <section className="space-y-3 py-4">
                <div className="space-y-1">
                  <Label className="text-sm font-semibold text-slate-900">Filter Mode</Label>
                  <p className="text-xs text-slate-500">
                    Choose whether the calendar should be filtered by selected users or by designated groups.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: "users" as const, label: "Users" },
                    { value: "groups" as const, label: "Groups" },
                  ].map((option) => {
                    const isActive = draftFilterMode === option.value

                    return (
                      <Button
                        key={option.value}
                        type="button"
                        variant="outline"
                        className={cn(
                          "cursor-pointer border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950",
                          isActive && "bg-blue-950 text-white hover:bg-blue-900 hover:text-white",
                        )}
                        onClick={() => setDraftFilterMode(option.value)}
                      >
                        {option.label}
                      </Button>
                    )
                  })}
                </div>
              </section>

              <div className="border-t border-slate-200" />

              {draftFilterMode === "users" ? (
                <section className="space-y-3 py-4">
                  <div className="space-y-1">
                    <Label className="text-sm font-semibold text-slate-900">Users</Label>
                    <p className="text-xs text-slate-500">
                      Select one or more calendar staff members, or leave empty to show the whole team.
                    </p>
                  </div>
                  <Input
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                    placeholder="Search users..."
                    className="border-blue-200 focus-visible:ring-blue-200"
                  />
                  <div className="space-y-2">
                    <div className="max-h-72 space-y-2 overflow-y-auto">
                      <label className="flex cursor-pointer items-center gap-3 border-b border-slate-100 py-3">
                        <Checkbox
                          checked={draftUserIds.length === 0}
                          onCheckedChange={(nextChecked) => {
                            if (nextChecked) {
                              setDraftUserIds([])
                            }
                          }}
                        />
                        <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">
                          All team
                        </span>
                      </label>
                      {filteredUsers.map((user) => {
                        const checked = draftUserIds.includes(user.id)

                        return (
                          <label
                            key={user.id}
                            className="flex cursor-pointer items-center gap-3 border-b border-slate-100 py-3 last:border-b-0"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(nextChecked) =>
                                setDraftUserIds((current) =>
                                  nextChecked
                                    ? [...current, user.id]
                                    : current.filter((value) => value !== user.id),
                                )
                              }
                            />
                            <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">
                              {user.label}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </section>
              ) : (
                <section className="space-y-3 py-4">
                  <div className="space-y-1">
                    <Label className="text-sm font-semibold text-slate-900">Groups</Label>
                    <p className="text-xs text-slate-500">
                      Select one or more designated teams. Appointments will show for all users in those groups.
                    </p>
                  </div>
                  <Input
                    value={groupSearch}
                    onChange={(event) => setGroupSearch(event.target.value)}
                    placeholder="Search groups..."
                    className="border-blue-200 focus-visible:ring-blue-200"
                  />
                  <div className="space-y-2">
                    <div className="max-h-72 space-y-2 overflow-y-auto">
                      <label className="flex cursor-pointer items-center gap-3 border-b border-slate-100 py-3">
                        <Checkbox
                          checked={draftGroupIds.length === 0}
                          onCheckedChange={(nextChecked) => {
                            if (nextChecked) {
                              setDraftGroupIds([])
                            }
                          }}
                        />
                        <span className="min-w-0 flex-1 text-sm font-medium text-slate-900">
                          All groups
                        </span>
                      </label>
                      {filteredGroups.length > 0 ? (
                        filteredGroups.map((group) => {
                          const checked = draftGroupIds.includes(group.id)

                          return (
                            <label
                              key={group.id}
                              className="flex cursor-pointer items-center gap-3 border-b border-slate-100 py-3 last:border-b-0"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(nextChecked) =>
                                  setDraftGroupIds((current) =>
                                    nextChecked
                                      ? [...current, group.id]
                                      : current.filter((value) => value !== group.id),
                                  )
                                }
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-900">{group.name}</p>
                                <p className="mt-1 text-[11px] text-slate-400">
                                  {group.members.length} member{group.members.length === 1 ? "" : "s"}
                                </p>
                              </div>
                            </label>
                          )
                        })
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                          No groups found.
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              <div className="border-t border-slate-200" />

              <section className="space-y-3 py-4">
                <div className="space-y-1">
                  <Label className="text-sm font-semibold text-slate-900">Service</Label>
                  <p className="text-xs text-slate-500">
                    Limit the schedule to appointments related to one service.
                  </p>
                </div>
                <Select value={draftServiceId} onValueChange={setDraftServiceId}>
                  <SelectTrigger className="border-blue-200 focus-visible:ring-blue-200">
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
              </section>
            </div>

            <SheetFooter>
              <Button
                type="button"
                variant="outline"
                className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
                onClick={() => {
                  setDraftFilterMode(selectedFilterMode)
                  setDraftUserIds(selectedUserIds)
                  setDraftGroupIds(selectedGroupIds)
                  setDraftServiceId(selectedServiceId)
                  setUserSearch("")
                  setGroupSearch("")
                  setIsFilterSheetOpen(false)
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-blue-950 text-white hover:bg-blue-900"
                onClick={onApplyFilters}
              >
                Apply Filters
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Sheet
          open={Boolean(selectedAppointment)}
          onOpenChange={(open) => {
            if (!open) {
              setIsEditingAppointment(false)
              setSelectedAppointment(null)
            }
          }}
        >
          <SheetContent side="right" className="flex h-full flex-col overflow-hidden p-0 sm:max-w-lg">
            {selectedAppointment ? (
              <>
                <SheetHeader className="border-b border-slate-200 bg-slate-50 px-6 py-6 text-left">
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
                    appointment={selectedAppointment}
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
                    <section className="border-b border-slate-200 px-6 py-6">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Schedule
                          </p>
                          <Badge
                            variant="secondary"
                            className="w-fit rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-950"
                          >
                            {formatAppointmentStatus(selectedAppointment.status)}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-4">
                          <Avatar size="lg" className="shrink-0 border border-slate-200 shadow-sm">
                            <AvatarImage
                              src={selectedAppointment.assignedToImage ?? undefined}
                              alt={selectedAppointment.assignedToLabel}
                            />
                            <AvatarFallback>
                              {getInitials(selectedAppointment.assignedToLabel)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Assigned Staff
                            </p>
                            <p className="mt-1 text-base font-semibold text-slate-950">
                              {selectedAppointment.assignedToLabel}
                            </p>
                            {selectedAssignee?.email ? (
                              <p className="mt-1 truncate text-sm text-slate-500">{selectedAssignee.email}</p>
                            ) : (
                              <p className="mt-1 text-sm text-slate-400">No email available</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="border-b border-slate-200 px-6 py-6">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Appointment
                      </p>
                      <div className="mt-3 space-y-4">
                        <p className="text-lg font-semibold leading-tight text-slate-950">
                          {selectedAppointment.title}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
                            onClick={() => setIsEditingAppointment(true)}
                          >
                            Edit appointment
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                            disabled={isCancelingAppointment}
                            onClick={() => void onCancelAppointment()}
                          >
                            {isCancelingAppointment ? "Canceling..." : "Cancel appointment"}
                          </Button>
                        </div>
                      </div>
                    </section>

                    <section className="border-b border-slate-200 px-6 py-6">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Schedule
                      </p>
                      <div className="mt-4 space-y-4">
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-medium text-slate-900">Start</p>
                          <p className="text-sm text-slate-600">
                            {formatDateTimeForDisplay(selectedAppointment.startAt, tenantTimezone)}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <p className="text-sm font-medium text-slate-900">End</p>
                          <p className="text-sm text-slate-600">
                            {formatDateTimeForDisplay(selectedAppointment.endAt, tenantTimezone)}
                          </p>
                        </div>
                      </div>
                    </section>

                    <section className="border-b border-slate-200 px-6 py-6">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Booking Details
                      </p>
                      <div className="mt-4 grid gap-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">
                            {selectedAppointment.contactName}
                          </p>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <DetailItem
                              label="Email"
                              value={selectedAppointment.contactEmail ?? "No email available"}
                            />
                            <DetailItem
                              label="Phone"
                              value={selectedAppointment.contactPhone ?? "No phone available"}
                            />
                          </div>
                        </div>
                        <DetailItem
                          label="Service"
                          value={selectedAppointment.serviceName ?? "No service assigned"}
                        />
                      </div>
                    </section>

                    {selectedAppointment.notes ? (
                      <section className="px-6 py-6">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Notes
                        </p>
                        <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                          {selectedAppointment.notes}
                        </p>
                      </section>
                    ) : null}
                  </div>
                )}
              </>
            ) : null}
          </SheetContent>
        </Sheet>

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
      </div>
    </section>
  )
}
