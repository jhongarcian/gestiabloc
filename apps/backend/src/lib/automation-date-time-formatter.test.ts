import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  AutomationDateTimeFormatterConfigSchema,
  resolveAutomationDateTimeFormatter,
} from "./automation-date-time-formatter.js"

const noStoredDates = {
  contact: { findFirst: async () => null },
  contactCustomFieldValue: { findFirst: async () => null },
}

describe("automation date/time formatter", () => {
  test("validates keys and date-only time requirements", () => {
    assert.equal(AutomationDateTimeFormatterConfigSchema.safeParse({
      mode: "DATE",
      source: { type: "CURRENT_DATE" },
      format: "MMM D, YYYY",
      outputKey: "appointment_date",
    }).success, true)
    assert.equal(AutomationDateTimeFormatterConfigSchema.safeParse({
      mode: "DATE",
      source: { type: "CURRENT_DATE" },
      format: "MMM D, YYYY",
      outputKey: "Appointment Date",
    }).success, false)
    assert.equal(AutomationDateTimeFormatterConfigSchema.safeParse({
      mode: "DATE_TIME",
      source: { type: "CUSTOM_FIELD", key: "appointment" },
      format: "YYYY-MM-DD hh:mm A",
      outputKey: "appointment_time",
    }).success, false)
  })

  test("formats current and relative execution instants", async () => {
    const occurredAt = new Date("2026-09-25T18:30:59.000Z")
    assert.equal(await resolveAutomationDateTimeFormatter(noStoredDates, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        mode: "DATE_TIME",
        source: { type: "CURRENT_DATE" },
        format: "dddd, MMMM D, YYYY hh:mm A",
        outputKey: "now",
      },
      tenantTimezone: "America/Chicago",
      occurredAt,
    }), "Friday, September 25, 2026 01:30 PM")
    assert.equal(await resolveAutomationDateTimeFormatter(noStoredDates, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        mode: "DATE",
        source: { type: "RELATIVE_DATE", amount: 2, unit: "WEEKS" },
        format: "MMM D, YYYY",
        outputKey: "follow_up",
      },
      tenantTimezone: "America/Chicago",
      occurredAt,
    }), "Oct 9, 2026")
  })

  test("formats live contact and custom date values", async () => {
    const prismaTx = {
      contact: { findFirst: async () => ({ dateOfBirth: new Date("1990-04-05T00:00:00.000Z") }) },
      contactCustomFieldValue: { findFirst: async () => ({ value: "2026-12-21" }) },
    }
    assert.equal(await resolveAutomationDateTimeFormatter(prismaTx, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        mode: "DATE",
        source: { type: "CONTACT_FIELD", key: "date_of_birth" },
        format: "MMMM Do YYYY",
        outputKey: "birthday",
      },
      tenantTimezone: "America/Chicago",
      occurredAt: new Date("2026-09-25T18:30:59.000Z"),
    }), "April 5th 1990")
    assert.equal(await resolveAutomationDateTimeFormatter(prismaTx, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        mode: "DATE_TIME",
        source: { type: "CUSTOM_FIELD", key: "appointment" },
        time: "09:45",
        format: "YYYY-MM-DD hh:mm A",
        outputKey: "appointment",
      },
      tenantTimezone: "America/Chicago",
      occurredAt: new Date("2026-09-25T18:30:59.000Z"),
    }), "2026-12-21 09:45 AM")
  })

  test("compares signed whole calendar days, months, and years", async () => {
    const compare = async (from: string, to: string, unit: "DAYS" | "MONTHS" | "YEARS") =>
      resolveAutomationDateTimeFormatter(noStoredDates, {
        tenantId: "tenant-1",
        contactId: "contact-1",
        config: {
          mode: "COMPARE_DATES",
          from: { type: "SPECIFIC_DATE", date: from, timezone: "America/Chicago" },
          to: { type: "SPECIFIC_DATE", date: to, timezone: "America/Chicago" },
          unit,
          outputKey: "difference",
        },
        tenantTimezone: "America/Chicago",
        occurredAt: new Date("2026-09-25T18:30:59.000Z"),
      })

    assert.equal(await compare("2026-03-07", "2026-03-09", "DAYS"), 2)
    assert.equal(await compare("2026-01-31", "2026-02-28", "MONTHS"), 1)
    assert.equal(await compare("2024-02-29", "2025-02-28", "YEARS"), 1)
    assert.equal(await compare("2026-09-25", "2024-09-25", "YEARS"), -2)
  })

  test("rejects local times in a DST gap", async () => {
    await assert.rejects(
      resolveAutomationDateTimeFormatter(noStoredDates, {
        tenantId: "tenant-1",
        contactId: "contact-1",
        config: {
          mode: "DATE_TIME",
          source: { type: "SPECIFIC_DATE", date: "2026-03-08", timezone: "America/Chicago" },
          time: "02:30",
          format: "YYYY-MM-DD HH:mm:ss",
          outputKey: "invalid_time",
        },
        tenantTimezone: "America/Chicago",
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
      /does not exist/,
    )
  })
})
