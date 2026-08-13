import { Prisma, type PrismaClient } from "../generated/prisma/index.js"

import { prisma } from "./prisma.js"

const DEFAULT_TIMEZONE = "America/Chicago"
const CALENDAR_SLOT_DURATION_OPTIONS = [15, 30, 45, 60, 120] as const
const CALENDAR_BUFFER_MODE_OPTIONS = ["BUSY", "UNAVAILABLE"] as const
const BOOKING_LOCK_NAMESPACE = "appointment-booking"
const BOOKING_TRANSACTION_RETRY_LIMIT = 3

type PrismaExecutor = PrismaClient | Prisma.TransactionClient

type AvailabilityParams = {
  tenantId: string
  contactId?: string
  assignedToUserId: string
  startAt: Date
  endAt: Date
  appointmentId?: string
}

type CreateAppointmentAtomicallyParams = {
  tenantId: string
  contactId: string
  serviceId: string | null
  bookedByUserId: string
  actorDisplayName: string
  assignedToUserId: string
  assignedToLabel: string
  title: string
  notes: string | null
  startAt: Date
  endAt: Date
  isAllDay: boolean
}

type UpdateAppointmentAtomicallyParams = {
  appointmentId: string
  tenantId: string
  actorUserId: string
  actorDisplayName: string
  contactId: string
  serviceId: string | null
  assignedToUserId: string
  assignedToLabel: string
  title: string
  notes: string | null
  startAt: Date
  endAt: Date
  isAllDay: boolean
}

type AppointmentAuditActionValue =
  | "CREATED"
  | "REASSIGNED"
  | "RESCHEDULED"
  | "CANCELED"

export function getSafeTimezone(timezone?: string | null) {
  return timezone?.trim() || DEFAULT_TIMEZONE
}

export function getSafeCalendarSlotDuration(value?: number | null) {
  return (CALENDAR_SLOT_DURATION_OPTIONS as readonly number[]).includes(value ?? -1)
    ? value!
    : 30
}

export function getSafeCalendarBufferMode(value?: string | null) {
  return (CALENDAR_BUFFER_MODE_OPTIONS as readonly string[]).includes(value ?? "")
    ? (value as (typeof CALENDAR_BUFFER_MODE_OPTIONS)[number])
    : "BUSY"
}

function parseOffsetMinutes(label: string) {
  if (label === "GMT" || label === "UTC") return 0

  const normalized = label.replace("UTC", "GMT")
  const match = normalized.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)
  if (!match) return 0

  const [, sign, hours, minutes] = match
  const total = Number(hours) * 60 + Number(minutes ?? "0")
  return sign === "-" ? -total : total
}

function compareLocalDateOnly(
  left: { year: number; month: number; day: number },
  right: { year: number; month: number; day: number },
) {
  if (left.year !== right.year) return left.year - right.year
  if (left.month !== right.month) return left.month - right.month
  return left.day - right.day
}

function diffLocalDays(
  left: { year: number; month: number; day: number },
  right: { year: number; month: number; day: number },
) {
  const leftUtc = Date.UTC(left.year, left.month - 1, left.day)
  const rightUtc = Date.UTC(right.year, right.month - 1, right.day)
  return Math.round((rightUtc - leftUtc) / (24 * 60 * 60 * 1000))
}

function diffLocalMonths(
  left: { year: number; month: number },
  right: { year: number; month: number },
) {
  return (right.year - left.year) * 12 + (right.month - left.month)
}

function getOffsetMinutes(timezone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(timezone),
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date)

  const label = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT"
  return parseOffsetMinutes(label)
}

export function getTimezoneDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date)

  const getPart = (type: string, fallback = "") =>
    parts.find((part) => part.type === type)?.value ?? fallback

  const weekday = getPart("weekday", "Sun")
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }

  return {
    year: Number(getPart("year", "0")),
    month: Number(getPart("month", "1")),
    day: Number(getPart("day", "1")),
    hour: Number(getPart("hour", "0")),
    minute: Number(getPart("minute", "0")),
    dayOfWeek: weekdayMap[weekday] ?? 0,
  }
}

export function zonedDateTimeToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, 0)
  let utcMs = utcGuess

  for (let index = 0; index < 3; index += 1) {
    const offsetMinutes = getOffsetMinutes(timezone, new Date(utcMs))
    const adjusted = utcGuess - offsetMinutes * 60_000
    if (adjusted === utcMs) break
    utcMs = adjusted
  }

  return new Date(utcMs)
}

function localMinutesToUtcDate(
  timezone: string,
  year: number,
  month: number,
  day: number,
  totalMinutes: number,
) {
  const dayOffset = Math.floor(totalMinutes / (24 * 60))
  const minutesWithinDay = totalMinutes % (24 * 60)
  const hour = Math.floor(minutesWithinDay / 60)
  const minute = minutesWithinDay % 60

  return zonedDateTimeToUtc(
    timezone,
    year,
    month,
    day + dayOffset,
    hour,
    minute,
    0,
  )
}

export function getDefaultRange(timezone: string) {
  const nowParts = getTimezoneDateParts(new Date(), timezone)
  const weekday = nowParts.dayOfWeek
  const mondayDelta = weekday === 0 ? -6 : 1 - weekday
  const start = zonedDateTimeToUtc(
    timezone,
    nowParts.year,
    nowParts.month,
    nowParts.day + mondayDelta,
    0,
    0,
    0,
  )
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)

  return { start, end }
}

