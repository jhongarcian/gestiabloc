"use client"

import { useMemo } from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  ArrowUpCircle,
  Check,
  CreditCard,
  HardDrive,
  Sparkles,
  Users,
} from "lucide-react"
import { subscriptionPlans, type PlanKey } from "@/lib/subscription-plans"

type SubscriptionData = {
  planKey: PlanKey
  seatLimit: number
  status: string
  currentPeriodEnd: string | null
  seatUsage: { used: number; limit: number; available: number }
  storageUsedBytes: number
  storageLimitBytes: number
  aiActionsPerMonth: number
  memberCount: number
  activeMemberCount: number
}

type SubscriptionDashboardProps = {
  tenantId: string
  tenantSlug: string
  subscription: SubscriptionData | null
  userRole: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr))
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { label: string; className: string }> = {
    ACTIVE: { label: "Active", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    TRIALING: { label: "Trial", className: "bg-amber-100 text-amber-700 border-amber-200" },
    PAST_DUE: { label: "Past Due", className: "bg-red-100 text-red-700 border-red-200" },
    CANCELED: { label: "Canceled", className: "bg-slate-100 text-slate-600 border-slate-200" },
    NONE: { label: "No Plan", className: "bg-slate-100 text-slate-600 border-slate-200" },
  }
  const variant = variants[status] ?? variants.NONE
  return (
    <Badge variant="outline" className={variant.className}>
      {variant.label}
    </Badge>
  )
}

export function SubscriptionDashboard({
  tenantId: _tenantId,
  tenantSlug,
  subscription,
  userRole: _userRole,
}: SubscriptionDashboardProps) {
  const currentPlan = useMemo(() => {
    if (!subscription) return null
    return subscriptionPlans.find((p) => p.key === subscription.planKey)
  }, [subscription])

  const nextPlan = useMemo(() => {
    if (!subscription) return null
    if (subscription.planKey === "STARTER") return subscriptionPlans.find((p) => p.key === "PRO")
    if (subscription.planKey === "PRO") return subscriptionPlans.find((p) => p.key === "BUSINESS")
    return null
  }, [subscription])

  const seatPercentage = subscription
    ? Math.round((subscription.seatUsage.used / subscription.seatUsage.limit) * 100)
    : 0

  const storagePercentage = subscription
    ? Math.round((subscription.storageUsedBytes / subscription.storageLimitBytes) * 100)
    : 0

  if (!subscription) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 md:p-6">
        <h2 className="text-lg font-semibold text-slate-900 md:text-xl">Subscription</h2>
        <p className="mt-2 text-sm text-slate-600">
          Unable to load subscription data. Please try again later.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 md:text-xl">Subscription</h2>
        <p className="mt-1 text-sm text-slate-500">
          Review and manage your subscription plan and usage.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardDescription>Current Plan</CardDescription>
              <StatusBadge status={subscription.status} />
            </div>
            <CardTitle className="text-2xl">
              {currentPlan?.name ?? subscription.planKey}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <CreditCard className="h-4 w-4" />
              <span>{currentPlan?.monthlyPrice ?? "—"}/month</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Users className="h-4 w-4" />
              <span>Up to {subscription.seatLimit} team members</span>
            </div>
            {subscription.currentPeriodEnd && (
              <div className="text-xs text-slate-500">
                {subscription.status === "TRIALING"
                  ? `Trial ends ${formatDate(subscription.currentPeriodEnd)}`
                  : `Renews ${formatDate(subscription.currentPeriodEnd)}`}
              </div>
            )}
          </CardContent>
        </Card>

        {nextPlan && (
          <Card className="border-indigo-200 bg-indigo-50/50">
            <CardHeader className="pb-3">
              <CardDescription>Upgrade Available</CardDescription>
              <CardTitle className="text-2xl text-indigo-900">
                {nextPlan.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-indigo-700">
                {nextPlan.monthlyPrice}/month &middot; Up to {nextPlan.seatLimit} seats
              </div>
              <ul className="space-y-1.5 text-xs text-indigo-600">
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  {nextPlan.aiUsage}
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  {nextPlan.storage}
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  {nextPlan.support}
                </li>
              </ul>
              <Button
                size="sm"
                className="w-full bg-indigo-600 hover:bg-indigo-700"
                asChild
              >
                <Link href={`/app/${tenantSlug}/account-settings/subscription`}>
                  <ArrowUpCircle className="mr-1.5 h-4 w-4" />
                  Upgrade to {nextPlan.name}
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-500" />
              <CardDescription>Team Seats</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold">
                {subscription.seatUsage.used}
              </span>
              <span className="text-sm text-slate-500">
                of {subscription.seatUsage.limit}
              </span>
            </div>
            <Progress value={seatPercentage} className="mt-2 h-2" />
            <p className="mt-1.5 text-xs text-slate-500">
              {subscription.seatUsage.available} seat{subscription.seatUsage.available !== 1 ? "s" : ""} available
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-slate-500" />
              <CardDescription>Storage</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold">
                {formatBytes(subscription.storageUsedBytes)}
              </span>
              <span className="text-sm text-slate-500">
                of {formatBytes(subscription.storageLimitBytes)}
              </span>
            </div>
            <Progress value={storagePercentage} className="mt-2 h-2" />
            <p className="mt-1.5 text-xs text-slate-500">
              {formatBytes(subscription.storageLimitBytes - subscription.storageUsedBytes)} remaining
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-slate-500" />
              <CardDescription>AI Actions</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold">
                {subscription.aiActionsPerMonth.toLocaleString()}
              </span>
              <span className="text-sm text-slate-500">/month</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Included in your {currentPlan?.name ?? subscription.planKey} plan
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan Comparison</CardTitle>
          <CardDescription>
            Compare features across all available plans.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {subscriptionPlans.map((plan) => {
              const isCurrent = plan.key === subscription.planKey
              return (
                <div
                  key={plan.key}
                  className={`rounded-lg border p-4 ${
                    isCurrent
                      ? "border-indigo-300 bg-indigo-50/50 ring-1 ring-indigo-200"
                      : "border-slate-200"
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900">{plan.name}</h3>
                    {isCurrent && (
                      <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 text-xs">
                        Current
                      </Badge>
                    )}
                  </div>
                  <p className="mb-3 text-xl font-bold text-slate-900">
                    {plan.monthlyPrice}
                    <span className="text-sm font-normal text-slate-500">/month</span>
                  </p>
                  <ul className="space-y-2">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
