"use client"

import { useEffect, useRef, useState } from "react"
import { isCancel } from "axios"
import { ChevronDown, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { contactCaseLabel, type ContactCaseSummary, type ContactCaseEvidence, type CaseHistory, type CasePagination } from "../_lib/contact-ai-cases"

const SECONDARY = "h-8 cursor-pointer rounded-full text-xs font-semibold"

export function ContactAiCaseChoices({ items, timezone, disabled, onSelect }: {
  items: ContactCaseSummary[]; timezone: string | null; disabled: boolean; onSelect: (item: ContactCaseSummary) => void
}) {
  return <div className="flex min-w-0 flex-col gap-2">{items.map((item) => <Button key={item.contactServiceId} type="button" variant="outline"
    className="h-auto min-h-8 max-w-full cursor-pointer justify-start rounded-xl px-3 py-2 text-left text-xs whitespace-normal" disabled={disabled} onClick={() => onSelect(item)}>
    <span className="min-w-0 break-words">{contactCaseLabel(item, timezone)}</span>
  </Button>)}</div>
}

export function ContactAiCases({ tenantId, contactId, timezone, disabled, onSelect, onCompare }: {
  tenantId: string; contactId: string; timezone: string | null; disabled: boolean
  onSelect: (item: ContactCaseSummary) => void; onCompare: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<ContactCaseSummary[]>([])
  const [pagination, setPagination] = useState<CasePagination | null>(null)
  const [checked, setChecked] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setLoading(true); setError("")
      try {
        const { data } = await api.get<{ items: ContactCaseSummary[]; pagination: CasePagination }>(`/api/services/${tenantId}/fit-scan/cases`, { params: { contactId, q: query.trim(), page, pageSize: 10 }, signal: controller.signal })
        if (!controller.signal.aborted) { setItems(data.items); setPagination(data.pagination) }
      } catch (cause) {
        if (!isCancel(cause) && !controller.signal.aborted) setError("Could not load purchased services. Close and reopen to retry.")
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }, query ? 250 : 0)
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [tenantId, contactId, open, query, page])
  return <Popover open={open} onOpenChange={(value) => { setOpen(value); if (value) { setChecked([]); setPage(1); setQuery("") } }}>
    <PopoverTrigger asChild><Button type="button" variant="outline" className={SECONDARY} disabled={disabled}>Purchased services<ChevronDown data-icon="inline-end" aria-hidden="true" /></Button></PopoverTrigger>
    <PopoverContent align="start" className="flex w-[min(32rem,calc(100vw-2rem))] flex-col gap-3 p-4">
      <p className="text-sm font-semibold">Choose a purchase</p>
      <Input aria-label="Search purchased services" className="h-11" maxLength={160} placeholder="Search service name or reference…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} />
      <p className="text-xs text-muted-foreground">Select a purchase to review, or check two to five to compare.</p>
      <div className="flex max-h-[min(24rem,50dvh)] flex-col gap-2 overflow-y-auto">
        {loading ? <p role="status" className="text-sm text-muted-foreground">Loading purchases…</p> : error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !items.length ? <p className="text-sm text-muted-foreground">No purchases found.</p> : items.map((item) => <div key={item.contactServiceId} className="flex items-center gap-2">
          <Checkbox aria-label={`Compare ${contactCaseLabel(item, timezone)}`} checked={checked.includes(item.contactServiceId)} disabled={!checked.includes(item.contactServiceId) && checked.length >= 5}
            onCheckedChange={(value) => setChecked((current) => value ? [...current, item.contactServiceId] : current.filter((id) => id !== item.contactServiceId))} />
          <div className="min-w-0 flex-1"><ContactAiCaseChoices items={[item]} timezone={timezone} disabled={disabled} onSelect={(choice) => { setOpen(false); onSelect(choice) }} /></div>
        </div>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" className={SECONDARY} disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
          <span className="text-xs text-muted-foreground">{page} / {pagination?.totalPages ?? 1}</span>
          <Button variant="outline" className={SECONDARY} disabled={loading || !pagination || page >= pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
        </div>
        <Button variant="outline" className={SECONDARY} disabled={disabled || checked.length < 2} onClick={() => { setOpen(false); onCompare(checked) }}>Compare selected ({checked.length})</Button>
      </div>
    </PopoverContent>
  </Popover>
}

export function ContactAiCaseHistory({ tenantId, contactId, item, onHistoryChange }: {
  tenantId: string; contactId: string; item: ContactCaseEvidence; onHistoryChange: (value: CaseHistory) => void
}) {
  const [details, setDetails] = useState(item)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])
  const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: details.billing.currency }).format(cents / 100)
  async function load(next: CaseHistory) {
    if (active.current) return
    const controller = new AbortController(); active.current = controller; setLoading(true)
    try {
      const { data } = await api.get<{ item: ContactCaseEvidence }>(`/api/services/${tenantId}/fit-scan/cases/${item.contactServiceId}`, { params: { contactId, ...next }, signal: controller.signal })
      if (!controller.signal.aborted) { setDetails(data.item); onHistoryChange(next) }
    } catch (cause) { if (!isCancel(cause)) toast.error("Could not load case history.") }
    finally { if (!controller.signal.aborted) setLoading(false); active.current = null }
  }
  const history = details.history
  const current = { paymentsPage: history.paymentsPage, notesPage: history.notesPage, q: history.search }
  return <details className="min-w-0 rounded-xl border bg-background p-3">
    <summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Purchase records · {item.reference}</summary>
    <div className="mt-3 flex min-w-0 flex-col gap-4 text-sm">
      <p>{money(details.billing.paidCents)} paid · {money(details.billing.remainingCents)} remaining · {details.billing.currency}</p>
      <div className="flex flex-col gap-2"><p className="font-medium">Remaining payments</p>
        {details.billing.schedule.filter((due) => due.remainingCents > 0).map((due) => <p key={due.id} className="break-words text-xs text-muted-foreground">{due.label}: {money(due.remainingCents)} · {due.dueDate ?? "No scheduled date"} · {due.state.toLowerCase()}</p>)}
        {details.billing.remainingCents > 0 && !details.billing.schedule.length ? <p className="text-xs text-muted-foreground">No payment schedule is recorded.</p> : null}
      </div>
      <div className="flex flex-col gap-2"><p className="font-medium">Transactions ({history.paymentCount})</p>
        {details.payments.map((payment) => <p key={payment.id} className="break-words text-xs text-muted-foreground">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: details.billing.timezone }).format(new Date(payment.paidAt))}: {money(payment.amountCents)} · {payment.voidedAt ? "Voided — excluded from totals" : payment.paymentMethod ?? "Recorded payment"}{payment.note ? ` · ${payment.note}` : ""}</p>)}
        {!details.payments.length ? <p className="text-xs text-muted-foreground">No transactions on this page.</p> : null}
        <div className="flex flex-wrap items-center gap-2"><Button variant="outline" className={SECONDARY} disabled={loading || history.paymentsPage <= 1} onClick={() => void load({ ...current, paymentsPage: history.paymentsPage - 1 })}>Previous transactions</Button>
          <span className="text-xs">{history.paymentsPage} / {history.paymentsTotalPages}</span><Button variant="outline" className={SECONDARY} disabled={loading || history.paymentsPage >= history.paymentsTotalPages} onClick={() => void load({ ...current, paymentsPage: history.paymentsPage + 1 })}>Next transactions</Button></div>
      </div>
      <div className="flex flex-col gap-2"><Label htmlFor={`case-note-search-${item.contactServiceId}`}>Search case notes</Label>
        <div className="flex gap-2"><Input id={`case-note-search-${item.contactServiceId}`} maxLength={160} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search saved note text…" />
          <Button variant="outline" className={SECONDARY} disabled={loading} onClick={() => void load({ ...current, notesPage: 1, q: search.trim() })}>Search</Button></div>
        <p className="font-medium">Notes ({history.noteCount})</p>
        {details.notes.map((note) => <div key={`${note.kind}:${note.id}`} className="flex flex-col gap-1 text-xs"><p className="break-words font-medium">{note.title} · {note.updatedAt.slice(0, 10)}</p><p className="break-words whitespace-pre-wrap text-muted-foreground">{note.body}</p></div>)}
        {!details.notes.length ? <p className="text-xs text-muted-foreground">No notes match on this page.</p> : null}
        <div className="flex flex-wrap items-center gap-2"><Button variant="outline" className={SECONDARY} disabled={loading || history.notesPage <= 1} onClick={() => void load({ ...current, notesPage: history.notesPage - 1 })}>Previous notes</Button>
          <span className="text-xs">{history.notesPage} / {history.notesTotalPages}</span><Button variant="outline" className={SECONDARY} disabled={loading || history.notesPage >= history.notesTotalPages} onClick={() => void load({ ...current, notesPage: history.notesPage + 1 })}>Next notes</Button></div>
      </div>
      {loading ? <p role="status" className="flex items-center gap-2 text-xs"><Loader2 className="size-3 animate-spin" aria-hidden="true" />Loading history…</p> : null}
    </div>
  </details>
}
