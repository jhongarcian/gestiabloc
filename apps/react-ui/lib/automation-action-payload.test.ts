import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { serializeAutomationAction } from "./automation-action-payload.js"
import type { AutomationAction } from "../app/(tenants)/app/[tenantSlug]/account-settings/_components/automation-types.js"

describe("serializeAutomationAction", () => {
  test("serializes only the Update/create opportunity configuration", () => {
    assert.deepEqual(
      serializeAutomationAction({
        nodeKey: "opportunity-1",
        type: "UPDATE_OPPORTUNITY",
        opportunityConfig: {
          actionName: "Move to follow-up",
          pipelineId: "pipeline-1",
          pipelineNameSnapshot: "Work",
          stageId: "stage-2",
          stageNameSnapshot: "Follow-up",
          resultMode: "WON",
          valueCents: 25_000,
        },
        statusConfigId: null,
      }),
      {
        nodeKey: "opportunity-1",
        type: "UPDATE_OPPORTUNITY",
        opportunityConfig: {
          actionName: "Move to follow-up",
          pipelineId: "pipeline-1",
          pipelineNameSnapshot: "Work",
          stageId: "stage-2",
          stageNameSnapshot: "Follow-up",
          resultMode: "WON",
          valueCents: 25_000,
        },
      },
    )
  })

  test("serializes only the Delete opportunity configuration", () => {
    assert.deepEqual(
      serializeAutomationAction({
        nodeKey: "delete-opportunity-1",
        type: "DELETE_OPPORTUNITY",
        deleteOpportunityConfig: {
          actionName: "Remove renewal",
          pipelineId: "pipeline-2",
          pipelineNameSnapshot: "Renewals",
        },
        statusConfigId: null,
      }),
      {
        nodeKey: "delete-opportunity-1",
        type: "DELETE_OPPORTUNITY",
        deleteOpportunityConfig: {
          actionName: "Remove renewal",
          pipelineId: "pipeline-2",
          pipelineNameSnapshot: "Renewals",
        },
      },
    )
  })

  test("serializes only the stable Go To destination", () => {
    assert.deepEqual(
      serializeAutomationAction({
        nodeKey: "go-to-1",
        type: "GO_TO",
        goToConfig: { targetNodeKey: "destination-1" },
        statusConfigId: null,
      }),
      {
        nodeKey: "go-to-1",
        type: "GO_TO",
        goToConfig: { targetNodeKey: "destination-1" },
      },
    )
  })

  test("serializes only the Add to workflow configuration", () => {
    assert.deepEqual(
      serializeAutomationAction({
        nodeKey: "workflow-1",
        type: "ADD_TO_WORKFLOW",
        addToWorkflowConfig: {
          actionName: "Start onboarding",
          targetAutomationId: "automation-2",
          targetAutomationNameSnapshot: "Client onboarding",
        },
        statusConfigId: null,
      }),
      {
        nodeKey: "workflow-1",
        type: "ADD_TO_WORKFLOW",
        addToWorkflowConfig: {
          actionName: "Start onboarding",
          targetAutomationId: "automation-2",
          targetAutomationNameSnapshot: "Client onboarding",
        },
      },
    )
  })

  test("serializes only the Remove from workflow configuration", () => {
    assert.deepEqual(
      serializeAutomationAction({
        nodeKey: "remove-workflow-1",
        type: "REMOVE_FROM_WORKFLOW",
        removeFromWorkflowConfig: {
          actionName: "End nurture",
          targetAutomationId: "automation-2",
          targetAutomationNameSnapshot: "Lead nurture",
        },
        statusConfigId: null,
      }),
      {
        nodeKey: "remove-workflow-1",
        type: "REMOVE_FROM_WORKFLOW",
        removeFromWorkflowConfig: {
          actionName: "End nurture",
          targetAutomationId: "automation-2",
          targetAutomationNameSnapshot: "Lead nurture",
        },
      },
    )
  })

  test("omits unrelated routing configs and preserves a nested If/Else inside Split", () => {
    const action: AutomationAction = {
      nodeKey: "split-1",
      type: "SPLIT",
      customFieldUpdates: null,
      statusConfigId: null,
      assignedUserId: null,
      tagId: null,
      waitConfig: null,
      noteTitle: null,
      noteBody: null,
      taskConfig: null,
      dateTimeFormatterConfig: null,
      numberFormatterConfig: null,
      textFormatterConfig: null,
      mathOperationConfig: null,
      ifElseConfig: null,
      splitConfig: {
        actionName: "Split",
        routes: [
          {
            branchKey: "route-1",
            name: "Route 1",
            percentage: 50,
            actions: [
              {
                nodeKey: "if-1",
                type: "IF_ELSE",
                splitConfig: null,
                ifElseConfig: {
                  actionName: "If/Else",
                  branches: [
                    {
                      branchKey: "branch-1",
                      name: "Branch 1",
                      isDefault: false,
                      matchMode: "ALL",
                      conditions: [{
                        source: "CONTACT_FIELD",
                        fieldKey: "name",
                        operator: "IS_NOT_EMPTY",
                      }],
                      actions: [{
                        nodeKey: "status-1",
                        type: "SET_CONTACT_STATUS",
                        statusConfigId: "active",
                        customFieldUpdates: null,
                        assignedUserId: null,
                        tagId: null,
                        waitConfig: null,
                        noteTitle: null,
                        noteBody: null,
                        taskConfig: null,
                        dateTimeFormatterConfig: null,
                        numberFormatterConfig: null,
                        textFormatterConfig: null,
                        mathOperationConfig: null,
                        ifElseConfig: null,
                        splitConfig: null,
                      }],
                    },
                    {
                      branchKey: "default-1",
                      name: "Default",
                      isDefault: true,
                      matchMode: "ALL",
                      conditions: [],
                      actions: [],
                    },
                  ],
                },
              },
            ],
          },
          {
            branchKey: "route-2",
            name: "Route 2",
            percentage: 50,
            actions: [],
          },
        ],
      },
    }

    const payload = JSON.parse(JSON.stringify(serializeAutomationAction(action)))
    const nestedIfElse = payload.splitConfig.routes[0].actions[0]
    const nestedStatus = nestedIfElse.ifElseConfig.branches[0].actions[0]

    assert.equal(Object.hasOwn(payload, "ifElseConfig"), false)
    assert.equal(Object.hasOwn(payload, "customFieldUpdates"), false)
    assert.equal(Object.hasOwn(payload, "waitConfig"), false)
    assert.equal(Object.hasOwn(nestedIfElse, "splitConfig"), false)
    assert.equal(Object.hasOwn(nestedStatus, "ifElseConfig"), false)
    assert.equal(Object.hasOwn(nestedStatus, "splitConfig"), false)
    assert.equal(nestedIfElse.type, "IF_ELSE")
    assert.equal(nestedStatus.type, "SET_CONTACT_STATUS")
  })
})
