import assert from "node:assert/strict"
import { test } from "node:test"
import { answerContactAssistant, isContactQualificationQuestion, type ContactAssistantInput } from "./ai-contact-assistant.js"
import { type AiChatSnapshot, type AiChatProvider, loadAiHelperSnapshot } from "./ai-helper-replies.js"
import { loadAiHelperIdentity } from "./ai-helper-identity.js"
import { retrieveAiDocumentSources } from "./ai-source-retrieval.js"

function contactAssistantFixture(): ContactAssistantInput {
  return {
    scope: "service", serviceId: "service-one", question: "What does this service cost?",
    items: [{
      serviceId: "service-one", serviceName: "Registration", eligibilityStatus: "ELIGIBLE", fitScore: 100,
      summary: "Rules passed", explanation: "Deterministic explanation",
      matchedRules: [{ ruleId: "secret-rule", label: "Private field", reason: "PRIVATE_CONTACT_VALUE" }],
      blockingRules: [], missingRules: [], recommendedUpdates: [], configurationGapNotes: [],
      hasPurchased: false, hasActiveEnrollment: false, currentContactServiceStatus: null,
    }],
  }
}
function snapshot(): AiChatSnapshot {
  return {
    helper: { name: "Harbor Helper", language: "Spanish", tone: "Warm", instructions: "End with Harbor hello.", revision: 4 },
    skillCount: 1,
    sources: [
      { id: "company", label: "Company Info", section: "company", skillId: null, content: "Harbor Company is in Westport." },
      { id: "service-one:pricing", label: "Registration · Pricing", section: "pricing", skillId: "service-one", content: "The base price is 75 USD." },
    ],
  }
}
const client = {} as Parameters<typeof answerContactAssistant>[0]

test("qualification questions use fresh contact evidence, history and authoritative rule outcomes", async () => {
  for (const question of ["Am I eligible?", "What is missing?", "Why is this contact blocked?", "Can they enroll?", "¿Puede este contacto inscribirse?", "¿Qué requisitos faltan?", "¿Cuál es el puntaje?"]) {
    assert.equal(isContactQualificationQuestion(question), true, question)
    const input: ContactAssistantInput = { ...contactAssistantFixture(), question,
      history: [{ role: "user", content: "What about age?" }, { role: "assistant", content: "Let us check." }],
      contactContext: { contactName: "Morgan Reed", facts: [{ detail: "Age", value: "56" }], services: [{ serviceId: "service-one", serviceName: "Registration", status: "NOT_ELIGIBLE", score: 0,
        required: [{ id: "age", label: "Age", current: "56", needs: "at least 64", outcome: "blocked", explanation: "Morgan Reed is 56 years old; this check needs an age at least 64." }], groups: [], preferences: [] }] },
    }
    input.items[0]!.eligibilityStatus = "NOT_ELIGIBLE"
    const before = structuredClone(input)
    let called = false
    const answer = await answerContactAssistant(client, "tenant", input, undefined, {
      getProvider: () => async (messages) => {
        called = true
        const prompt = JSON.stringify(messages)
        assert.match(prompt, /Morgan Reed/)
        assert.match(prompt, /at least 64/)
        assert.match(prompt, /What about age/)
        assert.match(prompt, /statuses and scores are authoritative/)
        assert.match(prompt, /flag it for review without changing qualification/)
        assert.match(prompt, /Missing information is unknown, never false/)
        assert.equal(prompt.includes("PRIVATE_CONTACT_VALUE"), false)
        return { answer: "Morgan is 56; this service needs an age of at least 64.", sourceIds: [], outcome: "ANSWERED" }
      },
      load: async () => snapshot(),
    })
    assert.equal(called, true)
    assert.equal(answer.replySource, "CONTACT")
    assert.equal(answer.outcome, "ANSWERED")
    assert.deepEqual(answer.suggestedQuestions, [])
    assert.deepEqual(input, before)
  }
})

