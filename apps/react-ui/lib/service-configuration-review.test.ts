import assert from "node:assert/strict"
import { test } from "node:test"
import { configurationReviewError, configurationReviewValue } from "./service-configuration-review"

test("configuration comparison renders complete nested action and filter values in readable terms", () => {
  const result = configurationReviewValue({ id: "private-row-id", title: "Review", completionDuration: 20, completionUnit: "DAYS", isRequired: false, actions: [{ nodeKey: "node", type: "SET_SERVICE_CHECKLIST_STATUS", serviceConfig: { checklistItemId: "source-id", status: "RECEIVED" } }] })
  assert.match(result, /Timeframe: 20/)
  assert.match(result, /Unit: Days/)
  assert.match(result, /Required: No/)
  assert.match(result, /Type: Set service checklist status/)
  assert.match(result, /Checklist item: source-id/)
  assert.doesNotMatch(result, /private-row-id|Node key/)
  assert.equal(configurationReviewValue(null), "None")
})
test("stale and expired reviews have actionable errors without claiming a timed-out update rolled back", () => {
  assert.match(configurationReviewError("CONFIGURATION_PREVIEW_STALE"), /changed.*Review/)
  assert.match(configurationReviewError("CONFIGURATION_PREVIEW_EXPIRED"), /expired/)
  assert.match(configurationReviewError(null), /could not confirm/)
})
