import { type Response, Router } from "express"
import { z } from "zod"

import { prisma } from "../lib/prisma.js"
import { enforceSameOrigin } from "../lib/security.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"

const router = Router()

const DEFAULT_TIMEZONE = "America/Chicago"
const CALENDAR_SLOT_DURATION_OPTIONS = [15, 30, 45, 60, 120] as const
const CALENDAR_BUFFER_MODE_OPTIONS = ["BUSY", "UNAVAILABLE"] as const

const TenantPathSchema = z.object({
  tenantId: z.string().trim().min(1),
})

const TenantAppointmentPathSchema = TenantPathSchema.extend({
  appointmentId: z.string().trim().min(1),
})

const CalendarQuerySchema = z.object({
  view: z.enum(["month", "week", "day", "list"]).optional().default("week"),
  assignedToUserId: z.string().trim().min(1).optional(),
  contactId: z.string().trim().min(1).optional(),
  serviceId: z.string().trim().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

const CalendarSlotsQuerySchema = z.object({
  assignedToUserId: z.string().trim().min(1),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const optionalStringField = (max: number) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }, z.string().max(max).nullable().optional())

const AvailabilityRequestSchema = z.object({
  assignedToUserId: z.string().trim().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  appointmentId: z.string().trim().min(1).optional(),
})

const CreateAppointmentSchema = z.object({
  contactId: z.string().trim().min(1),
  serviceId: optionalStringField(80),
  assignedToUserId: z.string().trim().min(1),
  title: optionalStringField(160),
  notes: optionalStringField(4000),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  isAllDay: z.boolean().optional().default(false),
})

function getSafeTimezone(timezone?: string | null) {
  return timezone?.trim() || DEFAULT_TIMEZONE
}

function getSafeCalendarSlotDuration(value?: number | null) {
  return (CALENDAR_SLOT_DURATION_OPTIONS as readonly number[]).includes(value ?? -1)
    ? value!
    : 30
}

function getSafeCalendarBufferMode(value?: string | null) {
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

function getOffsetMinutes(timezone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: getSafeTimezone(timezone),
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date)

  const label = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT"
  return parseOffsetMinutes(label)
}

function getTimezoneDateParts(date: Date, timezone: string) {
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

function zonedDateTimeToUtc(
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

function getDefaultRange(timezone: string) {
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

async function requireActiveMembership(
  req: AuthedRequest,
  res: Response,
  tenantId: string,
) {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_tenantId: {
        userId: req.user.id,
        tenantId,
      },
    },
    select: {
      role: true,
      status: true,
    },
  })

  if (!membership || membership.status !== "ACTIVE") {
    res.status(403).json({ error: "TENANT_ACCESS_DENIED" })
    return null
  }

  return membership
}

async function ensureActiveAssignee(tenantId: string, userId: string) {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_tenantId: {
        userId,
        tenantId,
      },
    },
    select: {
      userId: true,
      status: true,
      calendarEnabled: true,
      calendarColor: true,
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  })

  if (!membership || membership.status !== "ACTIVE" || !membership.calendarEnabled) {
    return null
  }

  return membership
}

