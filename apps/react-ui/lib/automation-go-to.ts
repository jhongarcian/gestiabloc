import type { AutomationAction } from "../app/(tenants)/app/[tenantSlug]/account-settings/_components/automation-types.js"

export type AutomationGoToLocation = {
  action: AutomationAction
  actions: AutomationAction[]
  index: number
  breadcrumb: string[]
}

export function collectAutomationGoToLocations(actions: AutomationAction[]) {
  const locations = new Map<string, AutomationGoToLocation>()
  const visit = (pathActions: AutomationAction[], breadcrumb: string[]) => {
    pathActions.forEach((action, index) => {
      if (action.nodeKey) locations.set(action.nodeKey, { action, actions: pathActions, index, breadcrumb })
      if (action.type === "IF_ELSE") {
        for (const branch of action.ifElseConfig?.branches ?? []) {
          visit(branch.actions, [...breadcrumb, branch.name])
        }
      } else if (action.type === "SPLIT") {
        for (const route of action.splitConfig?.routes ?? []) {
          visit(route.actions, [...breadcrumb, route.name])
        }
      }
    })
  }
  visit(actions, ["Main path"])
  return locations
}

function controlFlowEdges(actions: AutomationAction[], override?: { sourceNodeKey: string; targetNodeKey: string }) {
  const locations = collectAutomationGoToLocations(actions)
  const edges = new Map<string, Set<string>>()
  const addEdge = (source: string, target?: string | null) => {
    if (!target) return
    const targets = edges.get(source) ?? new Set<string>()
    targets.add(target)
    edges.set(source, targets)
  }

  for (const [nodeKey, { action, actions: pathActions, index }] of locations) {
    if (action.type === "GO_TO") {
      addEdge(nodeKey, override?.sourceNodeKey === nodeKey
        ? override.targetNodeKey
        : action.goToConfig?.targetNodeKey)
    } else if (action.type === "IF_ELSE") {
      for (const branch of action.ifElseConfig?.branches ?? []) {
        addEdge(nodeKey, branch.actions[0]?.nodeKey)
      }
    } else if (action.type === "SPLIT") {
      for (const route of action.splitConfig?.routes ?? []) addEdge(nodeKey, route.actions[0]?.nodeKey)
    } else {
      addEdge(nodeKey, pathActions[index + 1]?.nodeKey)
    }
  }
  return { locations, edges }
}

function graphHasCycle(nodeKeys: Iterable<string>, edges: Map<string, Set<string>>) {
  const state = new Map<string, 0 | 1 | 2>()
  const visit = (nodeKey: string): boolean => {
    const current = state.get(nodeKey) ?? 0
    if (current === 1) return true
    if (current === 2) return false
    state.set(nodeKey, 1)
    for (const target of edges.get(nodeKey) ?? []) {
      if (visit(target)) return true
    }
    state.set(nodeKey, 2)
    return false
  }
  return [...nodeKeys].some(visit)
}

function requiredAutomationValues(action: AutomationAction) {
  const required = new Set<string>()
  const addSource = (source: unknown) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return
    const candidate = source as Record<string, unknown>
    if (candidate.type === "AUTOMATION_VALUE" && typeof candidate.key === "string") required.add(candidate.key)
  }
  const addTemplate = (template: unknown) => {
    if (typeof template !== "string") return
    for (const match of template.matchAll(/\{automation\.([a-z][a-z0-9_]{0,63})\}/g)) {
      if (match[1]) required.add(match[1])
    }
  }
  if (action.type === "FORMAT_DATE_TIME") {
    const config = action.dateTimeFormatterConfig
    if (config?.mode === "COMPARE_DATES") {
      addSource(config.from)
      addSource(config.to)
    } else addSource(config?.source)
  } else if (action.type === "FORMAT_NUMBER") {
    if (action.numberFormatterConfig?.mode !== "RANDOM_NUMBER") addSource(action.numberFormatterConfig?.source)
  } else if (action.type === "FORMAT_TEXT") {
    addSource(action.textFormatterConfig?.source)
  } else if (action.type === "MATH_OPERATION") {
    addSource(action.mathOperationConfig?.source)
  } else if (action.type === "ADD_CONTACT_NOTE") {
    addTemplate(action.noteTitle)
    addTemplate(action.noteBody)
  } else if (action.type === "CREATE_TASK") {
    addTemplate(action.taskConfig?.nameTemplate)
    addTemplate(action.taskConfig?.descriptionTemplate)
    addTemplate(action.taskConfig?.reminder?.messageTemplate)
  } else if (action.type === "SEND_INTERNAL_NOTIFICATION") {
    addTemplate(action.internalNotificationConfig?.titleTemplate)
    addTemplate(action.internalNotificationConfig?.bodyTemplate)
  } else if (action.type === "CREATE_CONTACT") {
    const config = action.createContactConfig
    addTemplate(config?.firstNameTemplate)
    addTemplate(config?.middleNameTemplate)
    addTemplate(config?.lastNameTemplate)
    addTemplate(config?.emailTemplate)
    addTemplate(config?.phoneTemplate)
    addSource(config?.dateOfBirth)
    for (const assignment of config?.customFieldValues ?? []) {
      if (assignment.source.type === "TEMPLATE") addTemplate(assignment.source.template)
      else addSource(assignment.source)
    }
  } else if (action.type === "IF_ELSE") {
    for (const branch of action.ifElseConfig?.branches ?? []) {
      for (const condition of branch.conditions) addSource(condition)
    }
  }
  return required
}

