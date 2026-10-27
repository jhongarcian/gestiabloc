"use client"

import Link from "next/link"
import { isCancel } from "axios"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Loader2,
  MessageSquare,
  RefreshCcw,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { AiHelperAvatar } from "@/components/ai-helper-avatar"
import { api } from "@/lib/api"
import { AiActivityTracker } from "@/lib/ai-activity-tracking"
import { getServiceEnrollmentHref } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { defaultAiHelperIdentity, type AiHelperIdentity, type AiHelperSource } from "@/lib/ai-helper"
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
  initialHelper?: AiHelperIdentity
}

type AssistantScopeMode = "idle" | "all" | "service"

const PRIMARY_BUTTON = "h-8 shrink-0 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-blue-900 disabled:cursor-not-allowed"
const SECONDARY_BUTTON = "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed"

type AssistantMessage = {
  id: string
  role: "assistant" | "user"
  title?: string
  body: string
  bullets?: string[]
  showServiceChoices?: boolean
  helperName?: string
  replySource?: "KNOWLEDGE" | "CONTACT" | "RULES" | "FALLBACK"
  answerMode?: "ADAPTED" | "EXACT" | "TRANSLATED"
  sources?: AiHelperSource[]
  citations?: Array<{
    url: string
    title: string
  }>
}

type ServiceFitAssistantResponse = {
  ok: boolean
  helper?: AiHelperIdentity
  items?: ServiceFitScanItem[]
  scope: {
    mode: "all" | "service"
    serviceId: string | null
    serviceName: string | null
  }
  answer: {
    title: string
    summary: string
    bullets: string[]
    replySource?: AssistantMessage["replySource"]
    answerMode?: AssistantMessage["answerMode"]
    sources?: AiHelperSource[]
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
        "There are no active qualification rules to evaluate yet. You can still ask about your company, saved FAQs, and active service knowledge.",
      bullets: [
        "Qualification decisions become available when service rules are enabled.",
      ],
    })
  }

  return createMessage({
    role: "assistant",
    title: "Service review",
    body: `I reviewed ${items.length} active ${items.length === 1 ? "service" : "services"} for this contact. ${grouped.eligible.length} meet the qualification checks, ${grouped.needsInfo.length} need more information, and ${grouped.notEligible.length} do not currently qualify. Ask me about this contact or name any service. You can also select a service below for a closer look.`,
    bullets: items.slice(0, 4).map((item) => item.explanation || `${item.serviceName}: ${toSentence(item.eligibilityStatus)}.`),
    showServiceChoices: true,
  })
}

