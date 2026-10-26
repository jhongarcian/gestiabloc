import assert from "node:assert/strict"
import { test } from "node:test"
import {
  AiChatError,
  replyToAiTestChat,
  retrieveAiChatSources,
  type AiChatSnapshot,
  type AiChatProvider,
} from "./ai-test-chat.js"
import { faqMatchMessages, faqTranslationMessages } from "./ai-faq-replies.js"

const answer =
  "Bring your original ID.\nThe Harbor intake code is H-27; allow 3 days."
function snapshot(exactAnswer = true): AiChatSnapshot {
  return {
    helper: {
      name: "Harbor",
      language: "English and Spanish",
      tone: "Warm",
      instructions: "Append a greeting and signature.",
      revision: 1,
    },
    skillCount: 1,
    faqs: [
      {
        id: "one",
        serviceId: "registration",
        serviceName: "Registration",
        question: "What should I bring to Registration intake?",
        answer,
        exactAnswer,
      },
    ],
    sources: [
      {
        id: "faq:one",
        label: "Registration · Intake",
        section: "faq",
        skillId: "registration",
        faqId: "one",
        content: `Question: What should I bring to Registration intake?\nAnswer: ${answer}`,
      },
    ],
  }
}
const input = {
  question: "What do I bring to Registration intake?",
  history: [],
}
test("close FAQ matches return saved answer byte-for-byte without tone, instructions or generation", async () => {
  const data = snapshot()
  const provider: AiChatProvider = async () => {
    assert.fail("Exact replies must bypass ordinary generation")
  }
  provider.matchFaq = async (
    _question,
    _history,
    candidates,
    _language,
    signal,
  ) => {
    assert.equal(candidates[0].serviceName, "Registration")
    assert.ok(signal)
    return { faqId: "one", translate: false, language: "English" }
  }
  const result = await replyToAiTestChat(data, input, provider)
  assert.equal(result.answer, answer)
  assert.equal(result.answerMode, "EXACT")
  assert.equal(result.sources[0].faqId, "one")
})
test("translation uses only the saved answer and dedicated translation prompt", async () => {
  const translated =
    "Traiga su identificación original.\nEl código de admisión de Harbor es H-27; espere 3 días."
  const provider: AiChatProvider = async () => {
    assert.fail("No adaptation on translated exact replies")
  }
  provider.matchFaq = async () => ({
    faqId: "one",
    translate: true,
    language: "Spanish",
  })
  provider.translateFaq = async (saved, language) => {
    assert.equal(saved, answer)
    assert.equal(language, "Spanish")
    return { answer: translated }
  }
  const result = await replyToAiTestChat(
    snapshot(),
    { ...input, question: "¿Qué llevo a Registration intake?" },
    provider,
  )
  assert.equal(result.answer, translated)
  assert.equal(result.answerMode, "TRANSLATED")
  const prompt = faqTranslationMessages(answer, "Spanish")
  assert.match(prompt[0].content, /Do not add, omit, summarize, adapt/)
  assert.deepEqual(JSON.parse(prompt[1].content), { savedAnswer: answer })
  assert.doesNotMatch(JSON.stringify(prompt), /Append a greeting/)
})
test("unchecked answers and nonmatching questions follow the adaptive conversation path", async () => {
  const provider: AiChatProvider = async (messages) => {
    assert.match(messages[0].content, /Append a greeting/)
    return { answer: "A contextual reply.", sourceIds: ["faq:one"] }
  }
  provider.matchFaq = async () => {
    assert.fail("Unchecked FAQs do not enter exact matching")
  }
  assert.equal(
    (await replyToAiTestChat(snapshot(false), input, provider)).answerMode,
    "ADAPTED",
  )
  provider.matchFaq = async () => ({
    faqId: null,
    translate: false,
    language: "English",
  })
  assert.equal(
    (await replyToAiTestChat(snapshot(), input, provider)).answerMode,
    "ADAPTED",
  )
})
test("unavailable, foreign, and invalid exact-match responses cannot silently adapt or quote another FAQ", async () => {
  const provider: AiChatProvider = async () => {
    assert.fail("No silent fallback")
  }
  await assert.rejects(
    replyToAiTestChat(snapshot(), input, provider),
    (e) => e instanceof AiChatError && e.status === 503,
  )
  provider.matchFaq = async () => ({
    faqId: "foreign",
    translate: false,
    language: "English",
  })
  await assert.rejects(
    replyToAiTestChat(snapshot(), input, provider),
    (e) => e instanceof AiChatError && e.status === 502,
  )
  provider.matchFaq = async () => ({
    faqId: "one",
    translate: true,
    language: "Spanish",
  })
  await assert.rejects(
    replyToAiTestChat(snapshot(), input, provider),
    (e) => e instanceof AiChatError && e.status === 503,
  )
  const data = snapshot()
  data.helper.language = "English"
  await assert.rejects(
    replyToAiTestChat(data, input, provider),
    (e) => e instanceof AiChatError && e.status === 502,
  )
})
test("FAQ context remains whole and bounded, and matching prompts carry service identity", () => {
  const data = snapshot()
  data.sources[0].content = "x".repeat(15000)
  assert.equal(retrieveAiChatSources(data, input).sources.length, 0)
  const messages = faqMatchMessages(
    input.question,
    [],
    snapshot().faqs!,
    "English",
  )
  assert.match(
    messages[0].content,
    /Keyword overlap or a related topic is not enough/,
  )
  assert.equal(
    JSON.parse(messages[1].content).faqs[0].serviceName,
    "Registration",
  )
})
