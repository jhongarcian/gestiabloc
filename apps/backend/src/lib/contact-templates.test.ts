import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  contactTemplateCustomFieldKeys,
  parseContactTemplate,
  renderContactNoteTemplates,
  validateContactTemplate,
} from "./contact-templates.js"

const customFields = [
  {
    key: "balance",
    label: "Balance",
    fieldType: "CURRENCY" as const,
    isActive: true,
    isEncrypted: false,
    isSensitive: false,
  },
  {
    key: "birthday",
    label: "Birthday",
    fieldType: "DATE" as const,
    isActive: true,
    isEncrypted: false,
    isSensitive: false,
  },
  {
    key: "secret",
    label: "Secret",
    fieldType: "TEXT" as const,
    isActive: true,
    isEncrypted: true,
    isSensitive: true,
  },
]

describe("contact templates", () => {
  test("parses regular and custom fields while leaving ordinary braces alone", () => {
    const parsed = parseContactTemplate(
      "Hello {contact.name}; {ordinary text}; balance {contact.custom_field.balance|currency:USD}; {date.current|date:medium}; {date.specific.2026-09-23|date:iso}.",
    )

    assert.equal(parsed.issues.length, 0)
    assert.deepEqual(parsed.tokens.map((token) => [token.source, token.key]), [
      ["CONTACT", "name"],
      ["CUSTOM_FIELD", "balance"],
      ["DATE", "current"],
      ["DATE", "2026-09-23"],
    ])
    assert.deepEqual(
      contactTemplateCustomFieldKeys("{contact.custom_field.balance} {contact.custom_field.balance}"),
      ["balance"],
    )
  })

  test("rejects malformed, unknown, incompatible, and protected fields", () => {
    assert.equal(parseContactTemplate("Hello {contact.name").issues[0]?.code, "UNCLOSED_TEMPLATE_TOKEN")
    assert.equal(parseContactTemplate("Today {date.current").issues[0]?.code, "UNCLOSED_TEMPLATE_TOKEN")
    assert.equal(parseContactTemplate("Hello {{contact.name}}").issues[0]?.code, "DOUBLE_BRACES_NOT_SUPPORTED")
    assert.equal(
      validateContactTemplate("{contact.unknown}", customFields).issues[0]?.code,
      "CONTACT_TEMPLATE_FIELD_NOT_FOUND",
    )
    assert.equal(
      validateContactTemplate("{contact.email|date:medium}", customFields).issues[0]?.code,
      "CONTACT_TEMPLATE_FORMAT_MISMATCH",
    )
    assert.equal(
      validateContactTemplate("{contact.custom_field.secret}", customFields).issues[0]?.code,
      "CONTACT_TEMPLATE_FIELD_NOT_ALLOWED",
    )
    assert.equal(
      parseContactTemplate("{date.specific.2026-02-30|date:medium}").issues[0]?.code,
      "INVALID_TEMPLATE_TOKEN",
    )
    assert.equal(
      parseContactTemplate("{date.current|phone:national}").issues[0]?.code,
      "INVALID_TEMPLATE_TOKEN",
    )
  })

  test("renders current regular and custom values with type-aware formatting", async () => {
    const prismaTx = {
      contact: {
        findFirst: async () => ({
          firstName: "Taylor",
          middleName: "A.",
          lastName: "Reed",
          email: "taylor@example.com",
          phone: "+15413134664",
          secondaryPhone: null,
          dateOfBirth: new Date("1990-04-05T12:00:00.000Z"),
          gender: "NON_BINARY",
          medicarePartA: false,
          statusConfig: { name: "Active" },
          assignedToMembership: { user: { name: "John", email: "john@example.com" } },
          tags: [{ tag: { name: "VIP" } }, { tag: { name: "Appointment" } }],
          createdAt: new Date("2026-01-02T18:00:00.000Z"),
          updatedAt: new Date("2026-09-23T18:00:00.000Z"),
          customFieldValues: [
            {
              value: 1234.5,
              field: {
                key: "balance",
                fieldType: "CURRENCY",
                isActive: true,
                isEncrypted: false,
                isSensitive: false,
              },
            },
            {
              value: "2026-09-23T12:00:00.000Z",
              field: {
                key: "birthday",
                fieldType: "DATE",
                isActive: true,
                isEncrypted: false,
                isSensitive: false,
              },
            },
            {
              value: ["Checking", "Savings"],
              field: {
                key: "accounts",
                fieldType: "MULTI_SELECT",
                isActive: true,
                isEncrypted: false,
                isSensitive: false,
              },
            },
            {
              value: "Checking",
              field: {
                key: "preferred_account",
                fieldType: "RADIO",
                isActive: true,
                isEncrypted: false,
                isSensitive: false,
              },
            },
            {
              value: true,
              field: {
                key: "confirmed",
                fieldType: "CHECKBOX",
                isActive: true,
                isEncrypted: false,
                isSensitive: false,
              },
            },
            {
              value: 42.5,
              field: {
                key: "score",
                fieldType: "NUMBER",
                isActive: true,
                isEncrypted: false,
                isSensitive: false,
              },
            },
            {
              value: "Tay",
              field: {
                key: "nickname",
                fieldType: "TEXT",
                isActive: true,
                isEncrypted: false,
                isSensitive: false,
              },
            },
            {
              value: "Line 1\nLine 2",
              field: {
                key: "history",
                fieldType: "TEXTAREA",
                isActive: true,
                isEncrypted: false,
                isSensitive: false,
              },
            },
            {
              value: "+15413134664",
              field: {
                key: "mobile",
                fieldType: "PHONE",
                isActive: true,
                isEncrypted: false,
                isSensitive: false,
              },
            },
            {
              value: "Gold",
              field: {
                key: "tier",
                fieldType: "SELECT",
                isActive: true,
                isEncrypted: false,
                isSensitive: false,
              },
            },
            {
              value: "must not render",
              field: {
                key: "secret",
                fieldType: "TEXT",
                isActive: true,
                isEncrypted: true,
                isSensitive: true,
              },
            },
          ],
        }),
      },
    }

    const rendered = await renderContactNoteTemplates(prismaTx, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      titleTemplate: "Appointment for {contact.name}",
      bodyTemplate: [
        "Status {contact.status}; assigned to {contact.assigned_to}.",
        "Tags {contact.tags}; created {contact.created_at|date:long}.",
        "Phone {contact.phone|phone:international}.",
        "Phone formats {contact.phone|phone:national}; {contact.phone|phone:e164}.",
        "Date formats {contact.date_of_birth|date:short}; {contact.date_of_birth|date:medium}; {contact.date_of_birth|date:long}.",
        "DOB {contact.date_of_birth|date:iso}; custom date {contact.custom_field.birthday|date:weekday}.",
        "Balance {contact.custom_field.balance|currency:USD}.",
        "Accounts {contact.custom_field.accounts}; preferred {contact.custom_field.preferred_account}.",
        "Confirmed {contact.custom_field.confirmed}; Medicare A {contact.medicare_part_a}.",
        "Typed {contact.custom_field.score}; {contact.custom_field.nickname}; {contact.custom_field.tier}.",
        "Custom phone {contact.custom_field.mobile|phone:national}; notes {contact.custom_field.history}.",
        "Missing [{contact.custom_field.missing}]; protected [{contact.custom_field.secret}].",
        "Execution date {date.current|date:iso}; fixed date {date.specific.2026-09-23|date:weekday}.",
      ].join("\n"),
      timezone: "America/Chicago",
      occurredAt: new Date("2026-09-24T04:30:00.000Z"),
    })

    assert.equal(rendered.title, "Appointment for Taylor A. Reed")
    assert.match(rendered.body, /Phone \+1 541 313 4664\./)
    assert.match(rendered.body, /Phone formats \(541\) 313-4664; \+15413134664\./)
    assert.match(rendered.body, /Date formats 04\/05\/1990; Apr 5, 1990; April 5, 1990\./)
    assert.match(rendered.body, /Tags VIP, Appointment; created January 2, 2026\./)
    assert.match(rendered.body, /DOB 1990-04-05; custom date Wednesday, September 23, 2026\./)
    assert.match(rendered.body, /Balance \$1,234\.50\./)
    assert.match(rendered.body, /Accounts Checking, Savings; preferred Checking\./)
    assert.match(rendered.body, /Confirmed True; Medicare A False\./)
    assert.match(rendered.body, /Typed 42\.5; Tay; Gold\./)
    assert.match(rendered.body, /Custom phone \(541\) 313-4664; notes Line 1\nLine 2\./)
    assert.match(rendered.body, /Missing \[\]; protected \[\]\./)
    assert.match(rendered.body, /Execution date 2026-09-23; fixed date Wednesday, September 23, 2026\./)

    const renderedInTokyo = await renderContactNoteTemplates(prismaTx, {
      tenantId: "tenant-1",
      contactId: "contact-1",
      titleTemplate: "{date.current|date:iso}",
      bodyTemplate: "{date.specific.2026-09-23|date:long}",
      timezone: "Asia/Tokyo",
      occurredAt: new Date("2026-09-24T04:30:00.000Z"),
    })
    assert.equal(renderedInTokyo.title, "2026-09-24")
    assert.equal(renderedInTokyo.body, "September 23, 2026")
  })
})
