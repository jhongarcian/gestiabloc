import assert from "node:assert/strict"
import { test } from "node:test"
import { AiActivityTracker } from "./ai-activity-tracking"

test("failed retries reuse identity; successful repeat questions and new conversations get fresh IDs", () => {
  let sequence = 0
  const tracker = new AiActivityTracker(() => `id-${++sequence}`)
  const first = tracker.forRequest("question:1")
  assert.deepEqual(tracker.forRequest("question:1"), first)
  const edited = tracker.forRequest("question:2")
  assert.equal(edited.conversationId, first.conversationId)
  assert.notEqual(edited.requestId, first.requestId)
  tracker.complete(first.requestId)
  assert.deepEqual(tracker.forRequest("question:2"), edited)
  tracker.complete(edited.requestId)
  assert.notEqual(tracker.forRequest("question:2").requestId, edited.requestId)
  tracker.newConversation()
  assert.notEqual(tracker.forRequest("question:2").conversationId, first.conversationId)
})