function producedAutomationValue(action: AutomationAction) {
  if (action.type === "FORMAT_DATE_TIME") return action.dateTimeFormatterConfig?.outputKey
  if (action.type === "FORMAT_NUMBER") return action.numberFormatterConfig?.outputKey
  if (action.type === "FORMAT_TEXT") return action.textFormatterConfig?.outputKey
  if (action.type === "MATH_OPERATION") return action.mathOperationConfig?.outputKey
  return undefined
}

function automationValueControlFlowIssue(
  locations: Map<string, AutomationGoToLocation>,
  edges: Map<string, Set<string>>,
) {
  const predecessors = new Map<string, Set<string>>()
  for (const nodeKey of locations.keys()) predecessors.set(nodeKey, new Set())
  for (const [source, targets] of edges) {
    for (const target of targets) predecessors.get(target)?.add(source)
  }
  const remainingInputs = new Map([...predecessors].map(([nodeKey, sources]) => [nodeKey, sources.size]))
  const queue = [...remainingInputs].filter(([, count]) => count === 0).map(([nodeKey]) => nodeKey)
  const availableAfter = new Map<string, Set<string>>()
  while (queue.length > 0) {
    const nodeKey = queue.shift()!
    const incoming = [...(predecessors.get(nodeKey) ?? [])]
    const available = incoming.length === 0
      ? new Set<string>()
      : incoming.slice(1).reduce(
          (intersection, predecessor) => new Set(
            [...intersection].filter((key) => availableAfter.get(predecessor)?.has(key)),
          ),
          new Set(availableAfter.get(incoming[0]!) ?? []),
        )
    const action = locations.get(nodeKey)!.action
    for (const key of requiredAutomationValues(action)) {
      if (!available.has(key)) return `Automation value “${key}” is not available on every route to this action.`
    }
    const produced = producedAutomationValue(action)
    if (produced) available.add(produced)
    availableAfter.set(nodeKey, available)
    for (const target of edges.get(nodeKey) ?? []) {
      const count = (remainingInputs.get(target) ?? 1) - 1
      remainingInputs.set(target, count)
      if (count === 0) queue.push(target)
    }
  }
  return null
}

export function automationGoToTargetIssue(
  actions: AutomationAction[],
  sourceNodeKey: string,
  targetNodeKey: string,
) {
  const { locations, edges } = controlFlowEdges(actions, { sourceNodeKey, targetNodeKey })
  const source = locations.get(sourceNodeKey)
  const target = locations.get(targetNodeKey)
  if (!source) return "The Go To action is not available in this workflow."
  if (source.index !== source.actions.length - 1) return "Go To must be the final action in its path."
  if (!target) return "Choose an action that still exists in this workflow."
  if (sourceNodeKey === targetNodeKey) return "Go To cannot target itself."
  if (graphHasCycle(locations.keys(), edges)) {
    return source.actions === target.actions && target.index < source.index
      ? "A previous action in the same path would create a loop."
      : "This connection would create a workflow loop."
  }
  return automationValueControlFlowIssue(locations, edges)
}

export function validateAutomationGoToGraph(actions: AutomationAction[]) {
  const { locations, edges } = controlFlowEdges(actions)
  let hasGoTo = false
  for (const [nodeKey, location] of locations) {
    if (location.action.type !== "GO_TO") continue
    hasGoTo = true
    const targetNodeKey = location.action.goToConfig?.targetNodeKey ?? ""
    if (!targetNodeKey) return "Choose a destination for Go To."
    const issue = automationGoToTargetIssue(actions, nodeKey, targetNodeKey)
    if (issue) return issue
  }
  return hasGoTo ? automationValueControlFlowIssue(locations, edges) : null
}

export function automationGoToDestinations(actions: AutomationAction[], sourceNodeKey: string) {
  return [...collectAutomationGoToLocations(actions).values()]
    .filter((location) => location.action.nodeKey && location.action.nodeKey !== sourceNodeKey)
    .map((location) => ({
      ...location,
      nodeKey: location.action.nodeKey!,
      issue: automationGoToTargetIssue(actions, sourceNodeKey, location.action.nodeKey!),
    }))
}
