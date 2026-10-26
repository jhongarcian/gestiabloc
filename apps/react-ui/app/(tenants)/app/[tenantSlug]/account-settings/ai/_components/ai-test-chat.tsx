"use client"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Loader2, MessageCircle, Send } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { AiHelperAvatar } from "./ai-helper-avatar"
import { PRIMARY_BUTTON, SECONDARY_BUTTON, TEXTAREA_CLASS } from "./ai-ui"
import { useTestChat } from "./use-test-chat"
import type { AiHelperSettings } from "../_lib/helper-settings"

export function AiTestChat({
  tenantId,
  basePath,
  helper,
}: {
  tenantId: string
  basePath: string
  helper: AiHelperSettings | null
}) {
  const [open, setOpen] = useState(false)
  const chat = useTestChat(tenantId)
  const end = useRef<HTMLDivElement>(null)
  const lastHelper = chat.turns.at(-1)?.reply.helper
  const name =
    lastHelper && lastHelper.revision >= (helper?.revision ?? 0)
      ? lastHelper.name
      : (helper?.name ?? "AI Helper")
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "end", behavior: "instant" })
  }, [open, chat.turns.length, chat.pending, chat.error])
  const canSend =
    Boolean(chat.question.trim()) &&
    chat.question.trim().length <= 2000 &&
    !chat.pending &&
    chat.available === true
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) void chat.checkAvailability()
      }}
    >
      <SheetTrigger asChild>
        <Button type="button" className={`${PRIMARY_BUTTON} w-full`}>
          <MessageCircle data-icon="inline-start" aria-hidden="true" />
          Test helper
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex h-dvh w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-white p-0 sm:max-w-xl [&>button]:cursor-pointer"
      >
        <SheetHeader className="min-w-0 shrink-0 border-b border-blue-100 bg-[linear-gradient(135deg,#f1f7ff,#fff7ed)] px-5 py-5 pr-12 text-left sm:px-6 sm:pr-12">
          <p className="text-xs font-semibold text-blue-700">
            AI workspace · Test conversation
          </p>
          <SheetTitle className="break-words text-xl font-semibold text-slate-950 [overflow-wrap:anywhere]">
            Test {name}
          </SheetTitle>
          <SheetDescription className="text-sm leading-6 text-slate-600">
            Try questions about your company and services using saved
            information.
          </SheetDescription>
          <p className="text-xs leading-5 text-slate-500">
            Unsaved edits and preview sources are excluded. Messages clear when
            you refresh or leave the workspace.
          </p>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50/50 px-4 py-5 [scrollbar-gutter:stable] sm:px-6">
          <div
            role="log"
            aria-label="Test conversation"
            aria-live="polite"
            aria-relevant="additions"
            className="flex min-w-0 flex-col gap-6"
          >
            {chat.truncated ? (
              <p className="text-center text-xs text-slate-500">
                Earlier messages were cleared to keep this test chat short.
              </p>
            ) : null}
            {!chat.turns.length && !chat.pending ? (
              <Empty className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-8">
                <EmptyHeader>
                  <AiHelperAvatar
                    avatar={helper?.avatar}
                    name={name}
                    className="mx-auto mb-3 size-12"
                  />
                  <EmptyTitle>Start a conversation</EmptyTitle>
                  <EmptyDescription>
                    Ask about your company, compare services, or check saved
                    pricing and preparation notes.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
            {chat.turns.map((turn) => (
              <div key={turn.reply.id} className="flex min-w-0 flex-col gap-4">
                <div className="ml-8 flex min-w-0 flex-col gap-1 rounded-2xl rounded-br-sm bg-blue-950 px-4 py-3 text-white">
                  <p className="text-xs font-medium text-blue-100">You</p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
                    {turn.question}
                  </p>
                </div>
                <article
                  className="mr-2 flex min-w-0 flex-col gap-3 rounded-2xl rounded-bl-sm border border-slate-200 bg-white p-4"
                  aria-label={`${turn.reply.helper.name} reply`}
                >
                  <p className="text-xs font-semibold text-blue-950">
                    {turn.reply.helper.name}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700 [overflow-wrap:anywhere]">
                    {turn.reply.answer}
                  </p>
                  {turn.reply.sources.length ? (
                    <details className="border-t border-slate-100 pt-3">
                      <summary className="cursor-pointer rounded text-xs font-medium text-blue-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
                        Saved sources · {turn.reply.sources.length}
                      </summary>
                      <ul className="mt-3 flex flex-col gap-3">
                        {turn.reply.sources.map((source) => (
                          <li key={source.id} className="min-w-0">
                            <Link
                              onClick={() => setOpen(false)}
                              href={
                                source.skillId
                                  ? `${basePath}/skills/${source.skillId}/knowledge-base`
                                  : `${basePath}/company-info`
                              }
                              className="rounded text-xs font-semibold text-blue-800 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                            >
                              {source.label}
                            </Link>
                            <p className="mt-1 line-clamp-3 break-words text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">
                              {source.excerpt}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {turn.reply.context.limited &&
                  turn.reply.sources.length > 0 ? (
                    <p className="text-xs leading-5 text-slate-500">
                      A selection of relevant saved information was used. Ask a
                      more specific question for additional detail.
                    </p>
                  ) : null}
                </article>
              </div>
            ))}
            {chat.pending ? (
              <>
                <div className="ml-8 rounded-2xl rounded-br-sm bg-blue-950 px-4 py-3 text-sm leading-6 whitespace-pre-wrap break-words text-white [overflow-wrap:anywhere]">
                  {chat.pending}
                </div>
                <p
                  role="status"
                  className="flex items-center gap-2 text-sm text-slate-500"
                >
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {name} is replying…
                </p>
              </>
            ) : null}
            <div ref={end} />
          </div>
          {chat.available === false ? (
            <Alert className="mt-4 rounded-2xl">
              <AlertTitle>AI service is not connected</AlertTitle>
              <AlertDescription>
                The configured AI service is unavailable. Connect it on the
                server to test real replies.
              </AlertDescription>
            </Alert>
          ) : null}
          {chat.error ? (
            <Alert
              variant="destructive"
              role="alert"
              className="mt-4 rounded-2xl"
            >
              <AlertTitle>Conversation unavailable</AlertTitle>
              <AlertDescription>{chat.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <SheetFooter className="mt-0 shrink-0 border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void chat.send()
            }}
            className="flex min-w-0 flex-col gap-3"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="ai-test-question">
                  Your question
                </FieldLabel>
                <Textarea
                  id="ai-test-question"
                  value={chat.question}
                  disabled={Boolean(chat.pending)}
                  maxLength={2000}
                  rows={3}
                  className={`${TEXTAREA_CLASS} max-h-36 min-h-20 resize-y`}
                  placeholder="What should a client prepare for this service?"
                  onChange={(event) => chat.setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault()
                      if (canSend) void chat.send()
                    }
                  }}
                  aria-describedby="ai-test-keyboard-hint"
                />
              </Field>
            </FieldGroup>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p id="ai-test-keyboard-hint" className="text-xs text-slate-500">
                Enter to send · Shift + Enter for a new line
              </p>
              <div className="flex flex-wrap gap-2">
                {chat.available !== true ? (
                  <Button
                    type="button"
                    variant="outline"
                    className={SECONDARY_BUTTON}
                    disabled={chat.checking}
                    onClick={() => void chat.checkAvailability()}
                  >
                    {chat.checking ? "Connecting…" : "Check connection"}
                  </Button>
                ) : null}
                {chat.turns.length ? (
                  <Button
                    type="button"
                    variant="outline"
                    className={SECONDARY_BUTTON}
                    disabled={Boolean(chat.pending)}
                    onClick={chat.clear}
                  >
                    Clear chat
                  </Button>
                ) : null}
                {chat.pending ? (
                  <Button
                    type="button"
                    variant="outline"
                    className={SECONDARY_BUTTON}
                    onClick={chat.stop}
                  >
                    Stop reply
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  className={PRIMARY_BUTTON}
                  disabled={!canSend}
                >
                  {chat.pending ? (
                    <Loader2
                      data-icon="inline-start"
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Send data-icon="inline-start" aria-hidden="true" />
                  )}
                  {chat.pending
                    ? "Replying…"
                    : chat.error
                      ? "Try again"
                      : "Send question"}
                </Button>
              </div>
            </div>
          </form>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
