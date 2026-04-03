"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Loader2,
  MessageSquare,
  PanelLeftOpen,
  RefreshCcw,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
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

type AssistantScopeMode = "idle" | "all" | "service"

type AssistantMessage = {
  id: string
  role: "assistant" | "user"
  title?: string
  body: string
  bullets?: string[]
  suggestedQuestions?: string[]
  showServiceChoices?: boolean
  citations?: Array<{
    url: string
    title: string
  }>
}

type ServiceFitAssistantResponse = {
  ok: boolean
  scope: {
    mode: "all" | "service"
    serviceId: string | null
    serviceName: string | null
  }
  answer: {
    title: string
    summary: string
    bullets: string[]
    suggestedQuestions: string[]
    citations?: Array<{
      url: string
      title: string
    }>
  }
}

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

function createMessage(
  message: Omit<AssistantMessage, "id">,
): AssistantMessage {
  return {
    id: crypto.randomUUID(),
    ...message,
  }
}

function buildInitialAssistantMessage(items: ServiceFitScanItem[]) {
  const grouped = groupServiceFitResults(items)

  if (items.length === 0) {
    return createMessage({
      role: "assistant",
      title: "No active service rules found",
      body:
        "There are no active services with qualification rules available for this contact yet. Add or enable fit rules first, then rerun the analysis.",
      bullets: [
        "No service options are available to analyze in this workspace.",
      ],
    })
  }

  return createMessage({
    role: "assistant",
    title: "Choose a qualification scope",
    body: `${items.length} active services were reviewed. ${grouped.eligible.length} are eligible now, ${grouped.needsInfo.length} need more information, and ${grouped.notEligible.length} are not eligible. Which active service would you like to analyze?`,
    bullets: items.slice(0, 4).map((item) => `${item.serviceName}: ${toSentence(item.eligibilityStatus)}.`),
    showServiceChoices: true,
  })
}

function buildAssistantReplyMessage(response: ServiceFitAssistantResponse) {
  return createMessage({
    role: "assistant",
    title: response.answer.title,
    body: response.answer.summary,
    bullets: response.answer.bullets,
    suggestedQuestions: response.answer.suggestedQuestions,
    citations: response.answer.citations,
  })
}

function getServiceAction(
  item: ServiceFitScanItem,
  tenantSlug: string,
  contactId: string,
) {
  if (item.hasActiveEnrollment && item.currentContactServiceId) {
    return {
      label: "Open service",
      href: `/app/${tenantSlug}/contacts/${contactId}/services/${encodeURIComponent(item.currentContactServiceId)}`,
      variant: "default" as const,
    }
  }

  if (item.hasPurchased && item.currentContactServiceId) {
    return {
      label: "View service",
      href: `/app/${tenantSlug}/contacts/${contactId}/services/${encodeURIComponent(item.currentContactServiceId)}`,
      variant: "outline" as const,
    }
  }

  if (item.eligibilityStatus === "ELIGIBLE") {
    return {
      label: "Start service",
      href: `/app/${tenantSlug}/contacts/${contactId}/services?create=1&serviceId=${encodeURIComponent(item.serviceId)}`,
      variant: "default" as const,
    }
  }

  return null
}

