"use client"

import Link from "next/link"
import { useState } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { AiCreditUsageCard } from "@/components/ai-credit-usage"
import type { AiCreditOverviewController } from "@/lib/use-ai-credit-overview"
import type { AiUsageAnalytics } from "../_lib/analytics"
import { AiEmpty, AiPanel } from "./ai-ui"

const count = (value: number) => value.toLocaleString("en-US")
const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
const chartConfig = {
  creditsUsed: { label: "Credits spent", color: "var(--chart-3)" },
  inputTokens: { label: "Input tokens", color: "var(--chart-2)" },
  outputTokens: { label: "Output tokens", color: "var(--chart-1)" },
} satisfies ChartConfig

export function AiUsageReport({ usage, loading, credits, tenantSlug, userRole }: {
  usage?: AiUsageAnalytics; loading: boolean; credits: AiCreditOverviewController; tenantSlug: string; userRole: string
}) {
  const [metric, setMetric] = useState<"credits" | "tokens">("credits")
  const totals = usage?.totals
  const knownTokens = totals ? totals.inputTokens + totals.outputTokens : 0
  const tokenLabel = !totals ? "—" : !usage?.meteringEnabled && totals.providerCalls === 0 ? "Not tracking"
    : totals.unknownTokenCalls && knownTokens === 0 ? "Unavailable" : `${count(knownTokens)}${totals.unknownTokenCalls ? " known" : ""}`
  const hasUsage = totals && (totals.providerCalls > 0 || totals.chargedReplies > 0)
  return <section aria-label="AI usage" className="flex min-w-0 flex-col gap-4">
    <div className="grid items-start gap-4 xl:grid-cols-2">
      <AiCreditUsageCard controller={credits} userRole={userRole} compact manageHref={`/app/${tenantSlug}/account-settings/subscription#ai-credit-purchases`}
        footer={userRole === "TENANT_ADMIN" ? <Button asChild variant="outline" size="sm"><Link href={`/app/${tenantSlug}/account-settings/subscription`}>Manage credits</Link></Button> : null} />
      <Card>
        <CardHeader><div className="flex flex-wrap items-start justify-between gap-2"><CardTitle><h2>Usage in selected period</h2></CardTitle>{usage && !usage.meteringEnabled ? <Badge variant="outline">Token tracking paused</Badge> : null}</div><CardDescription>Follows the source and date filters above.</CardDescription></CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-1.5"><p className="text-sm text-muted-foreground">Credits spent</p>{loading ? <Skeleton className="h-8 w-24" /> : <p className="text-3xl font-semibold tracking-tight tabular-nums">{totals ? count(totals.creditsUsed) : "—"}</p>}<p className="text-xs text-muted-foreground">{totals ? `${count(totals.chargedReplies)} generated ${totals.chargedReplies === 1 ? "reply" : "replies"} charged. ` : ""}Released reservations and free checks are excluded.</p></div>
          <Separator />
          <div className="grid gap-1.5"><p className="text-sm text-muted-foreground">Recorded tokens</p>{loading ? <Skeleton className="h-8 w-28" /> : <p className="text-2xl font-semibold tracking-tight tabular-nums">{tokenLabel}</p>}<p className="text-xs text-muted-foreground">{totals && (knownTokens > 0 || (usage?.meteringEnabled && totals.unknownTokenCalls === 0)) ? `${count(totals.inputTokens)} input · ${count(totals.outputTokens)} output. ` : ""}Counts include cached input and reasoning output once.</p></div>
          <Separator />
          <div className="flex items-start justify-between gap-3"><div className="grid gap-1.5"><p className="text-sm text-muted-foreground">Provider calls</p><p className="text-xs leading-relaxed text-muted-foreground">Includes internal calls and unsuccessful attempts.{totals ? ` ${count(totals.failedCalls)} failed · ${count(totals.inProgressCalls)} in progress.` : ""}</p></div>{loading ? <Skeleton className="h-7 w-14" /> : <p className="text-2xl font-semibold tabular-nums">{totals ? count(totals.providerCalls) : "—"}</p>}</div>
          {totals && totals.unknownTokenCalls > 0 ? <Alert><AlertDescription>Token counts are missing for {count(totals.unknownTokenCalls)} of {count(totals.providerCalls)} calls. Totals and charts include known tokens only.</AlertDescription></Alert> : null}
          {usage && !usage.creditEnforcementEnabled ? <p className="text-xs text-muted-foreground">Credit deductions are currently off. Previously recorded spending is still shown.</p> : null}
        </CardContent>
      </Card>
    </div>
    {usage ? <>
      {!hasUsage ? <AiEmpty title="No usage recorded in this period" description="Usage appears after an AI request. Try another source or date range to see earlier records." /> : <AiPanel title="Usage over time" description={metric === "credits" ? "Credits committed each day in the selected period. Your current balance is shown separately above." : "Recorded input and output tokens per day. Only reported token counts are included in these totals."}
        actions={<ToggleGroup type="single" variant="outline" size="sm" value={metric} aria-label="Usage chart metric" onValueChange={value => { if (value === "credits" || value === "tokens") setMetric(value) }}><ToggleGroupItem value="credits">Credits</ToggleGroupItem><ToggleGroupItem value="tokens">Tokens</ToggleGroupItem></ToggleGroup>}>
        <ChartContainer config={chartConfig} className="h-64 w-full aspect-auto focus-within:rounded-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2" aria-label={metric === "credits" ? "Daily credits spent" : "Daily recorded tokens"}>
          <BarChart accessibilityLayer data={usage.daily} margin={{ left: 0, right: 12, top: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={dateLabel} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={52} tickCount={3} domain={[0, (maximum: number) => Math.max(1, maximum)]} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={value => dateLabel(String(value))} />} />
            {metric === "tokens" ? <ChartLegend content={<ChartLegendContent />} /> : null}
            {metric === "credits" ? <Bar key="creditsUsed" dataKey="creditsUsed" fill="var(--color-creditsUsed)" maxBarSize={32} isAnimationActive={false} /> : null}
            {metric === "tokens" ? <Bar key="inputTokens" dataKey="inputTokens" stackId="tokens" fill="var(--color-inputTokens)" maxBarSize={32} isAnimationActive={false} /> : null}
            {metric === "tokens" ? <Bar key="outputTokens" dataKey="outputTokens" stackId="tokens" fill="var(--color-outputTokens)" maxBarSize={32} isAnimationActive={false} /> : null}
          </BarChart>
        </ChartContainer>
        <details className="mt-4 text-sm"><summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">View daily usage table</summary><div className="mt-3 max-w-full overflow-x-auto" role="region" aria-label="Daily usage table" tabIndex={0}><table className="w-full text-left text-xs tabular-nums"><caption className="sr-only">Daily recorded usage in UTC for the selected source and period</caption><thead><tr>{["Date (UTC)", "Credits spent", "Charged replies", "Provider calls", "Input tokens", "Output tokens", "Calls missing tokens"].map(label => <th key={label} scope="col" className="whitespace-nowrap p-2 font-medium">{label}</th>)}</tr></thead><tbody>{usage.daily.map(day => <tr key={day.date} className="border-t"><th scope="row" className="whitespace-nowrap p-2 font-normal">{dateLabel(day.date)}</th>{(["creditsUsed", "chargedReplies", "providerCalls", "inputTokens", "outputTokens", "unknownTokenCalls"] as const).map(key => <td key={key} className="p-2">{count(day[key])}</td>)}</tr>)}</tbody></table></div></details>
      </AiPanel>}
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">Credits measure account spending; tokens measure text processed by the AI provider. One reply can require several provider calls. Usage before tracking was enabled is not backfilled. No conversation text is included in these reports.</p>
    </> : null}
  </section>
}
