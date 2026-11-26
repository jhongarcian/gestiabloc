"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { isAxiosError } from "axios"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import { aiReviewReasonLabel, type AiAnswerReviewList, type AiAnswerReviewDetail } from "@/lib/ai-answer-reviews"
import { cn } from "@/lib/utils"
import type { AiAnalyticsChannel, AiAnalyticsPeriod } from "../_lib/analytics"
import { AiEmpty, AiPanel, PRIMARY_BUTTON, SECONDARY_BUTTON } from "./ai-ui"

const reviewStatusButton = cn(SECONDARY_BUTTON, "data-[state=on]:border-transparent data-[state=on]:bg-blue-950 data-[state=on]:text-white data-[state=on]:hover:bg-blue-900 data-[state=on]:hover:text-white")
const date = (value: string) => new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC"
const source = (channel: string) => channel === "TEST" ? "Test helper" : "Contact assistant"
function errorText(error: unknown, action: "load" | "save" = "load") {
  const status = isAxiosError(error) ? error.response?.status : undefined
  return status === 401 ? "Your session expired. Sign in again to view reviews."
    : status === 403 ? "Account administrator access is required to view these details."
    : status === 404 || status === 410 ? "These details have expired or are no longer available. Refresh the list."
    : status === 409 ? "Another administrator changed this review. Refresh its details before trying again."
    : action === "save" ? "The review status could not be confirmed. Refresh its details before trying again." : "Review details could not be loaded. Try refreshing."
}

