"use client"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { formatCreditDate } from "@/lib/ai-credit-usage"
export function BillingAccessNotice({ subscription, tenantSlug, administrator, timeZone }: { tenantSlug: string; administrator: boolean; timeZone?: string | null; subscription?: { billingEnabled?: boolean; access?: { state: string; graceEndsAt: string | null }; } | null }) {
  const router = useRouter()
  if (!subscription?.billingEnabled || !subscription.access || subscription.access.state === "PAID") return null
  const grace = subscription.access.state === "GRACE"
  return <Alert variant={grace ? "default" : "destructive"}>
    <AlertTitle>{grace ? "Payment needs attention · AI is paused" : "Payment required to resume CRM access"}</AlertTitle>
    <AlertDescription>
      <p>{grace ? `CRM access remains available until ${formatCreditDate(subscription.access.graceEndsAt, timeZone) ?? "the payment recovery period ends"}. Update your payment method to resume AI.` : "Your account data is retained. Complete payment to resume access; billing and account recovery remain available."}</p>
      <div className="flex flex-wrap gap-2">{administrator ? <Button asChild variant="outline" size="sm"><Link href={`/app/${tenantSlug}/account-settings/subscription`}>Manage billing</Link></Button> : <p>Contact your account administrator to restore access.</p>}<Button variant="ghost" size="sm" onClick={() => router.refresh()}>Refresh payment status</Button></div>
    </AlertDescription>
  </Alert>
}
