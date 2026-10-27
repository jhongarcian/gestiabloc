"use client"

import { useState } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { AiEmpty, AiPageHeader, AiPanel, SECONDARY_BUTTON } from "./ai-ui"
import { useAiWorkspace } from "./ai-workspace"
import { useAiAnalytics } from "./use-ai-analytics"
import type { AiAnalyticsChannel, AiAnalyticsPeriod } from "../_lib/analytics"

const chartConfig = {
  conversations: { label: "Conversations", color: "var(--chart-3)" },
  answered: { label: "Answered", color: "var(--chart-2)" },
  needsReview: { label: "Needs review", color: "var(--chart-1)" },
} satisfies ChartConfig
const metrics = [
  { key: "conversations", label: "Conversations", description: "Distinct chats active in this period" },
  { key: "answered", label: "Questions answered", description: "Replies marked as answered" },
  { key: "qualificationRuns", label: "Qualification runs", description: "Explicit contact analysis requests" },
  { key: "needsReview", label: "Questions needing review", description: "Replies that need more knowledge or help" },
] as const
const channels: { value: AiAnalyticsChannel; label: string }[] = [
  { value: "ALL", label: "All activity" },
  { value: "TEST", label: "Test helper" },
  { value: "CONTACT_ASSISTANT", label: "Contact assistant" },
]
const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
  month: "short", day: "numeric", timeZone: "UTC",
})
const toggleClass = "h-8 cursor-pointer rounded-full px-3 text-xs font-semibold data-[state=on]:bg-blue-950 data-[state=on]:text-white"

export function AiAnalytics() {
  const { tenantId } = useAiWorkspace()
  const [period, setPeriod] = useState<AiAnalyticsPeriod>("30")
  const [channel, setChannel] = useState<AiAnalyticsChannel>("ALL")
  const { data, loading, error, refresh } = useAiAnalytics(tenantId, period, channel)
  const hasActivity = data && data.totals.conversations > 0

  return (
    <div className="flex min-w-0 flex-col gap-4" aria-busy={loading}>
      <AiPageHeader title="Analytics" description="Follow your helper’s conversations, answers, and qualification activity."
        actions={<Button variant="outline" className={SECONDARY_BUTTON} onClick={refresh} disabled={loading}>
          <RefreshCw data-icon="inline-start" aria-hidden="true" />{loading ? "Loading…" : "Refresh"}
        </Button>}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ToggleGroup type="single" value={channel} spacing={1} aria-label="Activity source"
              className="max-w-full flex-wrap rounded-full bg-white/80 p-1"
              onValueChange={(value) => { if (channels.some((item) => item.value === value)) setChannel(value as AiAnalyticsChannel) }}>
              {channels.map((item) => <ToggleGroupItem key={item.value} value={item.value} className={toggleClass}>{item.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <ToggleGroup type="single" value={period} spacing={1} aria-label="Analytics period"
              className="rounded-full bg-white/80 p-1"
              onValueChange={(value) => { if (["7", "30", "90"].includes(value)) setPeriod(value as AiAnalyticsPeriod) }}>
              {(["7", "30", "90"] as const).map((value) => <ToggleGroupItem key={value} value={value} className={toggleClass}>{value} days</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4" aria-label="Activity totals">
            {metrics.map((metric) => <Card key={metric.key} className="gap-2 rounded-2xl border-white/80 bg-white/85 py-4 shadow-none">
              <CardHeader className="gap-1 px-4">
                <CardTitle className="text-xs font-medium text-slate-600">{metric.label}</CardTitle>
                <CardDescription className="text-xs">{metric.description}</CardDescription>
              </CardHeader>
              <CardContent className="px-4">
                {loading ? <Skeleton className="h-8 w-16" /> : <p className="text-2xl font-semibold text-slate-950 tabular-nums">{data ? data.totals[metric.key].toLocaleString() : "—"}</p>}
              </CardContent>
            </Card>)}
          </div>
        </div>
      </AiPageHeader>

      {error ? <Alert variant="destructive" role="alert"><AlertTitle>Analytics unavailable</AlertTitle><AlertDescription>{error} Counts are unavailable, rather than zero.</AlertDescription></Alert> : null}
      {loading ? <div role="status" aria-label="Loading Analytics" className="flex flex-col gap-3"><Skeleton className="h-80 w-full rounded-[22px]" /><span className="sr-only">Loading activity…</span></div> : null}
      {data ? <>
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500">
          <p>{dateLabel(data.from.slice(0, 10))} – {dateLabel(data.through.slice(0, 10))} · Daily totals in UTC</p>
          <Badge variant="outline">Recorded activity</Badge>
        </div>
        {!hasActivity ? <AiEmpty title="No activity in this period" description="Try Test helper or run a contact qualification analysis. Recorded activity will appear here; you can also change the source or date range." /> : <>
          <AiPanel title="Conversation activity" description="Chats active each day. A chat spanning several days is counted once in the period total.">
            <ChartContainer config={chartConfig} className="h-64 w-full aspect-auto focus-within:rounded-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 sm:h-72" aria-label="Daily conversations">
              <AreaChart accessibilityLayer data={data.daily} margin={{ left: 0, right: 12, top: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={dateLabel} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} tickCount={3} domain={[0, (maximum: number) => Math.max(1, maximum)]} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => dateLabel(String(value))} />} />
                <Area dataKey="conversations" type="linear" stroke="var(--color-conversations)" fill="var(--color-conversations)" fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
              </AreaChart>
            </ChartContainer>
          </AiPanel>
          <AiPanel title="Answer outcomes" description="Answered questions and replies flagged for more knowledge or agency help.">
            <ChartContainer config={chartConfig} className="h-64 w-full aspect-auto focus-within:rounded-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2" aria-label="Daily answered questions and questions needing review">
              <BarChart accessibilityLayer data={data.daily} margin={{ left: 0, right: 12, top: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={dateLabel} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} tickCount={3} domain={[0, (maximum: number) => Math.max(1, maximum)]} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => dateLabel(String(value))} />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="answered" stackId="questions" fill="var(--color-answered)" maxBarSize={32} isAnimationActive={false} />
                <Bar dataKey="needsReview" stackId="questions" fill="var(--color-needsReview)" maxBarSize={32} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
          </AiPanel>
          <details className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">View daily activity table</summary>
            <div className="mt-3 max-w-full overflow-x-auto" role="region" aria-label="Daily activity table" tabIndex={0}>
              <table className="w-full text-left text-xs tabular-nums">
                <caption className="sr-only">Daily activity in UTC for the selected source and period</caption>
                <thead><tr>{["Date (UTC)", ...metrics.map((metric) => metric.label)].map((label) => <th key={label} scope="col" className="p-2 font-medium">{label}</th>)}</tr></thead>
                <tbody>{data.daily.map((day) => <tr key={day.date} className="border-t border-slate-100"><th scope="row" className="whitespace-nowrap p-2 font-normal">{dateLabel(day.date)}</th>{metrics.map((metric) => <td key={metric.key} className="p-2">{day[metric.key].toLocaleString()}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </details>
        </>}
        <p className="px-1 text-xs leading-relaxed text-slate-500">Completed replies and scans are counted. Failed requests and test replies stopped before completion are excluded. Test helper never runs qualification checks. Contact analysis counts each explicit scan, including scans performed for follow-up questions. “Needs review” includes contact questions answered with rule guidance when saved knowledge is unavailable; it is not a human review queue. Questions and replies are not retained in Analytics.</p>
      </> : null}
    </div>
  )
}
