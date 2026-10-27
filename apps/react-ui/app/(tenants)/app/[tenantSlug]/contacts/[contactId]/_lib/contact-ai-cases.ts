export type ContactCaseSummary = {
  contactServiceId: string; reference: string; serviceId: string; serviceName: string; serviceActive: boolean
  status: "IN_PROGRESS" | "PENDING_PAYMENT" | "COMPLETED" | "CANCELED"
  purchasedAt: string | null; createdAt: string
}
export type CasePagination = { page: number; pageSize: number; total: number; totalPages: number }
export type CaseHistory = { paymentsPage: number; notesPage: number; q: string }
export type ContactCaseEvidence = ContactCaseSummary & {
  billing: { totalPriceCents: number; paidCents: number; remainingCents: number; currency: string; workState: string; paymentState: string; timezone: string
    schedule: { id: string; label: string; remainingCents: number; dueDate: string | null; state: string }[] }
  payments: { id: string; amountCents: number; paidAt: string; paymentMethod: string | null; note: string; voidedAt: string | null }[]
  notes: { id: string; kind: string; title: string; body: string; updatedAt: string }[]
  history: { paymentsPage: number; paymentCount: number; paymentsTotalPages: number; notesPage: number; noteCount: number; notesTotalPages: number; search: string }
}
export type ContactCaseReference = { contactServiceId: string; view: "overview" | "transaction" | "follow-up" | "notes"; label: string }
export function contactCaseLabel(item: ContactCaseSummary, timezone: string | null) {
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timezone ?? "America/Chicago" }).format(new Date(item.purchasedAt ?? item.createdAt))
  return `${item.serviceName} · ${item.purchasedAt ? "Purchased" : "Created"} ${date} · ${item.status.toLowerCase().replaceAll("_", " ")} · ${item.reference}`
}
