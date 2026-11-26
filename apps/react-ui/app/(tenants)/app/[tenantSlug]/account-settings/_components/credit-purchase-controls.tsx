"use client"
import { useEffect, useRef, useState } from "react"
import type { AiCreditOverviewController } from "@/lib/use-ai-credit-overview"
import { isAxiosError } from "axios"
import { api } from "@/lib/api"
import { aiCreditPacks } from "@/lib/subscription-plans"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
type PackKey = keyof typeof aiCreditPacks

function go(url: string) {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:" || parsed.hostname !== "checkout.stripe.com") throw new Error("Invalid Checkout link")
  window.location.assign(parsed.toString())
}
const messages: Record<string, string> = {
  BILLING_REQUIRED: "An active paid subscription is required to buy AI credits.",
  BILLING_CHECKOUT_PENDING: "A payment is already in progress. Refresh to resume or cancel the unpaid Checkout.",
  AI_PURCHASE_REVIEW_REQUIRED: "A credit purchase needs billing review. Contact your account administrator.",
  CREDIT_PAYMENT_ALREADY_COMPLETED: "This payment has already finished. Refresh to check its credits.",
  CREDIT_PURCHASES_UNAVAILABLE: "Additional credit purchases are not available yet.",
  BILLING_PRICE_MISMATCH: "This credit pack is temporarily unavailable. Contact your administrator.",
  BILLING_RECONCILIATION_REQUIRED: "This payment needs to be checked. Contact your administrator before starting another purchase.",
  BILLING_CHECKOUT_EXPIRED: "That unpaid Checkout expired. Choose a pack to start a new payment.",
}
export function CreditPurchaseControls({ tenantId, userRole, overview }: { tenantId: string; userRole: string; overview: AiCreditOverviewController }) {
  const { data, refresh } = overview
  const [error, setError] = useState(""), [busy, setBusy] = useState(false)
  const attempt = useRef<{ tenantId: string; packKey: PackKey; requestId: string } | null>(null)
  const mutation = useRef<AbortController | null>(null)
  useEffect(() => () => mutation.current?.abort(), [tenantId])
  const admin = userRole === "TENANT_ADMIN"
  async function buy(packKey: PackKey) {
    if (busy || !data?.eligible) return
    if (attempt.current?.tenantId !== tenantId || attempt.current.packKey !== packKey) attempt.current = { tenantId, packKey, requestId: crypto.randomUUID() }
    const controller = new AbortController(); mutation.current = controller
    setBusy(true); setError("")
    try {
      const { data } = await api.post<{ url: string }>(`/api/billing/${tenantId}/credits/checkout`, { packKey, requestId: attempt.current.requestId }, { signal: controller.signal })
      if (controller.signal.aborted) return
      go(data.url); attempt.current = null
    } catch (cause) {
      if (controller.signal.aborted) return
      const code = isAxiosError(cause) ? cause.response?.data?.error : undefined
      if (["BILLING_REQUEST_CONFLICT", "BILLING_CHECKOUT_EXPIRED"].includes(code)) attempt.current = null
      setError(messages[code] ?? "Payment could not be confirmed. Refresh the purchase status before trying again.")
      refresh()
    } finally { setBusy(false) }
  }
  async function cancel() {
    if (!data?.pendingCheckout || busy) return
    const controller = new AbortController(); mutation.current = controller
    setBusy(true); setError("")
    try {
      await api.post(`/api/billing/${tenantId}/credits/${data.pendingCheckout.id}/cancel`, {}, { signal: controller.signal })
      attempt.current = null; refresh(); window.dispatchEvent(new Event("ai-credits-changed"))
    } catch (cause) {
      if (controller.signal.aborted) return
      const code = isAxiosError(cause) ? cause.response?.data?.error : undefined
      setError(messages[code] ?? "Could not cancel this payment. Refresh its status before continuing.")
      refresh()
    } finally { setBusy(false) }
  }
  if (!admin) return null
  if (!data) return error ? <Alert id="ai-credit-purchases" variant="destructive"><AlertTitle>Check your purchase status</AlertTitle><AlertDescription><p>{error}</p><Button variant="outline" size="sm" disabled={overview.loading} onClick={refresh}>Refresh purchase status</Button></AlertDescription></Alert> : null
  if (!data.purchasesEnabled && !data.pendingCheckout && !data.usage?.purchaseReviewRequired && !error) return null

  return <Card id="ai-credit-purchases" className="scroll-mt-6">
    <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="grid gap-1.5"><CardTitle><h2>Need more AI credits?</h2></CardTitle><CardDescription>Purchased credits carry over and are used after your monthly allowance.</CardDescription></div>
      <Badge variant="outline">One-time purchase</Badge>
    </CardHeader>
    <CardContent className="grid gap-4">
      {overview.error ? <Alert variant="destructive"><AlertDescription>Purchase availability could not be verified. Refresh the credit status to try again.</AlertDescription></Alert> : null}
      {data.usage?.purchaseReviewRequired ? <Alert variant="destructive"><AlertTitle>A purchase needs billing review</AlertTitle><AlertDescription>New AI spending and purchases are paused. Your credit balances are retained.</AlertDescription></Alert> : null}
      {data.pendingCheckout ? <Alert><AlertTitle>A credit purchase is awaiting confirmation</AlertTitle><AlertDescription><p>Resume the secure payment page, or cancel the unpaid purchase.</p><div className="flex flex-wrap gap-2">{data.pendingCheckout.url && data.canResume ? <Button variant="outline" disabled={busy} onClick={() => { try { go(data.pendingCheckout!.url!) } catch { setError("Could not open this Checkout.") } }}>Resume checkout</Button> : null}<Button variant="ghost" disabled={busy} onClick={() => void cancel()}>Cancel unpaid purchase</Button></div></AlertDescription></Alert> : null}
      {data.purchasesEnabled ? <>
        {!data.eligible && !data.pendingCheckout && !data.usage?.purchaseReviewRequired ? <p className="text-sm text-muted-foreground">An active paid subscription is required to purchase additional credits.</p> : null}
        <div className="grid gap-3 md:grid-cols-3">{Object.entries(aiCreditPacks).map(([key, pack]) => <div key={key} className="grid gap-4 rounded-lg border p-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-sm font-medium tabular-nums">{pack.credits.toLocaleString("en-US")} credits</p><p className="text-xl font-semibold tabular-nums">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(pack.priceCents / 100)}</p></div><Button variant="outline" disabled={!data.eligible || busy || overview.loading} onClick={() => void buy(key as PackKey)}>{busy ? "Please wait…" : "Buy credits"}</Button></div>)}</div>
        <p className="text-xs text-muted-foreground">Credit cost per reply depends on the selected AI model. Rules-only checks are free.</p>
      </> : null}
      <div className="flex flex-wrap items-center gap-3"><Button variant="ghost" size="sm" disabled={busy || overview.loading} onClick={() => { setError(""); refresh() }}>Refresh purchase status</Button><p className="text-xs text-muted-foreground">Payment is completed securely through Stripe.</p></div>
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
    </CardContent>
  </Card>
}
