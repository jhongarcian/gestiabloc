import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { findEnabledAutomationReference } from "./automation-references.js"

describe("findEnabledAutomationReference", () => {
  test("includes note title and body tokens when checking a custom field", async () => {
    let automationWhere: Record<string, unknown> | null = null
    const prismaClient = {
      contactCustomField: {
        findFirst: async () => ({ key: "bank_account" }),
      },
      automation: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          automationWhere = where
          return { id: "automation-1", name: "Appointment follow-up" }
        },
      },
    }

    const result = await findEnabledAutomationReference(
      prismaClient,
      "tenant-1",
      { kind: "customField", id: "field-1" },
    )

    assert.deepEqual(result, { id: "automation-1", name: "Appointment follow-up" })
    const serializedWhere = JSON.stringify(automationWhere)
    assert.match(serializedWhere, /contact\.custom_field\.bank_account}/)
    assert.match(serializedWhere, /contact\.custom_field\.bank_account\|/)
    assert.match(serializedWhere, /noteTitle/)
    assert.match(serializedWhere, /noteBody/)
  })

  test("finds custom fields and task statuses nested in create-task configs", async () => {
    const taskConfig = {
      nameTemplate: "Review {contact.custom_field.renewal_date|date:medium}",
      statusConfigId: "todo",
      assignee: { mode: "CONTACT_ASSIGNEE" },
      dueAt: {
        source: { type: "CUSTOM_FIELD", key: "renewal_date" },
        time: "09:00",
      },
    }
    const prismaClient = {
      contactCustomField: {
        findFirst: async () => ({ key: "renewal_date" }),
      },
      automation: {
        findFirst: async () => null,
        findMany: async () => [{
          id: "automation-1",
          name: "Renewal tasks",
          actions: [{ taskConfig }],
        }],
      },
    }

    assert.deepEqual(
      await findEnabledAutomationReference(
        prismaClient,
        "tenant-1",
        { kind: "customField", id: "field-1" },
      ),
      { id: "automation-1", name: "Renewal tasks" },
    )
    assert.deepEqual(
      await findEnabledAutomationReference(
        prismaClient,
        "tenant-1",
        { kind: "taskStatus", id: "todo" },
      ),
      { id: "automation-1", name: "Renewal tasks" },
    )
  })
})
