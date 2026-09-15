import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  TRANSACTION_SEARCH_MAX_LENGTH,
  sanitizeTransactionSearchInput,
  sanitizeTransactionSearchQuery,
} from "./transaction-search.js"

describe("transaction search sanitization", () => {
  test("normalizes pasted text and removes invisible control characters", () => {
    assert.equal(
      sanitizeTransactionSearchQuery("  Ada\u0000\n  Lovelace\u200B  "),
      "Ada Lovelace",
    )
    assert.equal(sanitizeTransactionSearchQuery("ＡＣＭＥ"), "ACME")
  })

  test("preserves useful contact-search punctuation", () => {
    const value = "O'Brien +1 (312) 555-0100 ada@example.com"

    assert.equal(sanitizeTransactionSearchQuery(value), value)
  })

  test("keeps a trailing typing space in the input but not in the committed query", () => {
    assert.equal(sanitizeTransactionSearchInput("Ada "), "Ada ")
    assert.equal(sanitizeTransactionSearchQuery("Ada "), "Ada")
  })

  test("caps search input length", () => {
    assert.equal(
      sanitizeTransactionSearchInput("a".repeat(TRANSACTION_SEARCH_MAX_LENGTH + 20)).length,
      TRANSACTION_SEARCH_MAX_LENGTH,
    )
  })
})
