import type { AutomationAction } from "../app/(tenants)/app/[tenantSlug]/account-settings/_components/automation-types.js"

export const MAX_AUTOMATION_ACTION_NODES = 100
const MAX_IF_ELSE_DEPTH = 3

function actionNodeCount(actions: AutomationAction[]): number {
  return actions.reduce((count, action) => {
    const paths = action.type === "IF_ELSE"
      ? action.ifElseConfig?.branches ?? []
      : action.type === "SPLIT"
        ? action.splitConfig?.routes ?? []
        : []
    if (paths.length === 0) return count + 1
    const branchCount = paths.reduce(
      (total, branch) => total + actionNodeCount(branch.actions),
      0,
    )
    return count + 1 + branchCount
  }, 0)
}

function maximumIfElseDepth(actions: AutomationAction[]): number {
  return actions.reduce((maximum, action) => {
    const paths = action.type === "IF_ELSE"
      ? action.ifElseConfig?.branches ?? []
      : action.type === "SPLIT"
        ? action.splitConfig?.routes ?? []
        : []
    if (paths.length === 0) return maximum
    const nestedDepth = paths.reduce(
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
      if (action.type === "IF_ELSE") {
        for (const branch of action.ifElseConfig?.branches ?? []) visit(branch.actions)
      } else if (action.type === "SPLIT") {
        for (const route of action.splitConfig?.routes ?? []) visit(route.actions)
      }
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
  const firstBranch = wrappedAction.type === "IF_ELSE"
    ? wrappedAction.ifElseConfig?.branches.find((branch) => !branch.isDefault)
    : wrappedAction.type === "SPLIT"
      ? wrappedAction.splitConfig?.routes[0]
      : null
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
  if (action.type !== "IF_ELSE" && action.type !== "SPLIT") return null
  if (action.type === "IF_ELSE" && !action.ifElseConfig?.branches.some((branch) => !branch.isDefault)) {
    return "Add a condition branch before saving this If/Else action."
  }
  if (action.type === "SPLIT" && (action.splitConfig?.routes.length ?? 0) < 2) {
    return "Add at least two routes before saving this Split action."
  }

  const nextActionCount = currentActionCount - (replacesExistingAction ? 1 : 0) + actionNodeCount([action])
  if (nextActionCount > MAX_AUTOMATION_ACTION_NODES) {
    return `An automation can contain at most ${MAX_AUTOMATION_ACTION_NODES} action nodes across all branches.`
  }

  const wrappedAction = wrapFollowingActionsInFirstBranch(action, followingActions)
  if (pathDepth + maximumIfElseDepth([wrappedAction]) > MAX_IF_ELSE_DEPTH) {
    return "Split and If/Else can be nested up to three levels."
  }

  const movedNodeKeys = actionNodeKeys(followingActions)
  const invalidWaitTarget = precedingPathActions.some((candidate) =>
    candidate.type === "WAIT" &&
    candidate.waitConfig?.mode === "FIXED_DATE" &&
    candidate.waitConfig.pastBehavior === "GO_TO_STEP" &&
    Boolean(candidate.waitConfig.targetNodeKey && movedNodeKeys.has(candidate.waitConfig.targetNodeKey)),
  )
  if (invalidWaitTarget) {
    return `An earlier Wait action targets a step that would move into ${action.type === "SPLIT" ? "Route 1" : "Branch 1"}. Update that Wait target first.`
  }

  return null
}
