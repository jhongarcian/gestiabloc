import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  SERVICE_TRANSACTION_SEARCH_MAX_LENGTH,
  SERVICE_TRANSACTION_SORTS,
  ServiceTransactionAmountCentsSchema,
  ServiceTransactionDateOnlySchema,
  ServiceTransactionIdSchema,
  ServiceTransactionNotesSchema,
  ServiceTransactionPaymentNoteSchema,
  ServiceTransactionPositiveAmountCentsSchema,
  ServiceTransactionSortSchema,
  getServiceTransactionContactName,
  getServiceTransactionFinancials,
  getServiceTransactionPaymentValidationError,
  getServiceTransactionPaymentState,
  sanitizeServiceTransactionSearch,
  sanitizeServiceTransactionMultilineText,
} from "./service-transactions.js"

describe("service transaction presentation", () => {
  test("accepts only supported transaction sort values", () => {
    for (const sort of SERVICE_TRANSACTION_SORTS) {
      assert.equal(ServiceTransactionSortSchema.parse(sort), sort)
    }
    assert.equal(ServiceTransactionSortSchema.safeParse("UNKNOWN").success, false)
  })

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

  test("validates full and partial payments against service rules", () => {
    const validate = (paymentAmountCents: number, overrides = {}) =>
      getServiceTransactionPaymentValidationError({
        totalPriceCents: 10_000,
        alreadyPaidCents: 2_000,
        paymentAmountCents,
        allowPartialPayments: true,
        minimumPartialPaymentCents: 1_000,
        ...overrides,
      })

    assert.equal(validate(8_000), null)
    assert.equal(validate(0), null)
    assert.equal(validate(8_001), "PAYMENT_EXCEEDS_SERVICE_TOTAL")
    assert.equal(validate(500), "PAYMENT_BELOW_MINIMUM")
    assert.equal(
      validate(1_000, { allowPartialPayments: false }),
      "SERVICE_DOES_NOT_ALLOW_PARTIAL_PAYMENTS",
    )
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

  test("sanitizes transaction notes before validating their stored length", () => {
    assert.equal(
      sanitizeServiceTransactionMultilineText(
        " <script>Payment</script>\u0000\n  second\tline ",
      ),
      "Payment\nsecond line",
    )
    assert.equal(
      ServiceTransactionNotesSchema.parse(" <b>Transaction note</b> "),
      "Transaction note",
    )
    assert.equal(ServiceTransactionNotesSchema.parse(" <b></b> "), null)
    assert.equal(
      ServiceTransactionPaymentNoteSchema.safeParse("a".repeat(1001)).success,
      false,
    )
  })

  test("requires exact numeric amounts, UUID identifiers, and real calendar dates", () => {
    assert.equal(ServiceTransactionAmountCentsSchema.parse(0), 0)
    assert.equal(ServiceTransactionPositiveAmountCentsSchema.parse(1), 1)
    assert.equal(ServiceTransactionAmountCentsSchema.safeParse("100").success, false)
    assert.equal(ServiceTransactionPositiveAmountCentsSchema.safeParse(0).success, false)
    assert.equal(ServiceTransactionAmountCentsSchema.safeParse(1_000_000_001).success, false)
    assert.equal(
      ServiceTransactionIdSchema.parse(" 550e8400-e29b-41d4-a716-446655440000 "),
      "550e8400-e29b-41d4-a716-446655440000",
    )
    assert.equal(ServiceTransactionIdSchema.safeParse("../../service").success, false)
    assert.equal(ServiceTransactionDateOnlySchema.parse("2026-02-28"), "2026-02-28")
    assert.equal(ServiceTransactionDateOnlySchema.safeParse("2026-02-31").success, false)
  })
})
