"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { isAxiosError } from "axios"
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { api } from "@/lib/api"
import { configurationReviewError, configurationReviewValue, type ConfigurationPreview } from "@/lib/service-configuration-review"

type Enrollment = { id: string; serviceName: string; contactName: string; lastApplied: { appliedAt: string; appliedByName: string | null } | null }
type ReviewState = { preview?: ConfigurationPreview; selected?: boolean; applied?: boolean; error?: string }

export function ServiceConfigurationUpdates({ tenantId, serviceId }: { tenantId: string; serviceId: string }) {
  const [items, setItems] = useState<Enrollment[]>([])
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({})
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const working = useRef(false)
  const base = `/api/services/${tenantId}`

  const load = useCallback(async (cursor?: string) => {
    if (working.current) return
    working.current = true
    setLoading(true); setError(null)
    try {
      const { data } = await api.get<{ items: Enrollment[]; nextCursor: string | null }>(`${base}/configuration-updates/${serviceId}/enrollments`, { params: cursor ? { cursor } : {} })
      if (alive.current) { setItems(data.items); setNextCursor(data.nextCursor); setReviews({}) }
    } catch { if (alive.current) setError("Enrollments could not be loaded. Try again.") }
    finally { working.current = false; if (alive.current) setLoading(false) }
  }, [base, serviceId])
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false } }, [load])

  async function review(ids: string[]) {
    if (working.current) return
    working.current = true; setBusy(true); setError(null)
    // One request at a time, with one enrollment transaction per request. Leaving the tab stops the remaining batch.
    for (const id of ids) {
      if (!alive.current) break
      try {
        const { data } = await api.post<{ preview: ConfigurationPreview }>(`${base}/contact-services/${id}/configuration-preview`)
        if (alive.current) setReviews(previous => ({ ...previous, [id]: { preview: data.preview } }))
      } catch { if (alive.current) setReviews(previous => ({ ...previous, [id]: { error: "The review could not be loaded. Try again." } })) }
    }
    working.current = false; if (alive.current) setBusy(false)
  }
  async function applySelected() {
    if (working.current) return
    const selected = items.filter(item => reviews[item.id]?.selected && reviews[item.id]?.preview?.canApply && !reviews[item.id]?.applied)
    working.current = true; setBusy(true)
    for (const item of selected) {
      if (!alive.current) break
      const previewId = reviews[item.id]!.preview!.previewId
      try {
        await api.post(`${base}/contact-services/${item.id}/configuration-apply`, { previewId })
        if (alive.current) setReviews(previous => ({ ...previous, [item.id]: { ...previous[item.id], applied: true, selected: false, error: undefined } }))
      } catch (error) {
        const code = isAxiosError(error) ? error.response?.data?.error : null
        if (alive.current) setReviews(previous => ({ ...previous, [item.id]: { ...previous[item.id], selected: false, error: configurationReviewError(code) } }))
      }
    }
    working.current = false; if (alive.current) setBusy(false)
  }
  const selectedCount = items.filter(item => reviews[item.id]?.selected && !reviews[item.id]?.applied).length
  return <div className="flex flex-col gap-5" aria-busy={busy || loading}>
    <Card>
      <CardHeader><CardTitle>Update existing enrollments</CardTitle><CardDescription>Review the latest saved configuration, then choose which active enrollments receive it. Save configuration edits before starting a review.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert><ShieldCheck /><AlertTitle>Existing work stays protected</AlertTitle><AlertDescription>Entered steps, checklist history, billing, assignments and manual schedules are preserved. Queued and waiting automations keep their saved actions. Reviews expire after 15 minutes.</AlertDescription></Alert>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy || loading || !items.length} onClick={() => void review(items.map(item => item.id))}>Review this page</Button>
          <Button variant="outline" disabled={busy || loading} onClick={() => void load()}><RefreshCw />Refresh enrollments</Button>
        </div>
        {error ? <Alert variant="destructive"><AlertTitle>Unable to load</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {loading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading active enrollments…</p> : null}
        {!loading && !items.length && !error ? <Empty><EmptyHeader><EmptyTitle>No active enrollments</EmptyTitle><EmptyDescription>In-progress enrollments and finished work awaiting payment will appear here when they use service steps.</EmptyDescription></EmptyHeader></Empty> : null}
      </CardContent>
      {items.length ? <CardFooter className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground" role="status">{busy ? "Processing one enrollment at a time…" : `${selectedCount} selected`}</p><Button disabled={busy || loading || !selectedCount} onClick={() => void applySelected()}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Apply to {selectedCount} selected</Button></CardFooter> : null}
    </Card>
    {items.map(item => {
      const state = reviews[item.id], preview = state?.preview
      return <Card key={item.id}>
        <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-col gap-1"><CardTitle>{item.contactName}</CardTitle><CardDescription>{item.serviceName}</CardDescription></div><Button variant="outline" size="sm" disabled={busy || loading} onClick={() => void review([item.id])}>{preview ? "Refresh review" : "Review changes"}</Button></div></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state?.applied ? <p className="flex items-center gap-2 text-sm" role="status"><CheckCircle2 className="size-4" />Reviewed changes applied.</p> : null}
          {state?.error ? <Alert variant="destructive"><AlertTitle>Review needed</AlertTitle><AlertDescription>{state.error}</AlertDescription></Alert> : null}
          {!preview && item.lastApplied ? <p className="text-sm text-muted-foreground">Last updated {new Date(item.lastApplied.appliedAt).toLocaleString()}{item.lastApplied.appliedByName ? ` by ${item.lastApplied.appliedByName}` : ""}.</p> : null}
          {preview ? <>
            {preview.blockers.length ? <Alert variant="destructive"><AlertTitle>Cannot apply this configuration</AlertTitle><AlertDescription><ul className="list-disc pl-4">{preview.blockers.map(message => <li key={message}>{message}</li>)}</ul></AlertDescription></Alert> : null}
            <p className="text-sm text-muted-foreground">{preview.hasChanges ? `${preview.differences.filter(change => change.kind !== "PRESERVE").length} proposed changes` : "This enrollment is up to date."} · Review expires {new Date(preview.expiresAt).toLocaleTimeString()}.</p>
            {preview.differences.length ? <details><summary className="cursor-pointer text-sm font-medium">Compare saved and proposed configuration</summary><div className="mt-4 flex flex-col gap-4">{preview.differences.map((change, index) => <section className="flex flex-col gap-2 rounded-lg border p-4" key={`${change.section}-${index}`}>
              <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{change.section}</Badge><Badge variant="secondary">{({ ADD: "Add", UPDATE: "Update", REMOVE: "Remove", PRESERVE: "Keep saved" })[change.kind]}</Badge><h4 className="text-sm font-medium">{change.label}</h4></div>
              {change.explanation ? <p className="text-sm text-muted-foreground">{change.explanation}</p> : null}
              {change.kind !== "PRESERVE" ? <div className="grid gap-3 md:grid-cols-2"><div><p className="mb-1 text-xs font-medium text-muted-foreground">Saved</p><p className="whitespace-pre-wrap break-words text-sm">{configurationReviewValue(change.before, preview.references)}</p></div><div><p className="mb-1 text-xs font-medium text-muted-foreground">Proposed</p><p className="whitespace-pre-wrap break-words text-sm">{configurationReviewValue(change.after, preview.references)}</p></div></div> : null}
            </section>)}</div></details> : null}
            <details><summary className="cursor-pointer text-sm text-muted-foreground">What stays unchanged</summary><ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">{preview.preserved.map(text => <li key={text}>{text}</li>)}</ul></details>
            <Field orientation="horizontal"><Checkbox id={`update-${item.id}`} checked={Boolean(state?.selected)} disabled={busy || !preview.canApply || state?.applied || Boolean(state?.error)} onCheckedChange={checked => setReviews(previous => ({ ...previous, [item.id]: { ...previous[item.id], selected: checked === true } }))} /><FieldLabel htmlFor={`update-${item.id}`}>Apply reviewed changes to {item.contactName}</FieldLabel></Field>
          </> : null}
        </CardContent>
      </Card>
    })}
    {nextCursor ? <Button variant="outline" disabled={busy || loading || selectedCount > 0} onClick={() => void load(nextCursor)}>Next 20 enrollments</Button> : null}
  </div>
}
