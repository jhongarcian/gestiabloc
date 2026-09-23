import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  AUTOMATION_PROCESS_BATCH_SIZE,
  getAutomationProcessBatchCount,
} from "./automation-process-batches.js"

describe("automation process batches", () => {
  test("uses batches of exactly 100 contacts", () => {
    assert.equal(AUTOMATION_PROCESS_BATCH_SIZE, 100)
    assert.equal(getAutomationProcessBatchCount(1), 1)
    assert.equal(getAutomationProcessBatchCount(100), 1)
    assert.equal(getAutomationProcessBatchCount(101), 2)
    assert.equal(getAutomationProcessBatchCount(1_001), 11)
  })

  test("rejects invalid contact totals", () => {
    assert.equal(getAutomationProcessBatchCount(0), 0)
    assert.equal(getAutomationProcessBatchCount(-1), 0)
    assert.equal(getAutomationProcessBatchCount(1.5), 0)
  })
})
