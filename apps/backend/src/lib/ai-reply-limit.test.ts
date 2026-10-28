import assert from "node:assert/strict"
import { test } from "node:test"
import { AiReplyLimit } from "./ai-reply-limit.js"

test("reply cost guard prevents overlap and enforces ten requests per minute without affecting another actor", () => {
  const limit = new AiReplyLimit()
  const first = limit.acquire("tenant:actor", 1)
  assert.ok(first)
  assert.equal(limit.acquire("tenant:actor", 1), null)
  first()
  for (let index = 1; index < 10; index++) {
    const release = limit.acquire("tenant:actor", 1)
    assert.ok(release)
    release()
  }
  assert.equal(limit.acquire("tenant:actor", 1), null)
  assert.ok(limit.acquire("tenant:another-actor", 1))
  assert.ok(limit.acquire("tenant:actor", 60001))
})
