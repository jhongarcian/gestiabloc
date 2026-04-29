import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { verifyServiceQuestion, shouldRunServiceVerification } from "./service-fit-verification.js"

describe("shouldRunServiceVerification", () => {
  test("uses configured trigger keywords", () => {
    assert.equal(
      shouldRunServiceVerification("Can we switch this plan?", {
        mode: "WEB_SOURCES",
        guidance: "",
        sourceUrls: ["https://example.com"],
        triggerKeywords: ["switch"],
      }),
      true,
    )
  })

  test("falls back to generic external-rule patterns", () => {
    assert.equal(
      shouldRunServiceVerification("Is this allowed outside the regular deadline?", {
        mode: "WEB_SOURCES",
        guidance: "",
        sourceUrls: ["https://example.com"],
        triggerKeywords: [],
      }),
      true,
    )
  })
})

describe("verifyServiceQuestion", () => {
  test("returns configured guidance for non-web verification modes", async () => {
    const result = await verifyServiceQuestion({
      question: "Can we change this service after purchase?",
      serviceName: "Priority Tax Filing",
      serviceDescription: "Tax preparation service.",
      eligibilityStatus: "ELIGIBLE",
      fitProfile: {
        enabled: true,
        summary: "For active tax clients.",
        rules: [],
        requirementMetadata: [],
        optionMetadata: [],
        verificationProfile: {
          mode: "MANUAL_CONFIRMATION",
          guidance: "Call the assigned tax lead before confirming amendment rules.",
          sourceUrls: [],
          triggerKeywords: ["change", "amendment"],
        },
        knowledgeProfile: {
          overview: "",
          pricingNotes: "",
          workflowNotes: "",
          faqNotes: "",
          adapter: "NONE",
        },
      },
    })

    assert.equal(
      result?.summary.includes("manual confirmation verification"),
      true,
    )
    assert.equal(
      result?.bullets.some((bullet) => bullet.includes("not a web-source lookup")),
      true,
    )
  })

  test("searches the web when a web verifier question needs outside confirmation", async () => {
    const originalFetch = globalThis.fetch

    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input)

      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return new Response(
          `
            <html>
              <body>
                <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fmedicare-switch">
                  Medicare Advantage switching options
                </a>
              </body>
            </html>
          `,
          { status: 200 },
        )
      }

      if (url === "https://example.com/medicare-switch") {
        return new Response(
          `
            <html>
              <head><title>Medicare Advantage switching options</title></head>
              <body>
                Members can switch Medicare Advantage plans during approved enrollment periods.
                Dental benefits vary by plan and should be compared before making a change.
              </body>
            </html>
          `,
          { status: 200 },
        )
      }

      return new Response("", { status: 404 })
    }) as typeof fetch

    try {
      const result = await verifyServiceQuestion({
        question:
          "The client is already in Medicare Advantage and wants a better dental plan. Can they change?",
        serviceName: "Medicare Advantage",
        serviceDescription: "Medicare plan enrollment service.",
        eligibilityStatus: "ELIGIBLE",
        fitProfile: {
          enabled: true,
          summary: "For contacts who qualify for Medicare Advantage assistance.",
          rules: [],
          requirementMetadata: [],
          optionMetadata: [],
          verificationProfile: {
            mode: "WEB_SOURCES",
            guidance: "Verify switching and enrollment timing from current web sources.",
            sourceUrls: [],
            triggerKeywords: ["switch", "dental"],
          },
          knowledgeProfile: {
            overview: "",
            pricingNotes: "",
            workflowNotes: "",
            faqNotes: "",
            adapter: "NONE",
          },
        },
      })

      assert.equal(result?.summary.includes("mention additional rules or conditions"), true)
      assert.equal(
        result?.bullets.some((bullet) => bullet.includes("Dental benefits vary by plan")),
        true,
      )
      assert.deepEqual(result?.citations, [
        {
          url: "https://example.com/medicare-switch",
          title: "Medicare Advantage switching options",
        },
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