function buildAssistantReplyMessage(response: ServiceFitAssistantResponse) {
  return createMessage({
    role: "assistant",
    body: response.answer.summary,
    bullets: response.answer.bullets,
    citations: response.answer.citations,
    helperName: ["KNOWLEDGE", "CONTACT"].includes(response.answer.replySource ?? "") ? response.answer.title : response.helper?.name,
    replySource: response.answer.replySource,
    answerMode: response.answer.answerMode,
    sources: response.answer.sources,
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
      href: getServiceEnrollmentHref({
        tenantSlug,
        contactServiceId: item.currentContactServiceId,
      }),
      variant: "default" as const,
    }
  }

  if (item.hasPurchased && item.currentContactServiceId) {
    return {
      label: "View service",
      href: getServiceEnrollmentHref({
        tenantSlug,
        contactServiceId: item.currentContactServiceId,
      }),
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
  initialHelper = defaultAiHelperIdentity,
}: ContactAiQualificationPanelProps) {
  const [items, setItems] = useState<ServiceFitScanItem[]>([])
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [ranAt, setRanAt] = useState<Date | null>(null)
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [scopeMode, setScopeMode] = useState<AssistantScopeMode>("idle")
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null)
  const [selectedServiceName, setSelectedServiceName] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [helper, setHelper] = useState(initialHelper)
  const activeRequest = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const tracking = useRef(new AiActivityTracker())
  const runAttempt = useRef<ReturnType<AiActivityTracker["forRequest"]> | null>(null)
  const history = useRef<Array<{ role: "user" | "assistant"; content: string }>>([])

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
  const canAskQuestions = hasRun && scopeMode !== "idle"

  useEffect(() => () => activeRequest.current?.abort(), [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, isSending])

  const appendMessage = (message: AssistantMessage) => {
    setMessages((current) => [...current, message])
  }

  const runQualificationAnalysis = async () => {
    if (activeRequest.current) return
    const controller = new AbortController()
    activeRequest.current = controller
    setIsLoadingAnalysis(true)
    setDraft("")

    if (!runAttempt.current) {
      tracking.current.newConversation()
      runAttempt.current = tracking.current.forRequest("run")
    }
    const activity = runAttempt.current

    try {
      const { data } = await api.post<ServiceFitScanResponse & { helper?: AiHelperIdentity }>(
        `/api/services/${encodeURIComponent(tenantId)}/fit-scan/run`,
        { contactId, ...activity },
        { signal: controller.signal },
      )
      tracking.current.complete(activity.requestId)
      runAttempt.current = null
      if (data.helper) setHelper(data.helper)

      const nextItems = data.items ?? []
      setItems(nextItems)
      setScopeMode("all")
      setSelectedServiceId(null)
      setSelectedServiceName(null)
      history.current = []
      setRanAt(new Date())
      setMessages([buildInitialAssistantMessage(nextItems)])
    } catch (error) {
      if (!isCancel(error)) toast.error("Could not run qualification analysis.")
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
      setIsLoadingAnalysis(false)
    }
  }

  const requestAssistant = async (options: {
    scope: "all" | "service"
    serviceId?: string | null
    question?: string
  }) => {
    if (activeRequest.current) return
    const controller = new AbortController()
    activeRequest.current = controller
    try {
      const activity = tracking.current.forRequest(JSON.stringify([contactId, options]))
      const { data } = await api.post<ServiceFitAssistantResponse>(
        `/api/services/${encodeURIComponent(tenantId)}/fit-scan/assistant`,
        {
          contactId,
          scope: options.scope,
          serviceId: options.serviceId ?? undefined,
          question: options.question?.trim() || undefined,
          history: history.current,
          ...activity,
        },
        { signal: controller.signal, timeout: 60000 },
      )
      tracking.current.complete(activity.requestId)
      if (data.helper) setHelper(data.helper)
      const updatedItems = data.items
      if (updatedItems) setItems(updatedItems)

      if (options.question) {
        const next = [...history.current,
          { role: "user" as const, content: options.question.trim() },
          { role: "assistant" as const, content: data.answer.summary.trim().slice(0, 6000) },
        ]
        while (next.length > 12 || next.reduce((size, entry) => size + entry.content.length, 0) > 12000) next.splice(0, 2)
        history.current = next
      }

      setScopeMode(data.scope.mode)
      setSelectedServiceId(data.scope.serviceId)
      setSelectedServiceName(data.scope.serviceName)
      appendMessage(buildAssistantReplyMessage(data))
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }

  const handleAnalyzeService = async (serviceId: string) => {
    const service = items.find((item) => item.serviceId === serviceId)
    if (!service || activeRequest.current) return

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
    } catch (error) {
      if (!isCancel(error)) toast.error("Could not analyze that service.")
    } finally {
      setIsSending(false)
    }
  }

  const handleSendQuestion = async (question: string) => {
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion || trimmedQuestion.length > 500 || isSending || isLoadingAnalysis || activeRequest.current) return

    if (!canAskQuestions) {
      toast.error("Start the conversation first.")
      return
    }

    appendMessage(
      createMessage({
        role: "user",
        body: trimmedQuestion,
      }),
    )
    setIsSending(true)

    try {
      await requestAssistant({
        scope: scopeMode === "all" ? "all" : "service",
        serviceId: scopeMode === "service" ? selectedServiceId : undefined,
        question: trimmedQuestion,
      })
      setDraft("")
    } catch (error) {
      if (!isCancel(error)) toast.error("Could not send that question.")
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
    <section className="flex min-w-0 flex-col gap-4">
      <header className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-4 sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
              <AiHelperAvatar name={helper.name} avatar={helper.avatar} className="size-8" />
              <span className="min-w-0">AI helper</span>
            </div>
            <div>
              <h2 className="break-words text-2xl font-semibold text-slate-950">
                {helper.name}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Company knowledge and service rules for {contactName}.
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
                    ? selectedServiceName ?? "Selected service"
                    : scopeMode === "all"
                      ? "All active services"
                      : "Choose a scope"}
                </span>
              </>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className={SECONDARY_BUTTON}
              onClick={() => {
                void runQualificationAnalysis()
              }}
              disabled={isLoadingAnalysis || isSending}
            >
              {isLoadingAnalysis ? (
                <>
                  <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
                  Running
                </>
              ) : hasRun ? (
                <>
                  <RefreshCcw data-icon="inline-start" aria-hidden="true" />
                  Run again
                </>
              ) : (
                <>
                  <MessageSquare data-icon="inline-start" aria-hidden="true" />
                  Start
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      <div className="grid min-h-[640px] min-w-0 grid-rows-[1fr_auto] overflow-hidden rounded-[26px] border border-slate-200 bg-slate-50/70">
        <ScrollArea className="min-h-0 min-w-0 [&_[data-slot=scroll-area-viewport]>div]:block!">
          {!hasRun ? (
            <div className="flex min-h-[620px] items-center justify-center px-6 py-10">
              <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
                <AiHelperAvatar name={helper.name} avatar={helper.avatar} className="size-16" />

                <div className="mt-8 space-y-3">
                  <p className="text-xs font-medium text-slate-500">
                    Your account’s AI helper
                  </p>
                  <h2 className="text-3xl font-semibold tracking-tight text-slate-950">
                    Talk with {helper.name}
                  </h2>
                  <p className="mx-auto max-w-xl text-sm leading-7 text-slate-600">
                    Review this contact’s service rules, then ask about your company, FAQs, or saved service knowledge.
                  </p>
                </div>

                <Button
                  type="button"
                  className={cn(PRIMARY_BUTTON, "mt-8")}
                  onClick={() => {
                    void runQualificationAnalysis()
                  }}
                  disabled={isLoadingAnalysis || isSending}
                >
                  {isLoadingAnalysis ? (
                    <>
                      <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
                      Reviewing services…
                    </>
                  ) : (
                    <>
                      <MessageSquare data-icon="inline-start" aria-hidden="true" />
                      Start conversation
                    </>
                  )}
                </Button>

                <p className="mt-4 text-xs text-slate-500">
                  Qualification comes from saved rules. Messages clear when you leave this page or refresh.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-6 px-5 py-6 md:px-7 md:py-7">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="rounded-full border border-white/80 bg-white/75 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                  {analysisMeta.serviceCount} {analysisMeta.serviceCount === 1 ? "service" : "services"} reviewed
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
                    "flex min-w-0",
                    message.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div className="min-w-0 max-w-[94%] xl:max-w-[72%]">
                    {message.role === "assistant" ? <p className="mb-2 break-words px-1 text-xs font-medium text-slate-600">{message.helperName ?? helper.name}</p> : null}
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
                          "whitespace-pre-wrap break-words text-sm leading-6",
                          message.title ? "mt-1.5" : "",
                          message.role === "user" ? "text-slate-100" : "text-slate-700",
                        )}
                      >
                        {message.body}
                      </p>

                      {message.bullets?.length ? (
                        <ul
                          className={cn(
                            "mt-3 space-y-2 text-sm leading-6",
                            message.role === "user" ? "text-slate-100" : "text-slate-700",
                          )}
                        >
                          {message.bullets.map((bullet) => (
                            <li
                              key={bullet}
                              className="flex items-start gap-2"
                            >
                              <span className="mt-0.5 shrink-0 font-semibold">*</span>
                              <span>{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      {message.replySource ? <div className="mt-3 flex flex-col gap-2">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">{message.replySource === "CONTACT" ? "Contact analysis" : message.replySource === "KNOWLEDGE" ? "Saved knowledge" : "Qualification guidance"}</Badge>
                          {message.answerMode === "EXACT" ? <Badge variant="secondary">As written</Badge> : null}
                          {message.answerMode === "TRANSLATED" ? <Badge variant="secondary">Translated answer</Badge> : null}
                        </div>
                        {message.replySource === "FALLBACK" ? <p className="text-xs leading-relaxed text-slate-500">A conversational reply is unavailable right now. These are the current qualification checks.</p> : null}
                      </div> : null}

                      {message.sources?.length ? <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                        <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Sources ({message.sources.length})</summary>
                        <ul className="mt-3 flex flex-col gap-3">
                          {message.sources.map((source) => <li key={source.id} className="flex flex-col gap-1">
                            <p className="break-words font-medium">{source.label}</p>
                            <p className="whitespace-pre-wrap break-words leading-relaxed text-slate-600">{source.excerpt}</p>
                          </li>)}
                        </ul>
                      </details> : null}

                      {message.showServiceChoices && items.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {items.map((item) => (
                            <Button
                              variant="outline"
                              key={item.serviceId}
                              type="button"
                              className={cn(
                                SECONDARY_BUTTON,
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
                            </Button>
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
                              className={cn(SECONDARY_BUTTON, "max-w-full")}
                            >
                              Source: {citation.title}
                            </Link>
                          ))}
                        </div>
                      ) : null}

                      {message.role === "assistant" && selectedServiceAction && message.id === messages[messages.length - 1]?.id ? (
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          {selectedServiceAction ? (
                            <Button
                              asChild
                              size="sm"
                              variant={selectedServiceAction.variant}
                              className={cn(
                                selectedServiceAction.variant === "default"
                                  ? PRIMARY_BUTTON : SECONDARY_BUTTON,
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
                        <span className="text-xs text-slate-500">From saved rules</span>
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
                        <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
                        {helper.name} is preparing a reply…
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
                id="contact-helper-question"
                aria-label="Your question"
                aria-describedby="contact-helper-question-help"
                maxLength={500}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={
                  canAskQuestions
                    ? "Ask about this contact or any service..."
                    : "Start AI qualification to open the conversation."
                }
                className="min-h-[64px] min-w-0 flex-1 rounded-xl border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-none focus-visible:ring-2"
                disabled={isSending || isLoadingAnalysis || !hasRun || !canAskQuestions}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void handleSendQuestion(draft)
                  }
                }}
              />
              <Button
                type="button"
                size="icon-sm"
                aria-label={hasRun ? "Send question" : "Start conversation"}
                className={cn(PRIMARY_BUTTON, "mb-1 size-8 px-0")}
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
                  <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
                ) : (
                  <MessageSquare aria-hidden="true" />
                )}
              </Button>
            </div>

            <div className="flex flex-col gap-2 px-2 pb-1 pt-2 md:flex-row md:items-center md:justify-between">
              <p id="contact-helper-question-help" className="text-xs text-slate-500">
                {!hasRun
                  ? "Start a conversation to review service rules and ask about saved knowledge."
                  : canAskQuestions
                    ? "Follow up naturally or name another service. 500 characters maximum."
                    : "Start the conversation before asking follow-up questions."}
              </p>
              {hasRun && scopeMode === "service" ? (
                <div className="flex flex-wrap gap-2">
                  {scopeMode === "service" ? (
                    <Button
                      variant="outline"
                      type="button"
                      className={SECONDARY_BUTTON}
                      onClick={() => {
                        setSelectedServiceId(null)
                        setSelectedServiceName(null)
                        setScopeMode("all")
                      }}
                      disabled={isSending}
                    >
                      All services
                    </Button>
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
