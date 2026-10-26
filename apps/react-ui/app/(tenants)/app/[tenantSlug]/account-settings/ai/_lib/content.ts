export type AiFaq = {
  id: string
  question: string
  answer: string
  exactAnswer: boolean
  sortOrder: number
}
export type AiFaqInput = Pick<AiFaq, "question" | "answer" | "exactAnswer">
export type AiFaqCollection = {
  faqs: AiFaq[]
  revision: string
  legacyNotes: string
}
export type AiKnowledgeInput = {
  description: string
  pricingNotes: string
  workflowNotes: string
  adapter: "NONE" | "IMMIGRATION_USCIS"
  verification: {
    mode:
      | "NONE"
      | "WEB_SOURCES"
      | "INTERNAL_KB"
      | "EXTERNAL_API"
      | "MANUAL_CONFIRMATION"
    guidance: string
    triggerKeywords: string[]
  }
}
export function knowledgeInput(value: AiKnowledgeInput): AiKnowledgeInput {
  return {
    description: value.description.trim(),
    pricingNotes: value.pricingNotes.trim(),
    workflowNotes: value.workflowNotes.trim(),
    adapter: value.adapter,
    verification: {
      mode: value.verification.mode,
      guidance: value.verification.guidance.trim(),
      triggerKeywords: [
        ...new Set(
          value.verification.triggerKeywords
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ],
    },
  }
}
export function faqErrors(value: AiFaqInput) {
  return {
    question: !value.question.trim()
      ? "Enter a question."
      : value.question.trim().length > 500
        ? "Keep the question to 500 characters or fewer."
        : "",
    answer: !value.answer.trim()
      ? "Enter an answer."
      : value.answer.trim().length > 4000
        ? "Keep the answer to 4,000 characters or fewer."
        : "",
  }
}
export function knowledgeValidation(value: AiKnowledgeInput) {
  const input = knowledgeInput(value)
  if (input.description.length > 6000)
    return "Keep the description to 6,000 characters or fewer."
  if (
    input.pricingNotes.length > 4000 ||
    input.workflowNotes.length > 4000 ||
    input.verification.guidance.length > 4000
  )
    return "Keep each guidance field to 4,000 characters or fewer."
  if (
    input.verification.triggerKeywords.length > 12 ||
    input.verification.triggerKeywords.some((item) => item.length > 120)
  )
    return "Use up to 12 trigger keywords, with no more than 120 characters each."
  return ""
}