function overlapsRange(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date,
) {
  return leftStart < rightEnd && leftEnd > rightStart
}

function formatMinutes(minutes: number) {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function mergeIntervals(intervals: Array<{ start: number; end: number }>) {
  if (intervals.length === 0) return []

  const sorted = [...intervals].sort((left, right) => left.start - right.start)
  const merged: Array<{ start: number; end: number }> = [sorted[0]]

  for (const interval of sorted.slice(1)) {
    const last = merged[merged.length - 1]
    if (interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end)
      continue
    }

    merged.push({ ...interval })
  }

  return merged
}

function intersectIntervals(
  left: Array<{ start: number; end: number }>,
  right: Array<{ start: number; end: number }>,
) {
  const intersections: Array<{ start: number; end: number }> = []

  for (const leftInterval of left) {
    for (const rightInterval of right) {
      const start = Math.max(leftInterval.start, rightInterval.start)
      const end = Math.min(leftInterval.end, rightInterval.end)
      if (end > start) {
        intersections.push({ start, end })
      }
    }
  }

  return mergeIntervals(intersections)
}

function subtractIntervals(
  base: Array<{ start: number; end: number }>,
  blocked: Array<{ start: number; end: number }>,
) {
  if (blocked.length === 0) return base

  const normalizedBlocked = mergeIntervals(blocked)
  const result: Array<{ start: number; end: number }> = []

  for (const interval of base) {
    let cursor = interval.start

    for (const block of normalizedBlocked) {
      if (block.end <= cursor || block.start >= interval.end) {
        continue
      }

      if (block.start > cursor) {
        result.push({ start: cursor, end: Math.min(block.start, interval.end) })
      }

      cursor = Math.max(cursor, block.end)
      if (cursor >= interval.end) {
        break
      }
    }

    if (cursor < interval.end) {
      result.push({ start: cursor, end: interval.end })
    }
  }

  return result.filter((interval) => interval.end > interval.start)
}

type CalendarAvailabilityRuleLike = {
  userId: string | null
  scope: "TENANT" | "USER"
  kind: "OPEN" | "BLOCK"
  startTimeMinutes: number
  endTimeMinutes: number
  label: string | null
}

function resolveDailyAvailability(
  rules: CalendarAvailabilityRuleLike[],
  assignedToUserId: string,
) {
  const tenantOpenRules = rules.filter(
    (rule) => rule.scope === "TENANT" && rule.kind === "OPEN" && rule.userId === null,
  )
  const userOpenRules = rules.filter(
    (rule) =>
      rule.scope === "USER" &&
      rule.kind === "OPEN" &&
      rule.userId === assignedToUserId,
  )
  const blockRules = rules.filter(
    (rule) =>
      rule.kind === "BLOCK" &&
      ((rule.scope === "TENANT" && rule.userId === null) ||
        (rule.scope === "USER" && rule.userId === assignedToUserId)),
  )

  const tenantIntervals = mergeIntervals(
    tenantOpenRules.map((rule) => ({
      start: rule.startTimeMinutes,
      end: rule.endTimeMinutes,
    })),
  )
  const userIntervals = mergeIntervals(
    userOpenRules.map((rule) => ({
      start: rule.startTimeMinutes,
      end: rule.endTimeMinutes,
    })),
  )
  const blockedIntervals = mergeIntervals(
    blockRules.map((rule) => ({
      start: rule.startTimeMinutes,
      end: rule.endTimeMinutes,
    })),
  )

  return {
    tenantOpenRules,
    userOpenRules,
    blockRules,
    tenantIntervals,
    userIntervals,
    openIntervals: subtractIntervals(
      intersectIntervals(tenantIntervals, userIntervals),
      blockedIntervals,
    ),
  }
}

type CalendarTimeBlockLike = {
  id: string
  title: string
  startsAt: Date
  endsAt: Date
  isAllDay: boolean
  recurrencePattern?: "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | null
  recurrenceUntil?: Date | null
}

export type CalendarBlockOccurrence = {
  id: string
  title: string
  startsAt: Date
  endsAt: Date
  isAllDay: boolean
}

function buildSingleBlockRangeForDay(
  block: CalendarTimeBlockLike,
  timezone: string,
  year: number,
  month: number,
  day: number,
) {
  const dayStart = zonedDateTimeToUtc(timezone, year, month, day, 0, 0, 0)
  const nextDayStart = zonedDateTimeToUtc(timezone, year, month, day + 1, 0, 0, 0)
  const startsAt = block.startsAt > dayStart ? block.startsAt : dayStart
  const endsAt = block.endsAt < nextDayStart ? block.endsAt : nextDayStart

  if (endsAt <= startsAt) {
    return null
  }

  const startParts = getTimezoneDateParts(startsAt, timezone)
  const endParts = getTimezoneDateParts(endsAt, timezone)
  const startMinutes = startParts.hour * 60 + startParts.minute
  const endMinutes =
    compareLocalDateOnly(endParts, { year, month, day }) === 0
      ? endParts.hour * 60 + endParts.minute
      : 24 * 60

  if (endMinutes <= startMinutes) {
    return null
  }

  return {
    id: block.id,
    title: block.title,
    startMinutes: Math.max(0, startMinutes),
    endMinutes: Math.min(24 * 60, endMinutes),
    startsAt,
    endsAt,
  }
}

