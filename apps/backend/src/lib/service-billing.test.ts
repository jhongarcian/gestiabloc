import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  allocateServicePayments,
  buildServicePaymentPlan,
  installmentDate,
  legacyPaymentFields,
  resolvePaymentSettings,
  reviseServicePaymentPlan,
  ServicePaymentSettingsSchema,
  ServicePaymentTermsSchema,
  summarizeServiceBilling,
  tenantDateOnly,
} from "./service-billing.js"

const settings = ServicePaymentSettingsSchema.parse({
  schemaVersion: 1,
  enabledTypes: ["SINGLE_PAYMENT", "INSTALLMENTS", "FLEXIBLE"],
  defaultType: "INSTALLMENTS",
  suggestedDepositCents: 20000,
  installmentCount: 4,
  installmentFrequency: "MONTHLY",
})
const build = (
  overrides: Partial<Parameters<typeof buildServicePaymentPlan>[0]> = {},
) =>
  buildServicePaymentPlan({
    totalPriceCents: 100000,
    initialPaymentCents: 20000,
    settings,
    terms: { type: "INSTALLMENTS", firstDueDate: "2026-11-22" },
    today: "2026-10-22",
    ...overrides,
  })
const summary = (
  paidCents: number,
  overrides: Partial<Parameters<typeof summarizeServiceBilling>[0]> = {},
) =>
  summarizeServiceBilling({
    totalPriceCents: 100000,
    paidCents,
    currency: "USD",
    paymentType: "INSTALLMENTS",
    financialRevision: 1,
    dues: build().dues.map((row, i) => ({ ...row, id: String(i) })),
    today: "2026-11-23",
    status: "PENDING_PAYMENT",
    ...overrides,
  })

