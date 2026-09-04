import assert from "node:assert/strict"
import test from "node:test"

import {
  NoteTextInputSchema,
  sanitizeNoteBody,
  sanitizeNoteTitle,
} from "./note-inputs.js"

test("sanitizeNoteTitle stores a single plain-text line", () => {
  assert.equal(
    sanitizeNoteTitle("  <strong>Policy</strong>\u0000   renewal\ncall  "),
    "Policy renewal call",
  )
})

test("sanitizeNoteBody removes markup and unsafe controls while preserving lines", () => {
  assert.equal(
    sanitizeNoteBody(
      " <p>First   line</p>\r\n\rSecond\u0007   line\n  <em>Third</em> ",
    ),
    "First line\n\nSecond line\nThird",
  )
})

test("NoteTextInputSchema returns sanitized note values", () => {
  assert.deepEqual(
    NoteTextInputSchema.parse({
      title: " <b>Next</b>   steps ",
      body: " Call   the contact\r\n <i>Confirm</i> coverage ",
    }),
    {
      title: "Next steps",
      body: "Call the contact\nConfirm coverage",
    },
  )
})

test("NoteTextInputSchema rejects values that become empty after sanitization", () => {
  const result = NoteTextInputSchema.safeParse({
    title: "<span></span>",
    body: "<div></div>",
  })

  assert.equal(result.success, false)
  if (!result.success) {
    assert.deepEqual(
      result.error.issues.map((issue) => issue.path[0]),
      ["title", "body"],
    )
  }
})
