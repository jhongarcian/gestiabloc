"use client"
import { useEffect, useRef, useState } from "react"
import { FileText, Link2, Loader2, Plus } from "lucide-react"
import { api } from "@/lib/api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AiEmpty,
  AiPanel,
  INPUT_CLASS,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from "./ai-ui"
import { useAiSkill } from "./ai-workspace"
import {
  SOURCE_STATUS,
  fileSize,
  sourcePending,
  sourceUrlError,
  type AiSource,
  type AiSourceText,
} from "../_lib/sources"

type Editing = {
  source: AiSource | null
  requestId: string
  label: string
  url: string
}
const MODAL =
  "max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[28px] border-slate-200 bg-white p-0 shadow-2xl sm:max-w-2xl [&>button]:cursor-pointer"
export function AiSourceManager({ skillId }: { skillId: string }) {
  const {
    skill,
    sourceCollections,
    sourceErrors,
    sourceLoading,
    sourceBusy,
    sourceConflicts,
    sourceUploads,
    uploadingSource,
    loadSources,
    changeSource,
    clearSourceError,
    uploadSourceFile,
    dismissSourceUpload,
    sourceRoot,
  } = useAiSkill(skillId)
  const sources = sourceCollections[skillId]
  const busy = sourceBusy !== null
  const error = sourceErrors[skillId]
  const [editing, setEditing] = useState<Editing | null>(null),
    [removing, setRemoving] = useState<AiSource | null>(null)
  const [viewing, setViewing] = useState<AiSource | null>(null),
    [text, setText] = useState<AiSourceText | null>(null),
    [textBusy, setTextBusy] = useState(false),
    [textError, setTextError] = useState("")
  const [touched, setTouched] = useState(false)
  const textRequest = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null),
    trigger = useRef<HTMLButtonElement | null>(null),
    addButton = useRef<HTMLButtonElement | null>(null),
    anchor = useRef("")
  const pending = Boolean(sources?.some(sourcePending))
  useEffect(() => {
    if (!sources && !error) void loadSources(skillId)
  }, [sources, error, loadSources, skillId])
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => void loadSources(skillId, true), 2000)
    return () => clearInterval(timer)
  }, [pending, loadSources, skillId])
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id.startsWith("source-") && anchor.current !== id) {
      const element = document.getElementById(id)
      if (element) {
        element.scrollIntoView({ block: "center" })
        element.focus({ preventScroll: true })
        anchor.current = id
      }
    }
  }, [sources])
  const uploads = Object.values(sourceUploads).filter(
    (upload) => upload.skillId === skillId,
  )
  const urlError =
    editing && editing.source?.kind !== "FILE"
      ? sourceUrlError(editing.url)
      : ""
  const latest = sources?.find((source) => source.id === editing?.source?.id)
  const changed =
    editing &&
    (!editing.source ||
      editing.label.trim() !== editing.source.label ||
      (editing.source.kind === "LINK" &&
        editing.url.trim() !== editing.source.url))
  function open(
    button: HTMLButtonElement,
    source: AiSource | null = null,
    url = "",
  ) {
    trigger.current = button
    clearSourceError(skillId)
    setTouched(false)
    setEditing({
      source,
      requestId: crypto.randomUUID(),
      label: source?.label ?? "",
      url: source?.url ?? url,
    })
  }
  function focusBack(event: Event) {
    event.preventDefault()
    ;(trigger.current?.isConnected
      ? trigger.current
      : addButton.current
    )?.focus()
  }
  async function save() {
    if (
      !editing ||
      busy ||
      urlError ||
      (!editing.label.trim() && editing.source) ||
      sourceConflicts[skillId]
    )
      return
    const saved = await changeSource(
      skillId,
      editing.source
        ? {
            action: "edit",
            source: editing.source,
            label: editing.label.trim(),
            ...(editing.source.kind === "LINK"
              ? { url: editing.url.trim() }
              : {}),
          }
        : {
            action: "create",
            requestId: editing.requestId,
            label: editing.label.trim(),
            url: editing.url.trim(),
          },
    )
    if (saved) setEditing(null)
  }
  async function readText(source: AiSource, append = false) {
    if (textBusy) return
    const request = ++textRequest.current
    if (!append) {
      setViewing(source)
      setText(null)
    }
    setTextBusy(true)
    setTextError("")
    try {
      const after = append ? (text?.chunks.at(-1)?.ordinal ?? -1) : -1
      const { data } = await api.get<AiSourceText>(
        `${sourceRoot}/${skillId}/sources/${source.id}/text`,
        { params: { after }, timeout: 15000 },
      )
      if (request !== textRequest.current) return
      setText((old) => ({
        ...data,
        chunks: append ? [...(old?.chunks ?? []), ...data.chunks] : data.chunks,
      }))
    } catch {
      if (request !== textRequest.current) return
      setTextError("The source text could not be loaded. Try again.")
    } finally {
      if (request === textRequest.current) setTextBusy(false)
    }
  }
  function closeText() {
    textRequest.current++
    setTextBusy(false)
    setViewing(null)
  }
  function card(source: AiSource) {
    return (
      <div
        key={source.id}
        id={`source-${source.id}`}
        tabIndex={-1}
        aria-label={source.label}
        className="flex min-w-0 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 focus-visible:outline-2 focus-visible:outline-blue-700"
      >
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 gap-3">
            {source.kind === "FILE" ? (
              <FileText
                className="mt-0.5 hidden size-4 shrink-0 text-slate-400 sm:block"
                aria-hidden="true"
              />
            ) : (
              <Link2
                className="mt-0.5 hidden size-4 shrink-0 text-slate-400 sm:block"
                aria-hidden="true"
              />
            )}
            <div className="flex min-w-0 flex-col gap-1">
              <p className="break-words text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">
                {source.label}
              </p>
              <p className="break-words text-xs leading-5 text-slate-500 [overflow-wrap:anywhere]">
                {source.kind === "FILE"
                  ? `${source.filename} · ${fileSize(source.size ?? 0)}`
                  : source.url}
              </p>
              {source.status === "READY" ? (
                <p className="text-xs text-slate-500">
                  {source.characterCount.toLocaleString()} characters available
                  to your helper
                </p>
              ) : null}
            </div>
          </div>
          <Badge
            variant={
              source.status === "FAILED" || source.status === "OCR_REQUIRED"
                ? "outline"
                : "secondary"
            }
            className="w-fit shrink-0"
          >
            {SOURCE_STATUS[source.status]}
          </Badge>
        </div>
        {sourcePending(source) ? (
          <div className="flex flex-col gap-2" role="status">
            <Progress
              value={source.progress}
              aria-label={`Processing ${source.label}`}
            />
            <p className="text-xs text-slate-500">
              {source.status === "QUEUED"
                ? "Waiting to read this source."
                : source.status === "UPLOADING"
                  ? "Storing your document."
                  : "Reading and preparing searchable text."}
            </p>
          </div>
        ) : null}
        {source.lastError ? (
          <p
            role={source.status === "FAILED" ? "alert" : undefined}
            className="text-sm leading-6 text-slate-600"
          >
            {source.lastError}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className={SECONDARY_BUTTON}
            disabled={busy || source.status === "UPLOADING"}
            aria-label={`Edit ${source.label}`}
            onClick={(event) => open(event.currentTarget, source)}
          >
            Edit
          </Button>
          {source.canDownload ? (
            <Button asChild variant="outline" className={SECONDARY_BUTTON}>
              <a
                href={`${api.defaults.baseURL}${sourceRoot}/${skillId}/sources/${source.id}/download`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Download ${source.label}`}
              >
                Download
              </a>
            </Button>
          ) : null}
          {source.status === "READY" ? (
            <Button
              variant="outline"
              className={SECONDARY_BUTTON}
              aria-label={`View text from ${source.label}`}
              onClick={(event) => {
                trigger.current = event.currentTarget
                void readText(source)
              }}
            >
              View text
            </Button>
          ) : null}
          {source.canRetry ? (
            <Button
              variant="outline"
              className={SECONDARY_BUTTON}
              disabled={busy}
              onClick={() =>
                void changeSource(skillId, { action: "retry", source })
              }
            >
              Retry processing
            </Button>
          ) : null}
          <Button
            variant="outline"
            className={SECONDARY_BUTTON}
            disabled={busy || source.status === "UPLOADING"}
            aria-label={`Remove ${source.label}`}
            onClick={(event) => {
              trigger.current = event.currentTarget
              clearSourceError(skillId)
              setRemoving(source)
            }}
          >
            Remove
          </Button>
        </div>
      </div>
    )
  }
  return (
    <>
      {error && !editing && !removing ? (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertTitle>Sources need attention</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <AiPanel
        title="Source links"
        description="Add a public webpage for your helper to read. Only the submitted page is fetched."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className={SECONDARY_BUTTON}
              disabled={Boolean(sourceLoading[skillId])}
              onClick={() => void loadSources(skillId)}
            >
              Refresh sources
            </Button>
            <Button
              ref={addButton}
              variant="outline"
              className={SECONDARY_BUTTON}
              disabled={busy || !sources || sources.length >= 100}
              onClick={(event) => open(event.currentTarget)}
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              Add link
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {!sources && !error ? (
            <Skeleton
              className="h-24 rounded-xl"
              aria-label="Loading sources"
            />
          ) : null}
          {sources?.filter((source) => source.kind === "LINK").map(card)}
          {sources && !sources.some((source) => source.kind === "LINK") ? (
            <AiEmpty
              title="No links yet"
              description="Add a public service webpage to build your helper’s knowledge."
            />
          ) : null}
          {skill.verificationProfile.sourceUrls.length ? (
            <details className="rounded-xl border border-slate-200 p-4">
              <summary className="cursor-pointer rounded text-sm font-medium text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-700">
                Previously saved links
              </summary>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                These links are preserved for reference. Add the pages you want
                your helper to read.
              </p>
              <div className="mt-3 flex flex-col gap-3">
                {skill.verificationProfile.sourceUrls.map((url) => (
                  <div
                    key={url}
                    className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center"
                  >
                    <p className="min-w-0 flex-1 break-all text-xs text-slate-600">
                      {url}
                    </p>
                    <Button
                      variant="outline"
                      className={SECONDARY_BUTTON}
                      disabled={
                        busy || sources?.some((source) => source.url === url)
                      }
                      onClick={(event) => open(event.currentTarget, null, url)}
                    >
                      Add to sources
                    </Button>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </AiPanel>
      <AiPanel
        title="Files"
        description="PDF, DOCX, or UTF-8 TXT · up to 10 MB each. Documents are stored privately for this account."
        actions={
          <Button
            variant="outline"
            className={SECONDARY_BUTTON}
            disabled={
              uploadingSource !== null || !sources || sources.length >= 100
            }
            onClick={() => fileInput.current?.click()}
          >
            <Plus data-icon="inline-start" aria-hidden="true" />
            Add file
          </Button>
        }
      >
        <input
          ref={fileInput}
          className="sr-only"
          tabIndex={-1}
          type="file"
          accept=".pdf,.docx,.txt"
          aria-label="Choose AI knowledge file"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void uploadSourceFile(skillId, file)
            event.target.value = ""
          }}
        />
        <div className="flex flex-col gap-3">
          {uploads.map((upload) => (
            <div
              key={upload.requestId}
              className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4"
              role="status"
            >
              <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                {upload.file.name} · {fileSize(upload.file.size)}
              </p>
              {upload.error ? (
                <>
                  <p className="text-sm text-rose-700" role="alert">
                    {upload.error}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className={SECONDARY_BUTTON}
                      disabled={uploadingSource !== null}
                      onClick={() => dismissSourceUpload(upload.requestId)}
                    >
                      Dismiss
                    </Button>
                    <Button
                      className={PRIMARY_BUTTON}
                      disabled={uploadingSource !== null}
                      onClick={() =>
                        void uploadSourceFile(
                          skillId,
                          upload.file,
                          upload.requestId,
                        )
                      }
                    >
                      Retry upload
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Progress
                    value={upload.progress}
                    aria-label={`Uploading ${upload.file.name}`}
                  />
                  <p className="text-xs text-slate-500">
                    {upload.progress === 100
                      ? "Storing document…"
                      : `Sending file · ${upload.progress}%`}
                  </p>
                </>
              )}
            </div>
          ))}
          {sources
            ?.filter(
              (source) =>
                source.kind === "FILE" && !sourceUploads[source.requestId],
            )
            .map(card)}
          {sources &&
          !sources.some((source) => source.kind === "FILE") &&
          !uploads.length ? (
            <AiEmpty
              title="No files yet"
              description="Add a document to make its readable text available to your helper."
            />
          ) : null}
        </div>
      </AiPanel>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setEditing(null)
            clearSourceError(skillId)
          }
        }}
      >
        <DialogContent className={MODAL} onCloseAutoFocus={focusBack}>
          <DialogHeader className="border-b border-blue-100 bg-[#f1f7ff] px-6 py-5 pr-12 text-left">
            <p className="text-xs font-semibold text-blue-700">{skill.name}</p>
            <DialogTitle>
              {editing?.source ? "Edit source" : "Add source link"}
            </DialogTitle>
            <DialogDescription>
              {editing?.source?.kind === "FILE"
                ? "Update the name shown in helper citations."
                : "Save a public page as a source for your helper."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
            noValidate
          >
            <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-5 [scrollbar-gutter:stable]">
              {error ? (
                <Alert variant="destructive" className="mb-4 rounded-xl">
                  <AlertTitle>Source was not saved</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              {sourceConflicts[skillId] && latest ? (
                <Alert className="mb-4 rounded-xl">
                  <AlertTitle>Latest saved source</AlertTitle>
                  <AlertDescription>
                    <p className="break-words [overflow-wrap:anywhere]">
                      {latest.label}
                      <br />
                      {latest.url}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className={SECONDARY_BUTTON}
                        onClick={() => {
                          setEditing(
                            (old) =>
                              old && {
                                ...old,
                                source: latest,
                                label: latest.label,
                                url: latest.url ?? "",
                              },
                          )
                          clearSourceError(skillId)
                        }}
                      >
                        Use saved source
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className={SECONDARY_BUTTON}
                        onClick={() => {
                          setEditing((old) => old && { ...old, source: latest })
                          clearSourceError(skillId)
                        }}
                      >
                        Keep my edits
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : null}
              <FieldGroup className="gap-5">
                <Field>
                  <FieldLabel htmlFor="ai-source-name">Source name</FieldLabel>
                  <Input
                    id="ai-source-name"
                    maxLength={200}
                    className={INPUT_CLASS}
                    value={editing?.label ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      setEditing(
                        (old) => old && { ...old, label: event.target.value },
                      )
                    }
                  />
                  {!editing?.source ? (
                    <FieldDescription>
                      Leave blank to use the website’s name.
                    </FieldDescription>
                  ) : null}
                </Field>
                {editing?.source?.kind !== "FILE" ? (
                  <Field data-invalid={touched && Boolean(urlError)}>
                    <FieldLabel htmlFor="ai-source-url">
                      Source URL{" "}
                      <span aria-hidden="true" className="text-rose-600">
                        *
                      </span>
                    </FieldLabel>
                    <Input
                      id="ai-source-url"
                      type="url"
                      inputMode="url"
                      maxLength={2048}
                      className={INPUT_CLASS}
                      value={editing?.url ?? ""}
                      disabled={busy}
                      aria-required="true"
                      aria-invalid={touched && Boolean(urlError)}
                      aria-describedby={
                        touched && urlError ? "ai-source-url-error" : undefined
                      }
                      onBlur={() => setTouched(true)}
                      onChange={(event) =>
                        setEditing(
                          (old) => old && { ...old, url: event.target.value },
                        )
                      }
                    />
                    {touched && urlError ? (
                      <FieldError id="ai-source-url-error">
                        {urlError}
                      </FieldError>
                    ) : null}
                    <FieldDescription>
                      Changing the URL replaces its searchable text after
                      processing.
                    </FieldDescription>
                  </Field>
                ) : null}
              </FieldGroup>
            </div>
            <DialogFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4">
              <Button
                type="button"
                variant="outline"
                className={SECONDARY_BUTTON}
                disabled={busy}
                onClick={() => {
                  setEditing(null)
                  clearSourceError(skillId)
                }}
              >
                Cancel
              </Button>
              {changed ? (
                <Button
                  type="submit"
                  className={PRIMARY_BUTTON}
                  disabled={
                    busy ||
                    Boolean(urlError) ||
                    Boolean(editing?.source && !editing.label.trim()) ||
                    sourceConflicts[skillId]
                  }
                >
                  {busy ? (
                    <Loader2
                      data-icon="inline-start"
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  {busy ? "Saving…" : "Save source"}
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
            clearSourceError(skillId)
          }
        }}
      >
        <DialogContent className={MODAL} onCloseAutoFocus={focusBack}>
          <DialogHeader className="border-b border-blue-100 bg-[#f1f7ff] px-6 py-5 pr-12 text-left">
            <DialogTitle>Remove source</DialogTitle>
            <DialogDescription>
              This source stops contributing to new helper replies immediately.
              Its stored file is also removed.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <p className="break-words text-sm text-slate-700 [overflow-wrap:anywhere]">
              {removing?.label}
            </p>
            {error ? (
              <p role="alert" className="mt-3 text-sm text-rose-700">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4">
            <Button
              variant="outline"
              className={SECONDARY_BUTTON}
              disabled={busy}
              onClick={() => {
                setRemoving(null)
                clearSourceError(skillId)
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="h-8 rounded-full px-4 text-xs"
              disabled={busy}
              onClick={async () => {
                if (
                  removing &&
                  (await changeSource(skillId, {
                    action: "delete",
                    source: removing,
                  }))
                )
                  setRemoving(null)
              }}
            >
              {busy ? "Removing…" : "Remove source"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={viewing !== null}
        onOpenChange={(open) => {
          if (!open) closeText()
        }}
      >
        <DialogContent className={MODAL} onCloseAutoFocus={focusBack}>
          <DialogHeader className="border-b border-blue-100 bg-[#f1f7ff] px-6 py-5 pr-12 text-left">
            <p className="text-xs font-semibold text-blue-700">Saved source</p>
            <DialogTitle className="break-words [overflow-wrap:anywhere]">
              {viewing?.label}
            </DialogTitle>
            <DialogDescription>
              Read-only extracted text available to your helper. Overlapping
              passages preserve context.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-5 [scrollbar-gutter:stable]">
            {text?.chunks.map((chunk) => (
              <div key={chunk.ordinal} className="mb-5 flex flex-col gap-2">
                <p className="text-xs font-medium text-slate-500">
                  {chunk.page ? `Page ${chunk.page} · ` : ""}Passage{" "}
                  {chunk.ordinal + 1}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">
                  {chunk.content}
                </p>
              </div>
            ))}
            {textBusy ? (
              <p role="status" className="text-sm text-slate-500">
                Reading saved text…
              </p>
            ) : null}
            {textError ? (
              <p role="alert" className="text-sm text-rose-700">
                {textError}
              </p>
            ) : null}
          </div>
          <DialogFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4">
            {(text?.hasMore || textError) && viewing ? (
              <Button
                variant="outline"
                className={SECONDARY_BUTTON}
                disabled={textBusy}
                onClick={() => void readText(viewing, Boolean(text))}
              >
                {textError ? "Try again" : "Load more"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              className={SECONDARY_BUTTON}
              onClick={closeText}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
