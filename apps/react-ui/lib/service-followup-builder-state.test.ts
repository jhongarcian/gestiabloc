import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  parseBuilderApiIssues,
  parseWorkflowValidationIssues,
  toPersistedBuilderSnapshot,
} from "../app/(tenants)/app/[tenantSlug]/account-settings/_components/service-followup-builder-state.js"

describe("follow-up builder saved state", () => {
  test("uses the same normalized snapshot before and after a successful save", () => {
    const nodes = [{
      id: "step-1",
      type: "stepNode",
      position: { x: 440, y: 210 },
      data: { kind: "step", label: "Collected documents" },
    }]
    const edges = [{ id: "edge-1", source: "start", target: "step-1", type: "smoothstep" }]

    const currentSnapshot = toPersistedBuilderSnapshot(nodes, edges, "  Medicare follow-up  ")
    const savedSnapshot = toPersistedBuilderSnapshot(nodes, edges, "Medicare follow-up")

    assert.equal(currentSnapshot, savedSnapshot)
  })

  test("keeps structured workflow issue locations", () => {
    assert.deepEqual(
      parseWorkflowValidationIssues([
        {
          code: "BRANCH_TARGET_REQUIRED",
          message: "Select a later step.",
          nodeId: "condition-1",
          transitionId: "transition-step-1",
          branchId: "default-branch",
        },
      ]),
      [{
        code: "BRANCH_TARGET_REQUIRED",
        message: "Select a later step.",
        nodeId: "condition-1",
        transitionId: "transition-step-1",
        branchId: "default-branch",
      }],
    )
  })

  test("turns request validation details into visible builder issues", () => {
    assert.deepEqual(
      parseBuilderApiIssues({
        error: "INVALID_REQUEST",
        details: [{
          path: "draftDefinition.schemaVersion",
          message: "Invalid input: expected 3",
        }],
      }),
      [{
        code: "INVALID_REQUEST",
        message: "draftDefinition.schemaVersion: Invalid input: expected 3",
      }],
    )
  })
})
