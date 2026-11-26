import assert from "node:assert/strict"
import { test } from "node:test"
import { AiActivityTracker } from "./ai-activity-tracking"
import { aiCreditErrorMessage, releaseTerminalAiAttempt } from "./ai-credit-errors"
const failure = (error: string) => ({ isAxiosError: true, response: { data: { error } } })
test("retry identities survive ambiguous errors but terminal conflicts allow a new explicit request", () => {
  let count = 0
  const tracker = new AiActivityTracker(() => `id-${++count}`)
  const first = tracker.forRequest("question")
  for (const error of [new Error("network"), failure("AI_BILLING_UNAVAILABLE"), failure("AI_REQUEST_IN_PROGRESS")]) {
    releaseTerminalAiAttempt(tracker, first.requestId, error)
    assert.deepEqual(tracker.forRequest("question"), first)
  }
  releaseTerminalAiAttempt(tracker, first.requestId, failure("AI_RESPONSE_EXPIRED"))
  assert.notEqual(tracker.forRequest("question").requestId, first.requestId)
  assert.match(aiCreditErrorMessage(failure("AI_CREDITS_EXHAUSTED"))!, /no AI credits/)
  assert.equal(aiCreditErrorMessage(new Error("network")), undefined)
})