function buildRecurringBlockRangeForDay(
  block: CalendarTimeBlockLike,
  timezone: string,
  year: number,
  month: number,
  day: number,
) {
  const recurrencePattern = block.recurrencePattern ?? "NONE"
  if (recurrencePattern === "NONE") {
    return null
  }

  const startParts = getTimezoneDateParts(block.startsAt, timezone)
  const endParts = getTimezoneDateParts(block.endsAt, timezone)
  const targetDate = { year, month, day }

  if (compareLocalDateOnly(startParts, endParts) !== 0) {
    return null
  }

  if (compareLocalDateOnly(targetDate, startParts) < 0) {
    return null
  }

  if (block.recurrenceUntil) {
    const untilParts = getTimezoneDateParts(block.recurrenceUntil, timezone)
    if (compareLocalDateOnly(targetDate, untilParts) > 0) {
      return null
    }
  }

  const daysDiff = diffLocalDays(startParts, targetDate)
  const monthsDiff = diffLocalMonths(startParts, targetDate)

  const matchesPattern =
    recurrencePattern === "DAILY"
      ? daysDiff >= 0
      : recurrencePattern === "WEEKLY"
        ? daysDiff >= 0 && daysDiff % 7 === 0
        : recurrencePattern === "BIWEEKLY"
          ? daysDiff >= 0 && daysDiff % 14 === 0
          : recurrencePattern === "MONTHLY"
            ? monthsDiff >= 0 && targetDate.day === startParts.day
            : false

  if (!matchesPattern) {
    return null
  }

  const startMinutes = block.isAllDay ? 0 : startParts.hour * 60 + startParts.minute
  const endMinutes = block.isAllDay ? 24 * 60 : endParts.hour * 60 + endParts.minute

  if (endMinutes <= startMinutes) {
    return null
  }

  return {
    id: block.id,
    title: block.title,
    startMinutes,
    endMinutes,
    startsAt: localMinutesToUtcDate(timezone, year, month, day, startMinutes),
    endsAt: localMinutesToUtcDate(timezone, year, month, day, endMinutes),
  }
}

function buildBlockRangeForDay(
  block: CalendarTimeBlockLike,
  timezone: string,
  year: number,
  month: number,
  day: number,
) {
  if ((block.recurrencePattern ?? "NONE") === "NONE") {
    return buildSingleBlockRangeForDay(block, timezone, year, month, day)
  }

  return buildRecurringBlockRangeForDay(block, timezone, year, month, day)
}

export async function listCalendarBlockOccurrences(
  client: PrismaExecutor,
  params: {
    tenantId: string
    timezone: string
    rangeStart: Date
    rangeEnd: Date
    scope?: "TENANT" | "USER"
    userId?: string | null
  },
) {
  const scopeWhere =
    params.scope === "USER"
      ? { scope: "USER" as const, userId: params.userId ?? null }
      : { scope: "TENANT" as const, userId: null }

  const rangeStartParts = getTimezoneDateParts(params.rangeStart, params.timezone)
  const rangeEndMinusTick = new Date(params.rangeEnd.getTime() - 1)
  const rangeEndParts = getTimezoneDateParts(rangeEndMinusTick, params.timezone)
  const rangeDayStart = zonedDateTimeToUtc(
    params.timezone,
    rangeStartParts.year,
    rangeStartParts.month,
    rangeStartParts.day,
    0,
    0,
    0,
  )

  const blocks = await client.calendarTimeBlock.findMany({
    where: {
      tenantId: params.tenantId,
      ...scopeWhere,
      AND: [
        {
          OR: [
            {
              recurrencePattern: "NONE",
              startsAt: { lt: params.rangeEnd },
              endsAt: { gt: params.rangeStart },
            },
            {
              recurrencePattern: { not: "NONE" },
              startsAt: { lt: params.rangeEnd },
              OR: [
                { recurrenceUntil: null },
                { recurrenceUntil: { gte: rangeDayStart } },
              ],
            },
          ],
        },
      ],
    },
    orderBy: [{ startsAt: "asc" }],
  })

  const occurrences: CalendarBlockOccurrence[] = []
  let current = zonedDateTimeToUtc(
    params.timezone,
    rangeStartParts.year,
    rangeStartParts.month,
    rangeStartParts.day,
    0,
    0,
    0,
  )

  while (current < params.rangeEnd) {
    const currentParts = getTimezoneDateParts(current, params.timezone)

    for (const block of blocks) {
      const occurrence = buildBlockRangeForDay(
        block,
        params.timezone,
        currentParts.year,
        currentParts.month,
        currentParts.day,
      )

      if (!occurrence) continue
      if (!overlapsRange(occurrence.startsAt, occurrence.endsAt, params.rangeStart, params.rangeEnd)) {
        continue
      }

      occurrences.push({
        id: `${block.id}:${toLocalDateKey(currentParts)}`,
        title: block.title,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
        isAllDay: block.isAllDay,
      })
    }

    if (
      currentParts.year === rangeEndParts.year &&
      currentParts.month === rangeEndParts.month &&
      currentParts.day === rangeEndParts.day
    ) {
      break
    }

    current = zonedDateTimeToUtc(
      params.timezone,
      currentParts.year,
      currentParts.month,
      currentParts.day + 1,
      0,
      0,
      0,
    )
  }

  return occurrences.sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
}

