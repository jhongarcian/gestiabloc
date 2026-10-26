import assert from "node:assert/strict"
import { test } from "node:test"
import { faqErrors, knowledgeInput } from "./content"
import {
  knowledgeDirty,
  mergeSavedSkill,
  qualificationDirty,
  toSkillDraft,
  type AiSkillDto,
} from "./skills"

const dto: AiSkillDto = {
  id: "skill",
  name: "Registration",
  parentId: "parent",
  parentName: "Services",
  isActive: true,
  parentActive: true,
  availableToAssistant: true,
  tagline: "Overview",
  faqCount: 0,
  knowledgeRevision: "knowledge-1",
  knowledgeReadOnlyReason: null,
  revision: "profile-1",
  qualificationReadOnlyReason: null,
  qualification: {
    enabled: true,
    summary: "Saved rules",
    rules: [],
    requirementMetadata: [],
    optionMetadata: [],
  },
  knowledgeProfile: {
    overview: "Saved overview",
    pricingNotes: "Saved pricing",
    faqNotes: "Legacy prose",
    workflowNotes: "Saved workflow",
    adapter: "NONE",
  },
  verificationProfile: {
    mode: "NONE",
    guidance: "Saved guidance",
    triggerKeywords: [],
    sourceUrls: ["https://example.test/legacy"],
  },
  notes: {
    overview: "Service overview",
    pricing: { basePriceCents: 7500, currency: "USD" },
    checklist: [],
    sources: { overview: "skill", pricing: "parent", checklist: "parent" },
  },
}
test("source data stays outside the independent knowledge payload", () => {
  const draft = toSkillDraft(dto)
  const inputWithSources = {
    ...draft.knowledge,
    links: [
      { id: "preview", label: "Preview", url: "https://example.test/local" },
    ],
    files: [],
  }
  assert.equal(knowledgeDirty(draft), false)
  assert.equal("links" in knowledgeInput(inputWithSources), false)
  assert.equal("files" in knowledgeInput(inputWithSources), false)
  draft.knowledge.description = "Edited description"
  assert.equal(knowledgeDirty(draft), true)
})
test("section saves retain other unsaved forms and use safe revisions for later saves", () => {
  const draft = toSkillDraft(dto)
  draft.qualification.summary = "Unsaved rule edits"
  draft.knowledge.description = "Unsaved knowledge edits"
  const savedKnowledge = {
    ...dto,
    revision: "profile-2",
    knowledgeRevision: "knowledge-2",
    knowledgeProfile: {
      ...dto.knowledgeProfile,
      overview: "Saved new knowledge",
    },
  }
  const next = mergeSavedSkill(draft, savedKnowledge, "knowledge")
  assert.equal(next.qualification.summary, "Unsaved rule edits")
  assert.equal(qualificationDirty(next), true)
  assert.equal(next.revision, "profile-2")
  assert.equal(next.knowledge.description, "Saved new knowledge")
  assert.equal(knowledgeDirty(next), false)
  const foreignRules = {
    ...savedKnowledge,
    revision: "profile-3",
    qualification: {
      ...dto.qualification,
      summary: "Changed by another admin",
    },
  }
  assert.equal(
    mergeSavedSkill(draft, foreignRules, "knowledge").revision,
    "profile-1",
  )
  const qualificationSave = mergeSavedSkill(
    draft,
    { ...dto, revision: "profile-4" },
    "qualification",
  )
  assert.equal(
    qualificationSave.knowledge.description,
    "Unsaved knowledge edits",
  )
  assert.equal(qualificationSave.knowledgeRevision, "knowledge-1")
  assert.equal(knowledgeDirty(qualificationSave), true)
})
test("FAQ form feedback rejects blank and oversized answers", () => {
  assert.equal(
    faqErrors({ question: " ", answer: " ", exactAnswer: false }).question,
    "Enter a question.",
  )
  assert.ok(
    faqErrors({ question: "Q", answer: "x".repeat(4001), exactAnswer: true })
      .answer,
  )
  assert.deepEqual(
    faqErrors({ question: "Q", answer: "A", exactAnswer: false }),
    { question: "", answer: "" },
  )
})
