"use client"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { isAxiosError } from "axios"
import { api, type SubscriptionResponse } from "@/lib/api"
import { formatSubscriptionDate, formatStorageSize, subscriptionPlanDescriptions } from "@/lib/subscription-display"
import { Check, CheckCircle2, ChevronDown, CreditCard, HardDrive, RefreshCw, Sparkles, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { subscriptionPlans, type PlanKey } from "@/lib/subscription-plans"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

type Data = SubscriptionResponse["subscription"]
const messages: Record<string, string> = {
  BILLING_CHECKOUT_PENDING: "A billing request is already in progress. Try again shortly.", BILLING_SUBSCRIPTION_EXISTS: "A subscription already exists. Refresh its status before continuing.",
  BILLING_CHANGE_PENDING: "Another plan change or cancellation is pending. Manage it with your administrator before changing plans.",
  BILLING_SEAT_LIMIT: "This plan has fewer seats than your active team. Reduce active seats before scheduling the downgrade.",
  BILLING_RECONCILIATION_REQUIRED: "This earlier billing request needs to be checked. Contact your administrator before trying again.",
  BILLING_REQUIRED: "Complete the outstanding payment before changing plans.",
  BILLING_PAID_PERIOD_REMAINS: "Your previous paid period has not ended. Contact your administrator before starting a replacement subscription.",
  BILLING_PRICE_MISMATCH: "This plan is temporarily unavailable. Contact your administrator.",
}
export function SubscriptionBillingControls({ tenantId, subscription, userRole, timeZone, children }: { tenantId: string; subscription: Data; userRole: string; timeZone?: string | null; children?: ReactNode }) {
  const router = useRouter(), [pending, setPending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("")
  const [selected, setSelected] = useState<PlanKey | null>(null)
  const attempt = useRef<{ key: string; requestId: string } | null>(null)
  const syncInFlight = useRef(false), syncedReturn = useRef<string | null>(null)
  const existing = Boolean(subscription.stripeSubscriptionId && subscription.status !== "CANCELED")
  const active = subscription.status === "ACTIVE" && Boolean(subscription.stripeSubscriptionId)
  const admin = userRole === "TENANT_ADMIN", enabled = subscription.billingEnabled === true
  const selectedPlan = subscriptionPlans.find(p => p.key === selected)
  const cancelingSchedule = selected === subscription.planKey && Boolean(subscription.scheduledPlanKey)
  const current = subscriptionPlans.find(p => p.key === subscription.planKey)
  const upgrade = selectedPlan && current ? selectedPlan.monthlyPriceCents > current.monthlyPriceCents : false
  const refreshPayment = useCallback(async () => {
    if (!admin || !enabled || syncInFlight.current) return
    syncInFlight.current = true
    setPending(true); setError(""); setNotice("")
    try {
      const { data } = await api.post<{ access: { state: "PAID" | "GRACE" | "BLOCKED" } }>(`/api/billing/${tenantId}/sync`, {})
      setNotice(data.access.state === "PAID" ? "Your paid subscription is up to date." : data.access.state === "GRACE" ? "Payment needs attention. Update your payment method to resume AI replies." : "Payment is still awaiting confirmation. Refresh again after completing payment.")
      window.dispatchEvent(new Event("ai-credits-changed"))
      router.refresh()
    } catch (cause) {
      const code = isAxiosError(cause) ? cause.response?.data?.error : undefined
      if (code === "BILLING_CHECKOUT_PENDING") {
        setNotice("Payment confirmation is in progress. Refresh status again shortly.")
        router.refresh()
      } else setError(messages[code] ?? "Payment status could not be verified. Try refreshing again shortly.")
    } finally { syncInFlight.current = false; setPending(false) }
  }, [admin, enabled, tenantId, router])
  useEffect(() => {
    if (syncedReturn.current === tenantId || new URLSearchParams(window.location.search).get("checkout") !== "complete") return
    if (!admin || !enabled) return
    syncedReturn.current = tenantId
    void refreshPayment()
  }, [admin, enabled, tenantId, refreshPayment])
  async function run(kind: "checkout" | "portal" | "plan", planKey?: PlanKey) {
    if (pending || !admin || !enabled) return
    const key = `${kind}:${planKey ?? ""}`
    if (attempt.current?.key !== key) attempt.current = { key, requestId: crypto.randomUUID() }
    setPending(true); setError(""); setNotice("")
    try {
      const { data } = await api.post<{ url?: string | null; paymentPending?: boolean; effectiveAt?: string }>(`/api/billing/${tenantId}/${kind}`, { requestId: attempt.current.requestId, ...(planKey ? { planKey } : {}) })
      attempt.current = null
      if (data.url) {
        const url = new URL(data.url)
        if (url.origin !== window.location.origin && (url.protocol !== "https:" || !["checkout.stripe.com", "billing.stripe.com", "invoice.stripe.com", "pay.stripe.com"].includes(url.hostname))) throw new Error("Invalid billing redirect")
        window.location.assign(url.toString())
      } else {
        setNotice(data.paymentPending ? "Your plan change is waiting for payment confirmation." : "Your billing request was saved. Refresh status to see the latest payment confirmation.")
        router.refresh()
      }
    } catch (cause) {
      const code = isAxiosError(cause) ? cause.response?.data?.error : undefined
      if (["BILLING_REQUEST_CONFLICT", "BILLING_CHECKOUT_EXPIRED"].includes(code)) attempt.current = null
      setError(messages[code] ?? "Billing is unavailable right now. Your payment status has not been confirmed. Try again shortly.")
    } finally { setPending(false) }
  }
  const paid = subscription.access.state === "PAID"
  const statusLabel = paid ? subscription.cancelAtPeriodEnd ? "Cancellation scheduled" : "Active" : subscription.status === "CANCELED" ? "Canceled" : subscription.access.state === "GRACE" ? "Payment needs attention" : "Payment required"
  const dateLabel = subscription.cancelAtPeriodEnd ? "Access ends" : paid ? "Next billing date" : "Payment status"
  const dateValue = paid || subscription.cancelAtPeriodEnd ? formatSubscriptionDate(subscription.paidThrough ?? subscription.currentPeriodEnd, timeZone) : subscription.status === "CANCELED" ? "Subscription canceled" : "Awaiting payment"

  return (
    <>
      <Card id="billing-management" aria-labelledby="current-subscription-title">
        <CardHeader className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-3">
            <CardDescription>{paid ? "Your current plan" : subscription.status === "CANCELED" ? "Your previous plan" : "Your selected plan"}</CardDescription>
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle><h2 id="current-subscription-title" className="text-3xl font-semibold tracking-tight">{current?.name ?? subscription.planKey}</h2></CardTitle>
              <Badge variant={paid ? "secondary" : "outline"}>{paid ? <CheckCircle2 aria-hidden="true" /> : null}{statusLabel}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{subscriptionPlanDescriptions[subscription.planKey]}</p>
          </div>
          <div className="grid gap-1 sm:text-right">
            <p className="text-3xl font-semibold tracking-tight tabular-nums">{current?.monthlyPrice ?? "—"}<span className="text-sm font-normal text-muted-foreground"> / month</span></p>
            <p className="text-xs text-muted-foreground">USD · billed monthly</p>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-5 sm:grid-cols-3">
            <div className="grid gap-1.5"><dt className="text-xs text-muted-foreground">{dateLabel}</dt><dd className="text-sm font-medium">{dateValue}</dd></div>
            <div className="grid gap-1.5"><dt className="text-xs text-muted-foreground">Monthly plan allowance</dt><dd className="text-sm font-medium tabular-nums">{subscription.aiCreditsPerMonth.toLocaleString("en-US")} AI credits</dd></div>
            <div className="grid gap-1.5"><dt className="text-xs text-muted-foreground">Support included</dt><dd className="text-sm font-medium">{current?.support ?? "Contact your administrator"}</dd></div>
          </dl>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-4">
          <Separator />
          <div className="flex flex-wrap items-center gap-2">
            {admin && subscription.stripeCustomerId ? <Button disabled={!enabled || pending} onClick={() => void run("portal")}><CreditCard data-icon="inline-start" aria-hidden="true" />Manage billing</Button> : null}
            <Button asChild variant={subscription.stripeCustomerId ? "outline" : "default"}><a href="#subscription-plans">{paid ? "Change plan" : "View plans"}</a></Button>
            {subscription.scheduledPlanKey ? <Button variant="outline" disabled={!admin || !enabled || pending} onClick={() => setSelected(subscription.planKey)}>Keep current plan</Button> : null}
            {admin ? <Button variant="ghost" size="sm" disabled={!enabled || pending} onClick={() => void refreshPayment()}><RefreshCw data-icon="inline-start" aria-hidden="true" className={pending ? "animate-spin motion-reduce:animate-none" : undefined} />{pending ? "Updating…" : "Refresh payment status"}</Button> : null}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{!admin ? "Your account administrator manages plans and payments." : !enabled ? "Online billing is not available yet." : "Manage your payment method, invoices, and cancellation securely with Stripe."}</p>
          {subscription.scheduledPlanKey ? <Alert><AlertDescription>{subscriptionPlans.find(p => p.key === subscription.scheduledPlanKey)?.name} starts {formatSubscriptionDate(subscription.scheduledChangeAt, timeZone)}. Your current plan stays available until then.</AlertDescription></Alert> : null}
          {subscription.cancelAtPeriodEnd ? <Alert><AlertDescription>Your subscription is scheduled to end after its paid period. Manage billing to review the cancellation.</AlertDescription></Alert> : null}
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
        </CardFooter>
      </Card>

      {children}

      <section id="subscription-plans" aria-labelledby="subscription-plans-title" className="flex scroll-mt-6 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1"><h2 id="subscription-plans-title" className="text-base font-semibold">Find the right fit for your team</h2><p className="text-sm text-muted-foreground">Compare capacity and change your plan as your agency grows.</p></div>
          <p className="text-xs text-muted-foreground">All plans billed monthly in USD</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {subscriptionPlans.map(plan => {
            const isCurrent = plan.key === subscription.planKey
            const isUpgrade = plan.monthlyPriceCents > (current?.monthlyPriceCents ?? 0)
            const isScheduled = plan.key === subscription.scheduledPlanKey
            return <Card key={plan.key}>
              <CardHeader>
                <div className="flex min-h-5 items-center justify-between gap-2"><CardTitle><h3>{plan.name}</h3></CardTitle>{isCurrent ? <Badge variant="secondary">{paid ? "Current plan" : "Selected plan"}</Badge> : isScheduled ? <Badge variant="outline">Scheduled</Badge> : null}</div>
                <CardDescription>{subscriptionPlanDescriptions[plan.key]}</CardDescription>
              </CardHeader>
              <CardContent className="grid flex-1 gap-5">
                <p className="text-2xl font-semibold tracking-tight tabular-nums">{plan.monthlyPrice}<span className="text-sm font-normal text-muted-foreground"> / month</span></p>
                <ul className="grid gap-3 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2.5"><Users className="size-4 shrink-0" aria-hidden="true" /><span><strong className="font-medium text-foreground">{plan.seatLimit}</strong> team members</span></li>
                  <li className="flex items-center gap-2.5"><Sparkles className="size-4 shrink-0" aria-hidden="true" /><span><strong className="font-medium text-foreground">{plan.aiCreditsPerMonth.toLocaleString("en-US")}</strong> AI credits / month</span></li>
                  <li className="flex items-center gap-2.5"><HardDrive className="size-4 shrink-0" aria-hidden="true" /><span><strong className="font-medium text-foreground">{formatStorageSize(plan.storageBytes)}</strong> file storage</span></li>
                </ul>
              </CardContent>
              <CardFooter><Button className="w-full" variant={isCurrent ? "secondary" : "outline"} disabled={!admin || !enabled || pending || (existing && !active) || (active && isCurrent) || Boolean(active && (subscription.scheduledPlanKey || subscription.cancelAtPeriodEnd))} onClick={() => active ? setSelected(plan.key) : void run("checkout", plan.key)}>
                {pending ? "Please wait…" : !admin ? "Administrator required" : !enabled ? "Not available yet" : existing && !active ? "Payment required" : active && isCurrent ? "Your current plan" : isScheduled ? "Scheduled for renewal" : active ? `${isUpgrade ? "Upgrade" : "Switch"} to ${plan.name}` : `Choose ${plan.name}`}
              </Button></CardFooter>
            </Card>
          })}
        </div>
        <Collapsible className="group">
          <div className="flex flex-wrap items-center justify-between gap-2"><CollapsibleTrigger asChild><Button variant="ghost" size="sm">Compare all plan features<ChevronDown data-icon="inline-end" aria-hidden="true" className="transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" /></Button></CollapsibleTrigger><p className="text-xs text-muted-foreground">No trials. Plans activate after payment confirmation.</p></div>
          <CollapsibleContent>
            <div className="grid gap-6 py-5 md:grid-cols-3">{subscriptionPlans.map(plan => <section key={plan.key} className="grid content-start gap-3"><h3 className="text-sm font-semibold">{plan.name} includes</h3><ul className="grid gap-3">{plan.features.map(feature => <li key={feature} className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{feature}</li>)}</ul></section>)}</div>
          </CollapsibleContent>
        </Collapsible>
      </section>

      <AlertDialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{cancelingSchedule ? "Keep your current plan?" : `Change to ${selectedPlan?.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>{selectedPlan?.monthlyPrice}/month. {cancelingSchedule ? "The scheduled downgrade will be removed. Your current monthly plan will continue." : upgrade ? "The upgrade takes effect after the prorated payment is confirmed. Confirming may charge your saved payment method now." : "The downgrade takes effect at your next renewal. Your current plan remains available for its paid period."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Go back</AlertDialogCancel><AlertDialogAction disabled={pending} onClick={() => { if (selected) void run("plan", selected) }}>{cancelingSchedule ? "Remove scheduled change" : "Confirm change"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
