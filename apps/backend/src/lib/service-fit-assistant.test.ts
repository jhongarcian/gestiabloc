import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  buildServiceFitAssistantReply,
  type ServiceFitAssistantScanItem,
} from "./service-fit-assistant.js"

function createItem(
  overrides: Partial<ServiceFitAssistantScanItem> = {},
): ServiceFitAssistantScanItem {
  return {
    serviceId: "service-medicare",
    serviceName: "Medicare Enrollment",
    eligibilityStatus: "NEEDS_INFO",
    fitScore: 72,
    summary: "The contact is close to qualifying but still needs more record details.",
    explanation:
      "Based on the configured rules, Medicare Enrollment may qualify for this contact record, but more information is still needed.",
    matchedRules: [],
    blockingRules: [],
    missingRules: [
      {
        ruleId: "dob",
        label: "Date of birth",
        reason: "Date of birth does not have enough data yet.",
      },
    ],
    recommendedUpdates: ["Update Date of birth on the contact record."],
    configurationGapNotes: [],
    hasPurchased: false,
    hasActiveEnrollment: false,
    currentContactServiceStatus: null,
    ...overrides,
  }
}

describe("buildServiceFitAssistantReply", () => {
  test("summarizes all-scope results without requiring a selected service", () => {
    const reply = buildServiceFitAssistantReply({
      scope: "all",
      items: [
        createItem({
          serviceId: "eligible-1",
          serviceName: "Retirement Review",
          eligibilityStatus: "ELIGIBLE",
          fitScore: 100,
          matchedRules: [
            {
              ruleId: "age",
              label: "Age",
              reason: "Age is at least 65.",
            },
          ],
          missingRules: [],
          recommendedUpdates: [],
        }),
        createItem(),
      ],
    })

    assert.equal(reply.title, "Qualification scope")
    assert.equal(reply.summary.includes("2 active services were reviewed"), true)
    assert.equal(reply.bullets.length > 0, true)
  })

  test("answers service-scoped missing information questions with recommended updates", () => {
    const reply = buildServiceFitAssistantReply({
      scope: "service",
      serviceId: "service-medicare",
      question: "What does this contact need to apply for this service?",
      items: [createItem()],
    })

    assert.equal(reply.title.includes("What this contact still needs"), true)
    assert.deepEqual(reply.bullets, [
      "Update Date of birth on the contact record.",
      "Date of birth does not have enough data yet.",
    ])
  })

  test("answers why a blocked service cannot move forward", () => {
    const reply = buildServiceFitAssistantReply({
      scope: "service",
      serviceId: "service-blocked",
      question: "Why is this service blocked?",
      items: [
        createItem({
          serviceId: "service-blocked",
          serviceName: "Housing Assistance",
          eligibilityStatus: "NOT_ELIGIBLE",
          explanation:
            "Based on the configured rules, Housing Assistance is not eligible for this contact record.",
          blockingRules: [
            {
              ruleId: "state",
              label: "State",
              reason: "State does not satisfy is equal to Illinois.",
            },
          ],
          missingRules: [],
          recommendedUpdates: [],
        }),
      ],
    })

    assert.equal(reply.title, "Why Housing Assistance is not eligible")
    assert.deepEqual(reply.bullets, [
      "State: State does not satisfy is equal to Illinois.",
    ])
  })

  test("handles already-enrolled plan-change questions without collapsing into generic next steps", () => {
    const reply = buildServiceFitAssistantReply({
      scope: "service",
      serviceId: "service-ma",
      question:
        "The client says he is already enrolled in medicare advantage but wants to change to a better plan with better dental. Can we do that?",
      items: [
        createItem({
          serviceId: "service-ma",
          serviceName: "Medicare Advantage",
          eligibilityStatus: "ELIGIBLE",
          fitScore: 100,
          explanation:
            "Based on the configured rules, Medicare Advantage is currently eligible for this contact.",
          matchedRules: [
            {
              ruleId: "age",
              label: "Age",
              reason: "Age is at least 65.",
            },
          ],
          missingRules: [],
          recommendedUpdates: [],
          hasPurchased: true,
          hasActiveEnrollment: true,
          currentContactServiceStatus: "IN_PROGRESS",
        }),
      ],
    })

    assert.equal(reply.title, "Existing service record question for Medicare Advantage")
    assert.equal(reply.summary.includes("keep, replace, or change an existing service or benefit record"), true)
    assert.equal(
      reply.bullets.some((bullet) => bullet.includes("does not decide whether an existing benefit, package, provider, or service record should be changed or replaced")),
      true,
    )
    assert.equal(
      reply.bullets.some((bullet) => bullet.includes("already active")),
      true,
    )
  })

  test("does not inject plan-specific wording for non-plan services", () => {
    const reply = buildServiceFitAssistantReply({
      scope: "service",
      serviceId: "service-license",
      question: "The client already has this benefit. Can we change it?",
      items: [
        createItem({
          serviceId: "service-license",
          serviceName: "License Plates Discount",
          eligibilityStatus: "NOT_ELIGIBLE",
          explanation:
            "Based on the configured rules, License Plates Discount is not eligible for this contact right now.",
          matchedRules: [],
          missingRules: [],
          blockingRules: [
            {
              ruleId: "income",
              label: "Income",
              reason: "Income is above the allowed limit.",
            },
          ],
          recommendedUpdates: [],
          hasPurchased: false,
          hasActiveEnrollment: false,
          currentContactServiceStatus: null,
        }),
      ],
    })

    assert.equal(reply.title, "Existing service record question for License Plates Discount")
    assert.equal(reply.summary.includes("plan"), false)
    assert.equal(reply.summary.includes("dental"), false)
    assert.equal(reply.bullets.some((bullet) => bullet.includes("plan")), false)
    assert.equal(reply.bullets.some((bullet) => bullet.includes("dental")), false)
  })
})
