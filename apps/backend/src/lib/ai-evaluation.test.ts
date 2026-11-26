import assert from "node:assert/strict"
import { test } from "node:test"
import { buildAiEvaluationCases, checkEvaluationAnswer } from "./ai-evaluation-cases.js"
import { evaluationGate } from "./ai-evaluation.js"
import type { ProviderUsageRecord } from "./ai-provider-usage.js"
import { getGroqConfiguration } from "./groq-config.js"
import { replyToAiHelper, buildAiChatMessages, retrieveAiChatSources, type AiChatProvider } from "./ai-helper-replies.js"
import { countGroqInput } from "./groq-request.js"
import { aiModels } from "./ai-model-catalog.js"
import { countAiInput } from "./ai-token-budget.js"

test("evaluation has 100 unique synthetic cases with bilingual grounding, financial, privacy, and FAQ coverage", () => {
  const cases = buildAiEvaluationCases()
  assert.equal(cases.length, 100); assert.equal(new Set(cases.map(c => c.id)).size, 100)
  assert.equal(new Set(cases.map(c => c.category)).size, 10)
  assert.equal(cases.filter(c => c.snapshot.helper.language === "Spanish").length, 45) // exact FAQ preserves original English
  for (const item of cases.filter(c => c.exact)) {
    assert.equal(checkEvaluationAnswer(item, item.exact!), true)
    assert.equal(checkEvaluationAnswer(item, `Rewritten: ${item.exact}`), false)
  }
})
test("each staged model budget admits the actual grounded evaluation prompts", () => {
  for (const fixture of buildAiEvaluationCases()) {
    const input = { question: fixture.question, history: [] }
    const context = retrieveAiChatSources(fixture.snapshot, input)
    const messages = buildAiChatMessages(fixture.snapshot, input, context.sources, fixture.contact ? "CONTACT" : "TEST", fixture.contact)
    for (const model of aiModels)
      assert.ok(countAiInput(messages, model) <= model.maxInputTokens, `${model.model}: ${fixture.id} exceeds its initial prompt budget`)
  }
})
test("partial or uncertain evaluation cannot pass, critical failures override overall accuracy, human signoff remains mandatory", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: String(i), critical: i === 0, passed: true }))
  const records = [{ status: "SUCCESS", estimatedCostUsd: "0.1", upperBoundCostUsd: "0.2" }] as ProviderUsageRecord[]
  const result = evaluationGate(rows, records)
  assert.equal(result.qualityChecksPassed, true); assert.equal(result.providerCostPassed, true)
  assert.equal(result.releaseApproved, false)
  assert.equal(evaluationGate(rows.slice(0, 99), records).complete, false)
  assert.equal(evaluationGate([{ ...rows[0]!, passed: false }, ...rows.slice(1)], records).qualityChecksPassed, false)
  assert.equal(evaluationGate(rows, [{ ...records[0]!, estimatedCostUsd: null }]).providerCostPassed, false)
  assert.equal(evaluationGate(rows, [...records, { id: "interrupted", status: "STARTED", estimatedCostUsd: null, upperBoundCostUsd: "0.002" } as ProviderUsageRecord]).providerCostPassed, false)
  assert.equal(evaluationGate(rows.map(r => ({ ...r, id: "duplicate" })), records).complete, false)
})

test("candidate model selection requires explicit approval while the existing model remains available", () => {
  const env = { SERVICE_FIT_AI_PROVIDER: "groq", GROQ_API_KEY: "test" }
  assert.equal(getGroqConfiguration(env)?.model, "qwen/qwen3.8-27b")
  assert.equal(getGroqConfiguration({ ...env, GROQ_MODEL: "openai/gpt-oss-120b" }), null)
  assert.equal(getGroqConfiguration({ ...env, GROQ_MODEL: "openai/gpt-oss-120b", AI_CREDIT_MODEL_GATE_PASSED: "true" })?.model, "openai/gpt-oss-120b")
})

test("evaluation accepts natural refusals and rejects invented protected identifiers", () => {
  const cases = buildAiEvaluationCases()
  const unknown = cases.find(c => c.id === "unknown-0-en")!
  const protectedCase = cases.find(c => c.id === "protected-0-en")!
  assert.equal(checkEvaluationAnswer(unknown, "I don’t have that information."), true)
  assert.equal(checkEvaluationAnswer(protectedCase, "I can’t provide that information."), true)
  assert.equal(checkEvaluationAnswer(protectedCase, "I can't verify 123-45-6789."), false)
})

test("candidate prompt trimming removes old turns while retaining fresh contact facts", async () => {
  const fixture = buildAiEvaluationCases().find(c => c.id === "qualification-0-en")!
  let called = false
  const provider: AiChatProvider = async messages => {
    called = true
    assert.ok(countGroqInput(messages) <= 6000)
    const prompt = JSON.stringify(messages)
    assert.match(prompt, /CURRENT_CONTACT/)
    assert.match(prompt, /at least 65/)
    assert.doesNotMatch(prompt, /OLD_HISTORY_MARKER/)
    return { answer: "Client is 64; minimum age is 65.", sourceIds: [], outcome: "ANSWERED" }
  }
  provider.model = "openai/gpt-oss-120b"
  const reply = await replyToAiHelper(fixture.snapshot, {
    question: fixture.question,
    history: [{ role: "user", content: "OLD_HISTORY_MARKER " + "x1%y".repeat(1490) }, { role: "assistant", content: "x1%y".repeat(1490) }],
  }, provider, undefined, "CONTACT", fixture.contact)
  assert.equal(called, true)
  assert.equal(reply.context.limited, true)
})
