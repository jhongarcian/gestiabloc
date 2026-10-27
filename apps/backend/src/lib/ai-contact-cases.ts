import { z } from "zod"
import { Prisma, type PrismaClient } from "../generated/prisma/index.js"
import { summarizeServiceBilling, tenantDateOnly } from "./service-billing.js"
import { readEnrollmentConfiguration, serializeEnrolledChecklistItem, enrolledChecklistSnapshotSelect } from "./service-enrollment-snapshots.js"
import { resolveEffectiveNextFollowUp, serializeEffectiveNextFollowUp } from "./service-followup-next-follow-up.js"
import { sanitizeNoteBody } from "./note-inputs.js"

export class ContactCaseError extends Error {
  readonly status = 404
  constructor(code = "CONTACT_SERVICE_NOT_FOUND") { super(code) }
}
export const ContactCasesQuerySchema = z.object({
  contactId: z.string().trim().min(1),
  serviceId: z.string().trim().min(1).optional(),
  q: z.string().trim().max(160).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().refine((size) => size === 10 || size === 25).default(10),
}).strict()
export const CaseHistoryQuerySchema = z.object({
  paymentsPage: z.coerce.number().int().min(1).max(100000).default(1),
  notesPage: z.coerce.number().int().min(1).max(100000).default(1),
  q: z.string().trim().max(160).default(""),
}).strict()
const identitySelect = {
  id: true, serviceId: true, status: true, purchasedAt: true, createdAt: true,
  configurationSnapshot: true,
  service: { select: { name: true, isActive: true, kind: true, parentService: { select: { isActive: true } } } },
} satisfies Prisma.ContactServiceSelect
type CaseRecord = Prisma.ContactServiceGetPayload<{ select: typeof identitySelect }>
function identity(record: CaseRecord) {
  return {
    contactServiceId: record.id, reference: record.id.slice(0, 8).toUpperCase(), serviceId: record.serviceId,
    serviceName: readEnrollmentConfiguration(record.configurationSnapshot)?.service.name ?? record.service.name,
    serviceActive: record.service.isActive && record.service.kind === "OFFERING" && Boolean(record.service.parentService?.isActive),
    status: record.status, purchasedAt: record.purchasedAt?.toISOString() ?? null, createdAt: record.createdAt.toISOString(),
  }
}
export type ContactCaseSummary = ReturnType<typeof identity>

