import {
  getAiChatProvider, loadAiHelperSnapshot, replyToAiHelper,
  type AiChatProvider,
} from "./ai-helper-replies.js"
import { buildServiceFitAssistantReply, type ServiceFitAssistantReply } from "./service-fit-assistant.js"
import { contactContextForPrompt, explainContactService, type ContactAssistantContext } from "./contact-assistant-context.js"
import type { AiTestChatInput } from "./ai-helper-replies.js"
import { caseContextForPrompt, contactCaseReferences, explainContactCase, type ContactCaseEvidence, type ContactCaseReference } from "./ai-contact-cases.js"

export type ContactAssistantInput = Omit<Parameters<typeof buildServiceFitAssistantReply>[0], "scope"> & {
  scope: "all" | "service" | "case"
  cases?: ContactCaseEvidence[]
  contactContext?: ContactAssistantContext
  history?: AiTestChatInput["history"]
}
export type ContactAssistantAnswer = ServiceFitAssistantReply & {
  replySource: "KNOWLEDGE" | "CONTACT" | "CASE" | "RULES" | "FALLBACK"
  recordReferences?: ContactCaseReference[]
  answerMode?: "ADAPTED" | "EXACT" | "TRANSLATED"
  sources?: Awaited<ReturnType<typeof replyToAiHelper>>["sources"]
}
type Dependencies = {
  load: typeof loadAiHelperSnapshot
  getProvider: () => AiChatProvider | null
}
const ruleQuestions = new Set([
  "what should i do next for this service",
  "what does this contact still need for this service",
  "what would need to change for this service",
  "should i review another service instead",
  "show services that still need information",
  "which service is already active for this contact",
])
export function isContactQualificationQuestion(question: string) {
  const normalized = question.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  if (ruleQuestions.has(normalized.trim().replace(/[?!.]+$/, ""))) return true
  return [
    /\b(qualif\w*|eligib\w*|fit|scores?|scoring|blocked|blocking|missing)\b/,
    /\b(why not|age|edad|disabil\w*|discapacid\w*)\b/,
    /\b(why|which|what)\b.*\b(rules?|conditions?|fields?|data|records?)\b/,
    /\b(meet\w*|satisf\w*|pass\w*|fail\w*)\b.*\b(requirements?|conditions?|rules?|criteria)\b/,
    /\b(can|could|should)\b.*\b(enroll|apply|start|proceed|move forward)\b/,
    /\b(keep|replace|change)\b.*\b(benefit|coverage|plan|policy|record)\b/,
    /\b(calific\w*|cualific\w*|elegib\w*|puntua\w*|puntaje|falt\w*|bloque\w*)\b/,
    /\b(pued\w*|deber\w*)\b.*\b(inscrib\w*|aplicar|iniciar|continuar)\b/,
    /\b(por que|que|cual\w*)\b.*\b(reglas?|condiciones?|datos?|campos?|registros?)\b/,
    /\b(cumpl\w*|satisfac\w*)\b.*\b(requisitos?|condiciones?|reglas?|criterios?)\b/,
  ].some((pattern) => pattern.test(normalized))
}

export async function answerContactAssistant(
  client: Parameters<typeof loadAiHelperSnapshot>[0],
  tenantId: string,
  input: ContactAssistantInput,
  signal?: AbortSignal,
  dependencies: Partial<Dependencies> = {},
): Promise<ContactAssistantAnswer> {
  const question = input.question?.trim()
  const references = input.cases?.length ? contactCaseReferences(input.cases) : undefined
  const rules = (): ServiceFitAssistantReply => {
    if (input.cases?.length) {
      const qualification = input.contactContext?.services.filter((service) => input.cases!.some((item) => item.serviceId === service.serviceId))
        .map((service) => explainContactService(input.contactContext!, service)) ?? []
      return { title: input.cases[0]!.contactName, summary: [...input.cases.map(explainContactCase), ...qualification].join("\n\n"), bullets: [], suggestedQuestions: [] }
    }
    if (!input.contactContext) return { ...buildServiceFitAssistantReply({ ...input, scope: input.scope === "case" ? "service" : input.scope }), suggestedQuestions: [] }
    const services = input.contactContext.services.filter((service) => input.scope !== "service" || service.serviceId === input.serviceId)
    return { title: input.contactContext.contactName, summary: services.map((service) => explainContactService(input.contactContext!, service)).join("\n\n") || "No qualification checks are configured for these services yet.", bullets: [], suggestedQuestions: [] }
  }
  if (!question)
    return { ...rules(), outcome: "ANSWERED", replySource: input.cases?.length ? "CASE" : "RULES", recordReferences: references }

  const { load = loadAiHelperSnapshot, getProvider = getAiChatProvider } = dependencies
  try {
    const provider = getProvider()
    if (!provider) throw new Error("AI_PROVIDER_UNAVAILABLE")
    // Only the authorized, non-encrypted projection built by the server is supplied.
    const serviceIds = input.cases?.length ? [...new Set(input.cases.map((item) => item.serviceId))] : input.scope === "service" && input.serviceId
      ? [input.serviceId]
      : undefined
    const request = { question, history: input.history ?? [] }
    const snapshot = await load(client, tenantId, request, serviceIds)
    const followsAssessment = input.history?.some((entry) => entry.role === "user" && isContactQualificationQuestion(entry.content))
      && /^(and|so|why|what about|would|could|y |entonces|por que)\b/i.test(question)
    const words = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    const mentionsContact = input.contactContext?.contactName.split(/\s+/).some((part) => words(part).length > 1 && ` ${words(question)} `.includes(` ${words(part)} `))
    const personal = Boolean(input.cases?.length) || isContactQualificationQuestion(question) || followsAssessment || mentionsContact || /\b(contact|he|she|his|her|they|their|this person|el|ella|cliente)\b/i.test(question)
    // An exact FAQ must never substitute generic advice for a personal assessment.
    const groundedSnapshot = personal ? { ...snapshot, faqs: snapshot.faqs?.map((faq) => ({ ...faq, exactAnswer: false })) } : snapshot
    const contactPrompt = input.contactContext ? contactContextForPrompt(input.contactContext, serviceIds) : input.cases?.length
      ? { contactName: input.cases[0]!.contactName, facts: [], services: [], catalog: [], limited: false } : undefined
    const reply = await replyToAiHelper(groundedSnapshot, request, provider, signal, "CONTACT",
      contactPrompt ? { ...contactPrompt, ...(input.cases?.length ? { cases: caseContextForPrompt(input.cases) } : {}) } : undefined)
    return {
      title: snapshot.helper.name,
      summary: reply.answer,
      bullets: [], suggestedQuestions: [],
      outcome: reply.outcome,
      replySource: input.cases?.length ? "CASE" : input.contactContext ? "CONTACT" : "KNOWLEDGE",
      recordReferences: references,
      answerMode: reply.answerMode,
      sources: reply.sources,
    }
  } catch (error) {
    if (signal?.aborted) throw error
    // Provider absence, timeout, invalid citations and source-read failures must
    // never disable qualification guidance or service-start controls.
    return { ...rules(), outcome: "NEEDS_REVIEW", replySource: "FALLBACK", recordReferences: references }
  }
}
