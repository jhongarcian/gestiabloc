"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import {
  ArrowRight,
  Check,
  Circle,
  Loader2,
  Rocket,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  type OnboardingResponse,
  updateOnboardingState,
} from "@/lib/api"
import { getOnboardingPath } from "@/lib/onboarding"

export function DashboardOnboardingChecklist({
  initialData,
  tenantSlug,
}: {
  initialData: OnboardingResponse
  tenantSlug: string
}) {
  const router = useRouter()
  const [isHidden, setIsHidden] = useState(false)
  const [pendingAction, setPendingAction] = useState<"resume" | "dismiss" | null>(
    null,
  )
  const { onboarding, profile, defaults, readiness } = initialData

  if (
    isHidden ||
    onboarding.status !== "SKIPPED" ||
    onboarding.checklistDismissedAt
  ) {
    return null
  }

  const resume = async () => {
    setPendingAction("resume")
    try {
      await updateOnboardingState(profile.id, { action: "resume" })
      router.push(getOnboardingPath(tenantSlug, onboarding.currentStep))
    } catch {
      toast.error("Could not resume workspace setup.")
      setPendingAction(null)
    }
  }

  const dismiss = async () => {
    setPendingAction("dismiss")
    try {
      await updateOnboardingState(profile.id, { action: "dismissChecklist" })
      setIsHidden(true)
    } catch {
      toast.error("Could not dismiss the setup checklist.")
    } finally {
      setPendingAction(null)
    }
  }

  const items = [
    {
      label: "Complete business profile",
      detail: profile.timezone ? "Business timezone saved" : "Add your timezone",
      done: Boolean(profile.name && profile.timezone),
      href: getOnboardingPath(tenantSlug, "business-profile"),
    },
    {
      label: "Review workflow defaults",
      detail: `${defaults.contactStatuses.length + defaults.taskStatuses.length} statuses and ${defaults.pipeline.stages.length} stages ready`,
      done: true,
      href: getOnboardingPath(tenantSlug, "workflow"),
    },
    {
      label: "Add your first service",
      detail: readiness.serviceCount
        ? `${readiness.serviceCount} service${readiness.serviceCount === 1 ? "" : "s"} configured`
        : "Define the work your team delivers",
      done: readiness.serviceCount > 0,
      href: `/app/${tenantSlug}/account-settings/services`,
    },
    {
      label: "Invite a teammate",
      detail: readiness.memberCount > 1 ? `${readiness.memberCount} active members` : "Build your workspace team",
      done: readiness.memberCount > 1,
      href: `/app/${tenantSlug}/account-settings/users`,
    },
  ]
  const completedCount = items.filter((item) => item.done).length

  return (
    <section className="relative overflow-hidden rounded-2xl border border-blue-200 bg-[#0b1730] p-5 text-white shadow-lg shadow-slate-900/10 sm:p-7">
      <div className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-blue-500/25 blur-3xl" />
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-400 text-slate-950">
            <Rocket className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-200">
              Workspace setup
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">
              Pick up where you left off
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
              {completedCount} of {items.length} foundations are ready. None of
              these prevent you from using the workspace.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-slate-300 hover:bg-white/10 hover:text-white"
          onClick={dismiss}
          disabled={pendingAction !== null}
          aria-label="Dismiss setup checklist"
        >
          {pendingAction === "dismiss" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <X className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="relative mt-6 grid gap-2 md:grid-cols-2">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-white/20 hover:bg-white/10"
          >
            <span className={item.done ? "text-emerald-300" : "text-slate-500"}>
              {item.done ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="mt-0.5 block truncate text-xs text-slate-400">
                {item.detail}
              </span>
            </span>
            <ArrowRight className="h-4 w-4 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-white" />
          </Link>
        ))}
      </div>

      <div className="relative mt-5 flex justify-end">
        <Button
          type="button"
          className="gap-2 bg-white text-slate-950 hover:bg-blue-50"
          onClick={resume}
          disabled={pendingAction !== null}
        >
          {pendingAction === "resume" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Resume setup
          {pendingAction !== "resume" ? <ArrowRight className="h-4 w-4" /> : null}
        </Button>
      </div>
    </section>
  )
}
