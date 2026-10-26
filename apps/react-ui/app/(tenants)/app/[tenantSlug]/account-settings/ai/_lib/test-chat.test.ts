import assert from "node:assert/strict"
import { test } from "node:test"
import { chatHistory, type AiTestTurn } from "./test-chat"
const turn = (question: string, answer: string): AiTestTurn => ({
  question,
  reply: {
    id: question,
    answer,
    helper: { name: "Helper", language: "English", tone: "Warm", revision: 0 },
    sources: [],
    context: { skillCount: 0, limited: false },
  },
})
test("chat history keeps recent complete pairs in chronological order", () => {
  const history = chatHistory(
    Array.from({ length: 10 }, (_, index) =>
      turn(`Question ${index}`, `Answer ${index}`),
    ),
  )
  assert.equal(history.length, 12)
  assert.deepEqual(history[0], { role: "user", content: "Question 4" })
  assert.deepEqual(history.at(-1), { role: "assistant", content: "Answer 9" })
})
test("chat history respects the request budget without splitting pairs or mutating messages", () => {
  const turns = [
    turn("First", "x".repeat(6000)),
    turn("Second", "y".repeat(6000)),
  ]
  const history = chatHistory(turns)
  assert.equal(history.length, 2)
  assert.equal(history[0].content, "Second")
  assert.equal(turns.length, 2)
  assert.deepEqual(chatHistory([]), [])
})
