"use client"
import type { ReactNode } from "react"
import Link from "next/link"
import { AlertCircle, RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LabeledProgress } from "@/components/ui/labeled-progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { creditDisplay, formatCreditDate } from "@/lib/ai-credit-usage"
import { useAiCreditOverview, type AiCreditOverviewController } from "@/lib/use-ai-credit-overview"
const count = (value: number) => value.toLocaleString("en-US")
const labels = { ready: "Available", low: "Running low", exhausted: "No credits available", reserved: "Replies in progress", review: "Billing review", paused: "AI paused", unavailable: "Not available yet", invalid: "Usage unavailable" }
export function AiCreditUsageCard({ controller, manageHref, userRole = "TENANT_ADMIN", footer }: { controller: AiCreditOverviewController; manageHref: string; userRole?: string; footer?: ReactNode }) {
  const { data, loading, error, refresh } = controller
  const admin = userRole === "TENANT_ADMIN", display = data ? creditDisplay(data) : null
  const valid = display && !["unavailable", "invalid"].includes(display.state) && data?.usage ? data.usage : null
  const paused = display?.state === "paused" || display?.state === "review"
  const periodEnd = formatCreditDate(valid?.period?.endsAt, data?.timeZone)
  return <Card aria-busy={loading}>
    <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="grid gap-1.5"><CardTitle>AI credit usage</CardTitle><CardDescription>Shared by your whole team. One credit covers one generated AI reply; rules-only checks are free.</CardDescription></div>
      {admin ? <Button type="button" variant="ghost" size="sm" className="shrink-0 self-start" disabled={loading} onClick={refresh}><RefreshCw data-icon="inline-start" className={loading ? "animate-spin motion-reduce:animate-none" : undefined} />{loading ? "Refreshing" : "Refresh"}</Button> : null}
    </CardHeader>
    <CardContent className="grid gap-5">
      {!admin ? <p className="text-sm text-muted-foreground">Your account administrator can view credit usage and manage purchases.</p>
        : error ? <Alert variant="destructive"><AlertCircle /><AlertTitle>Credit usage unavailable</AlertTitle><AlertDescription>{error} No balance is shown until it can be verified.<Button type="button" variant="outline" size="sm" onClick={refresh}>Try again</Button></AlertDescription></Alert>
        : !data ? <div aria-label="Loading credit usage" className="grid gap-3"><Skeleton className="h-9 w-44" /><Skeleton className="h-7 w-full" /><Skeleton className="h-14 w-full" /></div>
        : !valid || !display || !("available" in display) ? <div className="grid justify-items-start gap-3"><Badge variant="outline">{display?.state === "invalid" ? "Usage unavailable" : "Usage tracking coming soon"}</Badge><p className="text-sm leading-relaxed text-muted-foreground">{display?.state === "invalid" ? "The latest balance could not be verified. Refresh to try again." : data.plan ? `Your ${data.plan.name} plan includes ${count(data.plan.monthlyAllowance)} AI credits each month. Detailed usage will appear here when available.` : "Your balances will appear here when AI credits are available."}</p></div>
        : <>
          <div className="flex flex-wrap items-end justify-between gap-3"><div className="grid gap-1"><p className="text-sm text-muted-foreground">{paused ? "Credits in balance" : "Credits available to spend"}</p><p className="text-3xl font-semibold tracking-tight tabular-nums">{count(display.available)}</p></div><Badge variant={display.state === "exhausted" || display.state === "review" ? "destructive" : "secondary"}>{labels[display.state]}</Badge></div>
          {display.state === "review" ? <Alert variant="destructive"><AlertTitle>A purchase needs billing review</AlertTitle><AlertDescription>New AI spending and purchases are paused. Your balances are retained while the payment is reviewed.</AlertDescription></Alert>
            : display.state === "paused" ? <Alert><AlertTitle>AI replies are paused</AlertTitle><AlertDescription>{data.access?.state === "GRACE" ? `Update your payment method to resume AI. CRM access remains available until ${formatCreditDate(data.access.graceEndsAt, data.timeZone) ?? "the payment recovery period ends"}.` : "An active paid subscription is required to use these credits. Your purchased balance is retained."}</AlertDescription></Alert>
            : display.state === "reserved" ? <Alert><AlertTitle>Credits are reserved for replies in progress</AlertTitle><AlertDescription>Refresh after those replies finish. Failed replies release their reserved credits.</AlertDescription></Alert>
            : display.state === "exhausted" ? <Alert><AlertTitle>Your available credits are used up</AlertTitle><AlertDescription>{data.purchasesEnabled ? "Buy additional credits to keep using AI, or wait for your next paid monthly allowance." : "Your next monthly allowance is added after payment is confirmed. Rules-only qualification checks remain free."}</AlertDescription></Alert>
            : display.state === "low" ? <Alert><AlertTitle>Your team is running low on credits</AlertTitle><AlertDescription>{count(display.available)} credits are available across your monthly allowance and purchased balance.</AlertDescription></Alert> : null}
          <div className="grid gap-3"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium">Monthly credits remaining</p><p className="text-sm text-muted-foreground">{data.plan?.name ?? "Current plan"}</p></div>
            {display.monthlyPercent !== null ? <LabeledProgress value={display.monthlyPercent} ariaLabel="Monthly AI credits remaining" ariaValueText={`${display.monthlyPercent}% remaining; ${count(valid.monthly.remaining)} of ${count(valid.monthly.granted)} credits available, ${count(valid.monthly.used)} used and ${count(valid.monthly.reserved)} reserved`} summaryLabel={`${count(valid.monthly.remaining)} of ${count(valid.monthly.granted)} available`} /> : <p className="text-sm text-muted-foreground">No monthly allowance has been granted for this period. An allowance is added after the subscription payment is confirmed.</p>}
            <dl className="grid grid-cols-3 gap-3 text-sm"><div><dt className="text-muted-foreground">Granted</dt><dd className="font-medium tabular-nums">{count(valid.monthly.granted)}</dd></div><div><dt className="text-muted-foreground">Used</dt><dd className="font-medium tabular-nums">{count(valid.monthly.used)}</dd></div><div><dt className="text-muted-foreground">Reserved</dt><dd className="font-medium tabular-nums">{count(valid.monthly.reserved)}</dd></div></dl>
            <p className="text-xs leading-relaxed text-muted-foreground">{periodEnd ? `Unused monthly credits expire ${periodEnd}. ` : ""}{data.cancelAtPeriodEnd ? "Your subscription ends after its paid period." : "The next allowance is added after the next subscription payment is confirmed."}</p>
          </div>
          <Separator /><div className="grid gap-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Purchased credits available</p><p className="text-xl font-semibold tabular-nums">{count(valid.purchased.available)}</p></div><p className="text-xs text-muted-foreground">{count(valid.purchased.balance)} in balance · {count(valid.purchased.reserved)} reserved. Purchased credits carry over and are used after monthly credits.</p></div>
          <p className="text-xs text-muted-foreground">Updated {formatCreditDate(data.asOf, data.timeZone) ?? "on the last successful refresh"}. Reserved credits are held for replies in progress and are excluded from available credits.</p>
        </>}
      {footer !== undefined ? footer : admin ? <div className="flex flex-wrap gap-2"><Button asChild variant={valid && !paused && data?.purchasesEnabled ? "default" : "outline"}><Link href={manageHref}>{valid && !paused && data?.purchasesEnabled ? "Buy AI credits" : "Manage billing"}</Link></Button><p className="self-center text-xs text-muted-foreground">No trials. Payment must be confirmed before credits are added.</p></div> : null}
    </CardContent>
  </Card>
}
export function AiCreditUsage({ tenantId, tenantSlug, userRole }: { tenantId: string; tenantSlug: string; userRole: string }) {
  const controller = useAiCreditOverview(tenantId, userRole === "TENANT_ADMIN")
  return <AiCreditUsageCard controller={controller} userRole={userRole} manageHref={`/app/${tenantSlug}/account-settings/subscription#ai-credit-purchases`} />
}