function toLocalDateKey(parts: {
  year: number
  month: number
  day: number
}) {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-")
}

function formatAuditDateTimeRange(
  startAt: Date,
  endAt: Date,
  timezone: string,
) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(timezone),
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })

  return `${formatter.format(startAt)} to ${formatter.format(endAt)}`
}

async function createAppointmentAuditLog(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    appointmentId: string
    actorUserId: string | null
    actorDisplayName: string
    action: AppointmentAuditActionValue
    message: string
  },
) {
  await tx.appointmentAuditLog.create({
    data: {
      tenantId: params.tenantId,
      appointmentId: params.appointmentId,
      actorUserId: params.actorUserId,
      actorDisplayName: params.actorDisplayName,
      action: params.action,
      message: params.message,
    },
  })
}

async function acquireBookingLocks(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string
    localDate: string
    assigneeUserId: string
    contactId: string
  },
) {
  const resourceKeys = [
    `assignee:${params.assigneeUserId}`,
    `contact:${params.contactId}`,
  ].sort((left, right) => left.localeCompare(right))

  for (const resourceKey of resourceKeys) {
    const lockKey = `${params.tenantId}:${params.localDate}:${resourceKey}`
    await tx.$queryRaw`
      WITH advisory_lock AS (
        SELECT pg_advisory_xact_lock(
          hashtext(${BOOKING_LOCK_NAMESPACE}),
          hashtext(${lockKey})
        )
      )
      SELECT 1
    `
  }
}

function mergeAppointmentConflicts(
  left: Array<{
    id: string
    title: string
    startAt: Date
    endAt: Date
  }>,
  right: Array<{
    id: string
    title: string
    startAt: Date
    endAt: Date
  }>,
) {
  const unique = new Map<string, { id: string; title: string; startAt: Date; endAt: Date }>()

  for (const appointment of [...left, ...right]) {
    unique.set(appointment.id, appointment)
  }

  return [...unique.values()].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}

