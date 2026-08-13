"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Check, ChevronRight, Loader2, PanelsTopLeft, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ONBOARDING_STEPS } from "@/lib/onboarding"

import { useOnboarding } from "./onboarding-provider"

export function OnboardingShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? ""
  const router = useRouter()
  const { data, tenantSlug, isMutating, changeState } = useOnboarding()
  const activeStepIndex = Math.max(
    0,
    ONBOARDING_STEPS.findIndex((step) => pathname.endsWith(`/${step.key}`)),
  )
  const isComplete = data.onboarding.status === "COMPLETED"

  const finishLater = async () => {
    if (isComplete) {
      router.push(`/app/${tenantSlug}`)
      return
    }

    try {
      await changeState({ action: "skip" })
      router.push(`/app/${tenantSlug}`)
      router.refresh()
    } catch {
      toast.error("We could not save your setup progress.")
    }
  }

  return (
    <main className="min-h-screen bg-[#f3f1ea] text-slate-950">
      <div className="min-h-screen lg:grid lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="relative overflow-hidden bg-[#0b1730] px-6 py-6 text-white lg:flex lg:min-h-screen lg:flex-col lg:px-8 lg:py-8">
          <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:42px_42px]" />
          <div className="absolute -right-24 bottom-10 h-64 w-64 rounded-full bg-[#2f68ff]/25 blur-3xl" />

          <div className="relative flex items-center justify-between lg:block">
            <Link
              href={`/app/${tenantSlug}`}
              className="inline-flex items-center gap-3 font-semibold tracking-tight"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/10">
                <PanelsTopLeft className="h-5 w-5" />
              </span>
              <span>Gestiabloc</span>
            </Link>

            <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-100 lg:mt-8 lg:inline-flex">
              Workspace launch
            </span>
          </div>

          <div className="relative mt-6 hidden lg:block">
            <p className="max-w-xs text-sm leading-6 text-slate-300">
              A short setup pass to make the everyday work feel familiar from
              the first contact onward.
            </p>
          </div>

          <ol className="relative mt-8 grid grid-cols-4 gap-2 lg:mt-12 lg:grid-cols-1 lg:gap-1">
            {ONBOARDING_STEPS.map((step, index) => {
              const isActive = index === activeStepIndex
              const isPast = index < activeStepIndex || isComplete

              return (
                <li key={step.key}>
                  <div
                    className={cn(
                      "group flex min-w-0 items-center gap-3 rounded-xl px-2 py-2.5 transition lg:px-3",
                      isActive && "bg-white/10",
                    )}
                    aria-current={isActive ? "step" : undefined}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
                        isPast
                          ? "border-emerald-300 bg-emerald-300 text-slate-950"
                          : isActive
                            ? "border-white bg-white text-slate-950"
                            : "border-white/20 text-slate-400",
                      )}
                    >
                      {isPast ? <Check className="h-3.5 w-3.5" /> : step.eyebrow}
                    </span>
                    <span
                      className={cn(
                        "hidden truncate text-sm lg:block",
                        isActive ? "font-semibold text-white" : "text-slate-400",
                      )}
                    >
                      {step.label}
                    </span>
                    {isActive ? (
                      <ChevronRight className="ml-auto hidden h-4 w-4 text-blue-200 lg:block" />
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ol>

          <div className="relative mt-auto hidden border-t border-white/10 pt-6 lg:block">
            <p className="text-xs leading-5 text-slate-400">
              Your account is already usable. Everything here can be changed
              again from Account Settings.
            </p>
          </div>
        </aside>

        <section className="flex min-h-[calc(100vh-152px)] flex-col lg:min-h-screen">
          <header className="flex items-center justify-between border-b border-slate-900/10 px-5 py-4 sm:px-8 lg:px-12">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                {data.profile.name}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Step {activeStepIndex + 1} of {ONBOARDING_STEPS.length}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="gap-2 text-slate-600 hover:bg-white/70 hover:text-slate-950"
              onClick={finishLater}
              disabled={isMutating}
            >
              {isMutating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <X className="h-4 w-4" />
              )}
              {isComplete ? "Back to dashboard" : "Finish later"}
            </Button>
          </header>

          <div className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
            <div className="w-full max-w-5xl animate-in fade-in slide-in-from-bottom-2 duration-500">
              {children}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
