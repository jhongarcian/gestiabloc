import assert from "node:assert/strict"
import { test } from "node:test"
import { replyWordEnds, revealedReplyWords } from "./ai-reply-reveal"

test("word reveal preserves bilingual text, punctuation, paragraphs and original whitespace", () => {
  const text = "  Anthony needs ID.\n\nÉl debe traer:\n• identificación  original.  "
  const ends = replyWordEnds(text)
  assert.equal(text.slice(0, ends[0]), "  Anthony ")
  assert.equal(text.slice(0, ends.at(-1)), text)
  for (const end of ends) assert.ok(end === text.length || /\s/u.test(text[end - 1]!))
  assert.deepEqual(replyWordEnds("\n  "), [])
})
test("long replies finish within eight seconds and progress never splits or drops a word", () => {
  for (const total of [0, 1, 40, 1000]) {
    const steps = [0, 32, 100, 1000, 4000, 8000].map(ms => revealedReplyWords(total, ms))
    assert.equal(steps.at(-1), total)
    assert.deepEqual(steps, [...steps].sort((a, b) => a - b))
    assert.ok(steps.every(step => step >= 0 && step <= total))
  }
})