export async function evaluateAvailability(
  client: PrismaExecutor,
  params: AvailabilityParams,
) {
  const { tenantId, contactId, assignedToUserId, startAt, endAt, appointmentId } = params

  const tenant = await client.tenant.findUnique({
    where: { id: tenantId },
    select: {
      timezone: true,
      calendarMeetingDurationMinutes: true,
      calendarMinimumScheduleNoticeMinutes: true,
      calendarMaximumBookingsPerDay: true,
      calendarMaximumBookingsPerSlot: true,
      calendarPreBufferMinutes: true,
      calendarPostBufferMinutes: true,
      calendarBufferAvailabilityMode: true,
    },
  })

  const timezone = getSafeTimezone(tenant?.timezone)
  const meetingDurationMinutes = getSafeCalendarSlotDuration(
    tenant?.calendarMeetingDurationMinutes,
  )
  const minimumScheduleNoticeMinutes = tenant?.calendarMinimumScheduleNoticeMinutes ?? 0
  const maximumBookingsPerDay = tenant?.calendarMaximumBookingsPerDay ?? null
  const maximumBookingsPerSlot = tenant?.calendarMaximumBookingsPerSlot ?? 1
  const preBufferMinutes = tenant?.calendarPreBufferMinutes ?? 0
  const postBufferMinutes = tenant?.calendarPostBufferMinutes ?? 0
  const bufferAvailabilityMode = getSafeCalendarBufferMode(
    tenant?.calendarBufferAvailabilityMode,
  )
  const startParts = getTimezoneDateParts(startAt, timezone)
  const endParts = getTimezoneDateParts(endAt, timezone)

  const reasons: string[] = []

  if (
    startParts.year !== endParts.year ||
    startParts.month !== endParts.month ||
    startParts.day !== endParts.day
  ) {
    reasons.push("Availability checks currently require the appointment to stay within one local day.")
  }

  const startMinutes = startParts.hour * 60 + startParts.minute
  const endMinutes = endParts.hour * 60 + endParts.minute
  const requestedDurationMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60_000)
  const dayStart = zonedDateTimeToUtc(
    timezone,
    startParts.year,
    startParts.month,
    startParts.day,
    0,
    0,
    0,
  )
  const nextDayStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  const overlapQueryStart = new Date(startAt.getTime() - postBufferMinutes * 60_000)
  const overlapQueryEnd = new Date(endAt.getTime() + preBufferMinutes * 60_000)

  const [rules, timeBlocks, overlappingAppointments, bookingsForDay, contactOverlaps] =
    await Promise.all([
      client.calendarAvailabilityRule.findMany({
        where: {
          tenantId,
          isActive: true,
          OR: [
            { scope: "TENANT", userId: null },
            { scope: "USER", userId: assignedToUserId },
          ],
        },
        orderBy: [
          { scope: "asc" },
          { dayOfWeek: "asc" },
          { startTimeMinutes: "asc" },
        ],
      }),
      client.calendarTimeBlock.findMany({
        where: {
          tenantId,
          AND: [
            {
              OR: [
                { scope: "TENANT", userId: null },
                { scope: "USER", userId: assignedToUserId },
              ],
            },
            {
              OR: [
                {
                  recurrencePattern: "NONE",
                  startsAt: { lt: endAt },
                  endsAt: { gt: startAt },
                },
                {
                  recurrencePattern: { not: "NONE" },
                  startsAt: { lt: nextDayStart },
                  OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: dayStart } }],
                },
              ],
            },
          ],
        },
        orderBy: [{ startsAt: "asc" }],
      }),
      client.appointment.findMany({
        where: {
          tenantId,
          assignedToUserId,
          status: "SCHEDULED",
          ...(appointmentId ? { id: { not: appointmentId } } : {}),
          startAt: { lt: overlapQueryEnd },
          endAt: { gt: overlapQueryStart },
        },
        orderBy: [{ startAt: "asc" }],
        select: {
          id: true,
          title: true,
          startAt: true,
          endAt: true,
        },
      }),
      client.appointment.count({
        where: {
          tenantId,
          assignedToUserId,
          status: "SCHEDULED",
          ...(appointmentId ? { id: { not: appointmentId } } : {}),
          startAt: { lt: nextDayStart },
          endAt: { gt: dayStart },
        },
      }),
      contactId
        ? client.appointment.findMany({
            where: {
              tenantId,
              contactId,
              status: "SCHEDULED",
              ...(appointmentId ? { id: { not: appointmentId } } : {}),
              startAt: { lt: endAt },
              endAt: { gt: startAt },
            },
            orderBy: [{ startAt: "asc" }],
            select: {
              id: true,
              title: true,
              startAt: true,
              endAt: true,
            },
          })
        : Promise.resolve([] as Array<{ id: string; title: string; startAt: Date; endAt: Date }>),
    ])

  const activeRules = rules.filter((rule) => rule.dayOfWeek === startParts.dayOfWeek)
  const {
    tenantOpenRules,
    userOpenRules,
    blockRules,
    tenantIntervals,
    userIntervals,
  } = resolveDailyAvailability(activeRules, assignedToUserId)

  const fitsInterval = (interval: { start: number; end: number }) =>
    startMinutes >= interval.start && endMinutes <= interval.end
  const overlapsRule = (rule: { startTimeMinutes: number; endTimeMinutes: number }) =>
    startMinutes < rule.endTimeMinutes && endMinutes > rule.startTimeMinutes

  if (!tenantIntervals.some(fitsInterval)) {
    reasons.push("The selected time is outside the tenant calendar open hours.")
  }

  if (!userIntervals.some(fitsInterval)) {
    reasons.push("The selected time is outside the assignee's open hours.")
  }

  const matchedBlockRules = blockRules.filter(overlapsRule)
  if (matchedBlockRules.length > 0) {
    reasons.push("The selected time overlaps a recurring blocked window.")
  }

  const matchedTimeBlocks = timeBlocks
    .map((block) =>
      buildBlockRangeForDay(
        block,
        timezone,
        startParts.year,
        startParts.month,
        startParts.day,
      ),
    )
    .filter(
      (
        block,
      ): block is {
        id: string
        title: string
        startMinutes: number
        endMinutes: number
        startsAt: Date
        endsAt: Date
      } => block !== null,
    )
    .filter((block) => startMinutes < block.endMinutes && endMinutes > block.startMinutes)

  if (matchedTimeBlocks.length > 0) {
    reasons.push("The selected time overlaps a blocked period on the calendar.")
  }

  const overlappingAppointmentsWithBuffer = overlappingAppointments.filter((appointment) => {
    const bufferedStart = new Date(appointment.startAt.getTime() - preBufferMinutes * 60_000)
    const bufferedEnd = new Date(appointment.endAt.getTime() + postBufferMinutes * 60_000)
    return overlapsRange(bufferedStart, bufferedEnd, startAt, endAt)
  })

  if (requestedDurationMinutes !== meetingDurationMinutes) {
    reasons.push(`Appointments must use the configured ${meetingDurationMinutes}-minute duration.`)
  }

  if (minimumScheduleNoticeMinutes > 0) {
    const noticeMs = minimumScheduleNoticeMinutes * 60_000
    if (startAt.getTime() - Date.now() < noticeMs) {
      reasons.push("The selected time does not meet the minimum scheduling notice.")
    }
  }

  if (maximumBookingsPerDay !== null && bookingsForDay >= maximumBookingsPerDay) {
    reasons.push("The selected assignee reached the maximum bookings allowed for that day.")
  }

  if (overlappingAppointmentsWithBuffer.length >= maximumBookingsPerSlot) {
    reasons.push("The selected assignee already has an appointment in this time range.")
  }

  if (contactOverlaps.length > 0) {
    reasons.push("The selected contact already has an overlapping appointment.")
  }

  const appointmentConflicts = mergeAppointmentConflicts(
    overlappingAppointmentsWithBuffer,
    contactOverlaps,
  )

  return {
    available: reasons.length === 0,
    timezone,
    bookingRules: {
      meetingDurationMinutes,
      minimumScheduleNoticeMinutes,
      maximumBookingsPerDay,
      maximumBookingsPerSlot,
      preBufferMinutes,
      postBufferMinutes,
      bufferAvailabilityMode,
    },
    reasons,
    windows: {
      tenantOpen: tenantOpenRules.map((rule) => ({
        start: formatMinutes(rule.startTimeMinutes),
        end: formatMinutes(rule.endTimeMinutes),
        label: rule.label,
      })),
      userOpen: userOpenRules.map((rule) => ({
        start: formatMinutes(rule.startTimeMinutes),
        end: formatMinutes(rule.endTimeMinutes),
        label: rule.label,
      })),
      blocked: matchedBlockRules.map((rule) => ({
        start: formatMinutes(rule.startTimeMinutes),
        end: formatMinutes(rule.endTimeMinutes),
        label: rule.label,
      })),
    },
    conflicts: {
      appointments: appointmentConflicts.map((appointment) => ({
        id: appointment.id,
        title: appointment.title,
        startAt: appointment.startAt.toISOString(),
        endAt: appointment.endAt.toISOString(),
      })),
      blocks: matchedTimeBlocks.map((block) => ({
        id: block.id,
        title: block.title,
        startsAt: block.startsAt.toISOString(),
        endsAt: block.endsAt.toISOString(),
      })),
    },
  }
}