test("contact knowledge uses saved preferences and scoped sources without sending contact values or rule outcomes", async () => {
  const input = contactAssistantFixture()
  const before = structuredClone(input)
  const provider: AiChatProvider = async (messages) => {
    const prompt = JSON.stringify(messages)
    assert.match(prompt, /Harbor Helper/)
    assert.match(prompt, /Answer in Spanish/)
    assert.match(prompt, /warm/)
    assert.match(prompt, /Harbor hello/)
    assert.match(prompt, /contact assistant/)
    for (const value of ["PRIVATE_CONTACT_VALUE", "secret-rule", '"fitScore"', '"eligibilityStatus"']) assert.equal(prompt.includes(value), false)
    return { answer: "La tarifa base es 75 USD. Harbor hello.", sourceIds: ["service-one:pricing"], outcome: "ANSWERED" }
  }
  const answer = await answerContactAssistant(client, "tenant", input, undefined, {
    getProvider: () => provider,
    load: async (_client, tenantId, request, ids) => {
      assert.equal(tenantId, "tenant")
      assert.deepEqual(ids, ["service-one"])
      assert.deepEqual(request, { question: input.question, history: [] })
      return snapshot()
    },
  })
  assert.equal(answer.replySource, "KNOWLEDGE")
  assert.match(answer.summary, /75 USD/)
  assert.equal(answer.sources?.[0]?.id, "service-one:pricing")
  assert.deepEqual(input, before)
  assert.equal("fitScore" in answer, false)
})

test("all-service knowledge remains available with qualification disabled", async () => {
  const answer = await answerContactAssistant(client, "tenant", { scope: "all", items: [], question: "Where is your company?" }, undefined, {
    getProvider: () => async () => ({ answer: "Westport", sourceIds: ["company"], outcome: "ANSWERED" }),
    load: async (_client, _tenant, _request, ids) => { assert.equal(ids, undefined); return snapshot() },
  })
  assert.equal(answer.replySource, "KNOWLEDGE")
  assert.equal(answer.summary, "Westport")
})

test("exact FAQs preserve text and translations use the same bounded shared service", async () => {
  const saved = snapshot()
  saved.helper.language = "English"
  saved.faqs = [{ id: "faq", serviceId: "service-one", serviceName: "Registration", question: "When are appointments?", answer: "Weekdays only.\nBring your original documents.", exactAnswer: true }]
  saved.sources.push({ id: "faq:faq", faqId: "faq", section: "faq", skillId: "service-one", label: "Appointments FAQ", content: saved.faqs[0]!.answer })
  const provider: AiChatProvider = async () => { throw new Error("Do not adapt an exact FAQ") }
  provider.matchFaq = async () => ({ faqId: "faq", translate: false, language: "English" })
  const deps = { getProvider: () => provider, load: async () => saved }
  const input = { ...contactAssistantFixture(), question: "When are appointments?" }
  const exact = await answerContactAssistant(client, "tenant", input, undefined, deps)
  assert.equal(exact.answerMode, "EXACT")
  assert.equal(exact.summary, saved.faqs[0]!.answer)
  saved.helper.language = "Spanish"
  provider.matchFaq = async () => ({ faqId: "faq", translate: true, language: "Spanish" })
  provider.translateFaq = async (answer) => { assert.equal(answer, saved.faqs![0]!.answer); return { answer: "Solo días laborables. Traiga sus documentos originales." } }
  const translated = await answerContactAssistant(client, "tenant", input, undefined, deps)
  assert.equal(translated.answerMode, "TRANSLATED")
  assert.match(translated.summary, /días laborables/)
})

