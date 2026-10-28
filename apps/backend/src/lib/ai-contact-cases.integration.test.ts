import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import type { AddressInfo } from "node:net"
import express, { type ErrorRequestHandler, type Router } from "express"
import cookieParser from "cookie-parser"
import { z } from "zod"
import { sha256 } from "./crypto.js"
import { answerContactAssistant } from "./ai-contact-assistant.js"
import { canManageContactServices } from "./contact-service-permissions.js"

test("purchased-case routes isolate repeat purchases, read histories without writes, and allow LOW staff to book service consultations", {
  skip: process.env.AI_CONTACT_CASES_DB_TEST !== "1",
}, async (t) => {
  const { prisma } = await import("./prisma.js")
  const { createContactAssistantRouter } = await import("../routes/contact-assistant.routes.js")
  const { default: appointments } = await import("../routes/appointments.routes.js")
  const { evaluateServiceFitScan, default: serviceRoutes } = await import("../routes/services.routes.js")
  const tenantId = randomUUID(), foreignId = randomUUID(), userId = randomUUID(), agentId = randomUUID(), token = randomUUID()
  t.after(async () => {
    await prisma.service.deleteMany({ where: { tenantId: { in: [tenantId, foreignId] }, kind: "OFFERING" } })
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignId] } } })
    await prisma.user.deleteMany({ where: { id: { in: [userId, agentId] } } })
    await prisma.$disconnect()
  })
  await prisma.tenant.createMany({ data: [tenantId, foreignId].map((id) => ({ id, slug: `case-test-${id}`, name: "Fictional case test", timezone: "UTC" })) })
  await prisma.user.createMany({ data: [userId, agentId].map((id) => ({ id, name: id === agentId ? "Receiving agent" : "Sales fixture", email: `case-${id}@example.test` })) })
  await prisma.membership.createMany({ data: [userId, agentId].map((id) => ({ userId: id, tenantId, role: "TENANT_USER" as const, securityLevel: id === agentId ? "MEDIUM" as const : "LOW" as const, status: "ACTIVE" as const, calendarEnabled: true })) })
  await prisma.session.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 600000) } })
  const status = await prisma.contactStatusConfig.create({ data: { tenantId, name: "Fixture", bgColor: "#fff", textColor: "#000" } })
  const contact = await prisma.contact.create({ data: { tenantId, firstName: "Morgan", lastName: "Case Fixture", statusConfigId: status.id } })
  const otherContact = await prisma.contact.create({ data: { tenantId, firstName: "Other", lastName: "Contact", statusConfigId: status.id } })
  const parent = await prisma.service.create({ data: { tenantId, kind: "GROUP", name: "Fictional services", basePriceCents: 0 } })
  const service = await prisma.service.create({ data: { tenantId, kind: "OFFERING", parentServiceId: parent.id, name: "Registration", basePriceCents: 500000,
    fitProfile: { enabled: true, rules: [{ id: "name", source: "core", fieldKey: "firstName", valueType: "string", operator: "equals", compareValue: "Another name", required: true, weight: 1 }] } } })
  const inactive = await prisma.service.create({ data: { tenantId, kind: "OFFERING", parentServiceId: parent.id, name: "Archived service", basePriceCents: 0, isActive: false } })
  const first = await prisma.contactService.create({ data: { tenantId, contactId: contact.id, serviceId: service.id, purchasedAt: new Date("2025-01-01T12:00Z"), totalPriceCents: 10000, currency: "USD", workflowKind: "SERVICE_STEPS", paymentType: "INSTALLMENTS", financialRevision: 1,
    notes: "Staff statement: paid in full — review this against the ledger.", retiredWorkflowSnapshot: { PRIVATE_RETIRED_SENTINEL: "must not reach generation" } } })
  const second = await prisma.contactService.create({ data: { tenantId, contactId: contact.id, serviceId: service.id, purchasedAt: new Date("2026-01-01T12:00Z"), totalPriceCents: 20000, currency: "MXN", status: "PENDING_PAYMENT", paymentType: "SINGLE_PAYMENT", workflowKind: "LEGACY_TEMPLATE" } })
  const archived = await prisma.contactService.create({ data: { tenantId, contactId: contact.id, serviceId: inactive.id, totalPriceCents: 5000, status: "CANCELED", workflowKind: "LEGACY_TEMPLATE" } })
  const privateCase = await prisma.contactService.create({ data: { tenantId, contactId: otherContact.id, serviceId: service.id, totalPriceCents: 9000, notes: "OTHER_CONTACT_SECRET" } })
  const past = new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10), future = new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10)
  await prisma.contactServicePaymentDue.createMany({ data: [
    { tenantId, contactServiceId: first.id, label: "First installment", amountCents: 5000, remainingCents: 5000, dueDate: new Date(`${past}T00:00Z`), sortOrder: 1 },
    { tenantId, contactServiceId: first.id, label: "Second installment", amountCents: 5000, remainingCents: 5000, dueDate: new Date(`${future}T00:00Z`), sortOrder: 2 },
  ] })
  await prisma.contactServicePayment.createMany({ data: [
    ...Array.from({ length: 25 }, (_, index) => ({ tenantId, contactServiceId: first.id, amountCents: 100, paidAt: new Date(Date.now() - index * 1000), paymentMethod: "Cash" })),
    { tenantId, contactServiceId: first.id, amountCents: 9000, paidAt: new Date(), voidedAt: new Date(), note: "VOIDED_TEST_PAYMENT" },
    { tenantId, contactServiceId: second.id, amountCents: 20000, paidAt: new Date(), note: "SECOND_PURCHASE_SECRET" },
  ] })
  const checklist = await prisma.serviceChecklistItem.create({ data: { tenantId, serviceId: service.id, label: "Changed catalog label", isRequired: false } })
  await prisma.contactServiceChecklistItem.create({ data: { tenantId, contactServiceId: first.id, checklistItemId: checklist.id, labelSnapshot: "Purchased proof requirement", isRequiredSnapshot: true, status: "INFORMED" } })
  const step = await prisma.contactServiceStep.create({ data: { tenantId, contactServiceId: first.id, sourceStepId: randomUUID(), title: "Review documents", completionDuration: 3, completionUnit: "DAYS", sortOrder: 1 } })
  await prisma.serviceStepOccurrence.create({ data: { tenantId, contactServiceId: first.id, stepId: step.id, entryKey: "fixture", occurrenceNumber: 1, enteredAt: new Date(`${past}T10:00Z`), dueAt: new Date(`${past}T12:00Z`), defaultDueAt: new Date(`${past}T12:00Z`) } })
  const followUp = await prisma.contactServiceFollowUpStep.create({ data: { tenantId, contactServiceId: second.id, title: "Call back", status: "PENDING", dueAt: new Date(`${future}T12:00Z`) } })
  for (let index = 0; index < 12; index++) {
    const common = { tenantId, contactServiceId: first.id, createdById: userId, title: `Case note ${index}`, body: index === 0 ? "SEARCHABLE_DEEP_NOTE" : `First purchase note ${index}`, updatedAt: new Date(Date.now() - index * 1000) }
    if (index % 2) await prisma.contactServiceNote.create({ data: common })
    else await prisma.contactNote.create({ data: { ...common, contactId: contact.id } })
  }
  await prisma.contactServiceNote.create({ data: { tenantId, contactServiceId: second.id, createdById: userId, title: "Second purchase only", body: "SECOND_PURCHASE_SECRET" } })
  await prisma.contactNote.create({ data: { tenantId, contactId: contact.id, createdById: userId, title: "Unlinked note", body: "UNLINKED_NOTE_SECRET" } })
  let scans = 0, generated = 0, fail = false, lastPrompt = "", clock = Date.now(), allowQualification = false
  const activities: { qualificationRun: boolean; questionOutcome?: string | null }[] = []
  const app = express(); app.use(cookieParser(), express.json())
  app.use("/api/services", createContactAssistantRouter({
    requireMembership: async (_req, res, scope) => { if (scope !== tenantId) { res.status(403).json({ error: "TENANT_ACCESS_DENIED" }); return null }; return { role: "TENANT_USER", securityLevel: "LOW" } },
    evaluate: async (input) => { scans++; assert.equal(allowQualification, true, "Only explicit qualification questions may run the fit scan"); return evaluateServiceFitScan(input) },
    now: () => clock += 61000,
    identity: async () => ({ name: "Cedar", avatar: { presetId: "compass", imageUrl: null, revision: 0 } }),
    record: async (_client, activity) => { activities.push(activity); return { count: 1 } },
    reply: (db, scope, input, signal, overrides) => answerContactAssistant(db, scope, input, signal, { getProvider: () => async (messages) => {
      if (fail) throw new Error("Provider unavailable")
      generated++; lastPrompt = messages[1]!.content
      assert.doesNotMatch(lastPrompt, /OTHER_CONTACT_SECRET|UNLINKED_NOTE_SECRET|PRIVATE_RETIRED_SENTINEL/)
      return { answer: "The selected purchase records were reviewed. Staff statements do not override the ledger.", sourceIds: [], outcome: "ANSWERED" }
    }, ...overrides }),
  }))
  app.use("/api/appointments", appointments as unknown as Router)
  app.use("/api/services", serviceRoutes as unknown as Router)
  const errors: ErrorRequestHandler = (error, _req, res, _next) => res.status(error instanceof z.ZodError ? 400 : error.status ?? 500).json({ error: error.message })
  app.use(errors)
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); listener.once("error", reject) })
  t.after(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() }))
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const headers = { cookie: `sid=${token}`, origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", "content-type": "application/json" }
  const path = `/api/services/${tenantId}/fit-scan`
  const ask = async (body: Record<string, unknown>) => { const response = await fetch(`${root}${path}/assistant`, { method: "POST", headers, body: JSON.stringify({ contactId: contact.id, requestId: randomUUID(), ...body }) }); return { response, data: await response.json() } }
  const businessState = async () => JSON.stringify(await Promise.all([
    prisma.contactService.findMany({ where: { tenantId }, orderBy: { id: "asc" } }), prisma.contactServiceFollowUpStep.findMany({ where: { tenantId } }),
    prisma.contactServicePayment.count({ where: { tenantId } }), prisma.contactServiceChecklistItem.findMany({ where: { tenantId } }), prisma.serviceStepOccurrence.findMany({ where: { tenantId } }),
  ]))
  const before = await businessState()
  const headerRead = await fetch(`${root}/api/services/${tenantId}/contact-services?contactId=${contact.id}&pageSize=25&readOnly=true`, { headers })
  assert.equal(headerRead.status, 200)
  assert.equal(await businessState(), before, "Passive contact header must not sync, backfill or reconcile")
  let response = await fetch(`${root}${path}/cases?contactId=${contact.id}`, { headers })
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store")
  const list = await response.json(); assert.equal(list.pagination.total, 3); assert.equal(list.items.find((item: { contactServiceId: string }) => item.contactServiceId === archived.id).serviceActive, false)
  let result = await ask({ scope: "service", serviceId: service.id, question: "Has this service been purchased?" })
  assert.equal(result.response.status, 200); assert.equal(result.data.caseChoices.length, 2); assert.equal(generated, 0)
  result = await ask({ scope: "case", contactServiceId: first.id, question: "What is outstanding?" })
  assert.equal(result.data.selectedCase.billing.paidCents, 2500); assert.equal(result.data.selectedCase.billing.remainingCents, 7500)
  assert.equal(result.data.selectedCase.billing.schedule[0].remainingCents, 2500); assert.equal(result.data.selectedCase.billing.schedule[0].state, "OVERDUE")
  assert.equal(result.data.selectedCase.billing.schedule[1].dueDate, future)
  assert.equal(result.data.selectedCase.checklist.items[0].label, "Purchased proof requirement"); assert.equal(result.data.selectedCase.checklist.requiredOutstanding, 1)
  assert.equal(result.data.selectedCase.steps.items[0].overdue, true); assert.equal(result.data.selectedCase.history.paymentCount, 26)
  assert.doesNotMatch(lastPrompt, /SECOND_PURCHASE_SECRET/)
  response = await fetch(`${root}${path}/cases/${first.id}?contactId=${contact.id}&paymentsPage=2&notesPage=2`, { headers })
  const history = (await response.json()).item; assert.equal(history.payments.length, 6); assert.equal(history.notes.length, 2); assert.equal(history.billing.paidCents, 2500)
  response = await fetch(`${root}${path}/cases/${first.id}?contactId=${contact.id}&q=SEARCHABLE_DEEP_NOTE`, { headers })
  assert.equal((await response.json()).item.notes.length, 1)
  result = await ask({ scope: "case", contactServiceId: second.id, question: "What about this purchase?" })
  assert.equal(result.data.selectedCase.billing.workState, "FINISHED"); assert.equal(result.data.selectedCase.billing.currency, "MXN"); assert.equal(result.data.selectedCase.billing.remainingCents, 0)
  assert.equal(result.data.selectedCase.followUps.items[0].status, "PENDING")
  result = await ask({ scope: "case", compareContactServiceIds: [first.id, second.id], question: "Compare these purchases" })
  assert.equal(result.data.comparedCases.length, 2); assert.match(lastPrompt, /USD/); assert.match(lastPrompt, /MXN/)
  fail = true; result = await ask({ scope: "case", contactServiceId: first.id, question: "What remains to be paid?" })
  assert.equal(result.data.answer.replySource, "FALLBACK"); assert.match(result.data.answer.summary, /75.00 USD remaining/); assert.equal(result.data.answer.recordReferences.length, 4)
  assert.equal((await ask({ scope: "case", contactServiceId: privateCase.id })).response.status, 404)
  assert.equal((await ask({ scope: "case", contactServiceId: first.id, contactId: otherContact.id })).response.status, 404)
  assert.equal((await ask({ scope: "case", contactServiceId: first.id, serviceId: inactive.id })).response.status, 404)
  assert.equal((await fetch(`${root}${path}/cases?contactId=${contact.id}&pageSize=10000`, { headers })).status, 400)
  assert.equal((await fetch(`${root}/api/services/${foreignId}/fit-scan/cases?contactId=${contact.id}`, { headers })).status, 403)
  assert.equal(scans, 0); assert.equal(activities.every((activity) => !activity.qualificationRun), true)
  allowQualification = true; fail = false
  result = await ask({ scope: "case", contactServiceId: first.id, question: "Does this contact qualify for the service now?" })
  assert.equal(result.response.status, 200); assert.equal(scans, 1)
  assert.equal(result.data.items[0].eligibilityStatus, "NOT_ELIGIBLE"); assert.equal(result.data.items[0].purchaseCount, 2)
  assert.equal(activities.at(-1)?.qualificationRun, true)
  const prospective = await prisma.service.create({ data: { tenantId, parentServiceId: parent.id, kind: "OFFERING", name: "Document review", basePriceCents: 0,
    fitProfile: { enabled: true, rules: [{ id: "name", source: "core", fieldKey: "firstName", valueType: "string", operator: "is_not_empty", required: true, weight: 1 }] } } })
  result = await ask({ scope: "case", serviceId: service.id, contactServiceId: first.id, question: "Does the contact qualify for Document review?" })
  assert.equal(result.response.status, 200); assert.equal(result.data.scope.mode, "service"); assert.equal(result.data.scope.serviceId, prospective.id)
  assert.equal(result.data.selectedCase, null); assert.equal(result.data.caseChoices.length, 0); assert.equal(scans, 2)
  assert.equal(result.data.items.find((item: { serviceId: string }) => item.serviceId === prospective.id).eligibilityStatus, "ELIGIBLE")
  assert.equal(await businessState(), before)
  assert.equal((await prisma.contactServiceFollowUpStep.findUniqueOrThrow({ where: { id: followUp.id } })).status, "PENDING")
  assert.equal(canManageContactServices({ role: "TENANT_USER", securityLevel: "LOW" }), false)
  await prisma.calendarAvailabilityRule.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ tenantId, scope: "TENANT" as const, kind: "OPEN" as const, dayOfWeek, startTimeMinutes: 0, endTimeMinutes: 1440 })) })
  await prisma.calendarAvailabilityRule.createMany({ data: Array.from({ length: 7 }, (_, dayOfWeek) => ({ tenantId, userId: agentId, scope: "USER" as const, kind: "OPEN" as const, dayOfWeek, startTimeMinutes: 0, endTimeMinutes: 1440 })) })
  const bookingDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  response = await fetch(`${root}/api/appointments/${tenantId}`, { method: "POST", headers, body: JSON.stringify({ contactId: contact.id, serviceId: service.id, assignedToUserId: agentId,
    title: "Fictional consultation", startAt: `${bookingDate}T14:00:00Z`, endAt: `${bookingDate}T14:30:00Z` }) })
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  const booked = await prisma.appointment.findFirstOrThrow({ where: { tenantId, contactId: contact.id } })
  assert.equal(booked.serviceId, service.id); assert.equal(booked.assignedToUserId, agentId); assert.equal(booked.bookedByUserId, userId)
  assert.equal("contactServiceId" in booked, false); assert.equal(await prisma.contactService.count({ where: { tenantId } }), 4)
})
