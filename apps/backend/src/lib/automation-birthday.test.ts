import assert from "node:assert/strict"
import { test } from "node:test"

import { birthdayLocalClock, birthdayTimezone, isBirthdayOnLocalDate, isBirthdayReminderDue } from "./automation-birthday.js"

test("birthday clock uses the tenant date and time, including daylight saving changes", () => {
  assert.deepEqual(birthdayLocalClock(new Date("2026-03-08T13:59:00.000Z"), "America/Chicago"), {
    year: 2026, month: 3, day: 8, localDate: "2026-03-08", localTime: "08:59",
  })
  assert.deepEqual(birthdayLocalClock(new Date("2026-03-08T14:00:00.000Z"), "America/Chicago"), {
    year: 2026, month: 3, day: 8, localDate: "2026-03-08", localTime: "09:00",
  })
  assert.equal(birthdayLocalClock(new Date("2026-10-17T04:59:00.000Z"), "America/Chicago").localDate, "2026-10-16")
  assert.equal(birthdayLocalClock(new Date("2026-10-17T05:00:00.000Z"), "America/Chicago").localDate, "2026-10-17")
  assert.equal(birthdayTimezone(null), "America/Chicago")
  assert.equal(birthdayTimezone("invalid/timezone"), "America/Chicago")
})

test("February 29 uses February 28 in non-leap years and each birthday stays annual", () => {
  const leapBirth = new Date("2000-02-29T12:00:00.000Z")
  assert.equal(isBirthdayOnLocalDate(leapBirth, 2026, 2, 28), true)
  assert.equal(isBirthdayOnLocalDate(leapBirth, 2026, 3, 1), false)
  assert.equal(isBirthdayOnLocalDate(leapBirth, 2028, 2, 28), false)
  assert.equal(isBirthdayOnLocalDate(leapBirth, 2028, 2, 29), true)
  assert.equal(isBirthdayOnLocalDate(new Date("2026-10-16T00:00:00.000Z"), 2026, 10, 16), true)
  assert.equal(isBirthdayOnLocalDate(new Date("2027-10-16T00:00:00.000Z"), 2026, 10, 16), false)
  assert.equal(isBirthdayOnLocalDate(null, 2026, 10, 16), false)
})

test("reminders become due at the chosen local minute and stay due until the date ends", () => {
  assert.equal(isBirthdayReminderDue("08:59", "09:00"), false)
  assert.equal(isBirthdayReminderDue("09:00", "09:00"), true)
  assert.equal(isBirthdayReminderDue("23:59", "09:00"), true)
})
