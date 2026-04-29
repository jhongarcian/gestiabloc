import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { routeServiceQuestion } from "./service-fit-question-router.js"

function createItem() {
  return {
    serviceId: "service-1",
    serviceName: "Green Card Assistance",
    description: "Helps clients with permanent residency filings.",
    fitProfile: {
      enabled: true,
      summary: "For clients who may qualify for green card support.",
      rules: [],
      requirementMetadata: [],
      optionMetadata: [],
      verificationProfile: {
        mode: "NONE" as const,
        guidance: "",
        sourceUrls: [],
        triggerKeywords: [],
      },
      knowledgeProfile: {
        overview: "This service supports green card application planning.",
        pricingNotes: "Our service fee is separate from USCIS filing fees.",
        workflowNotes: "Confirm the filing path before quoting government fees.",
        faqNotes: "Use official USCIS sources for live filing fee questions.",
        adapter: "IMMIGRATION_USCIS" as const,
      },
    },
    eligibilityStatus: "ELIGIBLE" as const,
    fitScore: 100,
    summary: "Eligible for service.",
    explanation: "Based on the configured rules, Green Card Assistance is currently eligible for this contact.",
    matchedRules: [],
    blockingRules: [],
    missingRules: [],
    recommendedUpdates: [],
    configurationGapNotes: [],
    hasPurchased: false,
    hasActiveEnrollment: false,
    currentContactServiceStatus: null,
  }
}

function createWebVerifiedItem() {
  return {
    ...createItem(),
    serviceName: "Medicare Advantage",
    description: "Helps clients review and enroll in Medicare Advantage plans.",
    fitProfile: {
      ...createItem().fitProfile,
      verificationProfile: {
        mode: "WEB_SOURCES" as const,
        guidance: "Use official Medicare and carrier plan sources to answer plan change questions.",
        sourceUrls: ["https://www.medicare.gov/health-drug-plans/health-plans-your-choices"],
        triggerKeywords: [],
      },
      knowledgeProfile: {
        ...createItem().fitProfile.knowledgeProfile,
        overview: "",
        pricingNotes: "",
        workflowNotes: "",
        faqNotes: "",
        adapter: "NONE" as const,
      },
    },
  }
}

describe("routeServiceQuestion", () => {
  test("uses tenant knowledge for pricing questions before falling back to fit-only answers", async () => {
    const reply = await routeServiceQuestion({
      scope: "service",
      serviceId: "service-1",
      question: "What does this service usually cost?",
      items: [createItem()],
    })

    assert.equal(reply.title, "Green Card Assistance pricing guidance")
    assert.equal(reply.summary.includes("Our service fee is separate from USCIS filing fees"), true)
  })

  test("uses the USCIS adapter for live immigration fee questions", async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input)

      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return new Response(
          `
            <html>
              <body>
                <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.uscis.gov%2Fforms%2Ffiling-fees">
                  USCIS Filing Fees
                </a>
              </body>
            </html>
          `,
          { status: 200 },
        )
      }

      if (url === "https://www.uscis.gov/forms/filing-fees") {
        return new Response(
          `
            <html>
              <head><title>Filing Fees | USCIS</title></head>
              <body>
                Use the USCIS fee resources to review the current filing fee before sending the client forward.
                Some green card related filing costs depend on the form package and filing path.
              </body>
            </html>
          `,
          { status: 200 },
        )
      }

      return new Response("", { status: 404 })
    }) as typeof fetch

    try {
      const reply = await routeServiceQuestion({
        scope: "service",
        serviceId: "service-1",
        question: "What will be the cost for his green card application fee in 2026?",
        items: [createItem()],
      })

      assert.equal(reply.title, "Green Card Assistance USCIS guidance")
      assert.equal(reply.citations?.[0]?.url, "https://www.uscis.gov/forms/filing-fees")
      assert.equal(
        reply.summary.includes("official USCIS"),
        false,
      )
      assert.equal(
        reply.bullets.some((bullet) => bullet.includes("depend on the form package")),
        true,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("runs verification for open-ended service questions even without legacy trigger keywords", async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input)

      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return new Response(
          `
            <html>
              <body>
                <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.medicare.gov%2Fhealth-drug-plans%2Fhealth-plans-your-choices">
                  Medicare health plans and choices
                </a>
              </body>
            </html>
          `,
          { status: 200 },
        )
      }

      if (url === "https://www.medicare.gov/health-drug-plans/health-plans-your-choices") {
        return new Response(
          `
            <html>
              <head><title>Medicare health plans</title></head>
              <body>
                Medicare Advantage members may compare available plans in their area and review each plan's extra benefits, including dental coverage, before making a change.
              </body>
            </html>
          `,
          { status: 200 },
        )
      }

      return new Response("", { status: 404 })
    }) as typeof fetch

    try {
      const reply = await routeServiceQuestion({
        scope: "service",
        serviceId: "service-1",
        question: "He is currently enrolled with Humana Gold Plus HMO plan.",
        items: [createWebVerifiedItem()],
      })

      assert.equal(reply.citations?.[0]?.url, "https://www.medicare.gov/health-drug-plans/health-plans-your-choices")
      assert.equal(
        reply.summary.includes("Configured external sources"),
        true,
      )
      assert.equal(
        reply.bullets.some((bullet) => bullet.includes("extra benefits, including dental coverage")),
        true,
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
