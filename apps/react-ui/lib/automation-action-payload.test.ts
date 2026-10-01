import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { serializeAutomationAction } from "./automation-action-payload.js"
import type { AutomationAction } from "../app/(tenants)/app/[tenantSlug]/account-settings/_components/automation-types.js"

describe("serializeAutomationAction", () => {
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
