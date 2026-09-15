import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  SERVICE_TRANSACTION_SEARCH_MAX_LENGTH,
  getServiceTransactionContactName,
  getServiceTransactionFinancials,
  getServiceTransactionPaymentState,
  sanitizeServiceTransactionSearch,
} from "./service-transactions.js"

describe("service transaction presentation", () => {
  test("derives payment state from the sale total and collected amount", () => {
    assert.equal(getServiceTransactionPaymentState(10_000, 0), "UNPAID")
    assert.equal(getServiceTransactionPaymentState(10_000, 2_500), "PARTIAL")
    assert.equal(getServiceTransactionPaymentState(10_000, 10_000), "PAID")
    assert.equal(getServiceTransactionPaymentState(10_000, 12_000), "PAID")
    assert.equal(getServiceTransactionPaymentState(0, 0), "PAID")
  })

  test("builds a readable contact name without blank segments", () => {
    assert.equal(
      getServiceTransactionContactName({
        firstName: " Ada ",
        middleName: null,
        lastName: " Lovelace ",
      }),
      "Ada Lovelace",
    )
    assert.equal(getServiceTransactionContactName({}), "Unnamed contact")
  })

  test("computes collected and remaining amounts without a negative balance", () => {
    assert.deepEqual(
      getServiceTransactionFinancials(10_000, [
        { amountCents: 2_500 },
        { amountCents: 1_500 },
      ]),
      {
        paidCents: 4_000,
        remainingCents: 6_000,
        paymentState: "PARTIAL",
      },
    )
    assert.deepEqual(getServiceTransactionFinancials(10_000, [{ amountCents: 12_000 }]), {
      paidCents: 12_000,
      remainingCents: 0,
      paymentState: "PAID",
    })
  })

  test("sanitizes transaction search values without removing useful punctuation", () => {
    assert.equal(
      sanitizeServiceTransactionSearch("  Ada\u0000\n  Lovelace\u200B  "),
      "Ada Lovelace",
    )
    assert.equal(sanitizeServiceTransactionSearch("ＡＣＭＥ"), "ACME")
    assert.equal(
      sanitizeServiceTransactionSearch("O'Brien +1 (312) ada@example.com"),
      "O'Brien +1 (312) ada@example.com",
    )
    assert.equal(
      sanitizeServiceTransactionSearch("a".repeat(SERVICE_TRANSACTION_SEARCH_MAX_LENGTH + 20))
        .length,
      SERVICE_TRANSACTION_SEARCH_MAX_LENGTH,
    )
  })
})
