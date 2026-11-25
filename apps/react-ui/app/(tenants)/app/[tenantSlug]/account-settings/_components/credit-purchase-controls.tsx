"use client"
import { useEffect, useRef, useState } from "react"
import { AiCreditUsageCard } from "@/components/ai-credit-usage"
import { useAiCreditOverview } from "@/lib/use-ai-credit-overview"
import { isAxiosError } from "axios"
import { api } from "@/lib/api"
import { aiCreditPacks } from "@/lib/subscription-plans"
import { Button } from "@/components/ui/button"
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
export function CreditPurchaseControls({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  const overview = useAiCreditOverview(tenantId, userRole === "TENANT_ADMIN")
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
  return <><AiCreditUsageCard controller={overview} userRole={userRole} manageHref="#ai-credit-purchases" /><Card id="ai-credit-purchases">
    <CardHeader><CardTitle>Additional AI credits</CardTitle><CardDescription>One-time purchases. One credit covers one generated AI reply; rules-only checks are free. Purchased credits carry over and require an active subscription.</CardDescription></CardHeader>
    <CardContent className="grid gap-4">
      {!admin ? <p className="text-sm text-muted-foreground">Your account administrator can purchase credits.</p> : overview.error ? <p role="alert" className="text-sm text-destructive">Purchase availability could not be verified. Refresh the credit status to try again.</p> : !data ? <p className="text-sm text-muted-foreground">Checking purchase availability…</p> : !data.purchasesEnabled ? <p className="text-sm text-muted-foreground">Additional credit purchases are not available yet.</p> : !data.eligible && !data.pendingCheckout && !data.usage?.purchaseReviewRequired ? <p className="text-sm text-muted-foreground">An active paid subscription is required to purchase credits.</p> : null}

      {data?.usage?.purchaseReviewRequired ? <p role="alert" className="text-sm text-destructive">A purchase needs billing review. New AI spending and purchases are paused; your balances are retained.</p> : null}
      {data?.pendingCheckout ? <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3"><p className="text-sm">A credit purchase is awaiting confirmation.</p>{data.pendingCheckout.url && data.canResume ? <Button variant="outline" disabled={busy} onClick={() => { try { go(data.pendingCheckout!.url!) } catch { setError("Could not open this Checkout.") } }}>Resume Checkout</Button> : null}<Button variant="ghost" disabled={busy} onClick={() => void cancel()}>Cancel unpaid Checkout</Button></div> : null}
      <div className="grid gap-3 md:grid-cols-3">{Object.entries(aiCreditPacks).map(([key, pack]) => <div key={key} className="grid gap-3 rounded-lg border p-4"><div><p className="font-medium">{pack.credits.toLocaleString()} credits</p><p className="text-sm text-muted-foreground">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(pack.priceCents / 100)} one time</p></div><Button variant="outline" disabled={!admin || !data?.eligible || busy} onClick={() => void buy(key as PackKey)}>{busy ? "Please wait…" : "Continue to secure Checkout"}</Button></div>)}</div>
      {admin ? <Button variant="ghost" disabled={busy} onClick={() => { setError(""); refresh() }}>Refresh credit status</Button> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </CardContent>
  </Card></>
}
