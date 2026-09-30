import type { AutomationAction } from "../app/(tenants)/app/[tenantSlug]/account-settings/_components/automation-types.js"

const MAX_AUTOMATION_ACTIONS = 20
const MAX_IF_ELSE_DEPTH = 3

function actionNodeCount(actions: AutomationAction[]): number {
  return actions.reduce((count, action) => {
    if (action.type !== "IF_ELSE") return count + 1
    const branchCount = (action.ifElseConfig?.branches ?? []).reduce(
      (total, branch) => total + actionNodeCount(branch.actions),
      0,
    )
    return count + 1 + branchCount
  }, 0)
}

function maximumIfElseDepth(actions: AutomationAction[]): number {
  return actions.reduce((maximum, action) => {
    if (action.type !== "IF_ELSE") return maximum
    const nestedDepth = (action.ifElseConfig?.branches ?? []).reduce(
      (branchMaximum, branch) => Math.max(branchMaximum, maximumIfElseDepth(branch.actions)),
      0,
    )
    return Math.max(maximum, 1 + nestedDepth)
  }, 0)
}

function actionNodeKeys(actions: AutomationAction[]): Set<string> {
  const keys = new Set<string>()
  const visit = (pathActions: AutomationAction[]) => {
    for (const action of pathActions) {
      if (action.nodeKey) keys.add(action.nodeKey)
      if (action.type !== "IF_ELSE") continue
      for (const branch of action.ifElseConfig?.branches ?? []) visit(branch.actions)
    }
  }
  visit(actions)
  return keys
}

export function wrapFollowingActionsInFirstBranch(
  action: AutomationAction,
  followingActions: AutomationAction[],
): AutomationAction {
  const wrappedAction = structuredClone(action)
  if (wrappedAction.type !== "IF_ELSE" || !wrappedAction.ifElseConfig) return wrappedAction

  const firstBranch = wrappedAction.ifElseConfig.branches.find((branch) => !branch.isDefault)
  if (!firstBranch) return wrappedAction
  firstBranch.actions.push(...structuredClone(followingActions))
  return wrappedAction
}

export function ifElseWrapIssue({
  action,
  followingActions,
  precedingPathActions,
  pathDepth,
  currentActionCount,
  replacesExistingAction,
}: {
  action: AutomationAction
  followingActions: AutomationAction[]
  precedingPathActions: AutomationAction[]
  pathDepth: number
  currentActionCount: number
  replacesExistingAction: boolean
}): string | null {
  if (action.type !== "IF_ELSE" || !action.ifElseConfig) return null
  if (!action.ifElseConfig.branches.some((branch) => !branch.isDefault)) {
    return "Add a condition branch before saving this If/Else action."
  }

  const nextActionCount = currentActionCount - (replacesExistingAction ? 1 : 0) + actionNodeCount([action])
  if (nextActionCount > MAX_AUTOMATION_ACTIONS) {
    return "An automation can contain at most 20 action nodes across all branches."
  }

  const wrappedAction = wrapFollowingActionsInFirstBranch(action, followingActions)
  if (pathDepth + maximumIfElseDepth([wrappedAction]) > MAX_IF_ELSE_DEPTH) {
    return "If/Else can be nested up to three levels."
  }

  const movedNodeKeys = actionNodeKeys(followingActions)
  const invalidWaitTarget = precedingPathActions.some((candidate) =>
    candidate.type === "WAIT" &&
    candidate.waitConfig?.mode === "FIXED_DATE" &&
    candidate.waitConfig.pastBehavior === "GO_TO_STEP" &&
    Boolean(candidate.waitConfig.targetNodeKey && movedNodeKeys.has(candidate.waitConfig.targetNodeKey)),
  )
  if (invalidWaitTarget) {
    return "An earlier Wait action targets a step that would move into Branch 1. Update that Wait target first."
  }

  return null
}