export async function listContactCases(client: PrismaClient, tenantId: string, input: z.infer<typeof ContactCasesQuerySchema>) {
  return client.$transaction(async (tx) => {
    const contact = await tx.contact.findFirst({ where: { tenantId, id: input.contactId }, select: { id: true } })
    if (!contact) throw new ContactCaseError("CONTACT_NOT_FOUND")
    const where: Prisma.ContactServiceWhereInput = { tenantId, contactId: input.contactId,
      ...(input.serviceId ? { serviceId: input.serviceId } : {}),
      ...(input.q ? { OR: [{ service: { name: { contains: input.q, mode: "insensitive" } } }, { id: { startsWith: input.q.toLowerCase() } }] } : {}),
    }
    const [total, records, catalog] = await Promise.all([
      tx.contactService.count({ where }),
      tx.contactService.findMany({ where, select: identitySelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: input.pageSize, skip: (input.page - 1) * input.pageSize }),
      tx.service.findMany({ where: { tenantId, kind: "OFFERING", OR: [{ isActive: true, parentService: { is: { isActive: true } } }, { contactServices: { some: { tenantId, contactId: input.contactId } } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ])
    return { items: records.map(identity), services: catalog.map((record) => ({ serviceId: record.id, serviceName: record.name })),
      pagination: { page: input.page, pageSize: input.pageSize, total, totalPages: Math.max(1, Math.ceil(total / input.pageSize)) } }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}

export type CaseStepInput = { id: string; title: string; occurrences: {
  status: string; enteredAt: Date; createdAt: Date; dueAt: Date; supersededAt: Date | null;
  progressionStatus: string; progressionMessage: string | null
}[] }
export function caseStepEvidence(step: CaseStepInput, movements: { skippedStepIds: string[]; createdAt: Date }[], now: Date) {
  const entry = step.occurrences.at(-1)
  const skippedAt = Math.max(0, ...movements.filter((movement) => movement.skippedStepIds.includes(step.id)).map((movement) => movement.createdAt.getTime()))
  const bypassed = skippedAt > 0 && (!entry || entry.createdAt.getTime() < skippedAt)
  const status = bypassed ? "SKIPPED" : !entry ? "UPCOMING" : entry.supersededAt ? "SUPERSEDED"
    : ["WAITING_AUTOMATION", "PAUSED"].includes(entry.progressionStatus) ? entry.progressionStatus : entry.status
  return { id: step.id, title: step.title, status,
    dueAt: entry && !entry.supersededAt && !bypassed ? entry.dueAt.toISOString() : null,
    overdue: status === "ACTIVE" && Boolean(entry && entry.dueAt < now),
    attention: entry && !entry.supersededAt ? entry.progressionMessage?.slice(0, 1000) ?? null : null }
}

// Deliberately read-only: no workspace GET, sync, backfill, reconciliation or writes.
export async function loadContactCase(client: PrismaClient, tenantId: string, contactId: string, contactServiceId: string,
  history = CaseHistoryQuerySchema.parse({})) {
  return client.$transaction(async (tx) => {
    const record = await tx.contactService.findFirst({ where: { tenantId, contactId, id: contactServiceId }, select: {
      ...identitySelect, startedAt: true, completedAt: true, canceledAt: true, workflowKind: true, notes: true,
      totalPriceCents: true, currency: true, paymentType: true, financialRevision: true,
      contact: { select: { firstName: true, middleName: true, lastName: true } },
      tenant: { select: { timezone: true } },
      paymentDues: { orderBy: { sortOrder: "asc" } },
      checklistItems: { where: { tenantId }, select: { id: true, checklistItemId: true, ...enrolledChecklistSnapshotSelect, status: true, completedAt: true,
        checklistItem: { select: { label: true, description: true, isRequired: true, sortOrder: true } } } },
      followUpSteps: { where: { tenantId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: {
        id: true, title: true, status: true, availableAt: true, dueAt: true, completedAt: true, note: true,
        assignedTo: { select: { name: true } },
      } },
      serviceSteps: { where: { tenantId }, orderBy: { sortOrder: "asc" }, select: { id: true, title: true,
        occurrences: { where: { tenantId }, orderBy: { occurrenceNumber: "asc" }, select: { status: true, enteredAt: true, createdAt: true, dueAt: true, supersededAt: true, progressionStatus: true, progressionMessage: true } } } },
      stepMovements: { where: { tenantId }, select: { skippedStepIds: true, createdAt: true } },
    } })
    if (!record) throw new ContactCaseError()
    const noteFilter = history.q ? { OR: [{ title: { contains: history.q, mode: "insensitive" as const } }, { body: { contains: history.q, mode: "insensitive" as const } }] } : {}
    const notesWhere = { tenantId, contactServiceId, ...noteFilter }
    const contactNotesWhere = { ...notesWhere, contactId }
    const pattern = `%${history.q}%`
    const [paymentsTotal, payments, paymentCount, noteRows, serviceNoteCount, contactNoteCount] = await Promise.all([
      tx.contactServicePayment.aggregate({ where: { tenantId, contactServiceId, voidedAt: null }, _sum: { amountCents: true } }),
      tx.contactServicePayment.findMany({ where: { tenantId, contactServiceId }, orderBy: [{ paidAt: "desc" }, { id: "asc" }], skip: (history.paymentsPage - 1) * 20, take: 20,
        select: { id: true, amountCents: true, paidAt: true, paymentMethod: true, note: true, voidedAt: true, voidReason: true } }),
      tx.contactServicePayment.count({ where: { tenantId, contactServiceId } }),
      tx.$queryRaw<{ id: string; title: string; body: string; createdAt: Date; updatedAt: Date; kind: string }[]>(Prisma.sql`
        SELECT * FROM (
          SELECT id, title, body, "createdAt", "updatedAt", 'SERVICE_NOTE' AS kind FROM "ContactServiceNote"
          WHERE "tenantId"=${tenantId} AND "contactServiceId"=${contactServiceId}
            AND (${history.q === ""} OR title ILIKE ${pattern} OR body ILIKE ${pattern})
          UNION ALL
          SELECT id, title, body, "createdAt", "updatedAt", 'LINKED_CONTACT_NOTE' AS kind FROM "ContactNote"
          WHERE "tenantId"=${tenantId} AND "contactServiceId"=${contactServiceId} AND "contactId"=${contactId}
            AND (${history.q === ""} OR title ILIKE ${pattern} OR body ILIKE ${pattern})
        ) AS notes ORDER BY "updatedAt" DESC, id ASC, kind ASC LIMIT 10 OFFSET ${(history.notesPage - 1) * 10}
      `),
      tx.contactServiceNote.count({ where: notesWhere }), tx.contactNote.count({ where: contactNotesWhere }),
    ])
    const timezone = record.tenant.timezone || "America/Chicago", now = new Date()
    const billing = summarizeServiceBilling({ ...record, paidCents: paymentsTotal._sum.amountCents ?? 0, dues: record.paymentDues, today: tenantDateOnly(timezone), timezone })
    const checklist = record.checklistItems.map(serializeEnrolledChecklistItem).sort((a, b) => a.sortOrder - b.sortOrder)
    const notes = noteRows
      .map((note) => ({ id: note.id, kind: note.kind, title: note.title, body: sanitizeNoteBody(note.body).slice(0, 4000), createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString() }))
    const steps = record.serviceSteps.map((step) => caseStepEvidence(step, record.stepMovements, now))
    return { ...identity(record), contactName: [record.contact.firstName, record.contact.middleName, record.contact.lastName].filter(Boolean).join(" ") || "This contact",
      startedAt: record.startedAt?.toISOString() ?? null, completedAt: record.completedAt?.toISOString() ?? null, canceledAt: record.canceledAt?.toISOString() ?? null,
      billing, workflowKind: record.workflowKind, enrollmentNotes: sanitizeNoteBody(record.notes ?? "").slice(0, 4000),
      checklist: { total: checklist.length, requiredOutstanding: checklist.filter((item) => item.isRequired && item.status !== "RECEIVED").length,
        items: checklist.map(({ id, label, status, isRequired }) => ({ id, label, status, isRequired })) },
      steps: { configured: steps.length > 0, total: steps.length, completed: steps.filter((step) => ["COMPLETED", "SKIPPED"].includes(step.status)).length, items: steps },
      followUps: { next: serializeEffectiveNextFollowUp(resolveEffectiveNextFollowUp({ steps: record.followUpSteps })),
        total: record.followUpSteps.length, outstanding: record.followUpSteps.filter((step) => !["COMPLETED", "SKIPPED"].includes(step.status)).length,
        items: record.followUpSteps.map((step) => ({ id: step.id, title: step.title, status: step.status, availableAt: step.availableAt?.toISOString() ?? null,
          dueAt: step.dueAt?.toISOString() ?? null, completedAt: step.completedAt?.toISOString() ?? null, assignedTo: step.assignedTo?.name ?? null,
          overdue: !["COMPLETED", "SKIPPED"].includes(step.status) && Boolean(step.dueAt && step.dueAt < now), note: sanitizeNoteBody(step.note ?? "").slice(0, 2000) })) },
      payments: payments.map((payment) => ({ ...payment, paidAt: payment.paidAt.toISOString(), voidedAt: payment.voidedAt?.toISOString() ?? null,
        note: sanitizeNoteBody(payment.note ?? "").slice(0, 1000), voidReason: sanitizeNoteBody(payment.voidReason ?? "").slice(0, 1000) })),
      notes, history: { paymentsPage: history.paymentsPage, paymentCount, paymentsTotalPages: Math.max(1, Math.ceil(paymentCount / 20)), notesPage: history.notesPage,
        noteCount: serviceNoteCount + contactNoteCount, notesTotalPages: Math.max(1, Math.ceil((serviceNoteCount + contactNoteCount) / 10)), search: history.q },
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}
export type ContactCaseEvidence = Awaited<ReturnType<typeof loadContactCase>>
export type ContactCaseReference = { contactServiceId: string; view: "overview" | "transaction" | "follow-up" | "notes"; label: string }
export function contactCaseReferences(cases: ContactCaseEvidence[]): ContactCaseReference[] {
  return cases.flatMap((item) => (["overview", "transaction", "follow-up", "notes"] as const).map((view) => ({ contactServiceId: item.contactServiceId, view, label: `${item.serviceName} · ${item.reference} · ${view === "transaction" ? "Payments" : view === "follow-up" ? "Progress" : view === "notes" ? "Notes" : "Case"}` })))
}
export function explainContactCase(item: ContactCaseEvidence) {
  const money = (cents: number) => `${(cents / 100).toFixed(2)} ${item.billing.currency}`
  const lines = [`${item.serviceName} · ${item.reference} (${item.status.toLowerCase().replaceAll("_", " ")}).`,
    `Work: ${item.billing.workState.toLowerCase().replaceAll("_", " ")}. Payments: ${money(item.billing.paidCents)} recorded against ${money(item.billing.totalPriceCents)}; ${money(item.billing.remainingCents)} remaining.`,
    `${item.checklist.requiredOutstanding} required checklist items outstanding.`,
    ...item.checklist.items.filter((entry) => entry.isRequired && entry.status !== "RECEIVED").slice(0, 40).map((entry) => `${entry.label}: ${entry.status.toLowerCase().replaceAll("_", " ")}.`),
    item.steps.configured ? `Service steps: ${item.steps.completed} of ${item.steps.total} completed or skipped.` : "Service steps are not configured on this case.",
    ...item.steps.items.filter((step) => !["COMPLETED", "SKIPPED", "SUPERSEDED"].includes(step.status)).slice(0, 30).map((step) => `${step.title}: ${step.status.toLowerCase().replaceAll("_", " ")}${step.dueAt ? `, due ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: item.billing.timezone }).format(new Date(step.dueAt))} (${item.billing.timezone})` : ""}${step.overdue ? ", overdue" : ""}.`),
    `Follow-ups: ${item.followUps.outstanding} outstanding.`,
    ...item.followUps.items.filter((step) => !["COMPLETED", "SKIPPED"].includes(step.status)).slice(0, 30).map((step) => `${step.title}: ${step.status.toLowerCase()}${step.dueAt ? `, due ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: item.billing.timezone }).format(new Date(step.dueAt))} (${item.billing.timezone})` : ""}${step.overdue ? ", overdue" : ""}.`),
    ...item.billing.schedule.filter((due) => due.remainingCents > 0).map((due) => `${due.label}: ${money(due.remainingCents)} ${due.dueDate ? `due ${due.dueDate}${due.state === "OVERDUE" ? " (overdue)" : ""}` : "with no scheduled date"}.`),
  ]
  if (item.billing.scheduleNeedsReview) lines.push("The payment schedule needs review; no payment dates can be inferred.")
  if (item.enrollmentNotes) lines.push(`Enrollment note (staff statement): ${item.enrollmentNotes}`)
  for (const note of item.notes.slice(0, 3)) lines.push(`Note: ${note.title} (${note.updatedAt.slice(0, 10)}): ${note.body}`)
  if (item.notes.length || item.enrollmentNotes) lines.push("Staff notes are statements; review any disagreement with the saved payment and progress records above.")
  if (item.history.paymentCount > item.payments.length || item.history.noteCount > 3 || item.checklist.items.length > 40 || item.steps.items.length > 30 || item.followUps.items.length > 30) lines.push("This is a partial history. Use the purchase records and case references to review more.")
  return lines.join("\n")
}
export function caseContextForPrompt(cases: ContactCaseEvidence[]) {
  // Keep complete financial totals/counts; cap record excerpts explicitly.
  const projected = cases.map((item) => ({ ...item, enrollmentNotes: item.enrollmentNotes.slice(0, 2000),
    billing: { ...item.billing, scheduleTotal: item.billing.schedule.length },
    checklist: { ...item.checklist, items: item.checklist.items.slice(0, 40) },
    steps: { ...item.steps, items: item.steps.items.slice(0, 40) },
    followUps: { ...item.followUps, items: item.followUps.items.slice(0, 30).map((step) => ({ ...step, note: step.note.slice(0, 500) })) },
    payments: item.payments.slice(0, 20).map((payment) => ({ ...payment, note: payment.note.slice(0, 300), voidReason: payment.voidReason.slice(0, 300) })), notes: item.notes.slice(0, 5).map((note) => ({ ...note, body: note.body.slice(0, 1200) })),
    limited: item.checklist.items.length > 40 || item.steps.items.length > 40 || item.followUps.items.length > 30 || item.notes.length > 5
      || item.history.paymentCount > item.payments.length || item.history.noteCount > Math.min(5, item.notes.length) || Boolean(item.history.search) || item.enrollmentNotes.length > 2000 || item.notes.some((note) => note.body.length > 1200),
  }))
  // Comparisons share one budget. Never drop a case's identity or full totals.
  while (JSON.stringify(projected).length > 40000) {
    let reduced = false
    for (const item of projected) {
      for (const [container, key] of [[item, "notes"], [item, "payments"], [item.checklist, "items"], [item.steps, "items"], [item.followUps, "items"], [item.billing, "schedule"]] as const) {
        const record = container as unknown as Record<string, unknown[]>
        if (record[key]!.length) { record[key] = record[key]!.slice(0, Math.floor(record[key]!.length / 2)); reduced = true; item.limited = true }
      }
    }
    if (!reduced) break
  }
  return projected
}
export function isContactCaseQuestion(question: string) {
  return /\b(purchas\w*|bought|cases?|enrollments?|payments?|paid|balance|installments?|transactions?|follow[ -]?ups?|checklists?|overdue|in progress|notes?|compr\w*|pagos?|saldo|cuotas?|seguimientos?|notas?)\b/i.test(question)
}