async function evaluateAvailability(params: {
  tenantId: string
  assignedToUserId: string
  startAt: Date
  endAt: Date
  appointmentId?: string
}) {
  const { tenantId, assignedToUserId, startAt, endAt, appointmentId } = params

  const tenant = await prisma.tenant.findUnique({
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

  const [rules, timeBlocks, overlappingAppointments, bookingsForDay] = await prisma.$transaction([
    prisma.calendarAvailabilityRule.findMany({
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
    prisma.calendarTimeBlock.findMany({
      where: {
        tenantId,
        OR: [
          { scope: "TENANT", userId: null },
          { scope: "USER", userId: assignedToUserId },
        ],
        startsAt: { lt: endAt },
        endsAt: { gt: startAt },
      },
      orderBy: [{ startsAt: "asc" }],
    }),
    prisma.appointment.findMany({
      where: {
        tenantId,
        assignedToUserId,
        status: "SCHEDULED",
        ...(appointmentId
          ? {
              id: {
                not: appointmentId,
              },
            }
          : {}),
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
    prisma.appointment.count({
      where: {
        tenantId,
        assignedToUserId,
        status: "SCHEDULED",
        ...(appointmentId
          ? {
              id: {
                not: appointmentId,
              },
            }
          : {}),
        startAt: { lt: nextDayStart },
        endAt: { gt: dayStart },
      },
    }),
  ])

  const activeRules = rules.filter((rule) => rule.dayOfWeek === startParts.dayOfWeek)
  const tenantOpenRules = activeRules.filter(
    (rule) => rule.scope === "TENANT" && rule.kind === "OPEN",
  )
  const userOpenRules = activeRules.filter(
    (rule) => rule.scope === "USER" && rule.kind === "OPEN" && rule.userId === assignedToUserId,
  )
  const blockRules = activeRules.filter((rule) => rule.kind === "BLOCK")

  const fitsRule = (rule: { startTimeMinutes: number; endTimeMinutes: number }) =>
    startMinutes >= rule.startTimeMinutes && endMinutes <= rule.endTimeMinutes
  const overlapsRule = (rule: { startTimeMinutes: number; endTimeMinutes: number }) =>
    startMinutes < rule.endTimeMinutes && endMinutes > rule.startTimeMinutes

  if (tenantOpenRules.length > 0 && !tenantOpenRules.some(fitsRule)) {
    reasons.push("The selected time is outside the tenant calendar open hours.")
  }

  if (userOpenRules.length > 0 && !userOpenRules.some(fitsRule)) {
    reasons.push("The selected time is outside the assignee's open hours.")
  }

  const matchedBlockRules = blockRules.filter(overlapsRule)
  if (matchedBlockRules.length > 0) {
    reasons.push("The selected time overlaps a recurring blocked window.")
  }

  if (timeBlocks.length > 0) {
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
      appointments: overlappingAppointmentsWithBuffer.map((appointment) => ({
        id: appointment.id,
        title: appointment.title,
        startAt: appointment.startAt.toISOString(),
        endAt: appointment.endAt.toISOString(),
      })),
      blocks: timeBlocks.map((block) => ({
        id: block.id,
        title: block.title,
        startsAt: block.startsAt.toISOString(),
        endsAt: block.endsAt.toISOString(),
      })),
    },
  }
}

async function buildAppointmentSlots(params: {
  tenantId: string
  assignedToUserId: string
  localDate: string
}) {
  const { tenantId, assignedToUserId, localDate } = params

  const tenant = await prisma.tenant.findUnique({
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

  const [rules, timeBlocks, overlappingAppointments, bookingsForDay] = await prisma.$transaction([
    prisma.calendarAvailabilityRule.findMany({
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
    prisma.calendarTimeBlock.findMany({
      where: {
        tenantId,
        OR: [
          { scope: "TENANT", userId: null },
          { scope: "USER", userId: assignedToUserId },
        ],
        startsAt: { lt: nextDayStart },
        endsAt: { gt: dayStart },
      },
      orderBy: [{ startsAt: "asc" }],
    }),
    prisma.appointment.findMany({
      where: {
        tenantId,
        assignedToUserId,
        status: "SCHEDULED",
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
    prisma.appointment.count({
      where: {
        tenantId,
        assignedToUserId,
        status: "SCHEDULED",
        startAt: { lt: nextDayStart },
        endAt: { gt: dayStart },
      },
    }),
  ])

  const tenantOpenRules = rules.filter(
    (rule) => rule.scope === "TENANT" && rule.kind === "OPEN",
  )
  const userOpenRules = rules.filter(
    (rule) => rule.scope === "USER" && rule.kind === "OPEN" && rule.userId === assignedToUserId,
  )
  const blockRules = rules.filter((rule) => rule.kind === "BLOCK")

  const tenantIntervals = tenantOpenRules.length > 0
    ? tenantOpenRules.map((rule) => ({
        start: rule.startTimeMinutes,
        end: rule.endTimeMinutes,
      }))
    : [{ start: 0, end: 24 * 60 }]

  const userIntervals = userOpenRules.length > 0
    ? userOpenRules.map((rule) => ({
        start: rule.startTimeMinutes,
        end: rule.endTimeMinutes,
      }))
    : tenantIntervals

  const recurringBlockedIntervals = blockRules.map((rule) => ({
    start: rule.startTimeMinutes,
    end: rule.endTimeMinutes,
  }))

  const openIntervals = subtractIntervals(
    intersectIntervals(mergeIntervals(tenantIntervals), mergeIntervals(userIntervals)),
    recurringBlockedIntervals,
  )

  const blockRanges = timeBlocks.map((block) => {
    const blockStartParts = getTimezoneDateParts(block.startsAt, timezone)
    const blockEndParts = getTimezoneDateParts(block.endsAt, timezone)
    const blockStartMinutes =
      blockStartParts.year === year &&
      blockStartParts.month === month &&
      blockStartParts.day === day
        ? blockStartParts.hour * 60 + blockStartParts.minute
        : 0
    const blockEndMinutes =
      blockEndParts.year === year &&
      blockEndParts.month === month &&
      blockEndParts.day === day
        ? blockEndParts.hour * 60 + blockEndParts.minute
        : 24 * 60

    return {
      id: block.id,
      title: block.title,
      startMinutes: Math.max(0, blockStartMinutes),
      endMinutes: Math.min(24 * 60, blockEndMinutes),
    }
  })

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

router.get("/:tenantId/meta", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const [tenant, users, services] = await prisma.$transaction([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          calendarAppointmentSlotMinutes: true,
          calendarMeetingDurationMinutes: true,
          calendarMinimumScheduleNoticeMinutes: true,
          calendarMaximumBookingsPerDay: true,
          calendarMaximumBookingsPerSlot: true,
          calendarPreBufferMinutes: true,
          calendarPostBufferMinutes: true,
          calendarBufferAvailabilityMode: true,
        },
      }),
      prisma.membership.findMany({
        where: {
          tenantId,
          status: "ACTIVE",
          calendarEnabled: true,
        },
        orderBy: [{ user: { name: "asc" } }],
        select: {
          userId: true,
          role: true,
          calendarColor: true,
          user: {
            select: {
              name: true,
              email: true,
              image: true,
            },
          },
        },
      }),
      prisma.service.findMany({
        where: {
          tenantId,
          isActive: true,
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
        },
      }),
    ])

    return res.json({
      ok: true,
      settings: {
        meetingIntervalMinutes: getSafeCalendarSlotDuration(
          tenant?.calendarAppointmentSlotMinutes,
        ),
        meetingDurationMinutes: getSafeCalendarSlotDuration(
          tenant?.calendarMeetingDurationMinutes,
        ),
        minimumScheduleNoticeMinutes:
          tenant?.calendarMinimumScheduleNoticeMinutes ?? 0,
        maximumBookingsPerDay: tenant?.calendarMaximumBookingsPerDay ?? null,
        maximumBookingsPerSlot: tenant?.calendarMaximumBookingsPerSlot ?? 1,
        preBufferMinutes: tenant?.calendarPreBufferMinutes ?? 0,
        postBufferMinutes: tenant?.calendarPostBufferMinutes ?? 0,
        bufferAvailabilityMode: getSafeCalendarBufferMode(
          tenant?.calendarBufferAvailabilityMode,
        ),
      },
      filters: {
        users: users.map((item) => ({
          id: item.userId,
          label: item.user.name?.trim() || item.user.email,
          email: item.user.email,
          role: item.role,
          image: item.user.image ?? null,
          color: item.calendarColor ?? null,
        })),
        services,
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/slots", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const query = CalendarSlotsQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const assignee = await ensureActiveAssignee(tenantId, query.assignedToUserId)
    if (!assignee) {
      return res.status(404).json({ error: "ASSIGNEE_NOT_FOUND" })
    }

    const data = await buildAppointmentSlots({
      tenantId,
      assignedToUserId: query.assignedToUserId,
      localDate: query.date,
    })

    return res.json({
      ok: true,
      timezone: data.timezone,
      meetingIntervalMinutes: data.meetingIntervalMinutes,
      meetingDurationMinutes: data.meetingDurationMinutes,
      bookingRules: data.bookingRules,
      assignee: {
        id: assignee.userId,
        label: assignee.user.name?.trim() || assignee.user.email,
      },
      date: query.date,
      slots: data.slots,
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const query = CalendarQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    })

    const timezone = getSafeTimezone(tenant?.timezone)
    const defaultRange = getDefaultRange(timezone)
    const rangeStart = query.from ? new Date(query.from) : defaultRange.start
    const rangeEnd = query.to ? new Date(query.to) : defaultRange.end

    const items = await prisma.appointment.findMany({
      where: {
        tenantId,
        ...(query.assignedToUserId ? { assignedToUserId: query.assignedToUserId } : {}),
        ...(query.contactId ? { contactId: query.contactId } : {}),
        ...(query.serviceId ? { serviceId: query.serviceId } : {}),
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
      orderBy: [{ startAt: "asc" }],
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        assignedToUserId: true,
        status: true,
        contactId: true,
        serviceId: true,
        contact: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        assignedTo: {
          select: {
            name: true,
            email: true,
            memberships: {
              where: {
                tenantId,
              },
              select: {
                calendarColor: true,
              },
              take: 1,
            },
          },
        },
        service: {
          select: {
            name: true,
          },
        },
      },
    })

    return res.json({
      ok: true,
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        startAt: item.startAt.toISOString(),
        endAt: item.endAt.toISOString(),
        assignedToUserId: item.assignedToUserId,
        assignedToLabel: item.assignedTo?.name?.trim() || item.assignedTo?.email || "Unassigned",
        assignedToColor: item.assignedTo?.memberships[0]?.calendarColor ?? null,
        contactId: item.contactId,
        contactName: `${item.contact.firstName} ${item.contact.lastName}`.trim(),
        serviceId: item.serviceId,
        serviceName: item.service?.name ?? null,
        status: item.status,
      })),
      range: {
        from: rangeStart.toISOString(),
        to: rangeEnd.toISOString(),
      },
      filters: {
        view: query.view,
        assignedToUserId: query.assignedToUserId ?? null,
        contactId: query.contactId ?? null,
        serviceId: query.serviceId ?? null,
      },
      emptyState: {
        title: "No appointments yet",
        description:
          "Create the first appointment to start filling the calendar.",
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId/availability", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = AvailabilityRequestSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const startAt = new Date(payload.startAt)
    const endAt = new Date(payload.endAt)

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      return res.status(400).json({ error: "INVALID_APPOINTMENT_DATE" })
    }

    if (endAt <= startAt) {
      return res.status(400).json({ error: "INVALID_APPOINTMENT_RANGE" })
    }

    const assignee = await ensureActiveAssignee(tenantId, payload.assignedToUserId)
    if (!assignee) {
      return res.status(404).json({ error: "ASSIGNEE_NOT_FOUND" })
    }

    const availability = await evaluateAvailability({
      tenantId,
      assignedToUserId: payload.assignedToUserId,
      startAt,
      endAt,
      appointmentId: payload.appointmentId,
    })

    return res.json({
      ok: true,
      available: availability.available,
      timezone: availability.timezone,
      assignee: {
        id: assignee.userId,
        label: assignee.user.name?.trim() || assignee.user.email,
      },
      reasons: availability.reasons,
      windows: availability.windows,
      conflicts: availability.conflicts,
    })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = CreateAppointmentSchema.parse(req.body)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const startAt = new Date(payload.startAt)
    const endAt = new Date(payload.endAt)

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      return res.status(400).json({ error: "INVALID_APPOINTMENT_DATE" })
    }

    if (endAt <= startAt) {
      return res.status(400).json({ error: "INVALID_APPOINTMENT_RANGE" })
    }

    const [contact, service, assignee] = await Promise.all([
      prisma.contact.findFirst({
        where: {
          id: payload.contactId,
          tenantId,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      }),
      payload.serviceId
        ? prisma.service.findFirst({
            where: {
              id: payload.serviceId,
              tenantId,
            },
            select: {
              id: true,
              name: true,
            },
          })
        : Promise.resolve(null),
      ensureActiveAssignee(tenantId, payload.assignedToUserId),
    ])

    if (!contact) {
      return res.status(404).json({ error: "CONTACT_NOT_FOUND" })
    }

    if (payload.serviceId && !service) {
      return res.status(404).json({ error: "SERVICE_NOT_FOUND" })
    }

    if (!assignee) {
      return res.status(404).json({ error: "ASSIGNEE_NOT_FOUND" })
    }

    const availability = await evaluateAvailability({
      tenantId,
      assignedToUserId: payload.assignedToUserId,
      startAt,
      endAt,
    })

    if (!availability.available) {
      return res.status(409).json({
        error: "APPOINTMENT_TIME_UNAVAILABLE",
        availability,
      })
    }

    const defaultTitleBase = `${contact.firstName} ${contact.lastName}`.trim()
    const title = payload.title?.trim()
      ? payload.title.trim()
      : service?.name
        ? `${service.name} with ${defaultTitleBase}`
        : `Appointment with ${defaultTitleBase}`

    const appointment = await prisma.appointment.create({
      data: {
        tenantId,
        contactId: payload.contactId,
        serviceId: payload.serviceId ?? null,
        bookedByUserId: authed.user.id,
        assignedToUserId: payload.assignedToUserId,
        title,
        notes: payload.notes ?? null,
        startAt,
        endAt,
        isAllDay: payload.isAllDay,
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

    return res.status(201).json({
      ok: true,
      item: {
        ...appointment,
        startAt: appointment.startAt.toISOString(),
        endAt: appointment.endAt.toISOString(),
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.delete("/:tenantId/:appointmentId", requireAuth, async (req, res, next) => {
  try {
    enforceSameOrigin(req)

    const authed = req as AuthedRequest
    const { tenantId, appointmentId } = TenantAppointmentPathSchema.parse(req.params)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    await prisma.appointment.deleteMany({
      where: {
        id: appointmentId,
        tenantId,
      },
    })

    return res.json({ ok: true })
  } catch (error) {
    return next(error)
  }
})

export default router
