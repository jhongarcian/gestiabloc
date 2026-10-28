import assert from "node:assert/strict"
import { test } from "node:test"
import { configurationDigest } from "./service-configuration-digest.js"
import { readSavedServiceAutomations } from "./service-automation-snapshots.js"

test("review digests canonicalize object order and dates but detect changed order, values and nulls", () => {
  assert.equal(configurationDigest({ a: 1, b: new Date("2026-01-01Z") }), configurationDigest({ b: "2026-01-01T00:00:00.000Z", a: 1 }))
  assert.notEqual(configurationDigest([1, 2]), configurationDigest([2, 1]))
  assert.notEqual(configurationDigest({ a: null }), configurationDigest({}))
})
test("only absent saved workflows use compatibility behavior; malformed snapshots never fall back live", () => {
  assert.equal(readSavedServiceAutomations({ schemaVersion: 1 }), null)
  assert.deepEqual(readSavedServiceAutomations({ serviceAutomations: { schemaVersion: 1, definitions: [] } }), { schemaVersion: 1, definitions: [] })
  assert.throws(() => readSavedServiceAutomations({ serviceAutomations: { definitions: [] } }))
})
