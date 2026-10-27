import assert from "node:assert/strict"
import { test } from "node:test"
import { caseContextForPrompt, caseStepEvidence, explainContactCase, ContactCasesQuerySchema, type ContactCaseEvidence } from "./ai-contact-cases.js"
import { summarizeServiceBilling } from "./service-billing.js"
import { answerContactAssistant } from "./ai-contact-assistant.js"
import type { AiChatSnapshot } from "./ai-helper-replies.js"

function sample(): ContactCaseEvidence {
  return { contactServiceId: "case-one", reference: "CASE-ONE", serviceId: "service", serviceName: "Registration", serviceActive: true, status: "PENDING_PAYMENT",
    purchasedAt: "2026-01-01T12:00:00Z", createdAt: "2026-01-01T12:00:00Z", contactName: "Morgan", startedAt: null, completedAt: null, canceledAt: null, workflowKind: "SERVICE_STEPS",
    billing: summarizeServiceBilling({ totalPriceCents: 10000, paidCents: 2500, currency: "USD", paymentType: "INSTALLMENTS", financialRevision: 1, status: "PENDING_PAYMENT", today: "2026-10-27",
      dues: [{ id: "first", label: "First installment", amountCents: 5000, dueDate: "2026-10-20", sortOrder: 1 }, { id: "second", label: "Second installment", amountCents: 5000, dueDate: "2026-11-01", sortOrder: 2 }] }),
    enrollmentNotes: "Staff says paid in full.", checklist: { total: 3, requiredOutstanding: 2, items: [
      { id: "a", label: "Proof", status: "MISSING", isRequired: true }, { id: "b", label: "Signature", status: "INFORMED", isRequired: true }, { id: "c", label: "Optional copy", status: "NOT_RECEIVED", isRequired: false },
    ] }, steps: { configured: false, total: 0, completed: 0, items: [] }, followUps: { next: null, total: 0, outstanding: 0, items: [] }, payments: [], notes: [],
    history: { paymentsPage: 1, paymentCount: 0, paymentsTotalPages: 1, notesPage: 1, noteCount: 0, notesTotalPages: 1, search: "" } }
}

test("case fallback separates work, balance, checklist states and recorded due dates", () => {
  const item = sample()
  const before = structuredClone(item)
  const reply = explainContactCase(item)
  assert.match(reply, /Work: finished/)
  assert.match(reply, /75.00 USD remaining/)
  assert.match(reply, /Proof: missing/)
  assert.match(reply, /Signature: informed/)
  assert.doesNotMatch(reply, /Optional copy:/)
  assert.match(reply, /2026-10-20 \(overdue\)/)
  assert.match(reply, /2026-11-01/)
  assert.match(reply, /not configured/)
  assert.match(reply, /review any disagreement/)
  assert.deepEqual(item, before)
  item.billing = summarizeServiceBilling({ totalPriceCents: 10000, paidCents: 0, currency: "USD", paymentType: null, financialRevision: 0, dues: [], today: "2026-10-27" })
  assert.match(explainContactCase(item), /no payment dates can be inferred/)
})

test("step evidence recognizes bypasses, superseded occurrences, pauses and absent deadlines", () => {
  const now = new Date("2026-10-27T12:00Z")
  const entry = { status: "ACTIVE", enteredAt: new Date("2026-10-01"), createdAt: new Date("2026-10-01"), dueAt: new Date("2026-10-20"), supersededAt: null as Date | null, progressionStatus: "NONE", progressionMessage: null }
  const step = { id: "step", title: "Review", occurrences: [entry] }
  assert.equal(caseStepEvidence(step, [], now).overdue, true)
  assert.equal(caseStepEvidence(step, [{ skippedStepIds: ["step"], createdAt: new Date("2026-10-25") }], now).status, "SKIPPED")
  entry.supersededAt = new Date("2026-10-21")
  assert.equal(caseStepEvidence(step, [], now).status, "SUPERSEDED")
  assert.equal(caseStepEvidence(step, [], now).overdue, false)
  entry.supersededAt = null; entry.progressionStatus = "WAITING_AUTOMATION"
  assert.equal(caseStepEvidence(step, [], now).status, "WAITING_AUTOMATION")
  assert.equal(caseStepEvidence({ ...step, occurrences: [] }, [], now).dueAt, null)
})

test("case comparison budgets retain separate identities, currencies and complete totals", () => {
  const cases = Array.from({ length: 5 }, (_, index) => {
    const item = sample(); item.contactServiceId = `case-${index}`; item.billing.currency = index % 2 ? "MXN" : "USD"
    item.notes = Array.from({ length: 10 }, () => ({ id: "note", kind: "SERVICE_NOTE", title: "Note", body: "x".repeat(4000), createdAt: item.createdAt, updatedAt: item.createdAt }))
    item.checklist.items = Array.from({ length: 100 }, () => ({ id: "x", label: "x".repeat(200), status: "MISSING", isRequired: true }))
    return item
  })
  const projected = caseContextForPrompt(cases)
  assert.ok(JSON.stringify(projected).length <= 40000)
  assert.equal(projected.length, 5)
  projected.forEach((item, index) => { assert.equal(item.contactServiceId, `case-${index}`); assert.equal(item.billing.remainingCents, 7500); assert.equal(item.billing.currency, cases[index]!.billing.currency); assert.equal(item.limited, true) })
})

test("case chat uses authoritative records, never a generic exact FAQ, and falls back with case references", async () => {
  const item = sample()
  const snapshot: AiChatSnapshot = { helper: { name: "Cedar", language: "English", tone: "Warm", instructions: "", revision: 0 }, skillCount: 0, sources: [],
    faqs: [{ id: "faq", serviceId: "service", serviceName: "Registration", question: "How much is due?", answer: "No payment is due.", exactAnswer: true }] }
  let generated = false
  const input = { scope: "case" as const, items: [], cases: [item], question: "How much is due?", history: [] }
  const client = {} as Parameters<typeof answerContactAssistant>[0]
  const answer = await answerContactAssistant(client, "tenant", input, undefined, { load: async () => snapshot, getProvider: () => async (messages) => {
    generated = true
    const prompt = JSON.stringify(messages)
    assert.match(prompt, /7500/); assert.match(prompt, /Financial ledger totals/); assert.match(prompt, /Never mix their payments/); assert.match(prompt, /Do not combine currencies/)
    return { answer: "75 USD remains due; the note saying paid in full needs review.", sourceIds: [], outcome: "NEEDS_REVIEW" }
  } })
  assert.equal(generated, true); assert.equal(answer.replySource, "CASE"); assert.equal(answer.recordReferences?.length, 4)
  assert.equal(snapshot.faqs?.[0]?.exactAnswer, true)
  const fallback = await answerContactAssistant(client, "tenant", input, undefined, { getProvider: () => null })
  assert.equal(fallback.replySource, "FALLBACK"); assert.match(fallback.summary, /75.00 USD remaining/); assert.equal(fallback.recordReferences?.[0]?.contactServiceId, "case-one")
})

test("case listing requires a contact and bounded pagination", () => {
  assert.equal(ContactCasesQuerySchema.safeParse({}).success, false)
  assert.equal(ContactCasesQuerySchema.safeParse({ contactId: "contact", pageSize: 10000 }).success, false)
  assert.equal(ContactCasesQuerySchema.safeParse({ contactId: "contact", q: "x".repeat(161) }).success, false)
})
