import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  ifElseWrapIssue,
  wrapFollowingActionsInFirstBranch,
} from "./automation-if-else-insertion.js"
import type { AutomationAction } from "../app/(tenants)/app/[tenantSlug]/account-settings/_components/automation-types.js"

function ifElseAction(branchActions: AutomationAction[] = []): AutomationAction {
  return {
    nodeKey: "if-1",
    type: "IF_ELSE",
    ifElseConfig: {
      actionName: "If/Else",
      branches: [
        {
          branchKey: "branch-1",
          name: "Branch 1",
          isDefault: false,
          matchMode: "ALL",
          conditions: [{ conditionKey: "condition-1", source: "CONTACT_FIELD", fieldKey: "name", operator: "IS_NOT_EMPTY" }],
          actions: branchActions,
        },
        {
          branchKey: "default",
          name: "Default",
          isDefault: true,
          matchMode: "ALL",
          conditions: [],
          actions: [],
        },
      ],
    },
  }
}

function splitAction(routeActions: AutomationAction[] = []): AutomationAction {
  return {
    nodeKey: "split-1",
    type: "SPLIT",
    splitConfig: {
      actionName: "Split",
      routes: [
        { branchKey: "route-1", name: "Route 1", percentage: 50, actions: routeActions },
        { branchKey: "route-2", name: "Route 2", percentage: 50, actions: [] },
      ],
    },
  }
}

describe("If/Else insertion", () => {
  test("moves every following action into the first branch without changing order or node keys", () => {
    const existingBranchAction: AutomationAction = { nodeKey: "branch-action", type: "ADD_CONTACT_TAG", tagId: "tag-1" }
    const followingActions: AutomationAction[] = [
      { nodeKey: "status", type: "SET_CONTACT_STATUS", statusConfigId: "active" },
      { nodeKey: "wait", type: "WAIT", waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" } },
    ]
    const originalAction = ifElseAction([existingBranchAction])

    const wrapped = wrapFollowingActionsInFirstBranch(originalAction, followingActions)
    const firstBranch = wrapped.ifElseConfig?.branches.find((branch) => !branch.isDefault)

    assert.deepEqual(firstBranch?.actions.map((action) => action.nodeKey), ["branch-action", "status", "wait"])
    assert.deepEqual(originalAction.ifElseConfig?.branches[0]?.actions.map((action) => action.nodeKey), ["branch-action"])
    assert.equal(wrapped.ifElseConfig?.branches.at(-1)?.actions.length, 0)
  })

  test("blocks wrapping when an earlier Wait targets a moved action", () => {
    const issue = ifElseWrapIssue({
      action: ifElseAction(),
      followingActions: [{ nodeKey: "later", type: "ADD_CONTACT_TAG", tagId: "tag-1" }],
      precedingPathActions: [{
        nodeKey: "wait",
        type: "WAIT",
        waitConfig: {
          mode: "FIXED_DATE",
          dateTime: "2026-10-01T12:00:00.000Z",
          timing: "ON",
          pastBehavior: "GO_TO_STEP",
          targetNodeKey: "later",
        },
      }],
      pathDepth: 0,
      currentActionCount: 2,
      replacesExistingAction: false,
    })

    assert.match(issue ?? "", /earlier Wait action/)
  })

  test("allows a terminal node to move into Branch 1", () => {
    const issue = ifElseWrapIssue({
      action: ifElseAction(),
      followingActions: [{ nodeKey: "delete", type: "DELETE_CONTACT" }],
      precedingPathActions: [],
      pathDepth: 0,
      currentActionCount: 1,
      replacesExistingAction: false,
    })

    assert.equal(issue, null)
  })

  test("blocks insertion when it would create a fourth If/Else level", () => {
    const nested = ifElseAction()
    nested.nodeKey = "nested-2"
    const deepest = ifElseAction()
    deepest.nodeKey = "nested-3"
    nested.ifElseConfig!.branches[0]!.actions = [deepest]

    const issue = ifElseWrapIssue({
      action: ifElseAction(),
      followingActions: [nested],
      precedingPathActions: [],
      pathDepth: 1,
      currentActionCount: 3,
      replacesExistingAction: false,
    })

    assert.match(issue ?? "", /three levels/)
  })

  test("counts a conversion as a replacement rather than an additional node", () => {
    const common = {
      action: ifElseAction(),
      followingActions: [] as AutomationAction[],
      precedingPathActions: [] as AutomationAction[],
      pathDepth: 0,
      currentActionCount: 100,
    }

    assert.equal(ifElseWrapIssue({ ...common, replacesExistingAction: true }), null)
    assert.match(ifElseWrapIssue({ ...common, replacesExistingAction: false }) ?? "", /at most 100/)
  })

  test("moves following actions into Split Route 1 without copying them", () => {
    const followingActions: AutomationAction[] = [
      { nodeKey: "status", type: "SET_CONTACT_STATUS", statusConfigId: "active" },
      { nodeKey: "tag", type: "ADD_CONTACT_TAG", tagId: "tag-1" },
    ]
    const original = splitAction()
    const wrapped = wrapFollowingActionsInFirstBranch(original, followingActions)

    assert.deepEqual(wrapped.splitConfig?.routes[0]?.actions.map((action) => action.nodeKey), ["status", "tag"])
    assert.equal(wrapped.splitConfig?.routes[1]?.actions.length, 0)
    assert.equal(original.splitConfig?.routes[0]?.actions.length, 0)
  })

  test("applies one combined nesting limit across Split and If/Else", () => {
    const nestedIf = ifElseAction([splitAction()])
    const issue = ifElseWrapIssue({
      action: splitAction(),
      followingActions: [nestedIf],
      precedingPathActions: [],
      pathDepth: 1,
      currentActionCount: 3,
      replacesExistingAction: false,
    })

    assert.match(issue ?? "", /three levels/)
  })

  test("names Route 1 when a prior Wait target would cross into Split", () => {
    const issue = ifElseWrapIssue({
      action: splitAction(),
      followingActions: [{ nodeKey: "later", type: "ADD_CONTACT_TAG", tagId: "tag-1" }],
      precedingPathActions: [{
        nodeKey: "wait",
        type: "WAIT",
        waitConfig: {
          mode: "FIXED_DATE",
          dateTime: "2026-10-01T12:00:00.000Z",
          timing: "ON",
          pastBehavior: "GO_TO_STEP",
          targetNodeKey: "later",
        },
      }],
      pathDepth: 0,
      currentActionCount: 2,
      replacesExistingAction: false,
    })

    assert.match(issue ?? "", /Route 1/)
  })
})
