import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  TRANSACTION_CONTACT_SEARCH_MAX_LENGTH,
  TRANSACTION_NOTES_MAX_LENGTH,
  TRANSACTION_PAYMENT_NOTE_MAX_LENGTH,
  parseTransactionMoneyToCents,
  sanitizePaymentEntryMode,
  sanitizeTransactionContactSearch,
  sanitizeTransactionId,
  sanitizeTransactionMoneyInput,
  sanitizeTransactionMultilineInput,
  sanitizeTransactionPaymentMethod,
  sanitizeTransactionPaymentMode,
  sanitizeTransactionSingleLineInput,
} from "./transaction-inputs.js"

describe("transaction input sanitization", () => {
  test("normalizes searches and removes markup and invisible controls", () => {
    assert.equal(
      sanitizeTransactionContactSearch("  <b>Ａｄａ</b>\u0000\n Lovelace\u200B "),
      "Ada Lovelace",
    )
    assert.equal(
      sanitizeTransactionSingleLineInput("a".repeat(200)).length,
      TRANSACTION_CONTACT_SEARCH_MAX_LENGTH,
    )
  })

  test("cleans and bounds transaction notes", () => {
    assert.equal(
      sanitizeTransactionMultilineInput(" <script>note</script>\u0000\n  second\tline ", 100),
      "note \nsecond line ",
    )
    assert.equal(
      sanitizeTransactionMultilineInput("a".repeat(5000), TRANSACTION_NOTES_MAX_LENGTH).length,
      TRANSACTION_NOTES_MAX_LENGTH,
    )
    assert.equal(
      sanitizeTransactionMultilineInput(
        "a".repeat(2000),
        TRANSACTION_PAYMENT_NOTE_MAX_LENGTH,
      ).length,
      TRANSACTION_PAYMENT_NOTE_MAX_LENGTH,
    )
  })

  test("accepts only a strict currency value within the server limit", () => {
    assert.equal(sanitizeTransactionMoneyInput(" $1,234.567xyz "), "1234.56")
    assert.equal(parseTransactionMoneyToCents("1,234.56"), 123_456)
    assert.equal(parseTransactionMoneyToCents("12abc"), null)
    assert.equal(parseTransactionMoneyToCents("1.234"), null)
    assert.equal(parseTransactionMoneyToCents("10000000.00"), 1_000_000_000)
    assert.equal(parseTransactionMoneyToCents("10000000.01"), null)
    assert.equal(sanitizeTransactionMoneyInput("100000000"), "100000000")
    assert.equal(parseTransactionMoneyToCents("100000000"), null)
  })

  test("allowlists identifiers and fixed-choice values", () => {
    assert.equal(
      sanitizeTransactionId(" 550E8400-E29B-41D4-A716-446655440000 "),
      "550e8400-e29b-41d4-a716-446655440000",
    )
    assert.equal(sanitizeTransactionId("../../services"), "")
    assert.equal(sanitizeTransactionPaymentMethod("CARD"), "CARD")
    assert.equal(sanitizeTransactionPaymentMethod("WIRE"), "")
    assert.equal(sanitizeTransactionPaymentMode("PARTIAL"), "PARTIAL")
    assert.equal(sanitizeTransactionPaymentMode("UNKNOWN"), "FULL")
    assert.equal(sanitizePaymentEntryMode("PARTIAL"), "PARTIAL")
    assert.equal(sanitizePaymentEntryMode("LATER"), "FULL")
  })
})
