import assert from "node:assert/strict"
import { test } from "node:test"
import { retiredTemplate, retiredTemplateVersion, retiredWorkflowAttribution, retiredWorkflowSummary } from "./service-retired-workflows.js"

test("retired workflow responses expose attribution without executable or private archive data", () => {
  const archive = {
    retiredAt: "2026-10-22T00:00:00.000Z",
    template: { id: "template", name: "Original workflow", draftDefinition: { secret: true } },
    version: { id: "version", versionNumber: 3, definition: { nodes: ["send"] } },
    run: { status: "WAITING", resumeAt: "2026-11-01T00:00:00.000Z", variables: { private: true }, leaseToken: "secret" },
    nodeExecutions: [{ input: "private" }],
  }
  assert.deepEqual(retiredTemplate(archive), { id: "template", name: "Original workflow" })
  assert.deepEqual(retiredTemplateVersion(archive), { id: "version", versionNumber: 3 })
  const summary = retiredWorkflowSummary(archive)!
  assert.equal(summary.hadUnfinishedWork, true)
  assert.equal(summary.previousScheduledAt, archive.run.resumeAt)
  assert.match(summary.notice, /manually/)
  const attribution = retiredWorkflowAttribution(archive)!
  for (const result of [summary, attribution]) {
    assert.doesNotMatch(JSON.stringify(result), /secret|definition|nodeExecutions|variables|leaseToken/i)
  }
  assert.equal(retiredWorkflowSummary({ run: { status: "COMPLETED" } })?.hadUnfinishedWork, false)
})

test("retired attribution tolerates missing and malformed historical records", () => {
  for (const value of [null, undefined, [], "archive"]) {
    assert.equal(retiredWorkflowSummary(value), null)
    assert.equal(retiredWorkflowAttribution(value), null)
  }
  assert.equal(retiredTemplate({ template: { id: 42, name: "broken" } }), null)
  assert.equal(retiredTemplateVersion({ version: { id: "v", versionNumber: "3" } }), null)
  assert.equal(retiredWorkflowSummary({ template: null })?.previousStatus, null)
})
