import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  AutomationTaskConfigSchema,
  resolveAutomationTaskDateTime,
  taskConfigCustomFieldKeys,
} from "./automation-task.js"

describe("AutomationTaskConfigSchema", () => {
  test("accepts templates, flexible assignment, scheduling, and reminders", () => {
    const result = AutomationTaskConfigSchema.safeParse({
      nameTemplate: "Call {contact.name}",
      descriptionTemplate: "Balance: {contact.custom_field.balance|currency:USD}",
      statusConfigId: "todo",
      assignee: { mode: "CONTACT_ASSIGNEE" },
      linkedService: { id: "service-1", nameSnapshot: "Annual review" },
      dueAt: {
        source: { type: "CUSTOM_FIELD", key: "appointment_date" },
        time: "17:00",
      },
      reminder: {
        at: { source: { type: "CURRENT_DATE" }, time: "09:00" },
        messageTemplate: "Reminder for {contact.first_name}",
      },
    })

    assert.equal(result.success, true)
    if (!result.success) return
    assert.deepEqual(
      taskConfigCustomFieldKeys(result.data).sort(),
      ["appointment_date", "balance"],
    )
  })

  test("rejects reminders without a due date or assignee", () => {
    const base = {
      nameTemplate: "Call contact",
      statusConfigId: "todo",
      reminder: {
        at: { source: { type: "CURRENT_DATE" }, time: "09:00" },
      },
    }
    assert.equal(AutomationTaskConfigSchema.safeParse({
      ...base,
      assignee: { mode: "CONTACT_ASSIGNEE" },
    }).success, false)
    assert.equal(AutomationTaskConfigSchema.safeParse({
      ...base,
      assignee: { mode: "UNASSIGNED" },
      dueAt: { source: { type: "CURRENT_DATE" }, time: "17:00" },
    }).success, false)
  })

  test("validates relative calendar dates", () => {
    const base = {
      nameTemplate: "Call contact",
      statusConfigId: "todo",
      assignee: { mode: "CONTACT_ASSIGNEE" },
    }
    assert.equal(AutomationTaskConfigSchema.safeParse({
      ...base,
      dueAt: {
        source: { type: "RELATIVE_DATE", amount: 2, unit: "WEEKS" },
        time: "09:00",
      },
    }).success, true)
    assert.equal(AutomationTaskConfigSchema.safeParse({
      ...base,
      dueAt: {
        source: { type: "RELATIVE_DATE", amount: 0, unit: "DAYS" },
        time: "09:00",
      },
    }).success, false)
  })
})

describe("resolveAutomationTaskDateTime", () => {
  test("uses the tenant-local current date", async () => {
    const resolved = await resolveAutomationTaskDateTime({}, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: { source: { type: "CURRENT_DATE" }, time: "09:30" },
      tenantTimezone: "America/Los_Angeles",
      occurredAt: new Date("2026-09-24T01:00:00.000Z"),
      label: "Due date",
    })

    assert.equal(resolved.toISOString(), "2026-09-23T16:30:00.000Z")
  })

  test("adds relative weeks and clamps relative months on the tenant calendar", async () => {
    const occurredAt = new Date("2026-01-31T18:00:00.000Z")
    const twoWeeks = await resolveAutomationTaskDateTime({}, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        source: { type: "RELATIVE_DATE", amount: 2, unit: "WEEKS" },
        time: "09:30",
      },
      tenantTimezone: "America/Chicago",
      occurredAt,
      label: "Due date",
    })
    const oneMonth = await resolveAutomationTaskDateTime({}, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        source: { type: "RELATIVE_DATE", amount: 1, unit: "MONTHS" },
        time: "09:30",
      },
      tenantTimezone: "America/Chicago",
      occurredAt,
      label: "Due date",
    })

    assert.equal(twoWeeks.toISOString(), "2026-02-14T15:30:00.000Z")
    assert.equal(oneMonth.toISOString(), "2026-02-28T15:30:00.000Z")
  })

  test("rejects empty custom dates and nonexistent local times", async () => {
    const prismaTx = {
      contact: {
        findFirst: async () => ({ customFieldValues: [] }),
      },
    }
    await assert.rejects(
      resolveAutomationTaskDateTime(prismaTx, {
        tenantId: "tenant-1",
        contactId: "contact-1",
        config: { source: { type: "CUSTOM_FIELD", key: "appointment_date" }, time: "09:00" },
        tenantTimezone: "America/Chicago",
        occurredAt: new Date("2026-09-24T12:00:00.000Z"),
        label: "Due date",
      }),
      /empty or unavailable/,
    )

    await assert.rejects(
      resolveAutomationTaskDateTime({}, {
        tenantId: "tenant-1",
        contactId: "contact-1",
        config: {
          source: {
            type: "SPECIFIC_DATE",
            date: "2026-03-08",
            timezone: "America/Chicago",
          },
          time: "02:30",
        },
        tenantTimezone: "America/Chicago",
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        label: "Due date",
      }),
      /does not exist/,
    )
  })
})
