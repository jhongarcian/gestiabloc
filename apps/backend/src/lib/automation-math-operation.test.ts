import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  AutomationMathOperationConfigSchema,
  resolveAutomationMathOperation,
} from "./automation-math-operation.js"
import { shiftCalendarDate } from "./calendar-date.js"

const runtimeBase = {
  tenantId: "tenant-1",
  contactId: "contact-1",
  tenantTimezone: "America/Chicago",
  occurredAt: new Date("2026-09-26T18:30:00.000Z"),
}

describe("automation Math operation", () => {
  test("validates number and date configurations", () => {
    assert.equal(AutomationMathOperationConfigSchema.safeParse({
      mode: "NUMBER",
      source: { type: "AUTOMATION_VALUE", key: "premium" },
      operation: "MULTIPLY",
      operand: 1.25,
      outputKey: "adjusted_premium",
    }).success, true)
    assert.equal(AutomationMathOperationConfigSchema.safeParse({
      mode: "DATE",
      source: { type: "CUSTOM_FIELD", key: "renewal_date" },
      operation: "SUBTRACT",
      amount: 2,
      unit: "MONTHS",
      outputKey: "notice_date",
    }).success, true)
    assert.equal(AutomationMathOperationConfigSchema.safeParse({
      mode: "NUMBER",
      source: { type: "AUTOMATION_VALUE", key: "premium" },
      operation: "DIVIDE",
      operand: 0,
      outputKey: "adjusted_premium",
    }).success, false)
    assert.equal(AutomationMathOperationConfigSchema.safeParse({
      mode: "DATE",
      source: { type: "CUSTOM_FIELD", key: "renewal_date" },
      operation: "ADD",
      amount: 1.5,
      unit: "DAYS",
      outputKey: "notice_date",
    }).success, false)
  })

  test("calculates finite numbers from earlier automation values", async () => {
    const prismaTx = {}
    assert.equal(await resolveAutomationMathOperation(prismaTx, {
      ...runtimeBase,
      config: {
        mode: "NUMBER",
        source: { type: "AUTOMATION_VALUE", key: "premium" },
        operation: "ADD",
        operand: -25.5,
        outputKey: "adjusted_premium",
      },
      automationValues: { premium: 100 },
    }), 74.5)
    assert.equal(await resolveAutomationMathOperation(prismaTx, {
      ...runtimeBase,
      config: {
        mode: "NUMBER",
        source: { type: "AUTOMATION_VALUE", key: "premium" },
        operation: "MULTIPLY",
        operand: 0,
        outputKey: "adjusted_premium",
      },
      automationValues: { premium: 100 },
    }), 0)
    await assert.rejects(
      resolveAutomationMathOperation(prismaTx, {
        ...runtimeBase,
        config: {
          mode: "NUMBER",
          source: { type: "AUTOMATION_VALUE", key: "missing" },
          operation: "ADD",
          operand: 1,
          outputKey: "result",
        },
        automationValues: {},
      }),
      /was not created/,
    )
  })

  test("resolves live safe numeric and date fields", async () => {
    const prismaTx: any = {
      contact: {
        findFirst: async () => ({
          firstName: "Taylor",
          middleName: null,
          lastName: "Reed",
          dateOfBirth: new Date("1990-04-05T00:00:00.000Z"),
          customFieldValues: [
            {
              value: 2500,
              field: {
                key: "premium",
                fieldType: "CURRENCY",
                isActive: true,
                isEncrypted: false,
                isSensitive: false,
              },
            },
            {
              value: "2024-02-29",
              field: {
                key: "renewal_date",
                fieldType: "DATE",
                isActive: true,
                isEncrypted: false,
                isSensitive: false,
              },
            },
          ],
        }),
      },
    }
    assert.equal(await resolveAutomationMathOperation(prismaTx, {
      ...runtimeBase,
      config: {
        mode: "NUMBER",
        source: { type: "CUSTOM_FIELD", key: "premium" },
        operation: "DIVIDE",
        operand: 2,
        outputKey: "half_premium",
      },
      automationValues: {},
    }), 1250)
    assert.equal(await resolveAutomationMathOperation(prismaTx, {
      ...runtimeBase,
      config: {
        mode: "DATE",
        source: { type: "CUSTOM_FIELD", key: "renewal_date" },
        operation: "ADD",
        amount: 1,
        unit: "YEARS",
        outputKey: "next_renewal",
      },
      automationValues: {},
    }), "2025-02-28")

    prismaTx.contact.findFirst = async () => ({
      firstName: "Taylor",
      middleName: null,
      lastName: "Reed",
      customFieldValues: [
        {
          value: "",
          field: {
            key: "premium",
            fieldType: "CURRENCY",
            isActive: true,
            isEncrypted: false,
            isSensitive: false,
          },
        },
      ],
    })
    await assert.rejects(
      resolveAutomationMathOperation(prismaTx, {
        ...runtimeBase,
        config: {
          mode: "NUMBER",
          source: { type: "CUSTOM_FIELD", key: "premium" },
          operation: "ADD",
          operand: 1,
          outputKey: "adjusted_premium",
        },
        automationValues: {},
      }),
      /source is empty/,
    )
  })

  test("uses DST-safe calendar math and clamps month and year ends", () => {
    assert.equal(shiftCalendarDate("2026-03-07", 2, "DAYS"), "2026-03-09")
    assert.equal(shiftCalendarDate("2026-01-31", 1, "MONTHS"), "2026-02-28")
    assert.equal(shiftCalendarDate("2024-02-29", 1, "YEARS"), "2025-02-28")
    assert.equal(shiftCalendarDate("2026-01-31", -2, "MONTHS"), "2025-11-30")
    assert.equal(shiftCalendarDate("0001-01-01", -1, "DAYS"), null)
  })
})
