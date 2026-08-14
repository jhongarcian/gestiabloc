"use client"

import { isAxiosError } from "axios"
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Upload,
  X,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { type ChangeEvent, type ReactNode, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { uploadPrivateFileToSignedUrl } from "@/lib/supabase-storage"
import { cn } from "@/lib/utils"

type PendingUpload = {
  id: string
  file: File
}

type SaveProgress = {
  phase: "uploading" | "saving"
  completed: number
  total: number
  currentFileName: string | null
}

type CreateContactNoteDialogProps = {
  tenantId: string
  contactId: string
  trigger: ReactNode
  onCreated?: () => Promise<void> | void
  presentation?: "dialog" | "drawer"
  triggerTooltip?: string
}

const MAX_ATTACHMENTS = 10

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function inferContentType(file: File) {
  if (file.type) {
    return file.type
  }

  const extension = file.name.split(".").pop()?.toLowerCase()
  if (extension === "png") return "image/png"
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg"
  if (extension === "webp") return "image/webp"
  if (extension === "pdf") return "application/pdf"
  return ""
}

function isImageAttachment(contentType: string) {
  return contentType.startsWith("image/")
}

function attachmentIcon(contentType: string) {
  return isImageAttachment(contentType) ? ImageIcon : FileText
}

function isPdfAttachment(contentType: string) {
  return contentType === "application/pdf"
}

function attachmentTone(contentType: string) {
  if (isPdfAttachment(contentType)) {
    return {
      chip:
        "border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100",
      icon: "text-rose-600",
    }
  }

  if (isImageAttachment(contentType)) {
    return {
      chip:
        "border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100",
      icon: "text-sky-600",
    }
  }

  return {
    chip:
      "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
    icon: "text-slate-500",
  }
}

async function uploadAttachment(tenantId: string, file: File) {
  const contentType = inferContentType(file)
  if (!contentType) {
    throw new Error("UNSUPPORTED_CONTENT_TYPE")
  }

  const { data } = await api.post<{
    bucket: string
    fileId: string
    path: string
    token: string
  }>("/api/files/presign-upload", {
    tenantId,
    filename: file.name,
    contentType,
  })

  await uploadPrivateFileToSignedUrl(data, file, contentType)

  return {
    fileId: data.fileId,
    key: data.path,
    contentType,
    fileName: file.name,
    size: file.size,
  }
}

export function CreateContactNoteDialog({
  tenantId,
  contactId,
  trigger,
  onCreated,
  presentation = "dialog",
  triggerTooltip,
}: CreateContactNoteDialogProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState<SaveProgress | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{
    title?: string
    body?: string
    attachments?: string
  }>({})

  const resetDialog = () => {
    setTitle("")
    setBody("")
    setPendingUploads([])
    setFieldErrors({})
    setSaveProgress(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const handleSelectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? [])
    if (nextFiles.length === 0) return

    const totalCount = pendingUploads.length + nextFiles.length

    if (totalCount > MAX_ATTACHMENTS) {
      setFieldErrors((current) => ({
        ...current,
        attachments: `You can attach up to ${MAX_ATTACHMENTS} files.`,
      }))
      event.target.value = ""
      return
    }

    setFieldErrors((current) => ({ ...current, attachments: undefined }))
    setPendingUploads((current) => [
      ...current,
      ...nextFiles.map((file) => ({
        id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
      })),
    ])
    event.target.value = ""
  }

  const validateForm = () => {
    const nextErrors: {
      title?: string
      body?: string
      attachments?: string
    } = {}

    if (!title.trim()) {
      nextErrors.title = "Title is required."
    }

    if (!body.trim()) {
      nextErrors.body = "Note details are required."
    }

    if (pendingUploads.length > MAX_ATTACHMENTS) {
      nextErrors.attachments = `You can attach up to ${MAX_ATTACHMENTS} files.`
    }

    setFieldErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSave = async () => {
    if (!validateForm()) {
      return
    }

    setIsSaving(true)
    try {
      const uploadedFiles = []
      setSaveProgress({
        phase: pendingUploads.length > 0 ? "uploading" : "saving",
        completed: 0,
        total: pendingUploads.length,
        currentFileName: pendingUploads[0]?.file.name ?? null,
      })

      for (const [index, pendingUpload] of pendingUploads.entries()) {
        setSaveProgress({
          phase: "uploading",
          completed: index,
          total: pendingUploads.length,
          currentFileName: pendingUpload.file.name,
        })
        uploadedFiles.push(await uploadAttachment(tenantId, pendingUpload.file))
        setSaveProgress({
          phase: "uploading",
          completed: index + 1,
          total: pendingUploads.length,
          currentFileName: pendingUploads[index + 1]?.file.name ?? null,
        })
      }

      setSaveProgress({
        phase: "saving",
        completed: pendingUploads.length,
        total: pendingUploads.length,
        currentFileName: null,
      })

      await api.post(`/api/contacts/${tenantId}/${contactId}/notes`, {
        title: title.trim(),
        body: body.trim(),
        attachmentFileIds: uploadedFiles.map((attachment) => attachment.fileId),
      })

      toast.success("Note added.")
      setOpen(false)
      resetDialog()
      if (onCreated) {
        await onCreated()
      } else {
        router.refresh()
      }
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (backendError === "UNSUPPORTED_CONTENT_TYPE") {
          toast.error("Only PNG, JPG, WEBP, and PDF files are supported.")
        } else {
          toast.error("Could not save note.")
        }
      } else if (error instanceof Error && error.message === "UNSUPPORTED_CONTENT_TYPE") {
        toast.error("Only PNG, JPG, WEBP, and PDF files are supported.")
      } else {
        toast.error("Could not save note.")
      }
    } finally {
      setIsSaving(false)
      setSaveProgress(null)
    }
  }

  const isDrawer = presentation === "drawer"

  const progressPercent = saveProgress
    ? saveProgress.phase === "saving" || saveProgress.total === 0
      ? 100
      : Math.round((saveProgress.completed / saveProgress.total) * 100)
    : 0

  const content = (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-blue-700">Note details</p>
          <h3 className="text-base font-semibold text-slate-950">Capture the context</h3>
          <p className="text-sm leading-6 text-slate-600">
            Write a clear update your team can understand later.
          </p>
        </div>

        <FieldGroup className="gap-5">
          <Field
            data-invalid={Boolean(fieldErrors.title)}
            data-disabled={isSaving}
            className="gap-2"
          >
            <FieldLabel htmlFor="create-contact-note-title">
              Title <span className="text-rose-500" aria-hidden="true">*</span>
            </FieldLabel>
            <Input
              id="create-contact-note-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                setFieldErrors((current) => ({ ...current, title: undefined }))
              }}
              maxLength={160}
              placeholder="Example: Medicare paperwork pending"
              disabled={isSaving}
              aria-invalid={Boolean(fieldErrors.title)}
              className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
            />
            <div className="flex items-start justify-between gap-4">
              <FieldDescription className="text-xs">
                Use a clear internal title.
              </FieldDescription>
              <span className="shrink-0 text-xs tabular-nums text-slate-500">
                {title.length}/160
              </span>
            </div>
            <FieldError>{fieldErrors.title}</FieldError>
          </Field>

          <Field
            data-invalid={Boolean(fieldErrors.body)}
            data-disabled={isSaving}
            className="gap-2"
          >
            <FieldLabel htmlFor="create-contact-note-body">
              Note details <span className="text-rose-500" aria-hidden="true">*</span>
            </FieldLabel>
            <Textarea
              id="create-contact-note-body"
              value={body}
              onChange={(event) => {
                setBody(event.target.value)
                setFieldErrors((current) => ({ ...current, body: undefined }))
              }}
              maxLength={5000}
              placeholder="Add the context the team should know about this contact..."
              className="min-h-40 resize-y rounded-xl border-slate-200 bg-slate-50/60 px-4 py-3 leading-6 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
              disabled={isSaving}
              aria-invalid={Boolean(fieldErrors.body)}
            />
            <div className="flex items-start justify-between gap-4">
              <FieldDescription className="text-xs">
                Include important details or follow-up context.
              </FieldDescription>
              <span className="shrink-0 text-xs tabular-nums text-slate-500">
                {body.length}/5000
              </span>
            </div>
            <FieldError>{fieldErrors.body}</FieldError>
          </Field>
        </FieldGroup>
      </section>

      <section className="flex flex-col gap-4 border-t border-slate-200 pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold text-blue-700">Attachments</p>
            <h3 className="text-base font-semibold text-slate-950">
              Add supporting files
            </h3>
            <p className="text-sm leading-6 text-slate-600">
              Add up to {MAX_ATTACHMENTS} PNG, JPG, WEBP, or PDF files.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSaving}
            className="cursor-pointer border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            <Upload data-icon="inline-start" />
            Add files
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
          multiple
          className="hidden"
          onChange={handleSelectFiles}
          disabled={isSaving}
        />

        <Field
          data-invalid={Boolean(fieldErrors.attachments)}
          data-disabled={isSaving}
          className="gap-3"
        >
          <FieldError>{fieldErrors.attachments}</FieldError>

          {isSaving && saveProgress ? (
            <div
              className="flex flex-col gap-3 rounded-2xl border border-blue-200 bg-white p-4 shadow-sm"
              aria-live="polite"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-2.5">
                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-blue-800" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-sm font-semibold text-slate-900">
                      {saveProgress.phase === "uploading"
                        ? `Uploading ${Math.min(
                            saveProgress.completed + 1,
                            saveProgress.total,
                          )} of ${saveProgress.total}`
                        : "Saving the note"}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {saveProgress.currentFileName ?? "Finishing your changes..."}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-blue-900">
                  {progressPercent}%
                </span>
              </div>
              <Progress
                value={progressPercent}
                aria-label="Attachment upload progress"
                className="bg-blue-100 [&_[data-slot=progress-indicator]]:bg-blue-950"
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            {pendingUploads.map((attachment, index) => {
              const contentType = inferContentType(attachment.file)
              const AttachmentIcon = attachmentIcon(contentType)
              const tone = attachmentTone(contentType)
              const isComplete = Boolean(
                saveProgress &&
                  (saveProgress.phase === "saving" || index < saveProgress.completed),
              )
              const isUploading = Boolean(
                saveProgress?.phase === "uploading" &&
                  index === saveProgress.completed &&
                  saveProgress.currentFileName === attachment.file.name,
              )
              const stateLabel = isComplete
                ? "Upload complete"
                : isUploading
                  ? "Uploading now"
                  : "Ready to upload"

              return (
                <div
                  key={attachment.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-3",
                    tone.chip,
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/80">
                      <AttachmentIcon className={cn("size-4", tone.icon)} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {attachment.file.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatFileSize(attachment.file.size)} · {stateLabel}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      setPendingUploads((current) =>
                        current.filter((item) => item.id !== attachment.id),
                      )
                    }
                    disabled={isSaving}
                    className="cursor-pointer text-slate-400 hover:bg-white hover:text-rose-600"
                    aria-label={`Remove ${attachment.file.name}`}
                  >
                    <X />
                  </Button>
                </div>
              )
            })}

            {pendingUploads.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-7 text-center">
                <span className="mx-auto inline-flex size-10 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">
                  <Paperclip className="size-4" />
                </span>
                <p className="mt-3 text-sm font-medium text-slate-700">
                  No files attached
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Supporting files are optional.
                </p>
              </div>
            ) : null}
          </div>
        </Field>
      </section>
    </div>
  )

  if (isDrawer) {
    return (
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && isSaving) return
          setOpen(nextOpen)
          if (!nextOpen) resetDialog()
        }}
      >
        {triggerTooltip ? (
          <TooltipProvider delayDuration={120}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SheetTrigger asChild>{trigger}</SheetTrigger>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                {triggerTooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <SheetTrigger asChild>{trigger}</SheetTrigger>
        )}
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-white p-0 sm:max-w-2xl [&>button]:right-5 [&>button]:top-5 [&>button]:cursor-pointer [&>button]:rounded-full [&>button]:bg-white/80 [&>button]:opacity-100 [&>button]:shadow-sm [&>button]:backdrop-blur"
        >
          <SheetHeader className="relative overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left sm:px-7">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-12 -bottom-20 size-48 rounded-full bg-blue-300/30 blur-3xl"
            />
            <div className="relative pr-10">
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="text-xs font-semibold text-blue-700">Contact activity</p>
                <SheetTitle className="text-xl font-semibold text-slate-950 sm:text-2xl">
                  Add note
                </SheetTitle>
                <SheetDescription className="max-w-xl text-sm leading-6 text-slate-600">
                  Capture the context your team needs and keep supporting files with the contact.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
            {content}
          </div>
          <SheetFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:flex-row sm:justify-end sm:px-7">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false)
                resetDialog()
              }}
              disabled={isSaving}
              className="cursor-pointer border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="min-w-32 cursor-pointer bg-blue-950 text-white shadow-sm hover:bg-blue-900"
            >
              {isSaving ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : null}
              {isSaving
                ? saveProgress?.phase === "uploading"
                  ? "Uploading..."
                  : "Saving..."
                : "Save note"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isSaving) return
        setOpen(nextOpen)
        if (!nextOpen) resetDialog()
      }}
    >
      {triggerTooltip ? (
        <TooltipProvider delayDuration={120}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>{trigger}</DialogTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}>
              {triggerTooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add note</DialogTitle>
          <DialogDescription>
            Add a title, note body, and any supporting files for this contact.
          </DialogDescription>
        </DialogHeader>
        {content}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isSaving}
            className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