describe("saved service billing", () => {
  test("creates a deposit and four real future obligations", () => {
    assert.deepEqual(
      build().dues.map((row) => [row.amountCents, row.dueDate]),
      [
        [20000, "2026-10-22"],
        [20000, "2026-11-22"],
        [20000, "2026-12-22"],
        [20000, "2027-01-22"],
        [20000, "2027-02-22"],
      ],
    )
  })
  test("two small receipts satisfy one installment without moving future dates", () => {
    const split = summary(20000 + 7500 + 12500)
    assert.deepEqual(
      split.schedule.map((row) => row.remainingCents),
      [0, 0, 20000, 20000, 20000],
    )
    assert.equal(split.nextDueDate, "2026-12-22")
    assert.equal(split.nextDueCents, 20000)
    assert.equal(split.overdueCents, 0)
  })
  test("small and extra payments cover obligations oldest first", () => {
    assert.deepEqual(
      summary(27500).schedule.map((row) => row.remainingCents),
      [0, 12500, 20000, 20000, 20000],
    )
    assert.equal(summary(27500).overdueCents, 12500)
    assert.deepEqual(
      summary(75000).schedule.map((row) => row.remainingCents),
      [0, 0, 0, 5000, 20000],
    )
    assert.equal(summary(100000).nextDueDate, null)
    assert.equal(summary(100000).paymentState, "PAID")
  })
  test("always allows zero upfront and accepts one future installment", () => {
    const result = build({
      initialPaymentCents: 0,
      terms: { type: "INSTALLMENTS", installmentCount: 1 },
    })
    assert.equal(result.dues.length, 1)
    assert.equal(result.dues[0].amountCents, 100000)
  })
  test("places rounding remainder in the final installment", () => {
    const result = build({
      totalPriceCents: 10001,
      initialPaymentCents: 0,
      terms: { type: "INSTALLMENTS", installmentCount: 3 },
    })
    assert.deepEqual(
      result.dues.map((row) => row.amountCents),
      [3333, 3333, 3335],
    )
    assert.equal(
      result.dues.reduce((sum, row) => sum + row.amountCents, 0),
      10001,
    )
  })
  test("monthly dates retain their anchor across short months and leap years", () => {
    assert.equal(installmentDate("2027-01-31", "MONTHLY", 1), "2027-02-28")
    assert.equal(installmentDate("2027-01-31", "MONTHLY", 2), "2027-03-31")
    assert.equal(installmentDate("2028-01-31", "MONTHLY", 1), "2028-02-29")
    assert.equal(installmentDate("2026-12-25", "WEEKLY", 2), "2027-01-08")
    assert.equal(installmentDate("2026-12-25", "BIWEEKLY", 2), "2027-01-22")
  })
  test("default monthly terms retain the purchase-day anchor after a clamped first due date", () => {
    const result = build({
      initialPaymentCents: 0,
      terms: { type: "INSTALLMENTS", installmentCount: 3 },
      today: "2027-01-31",
    })
    assert.deepEqual(
      result.dues.map((due) => due.dueDate),
      ["2027-02-28", "2027-03-31", "2027-04-30"],
    )
    const savedPreviewTerms = build({
      initialPaymentCents: 0,
      today: "2027-01-31",
      terms: {
        type: "INSTALLMENTS",
        installmentCount: 3,
        firstDueDate: "2027-02-28",
        monthlyAnchorDay: 31,
      },
    })
    assert.deepEqual(savedPreviewTerms.dues, result.dues)
  })
  test("flexible balances have no dates or invented overdue amounts", () => {
    const dues = build({ terms: { type: "FLEXIBLE" } }).dues.map((row, i) => ({
      ...row,
      id: String(i),
    }))
    const result = summary(20000, { paymentType: "FLEXIBLE", dues })
    assert.equal(result.nextDueDate, null)
    assert.equal(result.overdueCents, 0)
    assert.equal(result.schedule[0].remainingCents, 80000)
    assert.equal(result.scheduleNeedsReview, false)
  })
  test("single payment describes a due obligation rather than forbidding partial receipts", () => {
    const dues = build({
      initialPaymentCents: 0,
      terms: { type: "SINGLE_PAYMENT", firstDueDate: "2026-11-23" },
    }).dues.map((row, i) => ({ ...row, id: String(i) }))
    const result = summary(5000, { paymentType: "SINGLE_PAYMENT", dues })
    assert.equal(result.dueTodayCents, 95000)
    assert.equal(result.overdueCents, 0)
    assert.equal(result.schedule[0].state, "PARTIAL")
  })
  test("legacy accounts keep settlement and work labels without inferred due dates", () => {
    const result = summary(20000, { paymentType: null, dues: [] })
    assert.equal(result.scheduleNeedsReview, true)
    assert.equal(result.nextDueDate, null)
    assert.equal(result.workState, "FINISHED")
    assert.equal(
      summary(100000, { paymentType: null, dues: [] }).scheduleNeedsReview,
      false,
    )
    assert.equal(
      summary(20000, { status: "IN_PROGRESS" }).workState,
      "IN_PROGRESS",
    )
  })
  test("revisions retain funded portions and replace only the unpaid balance", () => {
    const original = allocateServicePayments(build().dues, 35000)
    const revised = reviseServicePaymentPlan({
      totalPriceCents: 100000,
      paidCents: 35000,
      dues: original,
      settings,
      terms: {
        type: "INSTALLMENTS",
        installmentCount: 2,
        firstDueDate: "2027-02-01",
      },
      today: "2026-12-01",
    })
    assert.deepEqual(
      revised.dues.map((row) => row.amountCents),
      [20000, 15000, 32500, 32500],
    )
    assert.deepEqual(
      revised.dues.map((row) => row.dueDate),
      ["2026-10-22", "2026-11-22", "2027-02-01", "2027-03-01"],
    )
    // Correcting a receipt from before revision reopens a retained earlier obligation.
    const corrected = allocateServicePayments(revised.dues, 25000)
    assert.deepEqual(
      corrected.map((row) => row.remainingCents),
      [0, 10000, 32500, 32500],
    )
    assert.equal(
      corrected.reduce((sum, row) => sum + row.remainingCents, 0),
      75000,
    )
  })
  test("reviewing legacy arrangements preserves historical payments without assigning invented dates", () => {
    const revised = reviseServicePaymentPlan({
      totalPriceCents: 100000,
      paidCents: 20000,
      dues: [],
      settings,
      terms: { type: "FLEXIBLE" },
      today: "2026-10-22",
    })
    assert.deepEqual(
      revised.dues.map((row) => [row.amountCents, row.dueDate]),
      [
        [20000, null],
        [80000, null],
      ],
    )
  })
  test("rejects invalid options, impossible cent splits, counts, and calendar dates", () => {
    assert.throws(
      () => build({ initialPaymentCents: 100001 }),
      /INVALID_INITIAL_PAYMENT/,
    )
    assert.throws(
      () =>
        build({ settings: { ...settings, enabledTypes: ["SINGLE_PAYMENT"] } }),
      /PAYMENT_OPTION_NOT_ENABLED/,
    )
    assert.throws(
      () =>
        build({
          totalPriceCents: 2,
          initialPaymentCents: 0,
          terms: { type: "INSTALLMENTS", installmentCount: 3 },
        }),
      /INVALID_INSTALLMENT_COUNT/,
    )
    assert.equal(
      ServicePaymentTermsSchema.safeParse({
        type: "INSTALLMENTS",
        installmentCount: 121,
      }).success,
      false,
    )
    assert.equal(
      ServicePaymentTermsSchema.safeParse({
        type: "SINGLE_PAYMENT",
        firstDueDate: "2026-02-31",
      }).success,
      false,
    )
    assert.equal(
      ServicePaymentSettingsSchema.safeParse({
        ...settings,
        defaultType: "FLEXIBLE",
        enabledTypes: ["SINGLE_PAYMENT"],
      }).success,
      false,
    )
  })
  test("resolves legacy settings without enabling unrelated options", () => {
    assert.deepEqual(
      resolvePaymentSettings({ allowPartialPayments: false }).enabledTypes,
      ["SINGLE_PAYMENT"],
    )
    assert.deepEqual(
      resolvePaymentSettings({
        allowPartialPayments: true,
        installmentCount: 4,
        installmentFrequency: "MONTHLY",
      }).enabledTypes,
      ["SINGLE_PAYMENT", "INSTALLMENTS"],
    )
    assert.deepEqual(legacyPaymentFields(settings), {
      allowPartialPayments: true,
      minimumPartialPaymentCents: 20000,
      installmentCount: 4,
      installmentFrequency: "MONTHLY",
    })
  })
  test("tenant dates respect midnight boundaries and daylight saving time", () => {
    assert.equal(
      tenantDateOnly("America/Chicago", new Date("2026-11-01T04:30:00Z")),
      "2026-10-31",
    )
    assert.equal(
      tenantDateOnly("Pacific/Auckland", new Date("2026-10-22T23:30:00Z")),
      "2026-10-23",
    )
  })
})
