import assert from "node:assert/strict"
import { describe, test } from "node:test"

import type { AutomationAction } from "../app/(tenants)/app/[tenantSlug]/account-settings/_components/automation-types.js"
import {
  automationGoToDestinations,
  automationGoToTargetIssue,
  validateAutomationGoToGraph,
} from "./automation-go-to.js"

function split(routes: Array<{ branchKey: string; name: string; actions: AutomationAction[] }>): AutomationAction {
  return {
    nodeKey: "split-root",
    type: "SPLIT",
    splitConfig: {
      actionName: "Split",
      routes: routes.map((route) => ({ ...route, percentage: 50 })),
    },
  }
}

describe("automation Go To graph validation", () => {
  test("includes Default actions as Go To destinations and detects loops through Default", () => {
    const actions: AutomationAction[] = [{
      nodeKey: "if-node",
      type: "IF_ELSE",
      ifElseConfig: {
        actionName: "Route contact",
        branches: [
          {
            branchKey: "matched-branch",
            name: "Matched",
            isDefault: false,
            matchMode: "ALL",
            conditions: [],
            actions: [{ nodeKey: "go-node", type: "GO_TO", goToConfig: { targetNodeKey: "default-action" } }],
          },
          {
            branchKey: "default-branch",
            name: "Default",
            isDefault: true,
            matchMode: "ALL",
            conditions: [],
            actions: [{ nodeKey: "default-action", type: "CLEAR_CONTACT_ASSIGNEE" }],
          },
        ],
      },
    }]

    assert.equal(automationGoToTargetIssue(actions, "go-node", "default-action"), null)
    assert.equal(automationGoToDestinations(actions, "go-node").find((item) => item.nodeKey === "default-action")?.breadcrumb.join(" › "), "Main path › Default")

    actions[0]!.ifElseConfig!.branches[1]!.actions = [{
      nodeKey: "default-action",
      type: "GO_TO",
      goToConfig: { targetNodeKey: "go-node" },
    }]
    assert.match(validateAutomationGoToGraph(actions) ?? "", /loop/)
  })

  test("offers an acyclic target in another route", () => {
    const actions = [split([
      {
        branchKey: "route-a",
        name: "Route A",
        actions: [{ nodeKey: "go", type: "GO_TO", goToConfig: { targetNodeKey: "target" } }],
      },
      {
        branchKey: "route-b",
        name: "Route B",
        actions: [
          { nodeKey: "before", type: "CLEAR_CONTACT_ASSIGNEE" },
          { nodeKey: "target", type: "SET_CONTACT_STATUS", statusConfigId: "active" },
        ],
      },
    ])]

    assert.equal(automationGoToTargetIssue(actions, "go", "target"), null)
    assert.equal(validateAutomationGoToGraph(actions), null)
    assert.equal(
      automationGoToDestinations(actions, "go").find((item) => item.nodeKey === "target")?.breadcrumb.join(" › "),
      "Main path › Route B",
    )
  })

  test("rejects backward jumps, self-links, and cross-route cycles", () => {
    const backward: AutomationAction[] = [
      { nodeKey: "first", type: "CLEAR_CONTACT_ASSIGNEE" },
      { nodeKey: "go", type: "GO_TO", goToConfig: { targetNodeKey: "first" } },
    ]
    assert.match(automationGoToTargetIssue(backward, "go", "first") ?? "", /loop/)
    assert.match(automationGoToTargetIssue(backward, "go", "go") ?? "", /itself/)

    const cyclic = [split([
      { branchKey: "route-a", name: "Route A", actions: [{ nodeKey: "go-a", type: "GO_TO", goToConfig: { targetNodeKey: "go-b" } }] },
      { branchKey: "route-b", name: "Route B", actions: [{ nodeKey: "go-b", type: "GO_TO", goToConfig: { targetNodeKey: "go-a" } }] },
    ])]
    assert.match(validateAutomationGoToGraph(cyclic) ?? "", /loop/)
  })

  test("rejects a target whose formatter input is bypassed", () => {
    const actions = [split([
      {
        branchKey: "route-a",
        name: "Route A",
        actions: [{ nodeKey: "go", type: "GO_TO", goToConfig: { targetNodeKey: "note" } }],
      },
      {
        branchKey: "route-b",
        name: "Route B",
        actions: [
          {
            nodeKey: "formatter",
            type: "FORMAT_TEXT",
            textFormatterConfig: {
              actionName: "Normalize",
              mode: "UPPER_CASE",
              source: { type: "CONTACT_FIELD", key: "name" },
              outputKey: "lead_name",
            },
          },
          { nodeKey: "note", type: "ADD_CONTACT_NOTE", noteTitle: "Lead", noteBody: "{automation.lead_name}" },
        ],
      },
    ])]
    assert.match(automationGoToTargetIssue(actions, "go", "note") ?? "", /not available/)

    const createContactActions = [split([
      {
        branchKey: "route-a",
        name: "Route A",
        actions: [{ nodeKey: "go", type: "GO_TO", goToConfig: { targetNodeKey: "create-contact" } }],
      },
      {
        branchKey: "route-b",
        name: "Route B",
        actions: [
          {
            nodeKey: "formatter",
            type: "FORMAT_TEXT",
            textFormatterConfig: {
              actionName: "Normalize",
              mode: "UPPER_CASE",
              source: { type: "CONTACT_FIELD", key: "name" },
              outputKey: "lead_name",
            },
          },
          {
            nodeKey: "create-contact",
            type: "CREATE_CONTACT",
            createContactConfig: {
              actionName: "Create household contact",
              firstNameTemplate: "{automation.lead_name}",
              lastNameTemplate: "Household",
              statusConfigId: "active",
              customFieldValues: [],
            },
          },
        ],
      },
    ])]
    assert.match(
      automationGoToTargetIssue(createContactActions, "go", "create-contact") ?? "",
      /not available/,
    )
  })
})
