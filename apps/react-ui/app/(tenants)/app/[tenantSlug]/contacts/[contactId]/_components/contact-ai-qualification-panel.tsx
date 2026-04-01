"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { Sparkles, ArrowRight, Bot, BrainCircuit, Loader2, RefreshCcw, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  buildQualificationNextSteps,
  buildReviewedFacts,
  FIT_STATUS_STYLES,
  getEnrollmentSummary,
  groupServiceFitResults,
  type ServiceFitScanItem,
  type ServiceFitScanResponse,
  toSentence,
} from "../_lib/service-fit"

type ContactAiQualificationPanelProps = {
  tenantId: string
  tenantSlug: string
  contactId: string
  contactName: string
}

type ResultFilter = "all" | "eligible" | "needs_info"

function formatRunTimestamp(value: Date | null) {
  if (!value) return "Not run yet"

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value)
}

function getVisibleItems(items: ServiceFitScanItem[], filter: ResultFilter) {
  if (filter === "eligible") {
    return items.filter((item) => item.eligibilityStatus === "ELIGIBLE")
  }
  if (filter === "needs_info") {
    return items.filter((item) => item.eligibilityStatus === "NEEDS_INFO")
  }
  return items
}

export function ContactAiQualificationPanel({
  tenantId,
  tenantSlug,
  contactId,
  contactName,
}: ContactAiQualificationPanelProps) {
  const [items, setItems] = useState<ServiceFitScanItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  const [ranAt, setRanAt] = useState<Date | null>(null)
  const [filter, setFilter] = useState<ResultFilter>("all")

  const visibleItems = useMemo(() => getVisibleItems(items, filter), [filter, items])
  const groupedVisibleItems = useMemo(() => groupServiceFitResults(visibleItems), [visibleItems])
  const groupedAllItems = useMemo(() => groupServiceFitResults(items), [items])
  const reviewedFacts = useMemo(() => buildReviewedFacts(items), [items])
  const nextSteps = useMemo(() => buildQualificationNextSteps(items), [items])

  const analysisMeta = useMemo(
    () => ({
      serviceCount: items.length,
      eligibleCount: groupedAllItems.eligible.length,
      needsInfoCount: groupedAllItems.needsInfo.length,
      notEligibleCount: groupedAllItems.notEligible.length,
    }),
    [groupedAllItems, items.length],
  )

  const runQualificationAnalysis = async () => {
    setIsLoading(true)
    try {
      const { data } = await api.get<ServiceFitScanResponse>(
        `/api/services/${encodeURIComponent(tenantId)}/fit-scan`,
        {
          params: {
            contactId,
          },
        },
      )
      setItems(data.items ?? [])
      setHasRun(true)
      setRanAt(new Date())
      setFilter("all")
    } catch {
      toast.error("Could not run qualification analysis.")
    } finally {
      setIsLoading(false)
    }
  }

  const resultSections = [
    {
      key: "eligible",
      title: "Eligible now",
      description: "These services can move forward under the current configured rules.",
      items: groupedVisibleItems.eligible,
    },
    {
      key: "needs-info",
      title: "Need more information",
      description: "These services may qualify, but the contact record is missing information.",
      items: groupedVisibleItems.needsInfo,
    },
    {
      key: "not-eligible",
      title: "Not eligible",
      description: "These services are blocked by the current rule results.",
      items: groupedVisibleItems.notEligible,
    },
  ] as const

  return (
    <section className="flex flex-col gap-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,#fff6db_0%,#f8fafc_46%,#eef2ff_100%)]">
        <div className="flex flex-col gap-6 p-6 md:flex-row md:items-end md:justify-between md:p-7">
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
              <Sparkles className="h-3.5 w-3.5" />
              AI Qualification
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
                Assistant qualification report for {contactName}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                I review the configured service-fit rules for this contact, explain why services do
                or do not qualify, and call out what information is missing before you move forward.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Last run
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">{formatRunTimestamp(ranAt)}</p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Analysis mode
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">Deterministic rules + AI explanation</p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Safety
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  Eligibility rules do not change here.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 md:min-w-[250px] md:items-end">
            <Button
              type="button"
              className="cursor-pointer bg-slate-950 text-white hover:bg-slate-900"
              onClick={() => {
                void runQualificationAnalysis()
              }}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running analysis
                </>
              ) : hasRun ? (
                <>
                  <RefreshCcw className="h-4 w-4" />
                  Run again
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Run qualification analysis
                </>
              )}
            </Button>
            <p className="max-w-[250px] text-right text-xs leading-5 text-slate-500">
              This workspace explains the configured rules in plain language. It never changes the
              saved qualification logic.
            </p>
          </div>
        </div>
      </section>

      {!hasRun ? (
        <section className="grid gap-4 lg:grid-cols-[1.25fr_0.95fr]">
          <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
                <Bot className="h-5 w-5" />
              </div>
              <div className="space-y-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Ready to review this contact</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    I will scan every active service with fit rules, group the results by
                    qualification status, and highlight what is blocking or missing.
                  </p>
                </div>
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  The first run opens an assistant-style report with: what I reviewed, best matches,
                  and recommended next actions.
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              What you will get
            </p>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="flex gap-3">
                <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <p>Clear assistant-style qualification explanations for each service.</p>
              </div>
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <p>Rule-based outcomes that stay consistent with the configured service rules.</p>
              </div>
              <div className="flex gap-3">
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                <p>Direct next steps to enroll qualified services or collect missing details.</p>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Analysis summary
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={FIT_STATUS_STYLES.ELIGIBLE}>
                    {analysisMeta.eligibleCount} eligible
                  </Badge>
                  <Badge className={FIT_STATUS_STYLES.NEEDS_INFO}>
                    {analysisMeta.needsInfoCount} need info
                  </Badge>
                  <Badge className={FIT_STATUS_STYLES.NOT_ELIGIBLE}>
                    {analysisMeta.notEligibleCount} not eligible
                  </Badge>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                    {analysisMeta.serviceCount} services reviewed
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant={filter === "all" ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer",
                    filter === "all"
                      ? "bg-slate-950 text-white hover:bg-slate-900"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50",
                  )}
                  onClick={() => setFilter("all")}
                >
                  Show all
                </Button>
                <Button
                  type="button"
                  variant={filter === "eligible" ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer",
                    filter === "eligible"
                      ? "bg-slate-950 text-white hover:bg-slate-900"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50",
                  )}
                  onClick={() => setFilter("eligible")}
                >
                  Show only eligible
                </Button>
                <Button
                  type="button"
                  variant={filter === "needs_info" ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer",
                    filter === "needs_info"
                      ? "bg-slate-950 text-white hover:bg-slate-900"
                      : "border-slate-200 text-slate-700 hover:bg-slate-50",
                  )}
                  onClick={() => setFilter("needs_info")}
                >
                  Show missing info
                </Button>
              </div>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                What I reviewed
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">Relevant qualification signals</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                I checked the configured service-fit rules for this contact, including{" "}
                {reviewedFacts.length > 0
                  ? reviewedFacts.slice(0, 4).join(", ").toLowerCase()
                  : "the available qualification signals"}{" "}
                and any missing information that could block a decision.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {reviewedFacts.length ? (
                  reviewedFacts.map((fact) => (
                    <span
                      key={fact}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                    >
                      {fact}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-500">
                    No configured rule signals were available to summarize.
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                What to do next
              </p>
              <div className="mt-4 space-y-3">
                {nextSteps.map((step) => (
                  <div
                    key={step}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700"
                  >
                    {step}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-5">
            {resultSections.map((section) => (
              <div key={section.key} className="space-y-3">
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold text-slate-950">{section.title}</h2>
                  <p className="text-sm text-slate-500">{section.description}</p>
                </div>

                {section.items.length ? (
                  <div className="grid gap-4 xl:grid-cols-2">
                    {section.items.map((item) => (
                      (() => {
                        const enrollmentSummary = getEnrollmentSummary(item)
                        return (
                      <article
                        key={item.serviceId}
                        className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm"
                      >
                        <div className="flex flex-col gap-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge className={FIT_STATUS_STYLES[item.eligibilityStatus]}>
                                  {toSentence(item.eligibilityStatus)}
                                </Badge>
                                {enrollmentSummary ? (
                                  <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                    {enrollmentSummary.label}
                                  </span>
                                ) : null}
                                <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-semibold text-white">
                                  Score {item.fitScore}
                                </span>
                              </div>
                              <div>
                                <h3 className="text-lg font-semibold text-slate-900">
                                  {item.serviceName}
                                </h3>
                                <p className="mt-1 text-sm text-slate-500">
                                  {item.description || "No service description added yet."}
                                </p>
                              </div>
                            </div>

                            {item.hasActiveEnrollment && item.currentContactServiceId ? (
                              <Button asChild className="cursor-pointer bg-slate-950 text-white hover:bg-slate-900">
                                <Link
                                  href={`/app/${tenantSlug}/contacts/${contactId}/services/${encodeURIComponent(item.currentContactServiceId)}`}
                                >
                                  Open service
                                </Link>
                              </Button>
                            ) : item.hasPurchased && item.currentContactServiceId ? (
                              <Button asChild variant="outline" className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50">
                                <Link
                                  href={`/app/${tenantSlug}/contacts/${contactId}/services/${encodeURIComponent(item.currentContactServiceId)}`}
                                >
                                  View service
                                </Link>
                              </Button>
                            ) : item.eligibilityStatus === "ELIGIBLE" ? (
                              <Button asChild className="cursor-pointer bg-slate-950 text-white hover:bg-slate-900">
                                <Link
                                  href={`/app/${tenantSlug}/contacts/${contactId}/services?create=1&serviceId=${encodeURIComponent(item.serviceId)}`}
                                >
                                  Start service
                                </Link>
                              </Button>
                            ) : null}
                          </div>

                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                              Assistant conclusion
                            </p>
                            <p className="mt-2 text-sm leading-6 text-slate-700">
                              {item.explanation ||
                                item.summary ||
                                item.fitProfile.summary ||
                                "No explanation is available for this service yet."}
                            </p>
                            {enrollmentSummary ? (
                              <p className="mt-2 text-sm text-slate-600">{enrollmentSummary.detail}</p>
                            ) : null}
                            <p className="mt-2 text-xs text-slate-400">
                              {item.explanationSource === "ai"
                                ? "AI explanation from configured rules"
                                : "Rule-based explanation"}
                            </p>
                          </div>

                          {item.configurationGapNotes.length ? (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                              <p className="text-sm font-semibold text-amber-800">Configuration note</p>
                              <div className="mt-2 space-y-2">
                                {item.configurationGapNotes.map((note, index) => (
                                  <p key={`${item.serviceId}-note-${index}`} className="text-sm text-amber-900">
                                    {note}
                                  </p>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {item.recommendedUpdates.length ? (
                            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-4">
                              <p className="text-sm font-semibold text-sky-800">Suggested record updates</p>
                              <div className="mt-2 space-y-2">
                                {item.recommendedUpdates.map((update, index) => (
                                  <p key={`${item.serviceId}-update-${index}`} className="text-sm text-sky-900">
                                    {update}
                                  </p>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          <div className="grid gap-4 lg:grid-cols-3">
                            <div className="rounded-2xl border border-emerald-200 bg-white p-4">
                              <p className="text-sm font-semibold text-emerald-700">Matched</p>
                              <div className="mt-2 space-y-2">
                                {item.matchedRules.length ? (
                                  item.matchedRules.slice(0, 3).map((rule) => (
                                    <p key={rule.ruleId} className="text-sm text-slate-700">
                                      {rule.reason}
                                    </p>
                                  ))
                                ) : (
                                  <p className="text-sm text-slate-500">No matched rules were triggered.</p>
                                )}
                              </div>
                            </div>

                            <div className="rounded-2xl border border-amber-200 bg-white p-4">
                              <p className="text-sm font-semibold text-amber-700">Missing info</p>
                              <div className="mt-2 space-y-2">
                                {item.missingRules.length ? (
                                  item.missingRules.slice(0, 3).map((rule) => (
                                    <p key={rule.ruleId} className="text-sm text-slate-700">
                                      {rule.reason}
                                    </p>
                                  ))
                                ) : (
                                  <p className="text-sm text-slate-500">No missing information is blocking this service.</p>
                                )}
                              </div>
                            </div>

                            <div className="rounded-2xl border border-rose-200 bg-white p-4">
                              <p className="text-sm font-semibold text-rose-700">Blocking</p>
                              <div className="mt-2 space-y-2">
                                {item.blockingRules.length ? (
                                  item.blockingRules.slice(0, 3).map((rule) => (
                                    <p key={rule.ruleId} className="text-sm text-slate-700">
                                      {rule.reason}
                                    </p>
                                  ))
                                ) : (
                                  <p className="text-sm text-slate-500">No blocking rules are active for this service.</p>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </article>
                        )
                      })()
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                    {filter === "all"
                      ? `No services are in the "${section.title}" group for this contact right now.`
                      : "No services match the current filter in this group."}
                  </div>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </section>
  )
}
