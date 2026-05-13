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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { api } from "@/lib/api"
import { uploadPrivateFileToSignedUrl } from "@/lib/supabase-storage"

type PendingUpload = {
  id: string
  file: File
}

type CreateContactNoteDialogProps = {
  tenantId: string
  contactId: string
  trigger: ReactNode
  onCreated?: () => Promise<void> | void
  presentation?: "dialog" | "drawer"
}

const MAX_ATTACHMENTS = 10

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
}: CreateContactNoteDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [isSaving, setIsSaving] = useState(false)
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
      nextErrors.body = "Body is required."
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
      for (const pendingUpload of pendingUploads) {
        uploadedFiles.push(await uploadAttachment(tenantId, pendingUpload.file))
      }

      await api.post(`/api/contacts/${tenantId}/${contactId}/notes`, {
        title: title.trim(),
        body: body.trim(),
        attachmentFileIds: uploadedFiles.map((attachment) => attachment.fileId),
      })

      toast.success("Note added.")
      setOpen(false)
      resetDialog()
      await onCreated?.()
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
    }
  }

  const isDrawer = presentation === "drawer"

  const content = (
    <div className="space-y-6">
      <section className="space-y-5">
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="create-contact-note-title">Title</Label>
            <Input
              id="create-contact-note-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              placeholder="Example: Medicare paperwork pending"
              disabled={isSaving}
            />
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{fieldErrors.title ?? "Use a clear internal title."}</span>
              <span>{title.length}/160</span>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="create-contact-note-body">Body</Label>
            <Textarea
              id="create-contact-note-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={5000}
              placeholder="Add the context the team should know about this contact..."
              className="min-h-[180px]"
              disabled={isSaving}
            />
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{fieldErrors.body ?? "Include the important details or follow-up context."}</span>
              <span>{body.length}/5000</span>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4 border-t border-slate-100 pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Attachments
            </p>
            <h3 className="mt-1 text-base font-semibold text-slate-950">
              Images and documents
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Supported files: PNG, JPG, WEBP, and PDF.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSaving}
            className="cursor-pointer border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            <Upload className="h-4 w-4" />
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

        {fieldErrors.attachments ? (
          <p className="mt-3 text-sm text-rose-600">{fieldErrors.attachments}</p>
        ) : null}

        <div className="mt-4 space-y-3">
          {pendingUploads.map((attachment) => {
            const contentType = inferContentType(attachment.file)
            const AttachmentIcon = attachmentIcon(contentType)
            const tone = attachmentTone(contentType)

            return (
              <div
                key={attachment.id}
                className={`flex items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-3 ${tone.chip}`}
              >
                <div className="min-w-0 flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/80">
                    <AttachmentIcon className={`h-4 w-4 ${tone.icon}`} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {attachment.file.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      Will upload when you save
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setPendingUploads((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    )
                  }
                  disabled={isSaving}
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-slate-400 transition hover:bg-white hover:text-rose-600"
                  aria-label={`Remove ${attachment.file.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )
          })}

          {pendingUploads.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
              <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-500">
                <Paperclip className="h-4 w-4" />
              </span>
              <p className="mt-3 text-sm font-medium text-slate-700">
                No files attached yet
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Attach images or PDFs if this note needs supporting files.
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )

  if (isDrawer) {
    return (
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen && !isSaving) {
            resetDialog()
          }
        }}
      >
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="right" className="flex h-full flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-slate-200 bg-slate-50 px-6 text-left">
            <SheetTitle className="text-xl font-semibold text-slate-950">Add note</SheetTitle>
            <SheetDescription>
              Add a title, note body, and any supporting files for this contact.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">{content}</div>
          <SheetFooter className="border-t border-slate-200 bg-white px-6 py-4 sm:flex-row sm:justify-end">
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
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen && !isSaving) {
          resetDialog()
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
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
