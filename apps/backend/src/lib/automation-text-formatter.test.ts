import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  applyAutomationTextFormatter,
  AutomationTextFormatterConfigSchema,
  resolveAutomationTextFormatter,
  textFormatterOutputKind,
} from "./automation-text-formatter.js"

const source = { type: "CONTACT_FIELD" as const, key: "name" }
const common = { actionName: "Normalize name", source, outputKey: "formatted_text" }

describe("automation Text formatter", () => {
  test("validates every mode and its conditional fields", () => {
    const configs = [
      ...[
        "UPPER_CASE",
        "LOWER_CASE",
        "TITLE_CASE",
        "CAPITALIZE",
        "TRIM_WHITESPACE",
        "WORD_COUNT",
        "LENGTH",
        "EXTRACT_EMAIL",
        "EXTRACT_URL",
      ].map((mode) => ({ ...common, mode })),
      { ...common, mode: "DEFAULT_VALUE", defaultValue: "Unknown" },
      { ...common, mode: "TRIM", maxLength: 10 },
      { ...common, mode: "REPLACE_TEXT", searchText: "old", replacementText: "" },
      { ...common, mode: "FIND", searchText: "needle" },
      { ...common, mode: "SPLIT_TEXT", separator: " ", segment: 1 },
    ]
    for (const config of configs) {
      assert.equal(AutomationTextFormatterConfigSchema.safeParse(config).success, true)
    }
    assert.equal(AutomationTextFormatterConfigSchema.safeParse({
      ...common,
      mode: "SPLIT_TEXT",
      separator: "",
      segment: 1,
    }).success, false)
    assert.equal(AutomationTextFormatterConfigSchema.safeParse({
      ...common,
      mode: "TRIM",
      maxLength: 0,
    }).success, false)
  })

  test("applies casing and literal text operations", () => {
    assert.equal(applyAutomationTextFormatter("hello WORLD", { ...common, mode: "UPPER_CASE" }), "HELLO WORLD")
    assert.equal(applyAutomationTextFormatter("hello WORLD", { ...common, mode: "LOWER_CASE" }), "hello world")
    assert.equal(applyAutomationTextFormatter("hello WORLD", { ...common, mode: "TITLE_CASE" }), "Hello World")
    assert.equal(applyAutomationTextFormatter("hello WORLD", { ...common, mode: "CAPITALIZE" }), "Hello world")
    assert.equal(applyAutomationTextFormatter("  hello  ", { ...common, mode: "TRIM_WHITESPACE" }), "hello")
    assert.equal(applyAutomationTextFormatter("one-one-one", {
      ...common,
      mode: "REPLACE_TEXT",
      searchText: "one",
      replacementText: "two",
    }), "two-two-two")
    assert.equal(applyAutomationTextFormatter("Text Formatter", {
      ...common,
      mode: "SPLIT_TEXT",
      separator: " ",
      segment: 1,
    }), "Text")
    assert.equal(applyAutomationTextFormatter("Text Formatter", {
      ...common,
      mode: "SPLIT_TEXT",
      separator: " ",
      segment: 3,
    }), "")
  })

  test("counts and trims user-visible characters", () => {
    assert.equal(applyAutomationTextFormatter("Monday", { ...common, mode: "LENGTH" }), 6)
    assert.equal(applyAutomationTextFormatter("Text Formatter", { ...common, mode: "WORD_COUNT" }), 2)
    assert.equal(applyAutomationTextFormatter("A👍🏽B", { ...common, mode: "LENGTH" }), 3)
    assert.equal(applyAutomationTextFormatter("A👍🏽B", { ...common, mode: "TRIM", maxLength: 2 }), "A👍🏽")
    assert.equal(applyAutomationTextFormatter("Text Formatter", {
      ...common,
      mode: "FIND",
      searchText: "Formatter",
    }), 5)
    assert.equal(applyAutomationTextFormatter("Text Formatter", {
      ...common,
      mode: "FIND",
      searchText: "missing",
    }), -1)
  })

  test("extracts the first conventional email and URL", () => {
    assert.equal(applyAutomationTextFormatter(
      "Contact text.formatter@example.com or second@example.com",
      { ...common, mode: "EXTRACT_EMAIL" },
    ), "text.formatter@example.com")
    assert.equal(applyAutomationTextFormatter(
      "Visit https://example.com/path?value=1, then www.example.org.",
      { ...common, mode: "EXTRACT_URL" },
    ), "https://example.com/path?value=1")
    assert.equal(applyAutomationTextFormatter(
      "text formatter at example.com",
      { ...common, mode: "EXTRACT_EMAIL" },
    ), "")
  })

  test("creates deterministic results for empty input", () => {
    assert.equal(applyAutomationTextFormatter("", { ...common, mode: "UPPER_CASE" }), "")
    assert.equal(applyAutomationTextFormatter("", { ...common, mode: "WORD_COUNT" }), 0)
    assert.equal(applyAutomationTextFormatter("", { ...common, mode: "LENGTH" }), 0)
    assert.equal(applyAutomationTextFormatter("", { ...common, mode: "FIND", searchText: "x" }), -1)
    assert.equal(applyAutomationTextFormatter("   ", {
      ...common,
      mode: "DEFAULT_VALUE",
      defaultValue: "Fallback",
    }), "Fallback")
  })

  test("resolves safe contact, custom, and prior automation values", async () => {
    const prismaTx = {
      contact: {
        findFirst: async () => ({
          firstName: "Ada",
          middleName: null,
          lastName: "Lovelace",
          customFieldValues: [{
            value: ["Life", "Health"],
            field: {
              key: "coverage",
              fieldType: "MULTI_SELECT",
              isActive: true,
              isEncrypted: false,
              isSensitive: false,
            },
          }],
        }),
      },
      contactCustomField: { findFirst: async () => null },
    }
    assert.equal(await resolveAutomationTextFormatter(prismaTx, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: { ...common, mode: "UPPER_CASE" },
      automationValues: {},
    }), "ADA LOVELACE")
    assert.equal(await resolveAutomationTextFormatter(prismaTx, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        ...common,
        mode: "LOWER_CASE",
        source: { type: "CUSTOM_FIELD", key: "coverage" },
      },
      automationValues: {},
    }), "life, health")
    assert.equal(await resolveAutomationTextFormatter(prismaTx, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        ...common,
        mode: "LENGTH",
        source: { type: "AUTOMATION_VALUE", key: "earlier_value" },
      },
      automationValues: { earlier_value: "Monday" },
    }), 6)
  })

  test("treats an untouched safe custom field as empty and rejects unavailable fields", async () => {
    const prismaTx = {
      contact: { findFirst: async () => ({ customFieldValues: [] }) },
      contactCustomField: {
        findFirst: async ({ where }: any) => where.key === "empty_text" ? { fieldType: "TEXT" } : null,
      },
    }
    assert.equal(await resolveAutomationTextFormatter(prismaTx, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        ...common,
        mode: "DEFAULT_VALUE",
        source: { type: "CUSTOM_FIELD", key: "empty_text" },
        defaultValue: "Fallback",
      },
      automationValues: {},
    }), "Fallback")
    await assert.rejects(() => resolveAutomationTextFormatter(prismaTx, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      config: {
        ...common,
        mode: "UPPER_CASE",
        source: { type: "CUSTOM_FIELD", key: "missing_text" },
      },
      automationValues: {},
    }), /unavailable or incompatible/)
  })

  test("reports numeric output kinds", () => {
    assert.equal(textFormatterOutputKind({ mode: "FIND" }), "NUMBER")
    assert.equal(textFormatterOutputKind({ mode: "WORD_COUNT" }), "NUMBER")
    assert.equal(textFormatterOutputKind({ mode: "LENGTH" }), "NUMBER")
    assert.equal(textFormatterOutputKind({ mode: "UPPER_CASE" }), "TEXT")
  })
})
