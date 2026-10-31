"use client"
import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { isAxiosError } from "axios"
import { api } from "@/lib/api"
import { subscriptionPlans, type PlanKey } from "@/lib/subscription-plans"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

type Data = { planKey: PlanKey; status: string; billingEnabled?: boolean; stripeCustomerId?: string | null; stripeSubscriptionId?: string | null; paidThrough?: string | null; scheduledPlanKey?: PlanKey | null; scheduledChangeAt?: string | null; cancelAtPeriodEnd?: boolean }
const messages: Record<string, string> = {
  BILLING_CHECKOUT_PENDING: "A billing request is already in progress. Try again shortly.", BILLING_SUBSCRIPTION_EXISTS: "A subscription already exists. Refresh its status before continuing.",
  BILLING_CHANGE_PENDING: "Another plan change or cancellation is pending. Manage it with your administrator before changing plans.",
  BILLING_SEAT_LIMIT: "This plan has fewer seats than your active team. Reduce active seats before scheduling the downgrade.",
  BILLING_RECONCILIATION_REQUIRED: "This earlier billing request needs to be checked. Contact your administrator before trying again.",
  BILLING_REQUIRED: "Complete the outstanding payment before changing plans.",
  BILLING_PAID_PERIOD_REMAINS: "Your previous paid period has not ended. Contact your administrator before starting a replacement subscription.",
  BILLING_PRICE_MISMATCH: "This plan is temporarily unavailable. Contact your administrator.",
}
export function SubscriptionBillingControls({ tenantId, subscription, userRole }: { tenantId: string; subscription: Data; userRole: string }) {
  const router = useRouter(), [pending, setPending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("")
  const [selected, setSelected] = useState<PlanKey | null>(null)
  const attempt = useRef<{ key: string; requestId: string } | null>(null)
  const existing = Boolean(subscription.stripeSubscriptionId && subscription.status !== "CANCELED")
  const active = subscription.status === "ACTIVE" && Boolean(subscription.stripeSubscriptionId)
  const admin = userRole === "TENANT_ADMIN", enabled = subscription.billingEnabled === true
  const selectedPlan = subscriptionPlans.find(p => p.key === selected)
  const cancelingSchedule = selected === subscription.planKey && Boolean(subscription.scheduledPlanKey)
  const current = subscriptionPlans.find(p => p.key === subscription.planKey)
  const upgrade = selectedPlan && current ? selectedPlan.monthlyPriceCents > current.monthlyPriceCents : false
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
  return (
    <Card id="billing-management">
      <CardHeader>
        <CardTitle>Manage billing</CardTitle>
        <CardDescription>No free trials. Plans activate after payment is confirmed.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!admin ? <p className="text-sm text-muted-foreground">Your account administrator manages billing.</p> : !enabled ? <p className="text-sm text-muted-foreground">Online billing is not available yet.</p> : null}
        {subscription.scheduledPlanKey ? <p className="text-sm">{subscription.scheduledPlanKey} is scheduled for {subscription.scheduledChangeAt ? new Date(subscription.scheduledChangeAt).toLocaleDateString() : "your next renewal"}.</p> : null}
        {subscription.cancelAtPeriodEnd ? <p className="text-sm">Your subscription will end after the current paid period.</p> : null}
        <div className="grid gap-3 md:grid-cols-3">
          {subscriptionPlans.map(plan => (
            <div key={plan.key} className="grid gap-3 rounded-lg border p-4">
              <div><p className="font-medium">{plan.name}</p><p className="text-sm text-muted-foreground">{plan.monthlyPrice}/month · {plan.seatLimit} seats</p></div>
              <Button variant={plan.key === subscription.planKey ? "default" : "outline"} disabled={!admin || !enabled || pending || (existing && !active) || (active && plan.key === subscription.planKey) || Boolean(active && (subscription.scheduledPlanKey || subscription.cancelAtPeriodEnd))} onClick={() => active ? setSelected(plan.key) : void run("checkout", plan.key)}>
                {pending ? "Please wait…" : existing && !active ? "Payment required" : active && plan.key === subscription.planKey ? "Current plan" : active ? `Change to ${plan.name}` : `Choose ${plan.name}`}
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {subscription.scheduledPlanKey ? <Button variant="outline" disabled={!admin || !enabled || pending} onClick={() => setSelected(subscription.planKey)}>Keep current plan</Button> : null}
          <Button variant="outline" disabled={!admin || !enabled || pending || !subscription.stripeCustomerId} onClick={() => void run("portal")}>Payment methods, invoices & cancellation</Button>
          <Button variant="ghost" disabled={pending} onClick={() => router.refresh()}>Refresh payment status</Button>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      </CardContent>
      <AlertDialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{cancelingSchedule ? "Keep your current plan?" : `Change to ${selectedPlan?.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>{selectedPlan?.monthlyPrice}/month. {cancelingSchedule ? "The scheduled downgrade will be removed. Your current monthly plan will continue." : upgrade ? "The upgrade takes effect after the prorated payment is confirmed. Confirming may charge your saved payment method now." : "The downgrade takes effect at your next renewal. Your current plan remains available for its paid period."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Go back</AlertDialogCancel><AlertDialogAction disabled={pending} onClick={() => { if (selected) void run("plan", selected) }}>{cancelingSchedule ? "Remove scheduled change" : "Confirm change"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