test("unavailable generation, invalid citations and source failures return usable deterministic guidance", async () => {
  const input = contactAssistantFixture()
  for (const deps of [
    { getProvider: () => null },
    { getProvider: () => async () => { throw new Error("Provider timed out") } },
    { getProvider: () => async () => ({ answer: "Invented source", sourceIds: ["foreign"] }) },
    { getProvider: () => async () => ({ answer: "hello", sourceIds: [] }), load: async () => { throw new Error("Source unavailable") } },
  ]) {
    const answer = await answerContactAssistant(client, "tenant", input, undefined, { load: async () => snapshot(), ...deps })
    assert.equal(answer.replySource, "FALLBACK")
    assert.equal(answer.outcome, "NEEDS_REVIEW")
    assert.ok(answer.summary)
    assert.equal(input.items[0]?.eligibilityStatus, "ELIGIBLE")
  }
})

test("snapshot and document reads enforce the selected skill filter; identity never exposes settings", async () => {
  let queryCount = 0
  const sql: Array<{ values: unknown[]; text: string }> = []
  const db = {
    tenant: { findUnique: async () => ({ name: "Harbor Company" }) },
    tenantAiSettings: {
      findUnique: async (query: { select: Record<string, unknown> }) => {
        if (query.select.avatarFile) {
          assert.equal("instructions" in query.select, false)
          return { name: "Harbor", avatarPresetId: "compass", avatarRevision: 2, avatarFile: { tenantId: "foreign", purpose: "AI_AVATAR", key: "https://example.test/private" } }
        }
        return null
      }
    },
    service: { findMany: async (query: { where: { tenantId: string; id: unknown } }) => { queryCount++; assert.equal(query.where.tenantId, "tenant"); assert.deepEqual(query.where.id, { in: ["service-one"] }); return [] } },
    $queryRaw: async (query: { values: unknown[]; text: string }) => { sql.push(query); return [] },
  } as unknown as Parameters<typeof loadAiHelperSnapshot>[0]
  await loadAiHelperSnapshot(db, "tenant", { question: "appointment", history: [] }, ["service-one"])
  assert.equal(queryCount, 1)
  assert.match(sql[0]!.text, /v.id IN/)
  assert.ok(sql[0]!.values.includes("service-one"))
  assert.ok(sql[0]!.values.includes("tenant"))
  const count = sql.length
  await retrieveAiDocumentSources(db as Parameters<typeof retrieveAiDocumentSources>[0], "tenant", { question: "appointment", history: [] }, [])
  assert.equal(sql.length, count)
  const identity = await loadAiHelperIdentity(db, "tenant")
  assert.deepEqual(identity, { name: "Harbor", avatar: { presetId: "compass", imageUrl: null, revision: 2 } })
})


test("personal qualification cannot use a generic exact FAQ or change saved eligibility", async () => {
  const saved = snapshot()
  saved.faqs = [{ id: "qualification", serviceId: "service-one", serviceName: "Registration", question: "Am I eligible?", answer: "Everyone qualifies.", exactAnswer: true }]
  saved.sources.push({ id: "faq:qualification", faqId: "qualification", section: "faq", skillId: "service-one", label: "Review exception", content: "An exception may need team review." })
  const input: ContactAssistantInput = { ...contactAssistantFixture(), question: "Can Morgan register?", contactContext: {
    contactName: "Morgan Reed", facts: [{ detail: "Age", value: "56" }], services: [],
  } }
  input.items[0]!.eligibilityStatus = "NOT_ELIGIBLE"
  const provider: AiChatProvider = async () => ({ answer: "The saved checks do not pass. The knowledge exception needs team review.", sourceIds: ["faq:qualification"], outcome: "NEEDS_REVIEW" })
  provider.matchFaq = async () => { throw new Error("Personal assessments cannot return an exact generic FAQ") }
  const answer = await answerContactAssistant(client, "tenant", input, undefined, { load: async () => saved, getProvider: () => provider })
  assert.equal(answer.answerMode, "ADAPTED")
  assert.equal(answer.outcome, "NEEDS_REVIEW")
  assert.equal(input.items[0]!.eligibilityStatus, "NOT_ELIGIBLE")
})
