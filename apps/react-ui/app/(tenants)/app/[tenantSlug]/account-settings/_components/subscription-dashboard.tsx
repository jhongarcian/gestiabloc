"use client"

import Link from "next/link"
import { ArrowUpRight, HardDrive, Users } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { AiCreditUsageCard } from "@/components/ai-credit-usage"
import type { SubscriptionResponse } from "@/lib/api"
import { formatStorageSize } from "@/lib/subscription-display"
import { useAiCreditOverview, type AiCreditOverviewController } from "@/lib/use-ai-credit-overview"
import { CreditPurchaseControls } from "./credit-purchase-controls"
import { SubscriptionBillingControls } from "./subscription-billing-controls"

type SubscriptionDashboardProps = {
  tenantId: string
  tenantSlug: string
  subscription: SubscriptionResponse["subscription"] | null
  userRole: string
  timeZone?: string | null
}

export function SubscriptionDashboard(props: SubscriptionDashboardProps) {
  const credits = useAiCreditOverview(props.tenantId, Boolean(props.subscription) && props.userRole === "TENANT_ADMIN")
  return <SubscriptionDashboardContent {...props} credits={credits} />
}

export function SubscriptionDashboardContent({ tenantId, tenantSlug, subscription, userRole, timeZone, credits }: SubscriptionDashboardProps & { credits: AiCreditOverviewController }) {
  const percent = (used: number, limit: number) => limit > 0 ? Math.min(100, Math.max(0, used / limit * 100)) : 0
  return (
    <div className="flex w-full flex-col gap-7 pb-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Subscription & billing</h1>
        <p className="text-sm text-muted-foreground">Your plan, usage, and billing details in one place.</p>
      </header>

      {!subscription ? (
        <Alert>
          <AlertTitle>Subscription details are unavailable</AlertTitle>
          <AlertDescription>
            <p>{userRole === "TENANT_ADMIN" ? "Refresh this page to check your latest plan and payment status." : "Your account administrator can view subscription details and manage billing."}</p>
            <Button asChild variant="outline" size="sm"><Link href={`/app/${tenantSlug}/account-settings/subscription`}>Reload subscription</Link></Button>
          </AlertDescription>
        </Alert>
      ) : (
        <SubscriptionBillingControls key={tenantId} tenantId={tenantId} subscription={subscription} userRole={userRole} timeZone={timeZone}>
          <section aria-labelledby="subscription-usage-title" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 id="subscription-usage-title" className="text-base font-semibold text-foreground">Usage & limits</h2>
              <p className="text-sm text-muted-foreground">A clear view of your team’s available capacity.</p>
            </div>
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <AiCreditUsageCard controller={credits} userRole={userRole} manageHref="#ai-credit-purchases" footer={null} />
              <Card>
                <CardHeader>
                  <CardTitle><h3>Team & storage</h3></CardTitle>
                  <CardDescription>Capacity included with your current plan.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-5">
                  <div className="grid gap-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <p className="flex items-center gap-2 text-muted-foreground"><Users aria-hidden="true" className="size-4" />Team members</p>
                      <p className="font-medium tabular-nums">{subscription.seatUsage.used} <span className="font-normal text-muted-foreground">of {subscription.seatUsage.limit}</span></p>
                    </div>
                    <Progress value={percent(subscription.seatUsage.used, subscription.seatUsage.limit)} aria-label="Team seats used" aria-valuetext={`${subscription.seatUsage.used} of ${subscription.seatUsage.limit} seats used`} />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <p>{subscription.seatUsage.available} {subscription.seatUsage.available === 1 ? "seat" : "seats"} available</p>
                      <Link href={`/app/${tenantSlug}/account-settings/users`} className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline">Manage team<ArrowUpRight className="size-3" aria-hidden="true" /></Link>
                    </div>
                  </div>
                  <Separator />
                  <div className="grid gap-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <p className="flex items-center gap-2 text-muted-foreground"><HardDrive aria-hidden="true" className="size-4" />File storage</p>
                      <p className="font-medium tabular-nums">{formatStorageSize(subscription.storageUsedBytes)} <span className="font-normal text-muted-foreground">of {formatStorageSize(subscription.storageLimitBytes)}</span></p>
                    </div>
                    <Progress value={percent(subscription.storageUsedBytes, subscription.storageLimitBytes)} aria-label="File storage used" aria-valuetext={`${formatStorageSize(subscription.storageUsedBytes)} of ${formatStorageSize(subscription.storageLimitBytes)} used`} />
                    <p className="text-xs text-muted-foreground">{formatStorageSize(Math.max(0, subscription.storageLimitBytes - subscription.storageUsedBytes))} remaining</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
          <CreditPurchaseControls tenantId={tenantId} userRole={userRole} overview={credits} />
        </SubscriptionBillingControls>
      )}
    </div>
  )
}
