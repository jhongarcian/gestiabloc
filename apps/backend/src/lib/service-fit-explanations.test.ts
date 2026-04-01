import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  buildDeterministicServiceFitExplanation,
  buildServiceFitExplanationPrompt,
  detectServiceFitConfigurationGapNotes,
  generateServiceFitExplanation,
  type ServiceFitExplanationInput,
} from "./service-fit-explanations.js"

function createInput(
  overrides: Partial<ServiceFitExplanationInput> = {},
): ServiceFitExplanationInput {
  return {
    serviceName: "Premium Fleet Program",
    serviceDescription:
      "A record qualifies when fleet size is at least 10 and the compliance checklist is still open. They can also qualify through a referral partner exception.",
    fitSummary: "Use this to screen fleet-program intake records.",
    eligibilityStatus: "ELIGIBLE",
    fitScore: 100,
    matchedRules: [
      {
        ruleId: "age",
        label: "Age",
        reason: "Age is at least 65.",
      },
      {
        ruleId: "part-a",
        label: "Part A date",
        reason: "Part A date is empty.",
      },
    ],
    blockingRules: [],
    missingRules: [],
    ...overrides,
  }
}

describe("buildServiceFitExplanationPrompt", () => {
  test("uses service text and rule summaries without including extra raw contact fields", () => {
    const prompt = buildServiceFitExplanationPrompt({
      ...createInput(),
      // Extra property to verify the prompt builder does not serialize arbitrary contact data.
      rawContactDateOfBirth: "1950-01-01",
    } as ServiceFitExplanationInput & { rawContactDateOfBirth: string })

    assert.equal(prompt.includes("1950-01-01"), false)
    assert.equal(prompt.includes("Age is at least 65."), true)
    assert.equal(prompt.includes("Part A date is empty."), true)
  })
})

describe("detectServiceFitConfigurationGapNotes", () => {
  test("flags unsupported alternate qualification paths from the service description", () => {
    const notes = detectServiceFitConfigurationGapNotes(
      createInput({
        matchedRules: [
          {
            ruleId: "age",
            label: "Age",
            reason: "Age is at least 65.",
          },
        ],
      }),
    )

    assert.equal(
      notes.some((note) => note.toLowerCase().includes("referral partner exception")),
      true,
    )
  })
})

describe("buildDeterministicServiceFitExplanation", () => {
  test("explains missing information when qualification cannot be confirmed", () => {
    const explanation = buildDeterministicServiceFitExplanation(
      createInput({
        eligibilityStatus: "NEEDS_INFO",
        matchedRules: [],
        missingRules: [
          {
            ruleId: "assets",
            label: "Available assets",
            reason: "Available assets does not have enough data yet.",
          },
        ],
      }),
    )

    assert.equal(explanation.includes("record needs more information"), true)
    assert.equal(explanation.includes("Available assets does not have enough data yet."), true)
  })
})

describe("generateServiceFitExplanation", () => {
  test("falls back to deterministic explanation when the provider fails", async () => {
    const result = await generateServiceFitExplanation(createInput(), {
      async explainQualification() {
        throw new Error("provider down")
      },
    })

    assert.equal(result.explanationSource, "deterministic")
    assert.equal(result.explanation.includes("strong match"), true)
  })

  test("locks the final explanation to the deterministic status even if provider text is contradictory", async () => {
    const result = await generateServiceFitExplanation(
      createInput({
        eligibilityStatus: "NOT_ELIGIBLE",
        matchedRules: [],
        blockingRules: [
          {
            ruleId: "age",
            label: "Age",
            reason: "Age does not satisfy is at least 65.",
          },
        ],
      }),
      {
        async explainQualification() {
          return {
            reasonSummary: "They qualify immediately and should be enrolled now.",
            configurationGapNotes: [],
          }
        },
      },
    )

    assert.equal(result.explanationSource, "ai")
    assert.equal(
      result.explanation.startsWith(
        "Based on the configured rules, Premium Fleet Program is not eligible for this contact record.",
      ),
      true,
    )
  })

  test("returns recommended updates when required information is missing", async () => {
    const result = await generateServiceFitExplanation(
      createInput({
        eligibilityStatus: "NEEDS_INFO",
        matchedRules: [],
        missingRules: [
          {
            ruleId: "dob",
            label: "Date of birth",
            reason: "Date of birth does not have enough data yet.",
          },
        ],
      }),
      undefined,
    )

    assert.deepEqual(result.recommendedUpdates, [
      "Update Date of birth on the contact record.",
    ])
  })
})
