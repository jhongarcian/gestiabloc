import assert from "node:assert/strict"
import { test } from "node:test"
import { AiFaqSchema, AiFaqMutationSchema } from "./ai-skill-content.js"
import {
  AiKnowledgeSchema,
  knowledgeRevision,
  knowledgeReadOnlyReason,
  mergeAiKnowledge,
  profileObject,
} from "./ai-knowledge.js"

const knowledge = {
  description: "Updated description",
  pricingNotes: "75 USD",
  workflowNotes: "Bring ID",
  adapter: "NONE" as const,
  verification: {
    mode: "NONE" as const,
    guidance: "Confirm details",
    triggerKeywords: ["ID", "ID"],
  },
}
test("knowledge merges preserve legacy prose, URLs, qualification and unknown fields without normalization", () => {
  const raw = {
    enabled: true,
    rules: [{ id: "legacy", unusual: { nested: true } }],
    future: ["untouched"],
    knowledgeProfile: {
      faqNotes: "Unstructured legacy prose.\nSecond paragraph.",
      workflowNotes: "Old workflow",
      futureKnowledge: 42,
    },
    verificationProfile: {
      sourceUrls: ["https://example.test/old"],
      futureSource: { x: 1 },
    },
  }
  const merged = mergeAiKnowledge(raw, knowledge)
  assert.deepEqual(profileObject(merged).rules, raw.rules)
  assert.deepEqual(profileObject(merged).future, raw.future)
  assert.equal(
    profileObject(merged.knowledgeProfile).faqNotes,
    raw.knowledgeProfile.faqNotes,
  )
  assert.equal(profileObject(merged.knowledgeProfile).futureKnowledge, 42)
  assert.deepEqual(
    profileObject(merged.verificationProfile).sourceUrls,
    raw.verificationProfile.sourceUrls,
  )
  assert.deepEqual(profileObject(merged.verificationProfile).futureSource, {
    x: 1,
  })
  assert.equal(merged.knowledgeProfile.workflowNotes, "Bring ID")
  assert.deepEqual(merged.verificationProfile.triggerKeywords, ["ID"])
  assert.equal(knowledgeRevision(raw), knowledgeRevision({ ...raw, rules: [] }))
  assert.notEqual(knowledgeRevision(raw), knowledgeRevision(merged))
  assert.equal(knowledgeReadOnlyReason(null), null)
  for (const invalid of [
    "raw prose",
    [],
    { knowledgeProfile: "prose" },
    { verificationProfile: [] },
    { knowledgeProfile: { adapter: "FUTURE_ADAPTER" } },
    { verificationProfile: { triggerKeywords: Array(13).fill("keyword") } },
    { knowledgeProfile: { workflowNotes: { richText: "Preserve me" } } },
  ])
    assert.ok(knowledgeReadOnlyReason(invalid))
})
test("FAQ and knowledge schemas reject blank/oversized values and cross-section writes", () => {
  assert.deepEqual(
    AiFaqSchema.parse({ question: " Q? ", answer: " A. ", exactAnswer: false }),
    { question: "Q?", answer: "A.", exactAnswer: false },
  )
  for (const faq of [
    { question: " ", answer: "A", exactAnswer: false },
    { question: "Q", answer: "x".repeat(4001), exactAnswer: true },
    { question: "Q", answer: "A", exactAnswer: "yes" },
    { question: "Q", answer: "A", exactAnswer: false, tenantId: "foreign" },
  ])
    assert.equal(AiFaqSchema.safeParse(faq).success, false)
  assert.equal(
    AiFaqMutationSchema.safeParse({ revision: "stale", faq: {} }).success,
    false,
  )
  assert.equal(AiKnowledgeSchema.safeParse(knowledge).success, true)
  for (const bad of [
    { ...knowledge, description: "x".repeat(6001) },
    { ...knowledge, rules: [] },
    { ...knowledge, faqNotes: "overwrite" },
    {
      ...knowledge,
      verification: { ...knowledge.verification, sourceUrls: [] },
    },
  ])
    assert.equal(AiKnowledgeSchema.safeParse(bad).success, false)
})
