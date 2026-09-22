import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  AutomationUpsertSchema,
  evaluateAutomationOperator,
  executeOpportunityAutomations,
  getAutomationOperatorsForFieldType,
} from "./opportunity-automations.js"

describe("evaluateAutomationOperator", () => {
  test("evaluates numeric comparisons and ranges", () => {
    assert.equal(evaluateAutomationOperator("GREATER_THAN", 20_000, 10_000, "number"), true)
    assert.equal(
      evaluateAutomationOperator("BETWEEN", 15_000, { min: 10_000, max: 20_000 }, "number"),
      true,
    )
    assert.equal(evaluateAutomationOperator("LESS_THAN", 20_000, 10_000, "number"), false)
  })

  test("evaluates strings, arrays, booleans, and empty values", () => {
    assert.equal(evaluateAutomationOperator("CONTAINS", "Qualified lead", "lead", "string"), true)
    assert.equal(
      evaluateAutomationOperator("INCLUDES_ALL", ["A", "B"], ["A", "B"], "stringArray"),
      true,
    )
    assert.equal(evaluateAutomationOperator("IS_TRUE", true, null, "boolean"), true)
    assert.equal(evaluateAutomationOperator("IS_EMPTY", null, null, "string"), true)
  })

  test("uses field-appropriate operator catalogs", () => {
    assert.ok(getAutomationOperatorsForFieldType("NUMBER").includes("BETWEEN"))
    assert.ok(getAutomationOperatorsForFieldType("MULTI_SELECT").includes("INCLUDES_ANY"))
    assert.deepEqual(getAutomationOperatorsForFieldType("CHECKBOX"), [
      "IS_TRUE",
      "IS_FALSE",
      "IS_EMPTY",
      "IS_NOT_EMPTY",
    ])
  })
})

describe("AutomationUpsertSchema", () => {
  test("accepts creation and stage-change trigger shapes", () => {
    const base = {
      name: "Qualified opportunity",
      isEnabled: false,
      conditions: [],
      actions: [{ type: "CLEAR_CONTACT_STATUS" }],
    }
    assert.equal(
      AutomationUpsertSchema.safeParse({
        ...base,
        trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      }).success,
      true,
    )
    assert.equal(
      AutomationUpsertSchema.safeParse({
        ...base,
        trigger: {
          type: "OPPORTUNITY_STAGE_CHANGED",
          pipelineId: "pipeline-1",
          targetStageId: "stage-2",
        },
      }).success,
      true,
    )
  })

  test("accepts assignee and tag filters", () => {
    const result = AutomationUpsertSchema.safeParse({
      name: "Route assigned opportunity",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [
        {
          source: "CONTACT_ASSIGNEE",
          operator: "EQUALS",
          assignedUserId: "user-1",
        },
        {
          source: "CONTACT_TAGS",
          operator: "NOT_EQUALS",
          tagId: "tag-1",
        },
      ],
      actions: [{ type: "CLEAR_CONTACT_STATUS" }],
    })

    assert.equal(result.success, true)
  })

  test("rejects an empty action list", () => {
    const noActions = AutomationUpsertSchema.safeParse({
      name: "Invalid",
      isEnabled: false,
      trigger: { type: "OPPORTUNITY_CREATED", pipelineId: "pipeline-1" },
      conditions: [],
      actions: [],
    })
    assert.equal(noActions.success, false)
  })
})

describe("executeOpportunityAutomations", () => {
  test("matches a stage trigger by the stage entered, regardless of the source stage", async () => {
    let where: Record<string, unknown> | undefined
    const prismaTx = {
      automation: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          where = args.where
          return []
        },
      },
    }

    await executeOpportunityAutomations(prismaTx, {
      tenantId: "tenant-1",
      actorUserId: "user-1",
      triggerType: "OPPORTUNITY_STAGE_CHANGED",
      opportunityId: "opportunity-1",
      contactId: "contact-1",
      pipelineId: "pipeline-1",
      valueCents: 0,
      sourceStageId: "stage-1",
      targetStageId: "stage-2",
    })

    assert.deepEqual(where, {
      tenantId: "tenant-1",
      isEnabled: true,
      pipelineId: "pipeline-1",
      triggerType: "OPPORTUNITY_STAGE_CHANGED",
      targetStageId: "stage-2",
    })
  })
})
