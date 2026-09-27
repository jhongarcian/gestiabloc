import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  AUTOMATION_NUMBER_PHONE_FORMATS,
  AutomationNumberFormatterConfigSchema,
  formatAutomationPhone,
  parseAutomationNumber,
  resolveAutomationNumberFormatter,
} from "./automation-number-formatter.js"

describe("automation number formatter", () => {
  test("validates every supported configuration variant", () => {
    const source = { type: "CONTACT_FIELD", key: "weight" }
    const configs = [
      { mode: "TEXT_TO_NUMBER", source, decimalMark: "PERIOD", outputKey: "weight_value" },
      { mode: "FORMAT_NUMBER", source, decimalMark: "COMMA", groupingStyle: "PERIOD_COMMA", outputKey: "weight_label" },
      { mode: "FORMAT_CURRENCY", source, decimalMark: "PERIOD", currencyCode: "USD", outputKey: "premium" },
      { mode: "FORMAT_PHONE_NUMBER", source: { type: "CONTACT_FIELD", key: "phone" }, countryCode: "+1", phoneFormat: "E164", outputKey: "phone_value" },
      { mode: "RANDOM_NUMBER", min: 1, max: 10, outputKey: "draw_number" },
    ]
    for (const config of configs) {
      assert.equal(AutomationNumberFormatterConfigSchema.safeParse(config).success, true)
    }
    assert.equal(AutomationNumberFormatterConfigSchema.safeParse({
      mode: "RANDOM_NUMBER",
      min: 10,
      max: 1,
      outputKey: "draw_number",
    }).success, false)
  })

  test("parses period and comma decimal marks", () => {
    assert.equal(parseAutomationNumber("1,234,567.89", "PERIOD"), 1_234_567.89)
    assert.equal(parseAutomationNumber("1.234.567,89", "COMMA"), 1_234_567.89)
    assert.throws(() => parseAutomationNumber("not a number", "PERIOD"), /valid number/)
  })

  test("matches all follow-up phone formats", () => {
    const expected = [
      "+15413134664",
      "+1 541-313-4664",
      "541-313-4664",
      "+1 541 313 4664",
      "15413134664",
      "(541) 313-4664",
      "541 313-4664",
      "5413134664",
      "tel:+1-541-313-4664",
      "+1-541-313-4664",
    ]
    assert.deepEqual(
      AUTOMATION_NUMBER_PHONE_FORMATS.map((format) => formatAutomationPhone("5413134664", format, "+1")),
      expected,
    )
    assert.throws(
      () => formatAutomationPhone("123", "E164", "+1"),
      /ten-digit national number/,
    )
  })

  test("formats earlier automation values and uses inclusive random boundaries", async () => {
    const noDatabaseReads = {}
    assert.deepEqual(await resolveAutomationNumberFormatter(noDatabaseReads, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        mode: "FORMAT_NUMBER",
        source: { type: "AUTOMATION_VALUE", key: "raw_total" },
        decimalMark: "PERIOD",
        groupingStyle: "COMMA_PERIOD",
        outputKey: "total",
      },
      automationValues: { raw_total: 1234567.89 },
    }), { status: "CREATED", value: "1,234,567.89" })
    assert.deepEqual(await resolveAutomationNumberFormatter(noDatabaseReads, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: { mode: "RANDOM_NUMBER", min: 7, max: 7, outputKey: "draw" },
      automationValues: {},
    }), { status: "CREATED", value: 7 })
    await assert.rejects(
      resolveAutomationNumberFormatter(noDatabaseReads, {
        tenantId: "tenant-1",
        contactId: "contact-1",
        config: {
          mode: "TEXT_TO_NUMBER",
          source: { type: "AUTOMATION_VALUE", key: "missing" },
          decimalMark: "PERIOD",
          outputKey: "value",
        },
        automationValues: {},
      }),
      /was not created/,
    )
    await assert.rejects(
      resolveAutomationNumberFormatter(noDatabaseReads, {
        tenantId: "tenant-1",
        contactId: "contact-1",
        config: {
          mode: "TEXT_TO_NUMBER",
          source: { type: "AUTOMATION_VALUE", key: "empty" },
          decimalMark: "PERIOD",
          outputKey: "value",
        },
        automationValues: { empty: "" },
      }),
      /is empty/,
    )
  })

  test("resolves live safe contact and custom-field values", async () => {
    const prismaTx = {
      contact: {
        findFirst: async () => ({
          firstName: "Taylor",
          middleName: null,
          lastName: "Reed",
          weight: "1.234,5",
          customFieldValues: [{
            value: 2500,
            field: {
              key: "premium",
              fieldType: "CURRENCY",
              isActive: true,
              isEncrypted: false,
              isSensitive: false,
            },
          }],
        }),
      },
    }
    assert.deepEqual(await resolveAutomationNumberFormatter(prismaTx, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        mode: "TEXT_TO_NUMBER",
        source: { type: "CONTACT_FIELD", key: "weight" },
        decimalMark: "COMMA",
        outputKey: "weight",
      },
      automationValues: {},
    }), { status: "CREATED", value: 1234.5 })
    assert.deepEqual(await resolveAutomationNumberFormatter(prismaTx, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        mode: "FORMAT_CURRENCY",
        source: { type: "CUSTOM_FIELD", key: "premium" },
        decimalMark: "PERIOD",
        currencyCode: "USD",
        outputKey: "premium",
      },
      automationValues: {},
    }), { status: "CREATED", value: "$2,500.00" })
  })

  test("treats empty contact and custom fields as successful no-ops", async () => {
    const prismaTx = {
      contact: {
        findFirst: async () => ({
          firstName: "Taylor",
          middleName: null,
          lastName: "Reed",
          weight: "   ",
          customFieldValues: [{
            value: null,
            field: {
              key: "premium",
              fieldType: "CURRENCY",
              isActive: true,
              isEncrypted: false,
              isSensitive: false,
            },
          }],
        }),
      },
    }

    assert.deepEqual(await resolveAutomationNumberFormatter(prismaTx, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        mode: "FORMAT_NUMBER",
        source: { type: "CONTACT_FIELD", key: "weight" },
        decimalMark: "PERIOD",
        groupingStyle: "COMMA_PERIOD",
        outputKey: "weight",
      },
      automationValues: {},
    }), { status: "EMPTY_SOURCE" })

    assert.deepEqual(await resolveAutomationNumberFormatter(prismaTx, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        mode: "FORMAT_CURRENCY",
        source: { type: "CUSTOM_FIELD", key: "premium" },
        decimalMark: "PERIOD",
        currencyCode: "USD",
        outputKey: "premium",
      },
      automationValues: {},
    }), { status: "EMPTY_SOURCE" })
  })
})
