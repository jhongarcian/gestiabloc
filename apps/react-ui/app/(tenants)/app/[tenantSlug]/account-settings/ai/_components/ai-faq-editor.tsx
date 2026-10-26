"use client"
import { useEffect, useRef, useState } from "react"
import { Loader2, Plus } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { faqErrors, type AiFaq, type AiFaqInput } from "../_lib/content"
import {
  AiEmpty,
  AiPageHeader,
  AiPanel,
  INPUT_CLASS,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SkillBreadcrumbs,
  TEXTAREA_CLASS,
} from "./ai-ui"
import { useAiSkill } from "./ai-workspace"

const emptyFaq = (): AiFaqInput => ({
  question: "",
  answer: "",
  exactAnswer: false,
})
type Editing = {
  id: string | null
  revision: string
  original: AiFaqInput
  value: AiFaqInput
}
export function AiFaqEditor({ skillId }: { skillId: string }) {
  const {
    skill,
    faqCollections,
    faqErrors: requestErrors,
    faqConflicts,
    faqBusy,
    faqLoading,
    loadFaqs,
    changeFaq,
    clearFaqError,
  } = useAiSkill(skillId)
  const collection = faqCollections[skillId]
  const error = requestErrors[skillId]
  const busy = faqBusy !== null || Boolean(faqLoading[skillId])
  const [editing, setEditing] = useState<Editing | null>(null)
  const [removing, setRemoving] = useState<{
    faq: AiFaq
    revision: string
  } | null>(null)
  const [touched, setTouched] = useState({ question: false, answer: false })
  const trigger = useRef<HTMLButtonElement | null>(null)
  const addButton = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!collection && !error) void loadFaqs(skillId)
  }, [collection, error, loadFaqs, skillId])
  const errors = editing
    ? faqErrors(editing.value)
    : { question: "", answer: "" }
  const changed =
    editing &&
    JSON.stringify(editing.value) !== JSON.stringify(editing.original)
  const latestQuestion = collection?.faqs.find((faq) => faq.id === editing?.id)
  const valid = !errors.question && !errors.answer
  function openEditor(button: HTMLButtonElement, faq?: AiFaq, answer = "") {
    if (!collection || busy) return
    trigger.current = button
    clearFaqError(skillId)
    const value = faq
      ? {
          question: faq.question,
          answer: faq.answer,
          exactAnswer: faq.exactAnswer,
        }
      : { ...emptyFaq(), answer }
    setEditing({
      id: faq?.id ?? null,
      revision: collection.revision,
      original: faq ? value : emptyFaq(),
      value,
    })
    setTouched({ question: false, answer: false })
  }
  function restoreFocus(event: Event) {
    event.preventDefault()
    ;(trigger.current?.isConnected
      ? trigger.current
      : addButton.current
    )?.focus()
  }
  function closeEditor() {
    if (!busy) {
      setEditing(null)
      clearFaqError(skillId)
    }
  }
  async function save() {
    if (!editing || busy || !valid || !changed || faqConflicts[skillId]) return
    if (
      await changeFaq(skillId, editing.revision, {
        action: editing.id ? "update" : "create",
        faqId: editing.id ?? undefined,
        faq: editing.value,
      })
    )
      setEditing(null)
  }
  function reviewConflict(useSaved: boolean) {
    if (!editing || !collection) return
    const saved = collection.faqs.find((faq) => faq.id === editing.id)
    const original = saved
      ? {
          question: saved.question,
          answer: saved.answer,
          exactAnswer: saved.exactAnswer,
        }
      : emptyFaq()
    setEditing({
      id: saved || !editing.id ? editing.id : null,
      revision: collection.revision,
      original,
      value: useSaved && saved ? original : editing.value,
    })
    clearFaqError(skillId)
  }
  async function move(index: number, delta: number) {
    if (!collection || busy) return
    const ids = collection.faqs.map((faq) => faq.id)
    const id = ids[index]
    ids[index] = ids[index + delta]
    ids[index + delta] = id
    await changeFaq(skillId, collection.revision, { action: "order", ids })
  }
  return (
    <>
      <SkillBreadcrumbs skill={skill} section="faq" />
      <AiPageHeader
        title="FAQ"
        eyebrow={skill.name}
        description="Save individual questions and choose how your helper uses each answer."
        actions={
          <>
            <Button
              variant="outline"
              className={SECONDARY_BUTTON}
              disabled={busy}
              onClick={() => void loadFaqs(skillId)}
            >
              Refresh questions
            </Button>
            <Button
              ref={addButton}
              variant="outline"
              className={SECONDARY_BUTTON}
              disabled={!collection || busy || collection.faqs.length >= 100}
              onClick={(event) => openEditor(event.currentTarget)}
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add question
            </Button>
          </>
        }
      />
      {error && !editing && !removing ? (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertTitle>Questions could not be updated</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {!collection && !error ? (
        <Skeleton className="h-36 rounded-2xl" aria-label="Loading questions" />
      ) : null}
      {collection?.legacyNotes ? (
        <details className="rounded-[22px] border border-slate-200 bg-white p-5">
          <summary className="cursor-pointer rounded text-sm font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700">
            Imported FAQ notes · review needed
          </summary>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            These notes are preserved as written. Review them and create
            individual questions when appropriate.
          </p>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">
            {collection.legacyNotes}
          </p>
          <Button
            variant="outline"
            className={`${SECONDARY_BUTTON} mt-4`}
            disabled={busy || collection.faqs.length >= 100}
            onClick={(event) =>
              openEditor(event.currentTarget, undefined, collection.legacyNotes)
            }
          >
            Create question from notes
          </Button>
        </details>
      ) : null}
      {collection ? (
        <p className="px-1 text-sm text-slate-500">
          {collection.faqs.length} saved{" "}
          {collection.faqs.length === 1 ? "question" : "questions"}
        </p>
      ) : null}
      {collection?.faqs.map((faq, index) => (
        <div key={faq.id} id={`faq-${faq.id}`} className="min-w-0 scroll-mt-24">
          <AiPanel
            title={faq.question}
            className="[&_h2]:break-words [&_h2]:[overflow-wrap:anywhere]"
            actions={
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className={SECONDARY_BUTTON}
                  disabled={busy || index === 0}
                  onClick={() => void move(index, -1)}
                  aria-label={`Move question ${index + 1} up`}
                >
                  Move up
                </Button>
                <Button
                  variant="outline"
                  className={SECONDARY_BUTTON}
                  disabled={busy || index === collection.faqs.length - 1}
                  onClick={() => void move(index, 1)}
                  aria-label={`Move question ${index + 1} down`}
                >
                  Move down
                </Button>
                <Button
                  variant="outline"
                  className={SECONDARY_BUTTON}
                  disabled={busy}
                  onClick={(event) => openEditor(event.currentTarget, faq)}
                  aria-label={`Edit question ${index + 1}`}
                >
                  Edit
                </Button>
                <Button
                  variant="outline"
                  className={SECONDARY_BUTTON}
                  disabled={busy}
                  onClick={(event) => {
                    trigger.current = event.currentTarget
                    clearFaqError(skillId)
                    setRemoving({ faq, revision: collection.revision })
                  }}
                  aria-label={`Remove question ${index + 1}`}
                >
                  Remove
                </Button>
              </div>
            }
          >
            <div className="flex flex-col gap-3">
              <Badge
                variant={faq.exactAnswer ? "secondary" : "outline"}
                className="w-fit"
              >
                {faq.exactAnswer ? "Answer as written" : "Adapt answer"}
              </Badge>
              <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700 [overflow-wrap:anywhere]">
                {faq.answer}
              </p>
            </div>
          </AiPanel>
        </div>
      ))}
      {collection && !collection.faqs.length ? (
        <AiEmpty
          title="No questions yet"
          description="Use Add question to save the answers your helper should know."
        />
      ) : null}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) closeEditor()
        }}
      >
        <DialogContent
          onCloseAutoFocus={restoreFocus}
          className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[28px] border-slate-200 bg-white p-0 shadow-2xl sm:max-w-2xl [&>button]:cursor-pointer"
        >
          <DialogHeader className="border-b border-blue-100 bg-[#f1f7ff] px-6 py-5 pr-12 text-left">
            <p className="text-xs font-semibold text-blue-700">{skill.name}</p>
            <DialogTitle className="text-xl font-semibold text-slate-950">
              {editing?.id ? "Edit question" : "Add question"}
            </DialogTitle>
            <DialogDescription>
              Save a question, its answer, and how your helper should respond.
            </DialogDescription>
          </DialogHeader>
          <form
            id="ai-faq-form"
            noValidate
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-5 [scrollbar-gutter:stable]">
              {error ? (
                <Alert
                  variant="destructive"
                  className="mb-4 rounded-2xl"
                  role="alert"
                >
                  <AlertTitle>Question was not saved</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {faqConflicts[skillId] ? (
                <div className="mb-5 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm text-slate-700">
                    {editing?.id &&
                    !collection?.faqs.some((faq) => faq.id === editing.id)
                      ? "This question was removed elsewhere. Keeping your edits will create a new question."
                      : "Review the latest saved version before choosing which edits to keep."}
                  </p>
                  {latestQuestion ? (
                    <div className="rounded-lg border border-amber-200 bg-white/80 p-3 text-sm text-slate-700">
                      <p className="font-medium">Latest saved question</p>
                      <p className="mt-2 break-words [overflow-wrap:anywhere]">
                        {latestQuestion.question}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {latestQuestion.answer}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        {latestQuestion.exactAnswer
                          ? "Answer as written"
                          : "Adapt answer"}
                      </p>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {collection?.faqs.some((faq) => faq.id === editing?.id) ? (
                      <Button
                        type="button"
                        variant="outline"
                        className={SECONDARY_BUTTON}
                        onClick={() => reviewConflict(true)}
                      >
                        Use saved question
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      className={SECONDARY_BUTTON}
                      onClick={() => reviewConflict(false)}
                    >
                      Keep my edits
                    </Button>
                  </div>
                </div>
              ) : null}
              <FieldGroup className="gap-5">
                <Field
                  data-invalid={touched.question && Boolean(errors.question)}
                >
                  <FieldLabel htmlFor="faq-question">
                    Question{" "}
                    <span className="text-rose-600" aria-hidden="true">
                      *
                    </span>
                  </FieldLabel>
                  <Input
                    id="faq-question"
                    className={INPUT_CLASS}
                    value={editing?.value.question ?? ""}
                    disabled={busy}
                    maxLength={500}
                    aria-required="true"
                    aria-invalid={touched.question && Boolean(errors.question)}
                    aria-describedby={
                      touched.question && errors.question
                        ? "faq-question-error"
                        : undefined
                    }
                    onBlur={() =>
                      setTouched((value) => ({ ...value, question: true }))
                    }
                    onChange={(event) =>
                      setEditing(
                        (current) =>
                          current && {
                            ...current,
                            value: {
                              ...current.value,
                              question: event.target.value,
                            },
                          },
                      )
                    }
                    placeholder="What do callers ask?"
                  />
                  {touched.question && errors.question ? (
                    <FieldError id="faq-question-error">
                      {errors.question}
                    </FieldError>
                  ) : null}
                </Field>
                <Field data-invalid={touched.answer && Boolean(errors.answer)}>
                  <FieldLabel htmlFor="faq-answer">
                    Answer{" "}
                    <span className="text-rose-600" aria-hidden="true">
                      *
                    </span>
                  </FieldLabel>
                  <Textarea
                    id="faq-answer"
                    className={`${TEXTAREA_CLASS} min-h-40`}
                    value={editing?.value.answer ?? ""}
                    disabled={busy}
                    maxLength={4000}
                    aria-required="true"
                    aria-invalid={touched.answer && Boolean(errors.answer)}
                    aria-describedby={
                      touched.answer && errors.answer
                        ? "faq-answer-error"
                        : undefined
                    }
                    onBlur={() =>
                      setTouched((value) => ({ ...value, answer: true }))
                    }
                    onChange={(event) =>
                      setEditing(
                        (current) =>
                          current && {
                            ...current,
                            value: {
                              ...current.value,
                              answer: event.target.value,
                            },
                          },
                      )
                    }
                  />
                  {touched.answer && errors.answer ? (
                    <FieldError id="faq-answer-error">
                      {errors.answer}
                    </FieldError>
                  ) : null}
                  <FieldDescription>
                    Keep the answer to 4,000 characters or fewer.
                  </FieldDescription>
                </Field>
                <Field
                  orientation="horizontal"
                  className="items-start rounded-xl border border-blue-100 bg-blue-50/40 p-4"
                >
                  <Checkbox
                    id="faq-exact-answer"
                    checked={editing?.value.exactAnswer ?? false}
                    disabled={busy}
                    aria-describedby="faq-answer-style"
                    onCheckedChange={(checked) =>
                      setEditing(
                        (current) =>
                          current && {
                            ...current,
                            value: {
                              ...current.value,
                              exactAnswer: checked === true,
                            },
                          },
                      )
                    }
                  />
                  <div className="flex min-w-0 flex-col gap-2">
                    <FieldLabel htmlFor="faq-exact-answer">
                      Use answer as written
                    </FieldLabel>
                    <FieldDescription id="faq-answer-style">
                      {editing?.value.exactAnswer
                        ? "Uses this answer as written when the caller’s question closely matches. For other languages, it translates the answer without adding or removing information."
                        : "Adapts this answer to the caller’s question and conversation."}
                    </FieldDescription>
                  </div>
                </Field>
              </FieldGroup>
            </div>
            <DialogFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4">
              <Button
                type="button"
                variant="outline"
                className={SECONDARY_BUTTON}
                disabled={busy}
                onClick={closeEditor}
              >
                Cancel
              </Button>
              {changed ? (
                <Button
                  type="submit"
                  className={PRIMARY_BUTTON}
                  disabled={busy || !valid || faqConflicts[skillId]}
                >
                  {faqBusy === skillId ? (
                    <Loader2
                      data-icon="inline-start"
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  {faqBusy === skillId ? "Saving…" : "Save question"}
                </Button>
              ) : null}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setRemoving(null)
            clearFaqError(skillId)
          }
        }}
      >
        <DialogContent
          onCloseAutoFocus={restoreFocus}
          className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden rounded-[28px] border-slate-200 bg-white p-0 sm:max-w-lg [&>button]:cursor-pointer"
        >
          <DialogHeader className="border-b border-blue-100 bg-[#f1f7ff] px-6 py-5 pr-12 text-left">
            <DialogTitle>Remove question</DialogTitle>
            <DialogDescription>
              This removes the saved question and answer from this skill and
              future helper replies.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-5">
            <p className="break-words text-sm font-medium text-slate-900">
              {removing?.faq.question}
            </p>
            {error ? (
              <Alert variant="destructive" className="mt-4 rounded-xl">
                <AlertDescription>
                  {error}
                  {faqConflicts[skillId]
                    ? " Close this dialog and review the list before removing it."
                    : ""}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4">
            <Button
              variant="outline"
              className={SECONDARY_BUTTON}
              disabled={busy}
              onClick={() => {
                setRemoving(null)
                clearFaqError(skillId)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="h-8 cursor-pointer rounded-full px-3 text-xs font-semibold"
              disabled={busy || faqConflicts[skillId]}
              onClick={async () => {
                if (
                  removing &&
                  (await changeFaq(skillId, removing.revision, {
                    action: "delete",
                    faqId: removing.faq.id,
                  }))
                )
                  setRemoving(null)
              }}
            >
              {faqBusy === skillId ? "Removing…" : "Remove question"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