export function AiAnswerReviews({ tenantId, tenantSlug, days, channel, onRefresh }: { tenantId: string; tenantSlug: string; days: AiAnalyticsPeriod; channel: AiAnalyticsChannel; onRefresh?: () => void }) {
  const [state, setState] = useState("OPEN")
  const [cursor, setCursor] = useState<string | null>(null)
  const [previous, setPrevious] = useState<(string | null)[]>([])
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => { setCursor(null); setPrevious([]); setVersion(value => value + 1) }, [])
  const [result, setResult] = useState<{ key: string; version: number; data?: AiAnswerReviewList; error?: string } | null>(null)
  const key = JSON.stringify([tenantId, days, channel, state, cursor])
  const current = result?.key === key ? result : null
  const loading = !current || current.version !== version
  const data = current?.data
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailVersion, setDetailVersion] = useState(0)
  const [detailResult, setDetailResult] = useState<{ id: string; data?: AiAnswerReviewDetail; error?: string } | null>(null)
  const detail = detailResult && (!selectedId || detailResult.id === selectedId) ? detailResult : null
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const mutation = useRef<AbortController | null>(null)
  const path = `/api/account-settings/${tenantId}/ai/analytics/reviews`

  useEffect(() => {
    const controller = new AbortController()
    api.get<{ reviews: AiAnswerReviewList }>(path, { params: { days, channel, state, cursor: cursor ?? undefined }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setResult({ key, version, data: data.reviews }) })
      .catch(error => { if (!controller.signal.aborted) setResult({ key, version, error: errorText(error) }) })
    return () => controller.abort()
  }, [path, days, channel, state, cursor, key, version])
  useEffect(() => {
    // The Analytics Refresh action reloads reviews even on a later results page.
    const changed = () => {
      refresh()
      if (selectedId) { setDetailResult(null); setSaveError(null); setDetailVersion(value => value + 1) }
    }
    window.addEventListener("ai-review-changed", changed)
    return () => window.removeEventListener("ai-review-changed", changed)
  }, [refresh, selectedId])
  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    api.get<{ review: AiAnswerReviewDetail }>(`${path}/${selectedId}`, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setDetailResult({ id: selectedId, data: data.review }) })
      .catch(error => { if (!controller.signal.aborted) setDetailResult({ id: selectedId, error: errorText(error) }) })
    return () => controller.abort()
  }, [path, selectedId, detailVersion])
  useEffect(() => () => mutation.current?.abort(), [])

  async function updateReview() {
    if (!detail?.data || saving || mutation.current) return
    const controller = new AbortController(); mutation.current = controller
    setSaving(true); setSaveError(null)
    try {
      const response = await api.patch<{ review: AiAnswerReviewDetail }>(`${path}/${detail.data.id}`, { reviewed: !detail.data.reviewedAt, revision: detail.data.revision }, { signal: controller.signal })
      if (!controller.signal.aborted) { setDetailResult({ id: response.data.review.id, data: response.data.review }); refresh() }
    } catch (error) { if (!controller.signal.aborted) setSaveError(errorText(error, "save")) }
    finally { mutation.current = null; if (!controller.signal.aborted) setSaving(false) }
  }

  return <section id="ai-answer-reviews" aria-label="Flagged AI reply reviews" className="scroll-mt-6">
    <AiPanel title="Replies needing review" description="Open a flagged question and its AI reply, then mark it reviewed after your team has followed up. Follows the source and date filters above."
      actions={<Button type="button" variant="outline" size="sm" className={SECONDARY_BUTTON} disabled={loading} onClick={onRefresh ?? refresh}>{loading ? "Refreshing…" : "Refresh reviews"}</Button>}>
      <div className="flex flex-col gap-4">
        <ToggleGroup type="single" variant="outline" size="sm" spacing={1} className="max-w-full flex-wrap" aria-label="Review status" value={state} onValueChange={value => { if (["OPEN", "REVIEWED", "ALL"].includes(value)) { setState(value); setCursor(null); setPrevious([]) } }}>
          <ToggleGroupItem value="OPEN" className={reviewStatusButton}>Open{data ? ` · ${data.counts.open}` : ""}</ToggleGroupItem>
          <ToggleGroupItem value="REVIEWED" className={reviewStatusButton}>Reviewed{data ? ` · ${data.counts.reviewed}` : ""}</ToggleGroupItem>
          <ToggleGroupItem value="ALL" className={reviewStatusButton}>All saved</ToggleGroupItem>
        </ToggleGroup>
        {current?.error ? <Alert variant="destructive"><AlertDescription>{current.error}</AlertDescription></Alert> : null}
        {!data && loading ? <div role="status" aria-label="Loading answer reviews" className="flex flex-col gap-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div> : null}
        {data ? <>
          {!data.captureAvailable ? <Alert><AlertDescription>New review details cannot be saved until review encryption is configured on the server.</AlertDescription></Alert> : null}
          {data.counts.unavailable > 0 ? <p className="text-sm text-muted-foreground">{data.counts.unavailable.toLocaleString()} flagged {data.counts.unavailable === 1 ? "reply has" : "replies have"} no saved details. Older records contain counts only; saved details expire after {data.retentionDays} days.</p> : null}
          {!data.items.length ? <AiEmpty title={state === "OPEN" ? "No open reviews with saved details" : "No saved reviews in this view"} description="New flagged questions and replies appear here when details are available. Try another source, period or review status." /> : <ul className="flex flex-col divide-y divide-border">
            {data.items.map(item => <li key={item.id} className="flex flex-col items-start gap-3 py-4 sm:flex-row sm:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-2"><div className="flex flex-wrap items-center gap-2"><Badge variant={item.reviewedAt ? "secondary" : "outline"}>{item.reviewedAt ? "Reviewed" : "Open"}</Badge><p className="text-xs text-muted-foreground">{source(item.channel)} · {date(item.createdAt)}</p></div>
                <p className="line-clamp-2 break-words text-sm font-medium [overflow-wrap:anywhere]">{item.questionPreview ?? "Saved details are unavailable"}</p><p className="text-xs text-muted-foreground">{aiReviewReasonLabel(item.reason)}</p></div>
              <Button type="button" variant="outline" size="sm" className={SECONDARY_BUTTON} disabled={!item.detailsAvailable} onClick={() => { setDetailResult(null); setSaveError(null); setSelectedId(item.id) }}>View details<span className="sr-only">: {item.questionPreview}</span></Button>
            </li>)}
          </ul>}
          {previous.length > 0 || data.nextCursor ? <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" size="sm" className={SECONDARY_BUTTON} disabled={!previous.length || loading} onClick={() => { setCursor(previous.at(-1) ?? null); setPrevious(values => values.slice(0, -1)) }}>Previous</Button><Button variant="outline" size="sm" className={SECONDARY_BUTTON} disabled={!data.nextCursor || loading} onClick={() => { setPrevious(values => [...values, cursor]); setCursor(data.nextCursor) }}>More replies</Button></div> : null}
        </> : null}
        <p className="text-xs leading-relaxed text-muted-foreground">Only flagged question-and-reply pairs are saved, encrypted for 30 days, for account administrators. Earlier chat history is excluded. Marking reviewed keeps the original Analytics outcome unchanged.</p>
      </div>
    </AiPanel>
    <Sheet open={Boolean(selectedId)} onOpenChange={open => { if (!open) setSelectedId(null) }}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="shrink-0 border-b p-6 pr-12"><SheetTitle>Flagged reply details</SheetTitle><SheetDescription>{detail?.data ? `${source(detail.data.channel)} · ${date(detail.data.createdAt)}` : "Review the saved question, AI reply and reason for follow-up."}</SheetDescription></SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
          {!detail ? <Skeleton aria-label="Loading review details" className="h-48 w-full" /> : detail.error ? <Alert variant="destructive"><AlertDescription>{detail.error}</AlertDescription></Alert> : detail.data ? <>
            <div className="flex flex-col gap-2"><Badge variant={detail.data.reviewedAt ? "secondary" : "outline"} className="w-fit">{detail.data.reviewedAt ? "Reviewed" : "Open"}</Badge><p className="text-sm font-medium">{aiReviewReasonLabel(detail.data.reason)}</p><p className="text-xs text-muted-foreground">{detail.data.reason === "ASSISTANT_UNAVAILABLE" ? "The conversational reply was unavailable, so the assistant showed guidance from current records." : "This is an automatic flag for agency follow-up, not a human judgment of answer quality."}</p></div>
            {detail.data.details.serviceName ? <p className="text-sm text-muted-foreground">Service: {detail.data.details.serviceName}</p> : null}
            <section className="flex flex-col gap-2"><h3 className="text-sm font-semibold">Question</h3><p className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{detail.data.details.question}</p></section>
            <section className="flex flex-col gap-2"><h3 className="text-sm font-semibold">AI reply</h3><p className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{detail.data.details.answer}</p></section>
            {detail.data.details.sourceLabels.length ? <section className="flex flex-col gap-2"><h3 className="text-sm font-semibold">Saved sources used</h3><ul className="flex flex-col gap-2 text-sm text-muted-foreground">{detail.data.details.sourceLabels.map((label, index) => <li key={index} className="break-words">{label}</li>)}</ul></section> : null}
            {detail.data.details.contactId ? <Button asChild variant="outline" className={SECONDARY_BUTTON}><Link href={`/app/${tenantSlug}/contacts/${encodeURIComponent(detail.data.details.contactId)}/ai-qualification`}>Open contact</Link></Button> : null}
            <p className="text-xs text-muted-foreground">Details expire {date(detail.data.expiresAt)}.{detail.data.reviewedAt ? ` Reviewed ${date(detail.data.reviewedAt)}.` : ""}</p>
          </> : null}
          {saveError ? <Alert variant="destructive"><AlertDescription>{saveError}</AlertDescription></Alert> : null}
        </div>
        <SheetFooter className="shrink-0 border-t p-4"><Button type="button" variant="outline" className={SECONDARY_BUTTON} disabled={saving} onClick={() => { setDetailResult(null); setSaveError(null); setDetailVersion(value => value + 1) }}>Refresh details</Button><Button type="button" className={PRIMARY_BUTTON} disabled={saving || !detail?.data} onClick={() => void updateReview()}>{saving ? "Saving…" : detail?.data?.reviewedAt ? "Reopen review" : "Mark reviewed"}</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  </section>
}
