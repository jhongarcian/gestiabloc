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

  test("finds custom fields and selected teammates in internal notifications", async () => {
    const internalNotificationConfig = {
      actionName: "Notify reviewer",
      recipient: { mode: "SPECIFIC_USER", userId: "user-reviewer" },
      titleTemplate: "Review {contact.custom_field.policy_number}",
      bodyTemplate: "Open the contact for details.",
    }
    const prismaClient = {
      contactCustomField: {
        findFirst: async () => ({ key: "policy_number" }),
      },
      automation: {
        findFirst: async () => null,
        findMany: async () => [{
          id: "automation-1",
          name: "Policy review",
          actions: [{ type: "SEND_INTERNAL_NOTIFICATION", internalNotificationConfig }],
        }],
      },
    }

    assert.deepEqual(
      await findEnabledAutomationReference(
        prismaClient,
        "tenant-1",
        { kind: "customField", id: "field-policy-number" },
      ),
      { id: "automation-1", name: "Policy review" },
    )
    assert.deepEqual(
      await findEnabledAutomationReference(
        prismaClient,
        "tenant-1",
        { kind: "user", id: "user-reviewer" },
      ),
      { id: "automation-1", name: "Policy review" },
    )
  })

  test("finds custom fields nested in a multi-field update action", async () => {
    const prismaClient = {
      contactCustomField: {
        findFirst: async () => ({ key: "review_status" }),
      },
      automation: {
        findFirst: async () => null,
        findMany: async () => [{
          id: "automation-1",
          name: "Prepare contact",
          actions: [{
            type: "UPDATE_CONTACT_CUSTOM_FIELDS",
            taskConfig: null,
            customFieldUpdates: [
              { customFieldId: "field-1", operation: "SET", value: "Ready" },
              { customFieldId: "field-2", operation: "CLEAR" },
            ],
          }],
        }],
      },
    }

    assert.deepEqual(
      await findEnabledAutomationReference(
        prismaClient,
        "tenant-1",
        { kind: "customField", id: "field-2" },
      ),
      { id: "automation-1", name: "Prepare contact" },
    )
  })

  test("finds statuses and custom fields used by create-contact actions", async () => {
    const createContactConfig = {
      actionName: "Create household contact",
      firstNameTemplate: "{contact.first_name}",
      middleNameTemplate: null,
      lastNameTemplate: "{contact.custom_field.household_name}",
      emailTemplate: null,
      phoneTemplate: null,
      dateOfBirth: null,
      statusConfigId: "active",
      assignedToUserId: "user-1",
      customFieldValues: [{
        customFieldId: "field-2",
        source: { type: "CUSTOM_FIELD", key: "household_name" },
      }],
    }
    const prismaClient = {
      contactCustomField: {
        findFirst: async () => ({ key: "household_name" }),
      },
      automation: {
        findFirst: async () => null,
        findMany: async () => [{
          id: "automation-1",
          name: "Create household",
          actions: [{ type: "CREATE_CONTACT", createContactConfig }],
        }],
      },
    }

    assert.deepEqual(
      await findEnabledAutomationReference(
        prismaClient,
        "tenant-1",
        { kind: "customField", id: "field-2" },
      ),
      { id: "automation-1", name: "Create household" },
    )
    assert.deepEqual(
      await findEnabledAutomationReference(
        prismaClient,
        "tenant-1",
        { kind: "status", id: "active" },
      ),
      { id: "automation-1", name: "Create household" },
    )
    assert.deepEqual(
      await findEnabledAutomationReference(
        prismaClient,
        "tenant-1",
        { kind: "user", id: "user-1" },
      ),
      { id: "automation-1", name: "Create household" },
    )
  })

  test("finds custom fields used by a number formatter", async () => {
    const prismaClient = {
      contactCustomField: {
        findFirst: async () => ({ key: "premium" }),
      },
      automation: {
        findFirst: async () => null,
        findMany: async () => [{
          id: "automation-1",
          name: "Format premium",
          actions: [{
            type: "FORMAT_NUMBER",
            numberFormatterConfig: {
              mode: "FORMAT_CURRENCY",
              source: { type: "CUSTOM_FIELD", key: "premium" },
              decimalMark: "PERIOD",
              currencyCode: "USD",
              outputKey: "premium_label",
            },
          }],
        }],
      },
    }

    assert.deepEqual(
      await findEnabledAutomationReference(
        prismaClient,
        "tenant-1",
        { kind: "customField", id: "field-1" },
      ),
      { id: "automation-1", name: "Format premium" },
    )
  })

  test("finds custom fields used by a Math operation", async () => {
    const prismaClient = {
      contactCustomField: {
        findFirst: async () => ({ key: "renewal_date" }),
      },
      automation: {
        findFirst: async () => null,
        findMany: async () => [{
          id: "automation-1",
          name: "Calculate renewal",
          actions: [{
            type: "MATH_OPERATION",
            mathOperationConfig: {
              mode: "DATE",
              source: { type: "CUSTOM_FIELD", key: "renewal_date" },
              operation: "ADD",
              amount: 1,
              unit: "YEARS",
              outputKey: "next_renewal",
            },
          }],
        }],
      },
    }

    assert.deepEqual(
      await findEnabledAutomationReference(
        prismaClient,
        "tenant-1",
        { kind: "customField", id: "field-1" },
      ),
      { id: "automation-1", name: "Calculate renewal" },
    )
  })

  test("finds custom fields used by a Text formatter", async () => {
    const prismaClient = {
      contactCustomField: {
        findFirst: async () => ({ key: "intake_notes" }),
      },
      automation: {
        findFirst: async () => null,
        findMany: async () => [{
          id: "automation-1",
          name: "Normalize intake notes",
          actions: [{
            type: "FORMAT_TEXT",
            textFormatterConfig: {
              actionName: "Clean notes",
              mode: "TRIM_WHITESPACE",
              source: { type: "CUSTOM_FIELD", key: "intake_notes" },
              outputKey: "clean_notes",
            },
          }],
        }],
      },
    }

    assert.deepEqual(
      await findEnabledAutomationReference(
        prismaClient,
        "tenant-1",
        { kind: "customField", id: "field-1" },
      ),
      { id: "automation-1", name: "Normalize intake notes" },
    )
  })

  test("finds references inside If/Else conditions and nested branch actions", async () => {
    const prismaClient = {
      contactCustomField: {
        findFirst: async () => ({ key: "risk_level" }),
      },
      automation: {
        findFirst: async () => null,
        findMany: async () => [{
          id: "automation-1",
          name: "Risk routing",
          actions: [{
            type: "IF_ELSE",
            ifElseConfig: {
              actionName: "Route risk",
              branches: [{
                conditions: [{ source: "CONTACT_CUSTOM_FIELD", customFieldId: "field-1" }],
                actions: [{ type: "SET_CONTACT_STATUS", statusConfigId: "inactive" }],
              }],
            },
          }],
        }],
      },
    }

    assert.deepEqual(
      await findEnabledAutomationReference(
        prismaClient,
        "tenant-1",
        { kind: "customField", id: "field-1" },
      ),
      { id: "automation-1", name: "Risk routing" },
    )
    assert.deepEqual(
      await findEnabledAutomationReference(
        prismaClient,
        "tenant-1",
        { kind: "status", id: "inactive" },
      ),
      { id: "automation-1", name: "Risk routing" },
    )
  })

  test("finds references inside nested Split route actions", async () => {
    const prismaClient = {
      automation: {
        findFirst: async () => null,
        findMany: async () => [{
          id: "automation-1",
          name: "Random status test",
          actions: [{
            type: "SPLIT",
            splitConfig: {
              actionName: "Random split",
              routes: [{
                actions: [{ type: "SET_CONTACT_STATUS", statusConfigId: "inactive" }],
              }],
            },
          }],
        }],
      },
    }

    assert.deepEqual(
      await findEnabledAutomationReference(
        prismaClient,
        "tenant-1",
        { kind: "status", id: "inactive" },
      ),
      { id: "automation-1", name: "Random status test" },
    )
  })

  test("finds pipeline and stage references inside nested Update/create opportunity actions", async () => {
    const prismaClient = {
      automation: {
        findFirst: async () => null,
        findMany: async () => [{
          id: "automation-1",
          name: "Move renewal",
          actions: [{
            type: "SPLIT",
            splitConfig: {
              actionName: "Route",
              routes: [{
                actions: [{
                  type: "UPDATE_OPPORTUNITY",
                  opportunityConfig: {
                    actionName: "Move renewal",
                    pipelineId: "pipeline-2",
                    pipelineNameSnapshot: "Renewals",
                    stageId: "stage-2",
                    stageNameSnapshot: "Follow-up",
                    resultMode: "KEEP_CURRENT",
                    valueCents: 0,
                  },
                }],
              }],
            },
          }],
        }],
      },
    }

    assert.deepEqual(
      await findEnabledAutomationReference(prismaClient, "tenant-1", { kind: "pipeline", id: "pipeline-2" }),
      { id: "automation-1", name: "Move renewal" },
    )
    assert.deepEqual(
      await findEnabledAutomationReference(prismaClient, "tenant-1", { kind: "stage", ids: ["stage-2"] }),
      { id: "automation-1", name: "Move renewal" },
    )
  })

  test("finds pipeline references inside nested Delete opportunity actions", async () => {
    const prismaClient = {
      automation: {
        findFirst: async () => null,
        findMany: async () => [{
          id: "automation-1",
          name: "Remove renewal",
          actions: [{
            type: "IF_ELSE",
            ifElseConfig: {
              actionName: "Renewal state",
              branches: [{
                actions: [{
                  type: "DELETE_OPPORTUNITY",
                  deleteOpportunityConfig: {
                    actionName: "Remove renewal",
                    pipelineId: "pipeline-2",
                    pipelineNameSnapshot: "Renewals",
                  },
                }],
              }],
            },
          }],
        }],
      },
    }

    assert.deepEqual(
      await findEnabledAutomationReference(prismaClient, "tenant-1", { kind: "pipeline", id: "pipeline-2" }),
      { id: "automation-1", name: "Remove renewal" },
    )
  })
})
