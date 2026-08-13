import assert from "node:assert/strict"
import { describe, test } from "node:test"

import type { PrismaClient } from "../generated/prisma/index.js"

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test"

const bookingModule = import("./appointment-booking.js")

type AvailabilityRule = {
  id: string
  tenantId: string
  userId: string | null
  scope: "TENANT" | "USER"
  kind: "OPEN" | "BLOCK"
  dayOfWeek: number
  startTimeMinutes: number
  endTimeMinutes: number
  label: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const TENANT_ID = "tenant-1"
const ASSIGNEE_ID = "user-1"
const WEDNESDAY = 3
const LOCAL_DATE = "2026-08-12"

function availabilityRule(
  scope: "TENANT" | "USER",
  startTimeMinutes: number,
  endTimeMinutes: number,
  options: {
    kind?: "OPEN" | "BLOCK"
    userId?: string | null
  } = {},
): AvailabilityRule {
  const userId = options.userId ?? (scope === "USER" ? ASSIGNEE_ID : null)

  return {
    id: `${scope}-${options.kind ?? "OPEN"}-${startTimeMinutes}-${endTimeMinutes}`,
    tenantId: TENANT_ID,
    userId,
    scope,
    kind: options.kind ?? "OPEN",
    dayOfWeek: WEDNESDAY,
    startTimeMinutes,
    endTimeMinutes,
    label: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  }
}

function createMockClient(rules: AvailabilityRule[]) {
  return {
    tenant: {
      findUnique: async () => ({
        timezone: "UTC",
        calendarAppointmentSlotMinutes: 30,
        calendarMeetingDurationMinutes: 30,
        calendarMinimumScheduleNoticeMinutes: 0,
        calendarMaximumBookingsPerDay: null,
        calendarMaximumBookingsPerSlot: 1,
        calendarPreBufferMinutes: 0,
        calendarPostBufferMinutes: 0,
        calendarBufferAvailabilityMode: "BUSY",
      }),
    },
    calendarAvailabilityRule: {
      findMany: async () => rules,
    },
    calendarTimeBlock: {
      findMany: async () => [],
    },
    appointment: {
      findMany: async () => [],
      count: async () => 0,
    },
  } as unknown as PrismaClient
}

async function buildSlots(rules: AvailabilityRule[]) {
  const { buildAppointmentSlots } = await bookingModule

  return buildAppointmentSlots(createMockClient(rules), {
    tenantId: TENANT_ID,
    assignedToUserId: ASSIGNEE_ID,
    localDate: LOCAL_DATE,
  })
}

describe("appointment staff availability", () => {
  test("returns no slots when the account is open but the staff weekday is missing", async () => {
    const result = await buildSlots([
      availabilityRule("TENANT", 9 * 60, 17 * 60),
    ])

    assert.deepEqual(result.slots, [])
  })

  test("returns slots when account and staff hours overlap", async () => {
    const result = await buildSlots([
      availabilityRule("TENANT", 9 * 60, 17 * 60),
      availabilityRule("USER", 9 * 60, 17 * 60),
    ])

    assert.equal(result.slots.length, 16)
    assert.equal(result.slots[0]?.startLabel, "09:00")
    assert.equal(result.slots.at(-1)?.startLabel, "16:30")
    assert.equal(result.slots.every((slot) => slot.available), true)
  })

  test("limits slots to narrower staff hours", async () => {
    const result = await buildSlots([
      availabilityRule("TENANT", 9 * 60, 17 * 60),
      availabilityRule("USER", 10 * 60, 15 * 60),
    ])

    assert.equal(result.slots.length, 10)
    assert.equal(result.slots[0]?.startLabel, "10:00")
    assert.equal(result.slots.at(-1)?.startLabel, "14:30")
  })

  test("returns no slots when staff is open but the account weekday is missing", async () => {
    const result = await buildSlots([
      availabilityRule("USER", 9 * 60, 17 * 60),
    ])

    assert.deepEqual(result.slots, [])
  })

  test("subtracts recurring blocked intervals from the shared open hours", async () => {
    const result = await buildSlots([
      availabilityRule("TENANT", 9 * 60, 17 * 60),
      availabilityRule("USER", 9 * 60, 17 * 60),
      availabilityRule("USER", 11 * 60, 12 * 60, { kind: "BLOCK" }),
    ])

    assert.equal(result.slots.length, 14)
    assert.equal(result.slots.some((slot) => slot.startLabel === "11:00"), false)
    assert.equal(result.slots.some((slot) => slot.startLabel === "11:30"), false)
  })

  test("final validation rejects a time with no staff open rule", async () => {
    const { evaluateAvailability } = await bookingModule
    const result = await evaluateAvailability(
      createMockClient([availabilityRule("TENANT", 9 * 60, 17 * 60)]),
      {
        tenantId: TENANT_ID,
        assignedToUserId: ASSIGNEE_ID,
        startAt: new Date("2026-08-12T10:00:00.000Z"),
        endAt: new Date("2026-08-12T10:30:00.000Z"),
      },
    )

    assert.equal(result.available, false)
    assert.equal(
      result.reasons.includes("The selected time is outside the assignee's open hours."),
      true,
    )
    assert.equal(
      result.reasons.includes("The selected time is outside the tenant calendar open hours."),
      false,
    )
  })

  test("final validation accepts a time shared by account and staff hours", async () => {
    const { evaluateAvailability } = await bookingModule
    const result = await evaluateAvailability(
      createMockClient([
        availabilityRule("TENANT", 9 * 60, 17 * 60),
        availabilityRule("USER", 10 * 60, 15 * 60),
      ]),
      {
        tenantId: TENANT_ID,
        assignedToUserId: ASSIGNEE_ID,
        startAt: new Date("2026-08-12T10:00:00.000Z"),
        endAt: new Date("2026-08-12T10:30:00.000Z"),
      },
    )

    assert.equal(result.available, true)
    assert.deepEqual(result.reasons, [])
  })
})
