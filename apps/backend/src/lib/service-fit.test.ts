import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  buildServiceFitFieldCatalog,
  evaluateServiceFitProfile,
  normalizeServiceFitProfile,
  validateServiceFitProfile,
} from "./service-fit.js"

describe("buildServiceFitFieldCatalog", () => {
  test("includes core fields and excludes sensitive custom fields", () => {
    const catalog = buildServiceFitFieldCatalog({
      statuses: [{ id: "status-1", name: "Qualified" }],
      tags: [{ id: "tag-1", name: "VIP" }],
      customFields: [
        {
          id: "field-1",
          key: "legalStatus",
          label: "Legal status",
          description: null,
          fieldType: "SELECT",
          options: ["Citizen", "Resident"],
        },
        {
          id: "field-2",
          key: "ssnLast4",
          label: "SSN",
          description: null,
          fieldType: "TEXT",
          options: [],
          isSensitive: true,
        },
      ],
    })

    assert.ok(catalog.some((field) => field.source === "core" && field.fieldKey === "dateOfBirth"))
    assert.ok(catalog.some((field) => field.source === "derived" && field.fieldKey === "ageYears"))
    assert.ok(catalog.some((field) => field.source === "custom" && field.fieldKey === "legalStatus"))
    assert.equal(catalog.some((field) => field.fieldKey === "ssnLast4"), false)
  })
})

describe("validateServiceFitProfile", () => {
  test("normalizes compare values and rejects unsupported operators", () => {
    const catalog = buildServiceFitFieldCatalog({
      statuses: [],
      tags: [],
      customFields: [],
    })

    const valid = validateServiceFitProfile(
      normalizeServiceFitProfile({
        enabled: true,
        summary: "Age-based fit",
        rules: [
          {
            id: "age-rule",
            source: "derived",
            fieldKey: "ageYears",
            valueType: "number",
            operator: "greater_than_or_equal",
            compareValue: "65",
            required: true,
            weight: 1,
          },
        ],
      }),
      catalog,
    )

    assert.equal(valid.ok, true)
    if (!valid.ok) return
    assert.equal(valid.profile.rules[0]?.compareValue, 65)

    const invalid = validateServiceFitProfile(
      normalizeServiceFitProfile({
        enabled: true,
        summary: "",
        rules: [
          {
            id: "bad-rule",
            source: "derived",
            fieldKey: "ageYears",
            valueType: "number",
            operator: "contains",
            compareValue: "65",
            required: true,
            weight: 1,
          },
        ],
      }),
      catalog,
    )

    assert.equal(invalid.ok, false)
  })
})