export function ContactAiQualificationPanel({
  tenantId,
  tenantSlug,
  contactId,
  contactName,
}: ContactAiQualificationPanelProps) {
  const [items, setItems] = useState<ServiceFitScanItem[]>([])
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [ranAt, setRanAt] = useState<Date | null>(null)
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [scopeMode, setScopeMode] = useState<AssistantScopeMode>("idle")
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const endRef = useRef<HTMLDivElement | null>(null)

  const hasRun = messages.length > 0
  const groupedItems = useMemo(() => groupServiceFitResults(items), [items])
  const selectedService = useMemo(
    () => items.find((item) => item.serviceId === selectedServiceId) ?? null,
    [items, selectedServiceId],
  )
  const selectedEnrollmentSummary = selectedService ? getEnrollmentSummary(selectedService) : null
  const selectedServiceAction = selectedService
    ? getServiceAction(selectedService, tenantSlug, contactId)
    : null
  const canAskQuestions = scopeMode === "all" || (scopeMode === "service" && Boolean(selectedService))

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, isSending])

  const appendMessage = (message: AssistantMessage) => {
    setMessages((current) => [...current, message])
  }

  const runQualificationAnalysis = async () => {
    setIsLoadingAnalysis(true)
    setScopeMode("idle")
    setSelectedServiceId(null)
    setDraft("")

    try {
      const { data } = await api.get<ServiceFitScanResponse>(
        `/api/services/${encodeURIComponent(tenantId)}/fit-scan`,
        {
          params: {
            contactId,
          },
        },
      )

      const nextItems = data.items ?? []
      setItems(nextItems)
      setRanAt(new Date())
      setMessages([buildInitialAssistantMessage(nextItems)])
    } catch {
      toast.error("Could not run qualification analysis.")
    } finally {
      setIsLoadingAnalysis(false)
    }
  }

  const requestAssistant = async (options: {
    scope: "all" | "service"
    serviceId?: string | null
    question?: string
  }) => {
    const { data } = await api.post<ServiceFitAssistantResponse>(
      `/api/services/${encodeURIComponent(tenantId)}/fit-scan/assistant`,
      {
        contactId,
        scope: options.scope,
        serviceId: options.serviceId ?? undefined,
        question: options.question?.trim() || undefined,
      },
    )

    setScopeMode(data.scope.mode)
    setSelectedServiceId(data.scope.serviceId)
    appendMessage(buildAssistantReplyMessage(data))
  }

  const handleAnalyzeService = async (serviceId: string) => {
    const service = items.find((item) => item.serviceId === serviceId)
    if (!service) return

    appendMessage(
      createMessage({
        role: "user",
        body: `Analyze ${service.serviceName}.`,
      }),
    )

    setIsSending(true)
    try {
      await requestAssistant({
        scope: "service",
        serviceId,
      })
    } catch {
      toast.error("Could not analyze that service.")
    } finally {
      setIsSending(false)
    }
  }

  const handleAnalyzeAll = async () => {
    appendMessage(
      createMessage({
        role: "user",
        body: "Scan all active services.",
      }),
    )

    setIsSending(true)
    try {
      await requestAssistant({
        scope: "all",
      })
    } catch {
      toast.error("Could not summarize all services.")
    } finally {
      setIsSending(false)
    }
  }

  const handleSendQuestion = async (question: string) => {
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion) return

    if (!canAskQuestions) {
      toast.error("Choose a service or scan all services first.")
      return
    }

    appendMessage(
      createMessage({
        role: "user",
        body: trimmedQuestion,
      }),
    )
    setDraft("")
    setIsSending(true)

    try {
      await requestAssistant({
        scope: scopeMode === "all" ? "all" : "service",
        serviceId: scopeMode === "service" ? selectedServiceId : undefined,
        question: trimmedQuestion,
      })
    } catch {
      toast.error("Could not send that question.")
    } finally {
      setIsSending(false)
    }
  }

  const analysisMeta = {
    serviceCount: items.length,
    eligibleCount: groupedItems.eligible.length,
    needsInfoCount: groupedItems.needsInfo.length,
    notEligibleCount: groupedItems.notEligible.length,
  }

  return (
    <section className="overflow-hidden rounded-[32px] border border-slate-200/80 bg-[radial-gradient(circle_at_top,_rgba(255,243,213,0.95),_rgba(240,244,255,0.9)_34%,_rgba(255,255,255,0.92)_70%)] shadow-[0_24px_80px_-48px_rgba(15,23,42,0.55)]">
      <div className="border-b border-white/70 px-5 py-4 backdrop-blur md:px-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600 shadow-sm">
              <Sparkles className="h-3.5 w-3.5 text-amber-600" />
              AI Qualification
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-950 md:text-2xl">
                {contactName}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Qualification assistant chat grounded in the current service-fit rules.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {hasRun ? (
              <>
                <span className="rounded-full border border-white/80 bg-white/75 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                  Last run {formatRunTimestamp(ranAt)}
                </span>
                <span className="rounded-full border border-white/80 bg-white/75 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                  {scopeMode === "service"
                    ? selectedService?.serviceName ?? "Selected service"
                    : scopeMode === "all"
                      ? "All active services"
                      : "Choose a scope"}
                </span>
              </>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="border-white/80 bg-white/75 text-slate-700 shadow-sm hover:bg-white"
              onClick={() => {
                void runQualificationAnalysis()
              }}
              disabled={isLoadingAnalysis || isSending}
            >
              {isLoadingAnalysis ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running
                </>
              ) : hasRun ? (
                <>
                  <RefreshCcw className="h-4 w-4" />
                  Run again
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Start
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid min-h-[760px] grid-rows-[1fr_auto]">
        <ScrollArea className="min-h-0">
          {!hasRun ? (
            <div className="flex min-h-[620px] items-center justify-center px-6 py-10">
              <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
                <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.95),rgba(238,242,255,0.88)_45%,rgba(226,232,240,0.72)_100%)] shadow-[0_24px_70px_-38px_rgba(15,23,42,0.45)]">
                  <div className="absolute inset-2 rounded-full border border-white/70 bg-white/35" />
                  <div className="relative rounded-full bg-slate-950 p-4 text-white shadow-lg">
                    <Sparkles className="h-7 w-7" />
                  </div>
                </div>

                <div className="mt-8 space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-400">
                    Chat Workspace
                  </p>
                  <h2 className="text-3xl font-semibold tracking-tight text-slate-950">
                    Start AI qualification
                  </h2>
                  <p className="mx-auto max-w-xl text-sm leading-7 text-slate-600">
                    Open the qualification conversation, scan active services for this contact, and
                    then drill into one service at a time without loading every result card at once.
                  </p>
                </div>

                <Button
                  type="button"
                  size="lg"
                  className="mt-8 h-12 rounded-full bg-slate-950 px-7 text-white shadow-[0_20px_45px_-22px_rgba(15,23,42,0.65)] hover:bg-slate-900"
                  onClick={() => {
                    void runQualificationAnalysis()
                  }}
                  disabled={isLoadingAnalysis || isSending}
                >
                  {isLoadingAnalysis ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Starting AI qualification
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Start AI qualification
                    </>
                  )}
                </Button>

                <p className="mt-4 text-xs text-slate-500">
                  The first message will ask which active service you want to analyze, or you can
                  scan all active services.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6 px-5 py-6 md:px-7 md:py-7">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="rounded-full border border-white/80 bg-white/75 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                  {analysisMeta.serviceCount} services reviewed
                </span>
                <Badge className={FIT_STATUS_STYLES.ELIGIBLE}>
                  {analysisMeta.eligibleCount} eligible
                </Badge>
                <Badge className={FIT_STATUS_STYLES.NEEDS_INFO}>
                  {analysisMeta.needsInfoCount} need info
                </Badge>
                <Badge className={FIT_STATUS_STYLES.NOT_ELIGIBLE}>
                  {analysisMeta.notEligibleCount} not eligible
                </Badge>
              </div>

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div className={cn("max-w-[92%] md:max-w-[72%]", message.role === "assistant" ? "pr-8 md:pr-20" : "pl-8 md:pl-20")}>
                    <div
                      className={cn(
                        "rounded-[26px] px-5 py-4 shadow-[0_18px_45px_-32px_rgba(15,23,42,0.6)]",
                        message.role === "user"
                          ? "bg-slate-950 text-white"
                          : "border border-white/80 bg-white/88 text-slate-900 backdrop-blur",
                      )}
                    >
                      {message.title ? (
                        <p
                          className={cn(
                            "text-sm font-semibold",
                            message.role === "user" ? "text-white" : "text-slate-900",
                          )}
                        >
                          {message.title}
                        </p>
                      ) : null}
                      <p
                        className={cn(
                          "text-sm leading-6",
                          message.title ? "mt-1.5" : "",
                          message.role === "user" ? "text-slate-100" : "text-slate-700",
                        )}
                      >
                        {message.body}
                      </p>

                      {message.bullets?.length ? (
                        <div className="mt-3 space-y-2">
                          {message.bullets.map((bullet) => (
                            <div
                              key={bullet}
                              className={cn(
                                "rounded-2xl px-3.5 py-2.5 text-sm leading-6",
                                message.role === "user"
                                  ? "bg-white/10 text-slate-100"
                                  : "border border-slate-200/80 bg-slate-50/85 text-slate-700",
                              )}
                            >
                              {bullet}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {message.showServiceChoices && items.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {items.map((item) => (
                            <button
                              key={item.serviceId}
                              type="button"
                              className={cn(
                                "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                                selectedServiceId === item.serviceId
                                  ? "border-slate-950 bg-slate-950 text-white"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100",
                              )}
                              onClick={() => {
                                void handleAnalyzeService(item.serviceId)
                              }}
                              disabled={isSending}
                            >
                              {item.serviceName}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                            onClick={() => {
                              void handleAnalyzeAll()
                            }}
                            disabled={isSending}
                          >
                            Scan all
                          </button>
                        </div>
                      ) : null}

                      {message.suggestedQuestions?.length && message.role === "assistant" ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {message.suggestedQuestions.map((question) => (
                            <button
                              key={question}
                              type="button"
                              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                              onClick={() => {
                                void handleSendQuestion(question)
                              }}
                              disabled={isSending || !canAskQuestions}
                            >
                              {question}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {message.citations?.length && message.role === "assistant" ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {message.citations.map((citation) => (
                            <Link
                              key={citation.url}
                              href={citation.url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                            >
                              Source: {citation.title}
                            </Link>
                          ))}
                        </div>
                      ) : null}

                      {message.role === "assistant" && selectedService && message.id === messages[messages.length - 1]?.id ? (
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                            onClick={() => {
                              void handleAnalyzeAll()
                            }}
                            disabled={isSending}
                          >
                            <PanelLeftOpen className="h-3.5 w-3.5" />
                            Scan all services
                          </button>
                          {selectedServiceAction ? (
                            <Button
                              asChild
                              size="sm"
                              variant={selectedServiceAction.variant}
                              className={cn(
                                selectedServiceAction.variant === "default"
                                  ? "rounded-full bg-slate-950 text-white hover:bg-slate-900"
                                  : "rounded-full border-slate-200 text-slate-700 hover:bg-slate-50",
                              )}
                            >
                              <Link href={selectedServiceAction.href}>{selectedServiceAction.label}</Link>
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {message.role === "assistant" && selectedService && message.id === messages[messages.length - 1]?.id ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
                        <Badge className={FIT_STATUS_STYLES[selectedService.eligibilityStatus]}>
                          {toSentence(selectedService.eligibilityStatus)}
                        </Badge>
                        <span className="rounded-full border border-white/80 bg-white/75 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                          Score {selectedService.fitScore}
                        </span>
                        {selectedEnrollmentSummary ? (
                          <span className="rounded-full border border-white/80 bg-white/75 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                            {selectedEnrollmentSummary.label}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}

              {isSending ? (
                <div className="flex justify-start">
                  <div className="max-w-[92%] pr-8 md:max-w-[72%] md:pr-20">
                    <div className="rounded-[26px] border border-white/80 bg-white/88 px-5 py-4 text-sm text-slate-600 shadow-[0_18px_45px_-32px_rgba(15,23,42,0.6)] backdrop-blur">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Assistant is reviewing the qualification context.
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div ref={endRef} />
            </div>
          )}
        </ScrollArea>

        <div className="border-t border-white/70 bg-white/45 p-4 backdrop-blur md:p-5">
          <div className="rounded-[28px] border border-white/80 bg-white/78 p-3 shadow-[0_18px_45px_-32px_rgba(15,23,42,0.4)]">
            <div className="flex items-end gap-3">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={
                  canAskQuestions
                    ? scopeMode === "service" && selectedService
                      ? `Ask about ${selectedService.serviceName}...`
                      : "Ask about the active services..."
                    : "Start AI qualification to open the conversation."
                }
                className="min-h-[64px] border-none bg-transparent px-2 py-2 text-sm text-slate-700 shadow-none focus-visible:ring-0"
                disabled={isSending || isLoadingAnalysis || !hasRun}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void handleSendQuestion(draft)
                  }
                }}
              />
              <Button
                type="button"
                size="icon"
                className="mb-1 h-11 w-11 rounded-full bg-slate-950 text-white hover:bg-slate-900"
                onClick={() => {
                  if (!hasRun) {
                    void runQualificationAnalysis()
                    return
                  }
                  void handleSendQuestion(draft)
                }}
                disabled={
                  isSending ||
                  isLoadingAnalysis ||
                  (hasRun ? !draft.trim() || !canAskQuestions : false)
                }
              >
                {isLoadingAnalysis || isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
              </Button>
            </div>

            <div className="flex flex-col gap-2 px-2 pb-1 pt-2 md:flex-row md:items-center md:justify-between">
              <p className="text-xs text-slate-500">
                {!hasRun
                  ? "This chat stays empty until you trigger the first qualification scan."
                  : canAskQuestions
                    ? "Questions stay scoped to the current service or the all-services summary."
                    : "Choose a service scope before asking follow-up questions."}
              </p>
              {hasRun ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                    onClick={() => {
                      void handleAnalyzeAll()
                    }}
                    disabled={isSending || items.length === 0}
                  >
                    Scan all active services
                  </button>
                  {selectedService ? (
                    <button
                      type="button"
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                      onClick={() => {
                        setSelectedServiceId(null)
                        setScopeMode("idle")
                      }}
                      disabled={isSending}
                    >
                      Clear selected service
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
