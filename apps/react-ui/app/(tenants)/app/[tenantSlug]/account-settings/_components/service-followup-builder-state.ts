export type WorkflowValidationIssue = {
  code: string
  message: string
  nodeId?: string
  stepId?: string
  transitionId?: string
  branchId?: string
  edgeId?: string
}

type SnapshotNode = {
  id: string
  type?: unknown
  position: { x: number; y: number }
  data: unknown
}

type SnapshotEdge = {
  id: string
  source: string
  target: string
  type?: unknown
}

export function toPersistedBuilderSnapshot(
  nodes: SnapshotNode[],
  edges: SnapshotEdge[],
  name: string,
) {
  return JSON.stringify({
    name: name.trim(),
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: {
        x: node.position.x,
        y: node.position.y,
      },
      data: node.data,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
    })),
  })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value))

export function parseWorkflowValidationIssues(value: unknown): WorkflowValidationIssue[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.code !== "string" || typeof candidate.message !== "string") {
      return []
    }

    const issue: WorkflowValidationIssue = {
      code: candidate.code,
      message: candidate.message,
    }

    for (const key of ["nodeId", "stepId", "transitionId", "branchId", "edgeId"] as const) {
      if (typeof candidate[key] === "string") issue[key] = candidate[key]
    }

    return [issue]
  })
}

export function parseBuilderApiIssues(payload: unknown): WorkflowValidationIssue[] {
  if (!isRecord(payload)) return []

  const workflowIssues = parseWorkflowValidationIssues(payload.issues)
  if (workflowIssues.length) return workflowIssues
  if (!Array.isArray(payload.details)) return []

  return payload.details.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.message !== "string") return []
    const path = typeof candidate.path === "string" ? candidate.path.trim() : ""
    return [{
      code: "INVALID_REQUEST",
      message: path ? `${path}: ${candidate.message}` : candidate.message,
    }]
  })
}