export async function buildAppointmentSlots(
  client: PrismaExecutor,
  params: {
    tenantId: string
    assignedToUserId: string
    localDate: string
    appointmentId?: string
  },
) {
  const { tenantId, assignedToUserId, localDate, appointmentId } = params

  const tenant = await client.tenant.findUnique({
    where: { id: tenantId },
    select: {
      timezone: true,
      calendarAppointmentSlotMinutes: true,
      calendarMeetingDurationMinutes: true,
      calendarMinimumScheduleNoticeMinutes: true,
      calendarMaximumBookingsPerDay: true,
      calendarMaximumBookingsPerSlot: true,
      calendarPreBufferMinutes: true,
      calendarPostBufferMinutes: true,
      calendarBufferAvailabilityMode: true,
    },
  })

  const timezone = getSafeTimezone(tenant?.timezone)
  const meetingIntervalMinutes = getSafeCalendarSlotDuration(
    tenant?.calendarAppointmentSlotMinutes,
  )
  const meetingDurationMinutes = getSafeCalendarSlotDuration(
    tenant?.calendarMeetingDurationMinutes,
  )
  const minimumScheduleNoticeMinutes = tenant?.calendarMinimumScheduleNoticeMinutes ?? 0
  const maximumBookingsPerDay = tenant?.calendarMaximumBookingsPerDay ?? null
  const maximumBookingsPerSlot = tenant?.calendarMaximumBookingsPerSlot ?? 1
  const preBufferMinutes = tenant?.calendarPreBufferMinutes ?? 0
  const postBufferMinutes = tenant?.calendarPostBufferMinutes ?? 0
  const bufferAvailabilityMode = getSafeCalendarBufferMode(
    tenant?.calendarBufferAvailabilityMode,
  )
  const [year, month, day] = localDate.split("-").map(Number)
  const dayStart = zonedDateTimeToUtc(timezone, year, month, day, 0, 0, 0)
  const nextDayStart = zonedDateTimeToUtc(timezone, year, month, day + 1, 0, 0, 0)
  const { dayOfWeek } = getTimezoneDateParts(dayStart, timezone)

  const [rules, timeBlocks, overlappingAppointments, bookingsForDay] = await Promise.all([
    client.calendarAvailabilityRule.findMany({
      where: {
        tenantId,
        isActive: true,
        dayOfWeek,
        OR: [
          { scope: "TENANT", userId: null },
          { scope: "USER", userId: assignedToUserId },
        ],
      },
      orderBy: [
        { scope: "asc" },
        { startTimeMinutes: "asc" },
      ],
    }),
    client.calendarTimeBlock.findMany({
      where: {
        tenantId,
        AND: [
          {
            OR: [
              { scope: "TENANT", userId: null },
              { scope: "USER", userId: assignedToUserId },
            ],
          },
          {
            OR: [
              {
                recurrencePattern: "NONE",
                startsAt: { lt: nextDayStart },
                endsAt: { gt: dayStart },
              },
              {
                recurrencePattern: { not: "NONE" },
                startsAt: { lt: nextDayStart },
                OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: dayStart } }],
              },
            ],
          },
        ],
      },
      orderBy: [{ startsAt: "asc" }],
    }),
    client.appointment.findMany({
      where: {
        tenantId,
        assignedToUserId,
        status: "SCHEDULED",
        ...(appointmentId ? { id: { not: appointmentId } } : {}),
        startAt: { lt: nextDayStart },
        endAt: { gt: dayStart },
      },
      orderBy: [{ startAt: "asc" }],
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
      },
    }),
    client.appointment.count({
      where: {
        tenantId,
        assignedToUserId,
        status: "SCHEDULED",
        ...(appointmentId ? { id: { not: appointmentId } } : {}),
        startAt: { lt: nextDayStart },
        endAt: { gt: dayStart },
      },
    }),
  ])

  const { openIntervals } = resolveDailyAvailability(rules, assignedToUserId)

  const blockRanges = timeBlocks
    .map((block) => buildBlockRangeForDay(block, timezone, year, month, day))
    .filter(
      (
        block,
      ): block is {
        id: string
        title: string
        startMinutes: number
        endMinutes: number
        startsAt: Date
        endsAt: Date
      } => block !== null,
    )

  const appointmentRanges = overlappingAppointments.map((appointment) => {
    const appointmentStartParts = getTimezoneDateParts(appointment.startAt, timezone)
    const appointmentEndParts = getTimezoneDateParts(appointment.endAt, timezone)
    const appointmentStartMinutes =
      appointmentStartParts.year === year &&
      appointmentStartParts.month === month &&
      appointmentStartParts.day === day
        ? appointmentStartParts.hour * 60 + appointmentStartParts.minute
        : 0
    const appointmentEndMinutes =
      appointmentEndParts.year === year &&
      appointmentEndParts.month === month &&
      appointmentEndParts.day === day
        ? appointmentEndParts.hour * 60 + appointmentEndParts.minute
        : 24 * 60

    return {
      id: appointment.id,
      title: appointment.title,
      startMinutes: Math.max(0, appointmentStartMinutes),
      endMinutes: Math.min(24 * 60, appointmentEndMinutes),
    }
  })

  const nowWithNotice = new Date(Date.now() + minimumScheduleNoticeMinutes * 60_000)
  const noticeCutoffMinutes =
    minimumScheduleNoticeMinutes > 0
      ? (() => {
          const noticeParts = getTimezoneDateParts(nowWithNotice, timezone)
          if (
            noticeParts.year === year &&
            noticeParts.month === month &&
            noticeParts.day === day
          ) {
            return noticeParts.hour * 60 + noticeParts.minute
          }
          return null
        })()
      : null

  const slots: Array<{
    startAt: string
    endAt: string
    startLabel: string
    endLabel: string
    available: boolean
    reason: string | null
  }> = []

  for (const interval of openIntervals) {
    for (
      let startMinutes = interval.start;
      startMinutes + meetingDurationMinutes <= interval.end;
      startMinutes += meetingIntervalMinutes
    ) {
      const endMinutes = startMinutes + meetingDurationMinutes
      const dayLimitReached =
        maximumBookingsPerDay !== null && bookingsForDay >= maximumBookingsPerDay
      const violatesNotice =
        noticeCutoffMinutes !== null && startMinutes < noticeCutoffMinutes
      const overlappingBlock = blockRanges.find(
        (block) => startMinutes < block.endMinutes && endMinutes > block.startMinutes,
      )
      const overlappingBufferedAppointments = appointmentRanges.filter(
        (appointment) =>
          startMinutes < appointment.endMinutes + postBufferMinutes &&
          endMinutes > appointment.startMinutes - preBufferMinutes,
      )
      const slotCapacityReached =
        overlappingBufferedAppointments.length >= maximumBookingsPerSlot

      const startAt = zonedDateTimeToUtc(
        timezone,
        year,
        month,
        day,
        Math.floor(startMinutes / 60),
        startMinutes % 60,
        0,
      )
      const endAt = zonedDateTimeToUtc(
        timezone,
        year,
        month,
        day,
        Math.floor(endMinutes / 60),
        endMinutes % 60,
        0,
      )

      slots.push({
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        startLabel: formatMinutes(startMinutes),
        endLabel: formatMinutes(endMinutes),
        available:
          !violatesNotice &&
          !dayLimitReached &&
          !overlappingBlock &&
          !slotCapacityReached,
        reason: violatesNotice
          ? "Notice required"
          : dayLimitReached
            ? "Daily limit"
            : slotCapacityReached
              ? bufferAvailabilityMode === "UNAVAILABLE"
                ? "Unavailable"
                : "Busy"
              : overlappingBlock
                ? "Blocked"
                : null,
      })
    }
  }

  return {
    timezone,
    meetingIntervalMinutes,
    meetingDurationMinutes,
    bookingRules: {
      minimumScheduleNoticeMinutes,
      maximumBookingsPerDay,
      maximumBookingsPerSlot,
      preBufferMinutes,
      postBufferMinutes,
      bufferAvailabilityMode,
    },
    slots,
  }
}

