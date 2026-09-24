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
})
