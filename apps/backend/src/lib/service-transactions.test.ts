import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  getServiceTransactionContactName,
  getServiceTransactionFinancials,
  getServiceTransactionPaymentState,
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
})
