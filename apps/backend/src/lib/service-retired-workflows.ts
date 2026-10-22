type JsonRecord = Record<string, unknown>
const record = (value: unknown): JsonRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null

// Only public attribution leaves the archive. Definitions, variables, execution inputs
// and old lease data must never become an executable configuration or an API response.
export function retiredTemplate(value: unknown) {
  const template = record(record(value)?.template)
  return typeof template?.id === "string" && typeof template.name === "string"
    ? { id: template.id, name: template.name }
    : null
}

export function retiredTemplateVersion(value: unknown) {
  const version = record(record(value)?.version)
  return typeof version?.id === "string" && typeof version.versionNumber === "number"
    ? { id: version.id, versionNumber: version.versionNumber }
    : null
}

export function retiredWorkflowSummary(value: unknown) {
  const archive = record(value)
  if (!archive) return null
  const run = record(archive.run)
  return {
    template: retiredTemplate(value),
    version: retiredTemplateVersion(value),
    retiredAt: typeof archive.retiredAt === "string" ? archive.retiredAt : null,
    previousStatus: typeof run?.status === "string" ? run.status : null,
    previousScheduledAt: typeof run?.resumeAt === "string" ? run.resumeAt : null,
    hadUnfinishedWork: run ? !["COMPLETED", "CANCELED"].includes(String(run.status)) : false,
    notice: "This earlier workflow has been retired. Saved steps and history remain available. Review unfinished actions and finish the saved steps manually.",
  }
}

export function retiredWorkflowAttribution(value: unknown) {
  const archive = record(value)
  return archive ? {
    schemaVersion: 1,
    retiredAt: typeof archive.retiredAt === "string" ? archive.retiredAt : null,
    template: retiredTemplate(value),
    version: retiredTemplateVersion(value),
  } : null
}