describe("evaluateServiceFitProfile", () => {
  const catalog = buildServiceFitFieldCatalog({
    statuses: [{ id: "status-qualified", name: "Qualified" }],
    tags: [{ id: "tag-vip", name: "VIP" }],
    customFields: [
      {
        id: "field-legal-status",
        key: "legalStatus",
        label: "Legal status",
        description: null,
        fieldType: "SELECT",
        options: ["Citizen", "Resident"],
      },
      {
        id: "field-part-a-date",
        key: "partADate",
        label: "Part A date",
        description: null,
        fieldType: "DATE",
        options: [],
      },
      {
        id: "field-part-b-date",
        key: "partBDate",
        label: "Part B date",
        description: null,
        fieldType: "DATE",
        options: [],
      },
    ],
  })

  test("marks a contact eligible when all required rules pass", () => {
    const validation = validateServiceFitProfile(
      normalizeServiceFitProfile({
        enabled: true,
        summary: "Medicare application screening",
        rules: [
          {
            id: "age",
            source: "derived",
            fieldKey: "ageYears",
            valueType: "number",
            operator: "greater_than_or_equal",
            compareValue: "65",
            required: true,
            weight: 1,
          },
          {
            id: "part-a",
            source: "custom",
            fieldKey: "partADate",
            valueType: "date",
            operator: "is_empty",
            compareValue: null,
            required: true,
            weight: 1,
          },
          {
            id: "part-b",
            source: "custom",
            fieldKey: "partBDate",
            valueType: "date",
            operator: "is_empty",
            compareValue: null,
            required: true,
            weight: 1,
          },
          {
            id: "legal-status",
            source: "custom",
            fieldKey: "legalStatus",
            valueType: "string",
            operator: "is_not_empty",
            compareValue: null,
            required: true,
            weight: 1,
          },
        ],
      }),
      catalog,
    )

    assert.equal(validation.ok, true)
    if (!validation.ok) return

    const result = evaluateServiceFitProfile({
      profile: validation.profile,
      catalog,
      timezone: "America/Chicago",
      contact: {
        id: "contact-1",
        firstName: "Jane",
        middleName: null,
        lastName: "Doe",
        email: "jane@example.com",
        phoneNumber: "+13125550100",
        secondaryPhoneNumber: null,
        dateOfBirth: "1950-01-01",
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        statusConfigId: "status-qualified",
        tagIds: ["tag-vip"],
        customFieldValues: {
          legalStatus: "Citizen",
          partADate: "",
          partBDate: "",
        },
      },
    })

    assert.equal(result.eligibilityStatus, "ELIGIBLE")
    assert.equal(result.fitScore, 100)
    assert.equal(result.blockingRules.length, 0)
    assert.equal(result.missingRules.length, 0)
  })

  test("marks a contact as needs-info when a required value is missing", () => {
    const validation = validateServiceFitProfile(
      normalizeServiceFitProfile({
        enabled: true,
        summary: "",
        rules: [
          {
            id: "legal-status",
            source: "custom",
            fieldKey: "legalStatus",
            valueType: "string",
            operator: "is_not_empty",
            compareValue: null,
            required: true,
            weight: 1,
          },
        ],
      }),
      catalog,
    )

    assert.equal(validation.ok, true)
    if (!validation.ok) return

    const result = evaluateServiceFitProfile({
      profile: validation.profile,
      catalog,
      contact: {
        id: "contact-2",
        firstName: "Ana",
        middleName: null,
        lastName: "Lopez",
        email: null,
        phoneNumber: null,
        secondaryPhoneNumber: null,
        dateOfBirth: "1958-05-20",
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        statusConfigId: null,
        tagIds: [],
        customFieldValues: {},
      },
    })

    assert.equal(result.eligibilityStatus, "NEEDS_INFO")
    assert.equal(result.missingRules.length, 1)
  })

  test("marks a contact as not-eligible when a required rule fails and scores optional rules", () => {
    const validation = validateServiceFitProfile(
      normalizeServiceFitProfile({
        enabled: true,
        summary: "",
        rules: [
          {
            id: "part-a",
            source: "custom",
            fieldKey: "partADate",
            valueType: "date",
            operator: "is_empty",
            compareValue: null,
            required: true,
            weight: 1,
          },
          {
            id: "vip",
            source: "tags",
            fieldKey: "tagIds",
            valueType: "stringArray",
            operator: "includes_any",
            compareValue: ["tag-vip"],
            required: false,
            weight: 3,
          },
          {
            id: "qualified",
            source: "status",
            fieldKey: "statusConfigId",
            valueType: "string",
            operator: "equals",
            compareValue: "status-qualified",
            required: false,
            weight: 1,
          },
        ],
      }),
      catalog,
    )

    assert.equal(validation.ok, true)
    if (!validation.ok) return

    const result = evaluateServiceFitProfile({
      profile: validation.profile,
      catalog,
      contact: {
        id: "contact-3",
        firstName: "Mark",
        middleName: null,
        lastName: "Smith",
        email: null,
        phoneNumber: null,
        secondaryPhoneNumber: null,
        dateOfBirth: "1960-07-12",
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        statusConfigId: "status-qualified",
        tagIds: ["tag-vip"],
        customFieldValues: {
          partADate: "2025-01-01",
        },
      },
    })

    assert.equal(result.eligibilityStatus, "NOT_ELIGIBLE")
    assert.equal(result.fitScore, 100)
    assert.equal(result.blockingRules.length, 1)
    assert.equal(result.matchedRules.length, 2)
  })

  test("supports grouped required rules with alternative qualifying branches", () => {
    const branchingCatalog = buildServiceFitFieldCatalog({
      statuses: [],
      tags: [],
      customFields: [
        {
          id: "field-income",
          key: "yearlyIncome",
          label: "Yearly income",
          description: null,
          fieldType: "CURRENCY",
          options: [],
        },
        {
          id: "field-disability",
          key: "hasDisability",
          label: "Disability status",
          description: null,
          fieldType: "CHECKBOX",
          options: [],
        },
      ],
    })

    const validation = validateServiceFitProfile(
      normalizeServiceFitProfile({
        enabled: true,
        summary: "License plate discount for seniors",
        rules: [
          {
            id: "income",
            source: "custom",
            fieldKey: "yearlyIncome",
            valueType: "number",
            operator: "less_than_or_equal",
            compareValue: "34000",
            required: true,
            requiredGroup: null,
            weight: 1,
          },
          {
            id: "senior-age",
            source: "derived",
            fieldKey: "ageYears",
            valueType: "number",
            operator: "greater_than_or_equal",
            compareValue: "65",
            required: true,
            requiredGroup: "Age or disability qualification",
            requiredBranch: "Senior branch",
            weight: 1,
          },
          {
            id: "disability-age",
            source: "derived",
            fieldKey: "ageYears",
            valueType: "number",
            operator: "greater_than_or_equal",
            compareValue: "16",
            required: true,
            requiredGroup: "Age or disability qualification",
            requiredBranch: "Disability branch",
            weight: 1,
          },
          {
            id: "disability-yes",
            source: "custom",
            fieldKey: "hasDisability",
            valueType: "boolean",
            operator: "is_true",
            compareValue: null,
            required: true,
            requiredGroup: "Age or disability qualification",
            requiredBranch: "Disability branch",
            weight: 1,
          },
        ],
      }),
      branchingCatalog,
    )

    assert.equal(validation.ok, true)
    if (!validation.ok) return

    const result = evaluateServiceFitProfile({
      profile: validation.profile,
      catalog: branchingCatalog,
      timezone: "America/Chicago",
      contact: {
        id: "contact-branching",
        firstName: "Jordan",
        middleName: null,
        lastName: "Lee",
        email: null,
        phoneNumber: null,
        secondaryPhoneNumber: null,
        dateOfBirth: "1998-03-15",
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        statusConfigId: null,
        tagIds: [],
        customFieldValues: {
          yearlyIncome: 31000,
          hasDisability: true,
        },
      },
    })

    assert.equal(result.eligibilityStatus, "ELIGIBLE")
    assert.equal(result.matchedRules.some((rule) => rule.ruleId === "income"), true)
    assert.equal(result.matchedRules.some((rule) => rule.ruleId === "disability-age"), true)
    assert.equal(result.matchedRules.some((rule) => rule.ruleId === "disability-yes"), true)
    assert.equal(result.blockingRules.some((rule) => rule.ruleId === "senior-age"), false)
  })
})
