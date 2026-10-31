"use client"
import { useEffect, useRef, useState } from "react"
import { isAxiosError } from "axios"
import { api } from "@/lib/api"
import { aiCreditPacks } from "@/lib/subscription-plans"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
type PackKey = keyof typeof aiCreditPacks
type Overview = { purchasesEnabled: boolean; eligible: boolean; usage: { purchased: { balance: number; reserved: number; available: number }; purchaseReviewRequired: boolean } | null; pendingCheckout?: { id: string; packKey: string; url: string | null } | null }
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
  const [loaded, setLoaded] = useState<{ tenantId: string; data: Overview } | null>(null), [refresh, setRefresh] = useState(0)
  const [error, setError] = useState(""), [busy, setBusy] = useState(false)
  const attempt = useRef<{ tenantId: string; packKey: PackKey; requestId: string } | null>(null)
  const data = loaded?.tenantId === tenantId ? loaded.data : null, admin = userRole === "TENANT_ADMIN"
  useEffect(() => {
    if (!admin) return
    const controller = new AbortController()
    void api.get<Overview>(`/api/billing/${tenantId}/credits`, { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setLoaded({ tenantId, data })
    }).catch(() => { if (!controller.signal.aborted) setError("Could not load credit purchase status. Try refreshing.") })
    return () => controller.abort()
  }, [tenantId, admin, refresh])
  async function buy(packKey: PackKey) {
    if (busy || !data?.eligible) return
    if (attempt.current?.tenantId !== tenantId || attempt.current.packKey !== packKey) attempt.current = { tenantId, packKey, requestId: crypto.randomUUID() }
    setBusy(true); setError("")
    try {
      const { data } = await api.post<{ url: string }>(`/api/billing/${tenantId}/credits/checkout`, { packKey, requestId: attempt.current.requestId })
      go(data.url); attempt.current = null
    } catch (cause) {
      const code = isAxiosError(cause) ? cause.response?.data?.error : undefined
      if (["BILLING_REQUEST_CONFLICT", "BILLING_CHECKOUT_EXPIRED"].includes(code)) attempt.current = null
      setError(messages[code] ?? "Payment could not be confirmed. Refresh the purchase status before trying again.")
      setRefresh(value => value + 1)
    } finally { setBusy(false) }
  }
  async function cancel() {
    if (!data?.pendingCheckout || busy) return
    setBusy(true); setError("")
    try {
      await api.post(`/api/billing/${tenantId}/credits/${data.pendingCheckout.id}/cancel`, {})
      attempt.current = null; setRefresh(value => value + 1)
    } catch (cause) {
      const code = isAxiosError(cause) ? cause.response?.data?.error : undefined
      setError(messages[code] ?? "Could not cancel this payment. Refresh its status before continuing.")
      setRefresh(value => value + 1)
    } finally { setBusy(false) }
  }
  return <Card>
    <CardHeader><CardTitle>Additional AI credits</CardTitle><CardDescription>One-time purchases. Purchased credits carry over; an active subscription is required to use them.</CardDescription></CardHeader>
    <CardContent className="grid gap-4">
      {!admin ? <p className="text-sm text-muted-foreground">Your account administrator can purchase credits.</p> : !data?.purchasesEnabled ? <p className="text-sm text-muted-foreground">Additional credit purchases are not available yet.</p> : !data.eligible && !data.pendingCheckout && !data.usage?.purchaseReviewRequired ? <p className="text-sm text-muted-foreground">An active paid subscription is required to purchase credits.</p> : null}
      {data?.usage ? <p className="text-sm">Purchased credits available: <strong>{data.usage.purchased.available.toLocaleString()}</strong>{data.usage.purchased.reserved ? ` (${data.usage.purchased.reserved.toLocaleString()} reserved)` : ""}</p> : null}
      {data?.usage?.purchaseReviewRequired ? <p role="alert" className="text-sm text-destructive">A purchase needs billing review. New AI spending and purchases are paused; your balances are retained.</p> : null}
      {data?.pendingCheckout ? <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3"><p className="text-sm">An unpaid purchase is awaiting confirmation.</p>{data.pendingCheckout.url && data.purchasesEnabled ? <Button variant="outline" disabled={busy} onClick={() => { try { go(data.pendingCheckout!.url!) } catch { setError("Could not open this Checkout.") } }}>Resume Checkout</Button> : null}<Button variant="ghost" disabled={busy} onClick={() => void cancel()}>Cancel unpaid Checkout</Button></div> : null}
      <div className="grid gap-3 md:grid-cols-3">{Object.entries(aiCreditPacks).map(([key, pack]) => <div key={key} className="grid gap-3 rounded-lg border p-4"><div><p className="font-medium">{pack.credits.toLocaleString()} credits</p><p className="text-sm text-muted-foreground">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(pack.priceCents / 100)} one time</p></div><Button variant="outline" disabled={!admin || !data?.eligible || busy} onClick={() => void buy(key as PackKey)}>{busy ? "Please wait…" : "Continue to secure Checkout"}</Button></div>)}</div>
      {admin ? <Button variant="ghost" disabled={busy} onClick={() => { setError(""); setRefresh(value => value + 1) }}>Refresh credit status</Button> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </CardContent>
  </Card>
}