export async function createAppointmentAtomically(
  params: CreateAppointmentAtomicallyParams,
) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: params.tenantId },
    select: { timezone: true },
  })

  const timezone = getSafeTimezone(tenant?.timezone)
  const startParts = getTimezoneDateParts(params.startAt, timezone)
  const localDate = toLocalDateKey(startParts)

  for (let attempt = 0; attempt < BOOKING_TRANSACTION_RETRY_LIMIT; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await acquireBookingLocks(tx, {
            tenantId: params.tenantId,
            localDate,
            assigneeUserId: params.assignedToUserId,
            contactId: params.contactId,
          })

          const availability = await evaluateAvailability(tx, {
            tenantId: params.tenantId,
            contactId: params.contactId,
            assignedToUserId: params.assignedToUserId,
            startAt: params.startAt,
            endAt: params.endAt,
          })

          if (!availability.available) {
            return {
              ok: false as const,
              availability,
            }
          }

          const appointment = await tx.appointment.create({
            data: {
              tenantId: params.tenantId,
              contactId: params.contactId,
              serviceId: params.serviceId,
              bookedByUserId: params.bookedByUserId,
              assignedToUserId: params.assignedToUserId,
              title: params.title,
              notes: params.notes,
              startAt: params.startAt,
              endAt: params.endAt,
              isAllDay: params.isAllDay,
              status: "SCHEDULED",
            },
            select: {
              id: true,
              title: true,
              startAt: true,
              endAt: true,
              status: true,
              assignedToUserId: true,
              contactId: true,
              serviceId: true,
            },
          })

          await createAppointmentAuditLog(tx, {
            tenantId: params.tenantId,
            appointmentId: appointment.id,
            actorUserId: params.bookedByUserId,
            actorDisplayName: params.actorDisplayName,
            action: "CREATED",
            message: `${params.actorDisplayName} created this appointment and assigned it to ${params.assignedToLabel} for ${formatAuditDateTimeRange(params.startAt, params.endAt, timezone)}.`,
          })

          return {
            ok: true as const,
            appointment,
          }
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      )
    } catch (error) {
      const isRetryableSerializationFailure =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < BOOKING_TRANSACTION_RETRY_LIMIT - 1

      if (!isRetryableSerializationFailure) {
        throw error
      }
    }
  }

  throw new Error("BOOKING_TRANSACTION_RETRY_EXHAUSTED")
}

export async function updateAppointmentAtomically(
  params: UpdateAppointmentAtomicallyParams,
) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: params.tenantId },
    select: { timezone: true },
  })

  const timezone = getSafeTimezone(tenant?.timezone)
  const startParts = getTimezoneDateParts(params.startAt, timezone)
  const localDate = toLocalDateKey(startParts)

  for (let attempt = 0; attempt < BOOKING_TRANSACTION_RETRY_LIMIT; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.appointment.findFirst({
            where: {
              id: params.appointmentId,
              tenantId: params.tenantId,
            },
            select: {
              id: true,
              contactId: true,
              assignedToUserId: true,
              startAt: true,
              endAt: true,
              assignedTo: {
                select: {
                  name: true,
                  email: true,
                },
              },
            },
          })

          if (!existing) {
            return {
              ok: false as const,
              error: "APPOINTMENT_NOT_FOUND" as const,
            }
          }

          const oldLockDate = existing.assignedToUserId
            ? toLocalDateKey(
                getTimezoneDateParts(
                  existing.startAt,
                  timezone,
                ),
              )
            : localDate

          const resources = [
            {
              localDate,
              assigneeUserId: params.assignedToUserId,
              contactId: params.contactId,
            },
            {
              localDate: oldLockDate,
              assigneeUserId: existing.assignedToUserId ?? params.assignedToUserId,
              contactId: existing.contactId,
            },
          ]

          const uniqueResources = resources.filter(
            (resource, index, items) =>
              items.findIndex(
                (candidate) =>
                  candidate.localDate === resource.localDate &&
                  candidate.assigneeUserId === resource.assigneeUserId &&
                  candidate.contactId === resource.contactId,
              ) === index,
          )

          uniqueResources.sort((left, right) =>
            `${left.localDate}:${left.assigneeUserId}:${left.contactId}`.localeCompare(
              `${right.localDate}:${right.assigneeUserId}:${right.contactId}`,
            ),
          )

          for (const resource of uniqueResources) {
            await acquireBookingLocks(tx, {
              tenantId: params.tenantId,
              localDate: resource.localDate,
              assigneeUserId: resource.assigneeUserId,
              contactId: resource.contactId,
            })
          }

          const availability = await evaluateAvailability(tx, {
            tenantId: params.tenantId,
            contactId: params.contactId,
            assignedToUserId: params.assignedToUserId,
            startAt: params.startAt,
            endAt: params.endAt,
            appointmentId: params.appointmentId,
          })

          if (!availability.available) {
            return {
              ok: false as const,
              error: "APPOINTMENT_TIME_UNAVAILABLE" as const,
              availability,
            }
          }

          const appointment = await tx.appointment.update({
            where: {
              id: params.appointmentId,
            },
            data: {
              contactId: params.contactId,
              serviceId: params.serviceId,
              assignedToUserId: params.assignedToUserId,
              title: params.title,
              notes: params.notes,
              startAt: params.startAt,
              endAt: params.endAt,
              isAllDay: params.isAllDay,
              status: "SCHEDULED",
            },
            select: {
              id: true,
              title: true,
              startAt: true,
              endAt: true,
              status: true,
              assignedToUserId: true,
              contactId: true,
              serviceId: true,
            },
          })

          const previousAssignedToLabel =
            existing.assignedTo?.name?.trim() ||
            existing.assignedTo?.email ||
            "Unassigned staff"
          const wasReassigned =
            existing.assignedToUserId !== params.assignedToUserId
          const wasRescheduled =
            existing.startAt.getTime() !== params.startAt.getTime() ||
            existing.endAt.getTime() !== params.endAt.getTime()

          if (wasReassigned) {
            await createAppointmentAuditLog(tx, {
              tenantId: params.tenantId,
              appointmentId: params.appointmentId,
              actorUserId: params.actorUserId,
              actorDisplayName: params.actorDisplayName,
              action: "REASSIGNED",
              message: `${params.actorDisplayName} reassigned this appointment from ${previousAssignedToLabel} to ${params.assignedToLabel}.`,
            })
          }

          if (wasRescheduled) {
            await createAppointmentAuditLog(tx, {
              tenantId: params.tenantId,
              appointmentId: params.appointmentId,
              actorUserId: params.actorUserId,
              actorDisplayName: params.actorDisplayName,
              action: "RESCHEDULED",
              message: `${params.actorDisplayName} rescheduled this appointment from ${formatAuditDateTimeRange(existing.startAt, existing.endAt, timezone)} to ${formatAuditDateTimeRange(params.startAt, params.endAt, timezone)}.`,
            })
          }

          return {
            ok: true as const,
            appointment,
          }
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      )
    } catch (error) {
      const isRetryableSerializationFailure =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < BOOKING_TRANSACTION_RETRY_LIMIT - 1

      if (!isRetryableSerializationFailure) {
        throw error
      }
    }
  }

  throw new Error("BOOKING_TRANSACTION_RETRY_EXHAUSTED")
}
