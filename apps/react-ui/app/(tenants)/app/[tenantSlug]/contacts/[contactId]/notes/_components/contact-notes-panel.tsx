"use client"
import Link from "next/link"
import { isAxiosError } from "axios"
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  StickyNote,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

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
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { uploadPrivateFileToSignedUrl } from "@/lib/supabase-storage"
import { cn } from "@/lib/utils"

type NoteAttachment = {
  id: string
  fileId: string
  key: string
  fileName: string
  contentType: string
  size: number | null
}

type ContactNote = {
  id: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
  author: {
    id: string
    name: string
    email: string
  }
  permissions: {
    canEdit: boolean
    canDelete: boolean
  }
  source: {
    type: "CONTACT" | "SERVICE"
    contactServiceId?: string
    serviceName?: string
    followUpTemplateName?: string
    followUpStepTitle?: string
  }
  attachments: NoteAttachment[]
}

type ContactNotesPanelProps = {
  tenantId: string
  tenantSlug: string
  contactId: string
  currentUserRole: string
  initialData: {
    items: ContactNote[]
    pagination: {
      page: number
      pageSize: number
      total: number
      totalPages: number
    }
  }
}

type PendingUpload = {
  id: string
  file: File
}

type NoteDialogMode = "create" | "edit"
type NoteSort = "updated-desc" | "updated-asc" | "created-desc"
type NoteSaveProgress = {
  phase: "uploading" | "saving"
  completed: number
  total: number
  currentFileName: string | null
}
type NoteResponse = {
  ok: boolean
  items: ContactNote[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

const MAX_ATTACHMENTS = 10
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Unknown"

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function formatFileSize(value: number | null | undefined) {
  if (!value || value < 1) return "Size unavailable"
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
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

export function ContactNotesPanel({
  tenantId,
  tenantSlug,
  contactId,
  initialData,
}: ContactNotesPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [data, setData] = useState(initialData)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<NoteDialogMode>("create")
  const [activeNote, setActiveNote] = useState<ContactNote | null>(null)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [existingAttachments, setExistingAttachments] = useState<NoteAttachment[]>([])
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState<NoteSaveProgress | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isDeletingNoteId, setIsDeletingNoteId] = useState<string | null>(null)
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null)
  const [previewAttachment, setPreviewAttachment] = useState<NoteAttachment | null>(
    null,
  )
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [sortOrder, setSortOrder] = useState<NoteSort>("updated-desc")
  const [page, setPage] = useState(initialData.pagination.page)
  const [pageSize, setPageSize] = useState<
    (typeof PAGE_SIZE_OPTIONS)[number]
  >(
    PAGE_SIZE_OPTIONS.includes(
      initialData.pagination.pageSize as (typeof PAGE_SIZE_OPTIONS)[number],
    )
      ? (initialData.pagination.pageSize as (typeof PAGE_SIZE_OPTIONS)[number])
      : 10,
  )
  const [fieldErrors, setFieldErrors] = useState<{
    title?: string
    body?: string
    attachments?: string
  }>({})
  const notes = data.items
  const pagination = data.pagination
  const activeNoteCanEdit =
    dialogMode === "create" || Boolean(activeNote?.permissions.canEdit)
  const activeNoteCanDelete =
    dialogMode === "edit" && Boolean(activeNote?.permissions.canDelete)
  const saveProgressPercent =
    saveProgress?.phase === "saving"
      ? 100
      : saveProgress && saveProgress.total > 0
        ? Math.max(
            8,
            Math.round((saveProgress.completed / saveProgress.total) * 100),
          )
        : 0

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim())
      setPage(1)
    }, 350)

    return () => window.clearTimeout(timeout)
  }, [searchQuery])

  const loadNotes = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data: response } = await api.get<NoteResponse>(
        `/api/contacts/${tenantId}/${contactId}/notes`,
        {
          params: {
            page,
            pageSize,
            q: debouncedQuery || undefined,
            sort: sortOrder.replace("-", "_"),
          },
        },
      )
      setData({
        items: response.items,
        pagination: response.pagination,
      })
    } catch {
      toast.error("Could not load notes.")
    } finally {
      setIsLoading(false)
    }
  }, [contactId, debouncedQuery, page, pageSize, sortOrder, tenantId])

  useEffect(() => {
    if (
      page === initialData.pagination.page &&
      pageSize === initialData.pagination.pageSize &&
      debouncedQuery === "" &&
      sortOrder === "updated-desc"
    ) {
      return
    }

    void loadNotes()
  }, [
    debouncedQuery,
    initialData.pagination.page,
    initialData.pagination.pageSize,
    loadNotes,
    page,
    pageSize,
    sortOrder,
  ])

  const resetDialog = () => {
    setDialogMode("create")
    setActiveNote(null)
    setTitle("")
    setBody("")
    setExistingAttachments([])
    setPendingUploads([])
    setSaveProgress(null)
    setFieldErrors({})
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const openCreateDialog = () => {
    resetDialog()
    setDialogMode("create")
    setDialogOpen(true)
  }

  const openEditDialog = (note: ContactNote) => {
    resetDialog()
    setDialogMode("edit")
    setActiveNote(note)
    setTitle(note.title)
    setBody(note.body)
    setExistingAttachments(note.attachments)
    setDialogOpen(true)
  }

  const handleSelectFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? [])
    if (nextFiles.length === 0) return

    const totalCount =
      existingAttachments.length + pendingUploads.length + nextFiles.length

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
    if (existingAttachments.length + pendingUploads.length > MAX_ATTACHMENTS) {
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
    setSaveProgress(
      pendingUploads.length > 0
        ? {
            phase: "uploading",
            completed: 0,
            total: pendingUploads.length,
            currentFileName: pendingUploads[0]?.file.name ?? null,
          }
        : {
            phase: "saving",
            completed: 0,
            total: 0,
            currentFileName: null,
          },
    )
    try {
      const uploadedFiles = []
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
          currentFileName:
            pendingUploads[index + 1]?.file.name ?? pendingUpload.file.name,
        })
      }

      setSaveProgress({
        phase: "saving",
        completed: pendingUploads.length,
        total: pendingUploads.length,
        currentFileName: null,
      })

      const attachmentFileIds = [
        ...existingAttachments.map((attachment) => attachment.fileId),
        ...uploadedFiles.map((attachment) => attachment.fileId),
      ]

      if (dialogMode === "create") {
        await api.post<{ ok: boolean; note: ContactNote }>(
          `/api/contacts/${tenantId}/${contactId}/notes`,
          {
            title: title.trim(),
            body: body.trim(),
            attachmentFileIds,
          },
        )

        toast.success("Note added.")
      } else if (activeNote) {
        await api.patch<{ ok: boolean; note: ContactNote }>(
          `/api/contacts/${tenantId}/${contactId}/notes/${activeNote.id}`,
          {
            title: title.trim(),
            body: body.trim(),
            attachmentFileIds,
          },
        )

        toast.success("Note updated.")
      }

      if (page !== 1) {
        setPage(1)
      } else {
        await loadNotes()
      }
      setDialogOpen(false)
      resetDialog()
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
      } else if (error instanceof Error && error.message === "FILE_TOO_LARGE") {
        toast.error("Images must be 5 MB or less and PDFs must be 20 MB or less.")
      } else {
        toast.error("Could not save note.")
      }
    } finally {
      setIsSaving(false)
      setSaveProgress(null)
    }
  }

  const handleDelete = async (note: ContactNote) => {
    setIsDeletingNoteId(note.id)
    try {
      await api.delete(`/api/contacts/${tenantId}/${contactId}/notes/${note.id}`)
      toast.success("Note deleted.")
      if (notes.length === 1 && page > 1) {
        setPage(page - 1)
      } else {
        await loadNotes()
      }
    } catch {
      toast.error("Could not delete note.")
    } finally {
      setIsDeletingNoteId(null)
    }
  }

  const handlePreviewAttachment = async (attachment: NoteAttachment) => {
    setDownloadingKey(attachment.key)
    setPreviewAttachment(attachment)
    setPreviewUrl(null)
    setPreviewError(null)
    try {
      const { data } = await api.post<{ url: string }>("/api/files/presign-download", {
        tenantId,
        key: attachment.key,
      })

      setPreviewUrl(data.url)
    } catch {
      setPreviewError("Could not load attachment preview.")
    } finally {
      setDownloadingKey(null)
    }
  }

  return (
    <>
      <section className="flex min-h-full flex-1 flex-col gap-4">
        <div className="flex min-h-[calc(100vh-18rem)] flex-1 flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 sm:p-4">
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <Label htmlFor="contact-notes-search" className="sr-only">
                Search notes
              </Label>
              <Input
                id="contact-notes-search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search title, note details, author, or attachment"
                className="w-full lg:max-w-xl"
              />
            </div>

            <div className="flex items-center gap-3">
              <Select
                value={sortOrder}
                onValueChange={(value) => setSortOrder(value as NoteSort)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updated-desc">Recently updated</SelectItem>
                  <SelectItem value="created-desc">Newest created</SelectItem>
                  <SelectItem value="updated-asc">Oldest updated</SelectItem>
                </SelectContent>
              </Select>
              <Button
                onClick={openCreateDialog}
                className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
              >
                Add note
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="px-4 py-16 text-center text-sm text-slate-500">
              Loading notes...
            </div>
          ) : notes.length > 0 ? (
            <div className="flex flex-1 flex-col">
              <div className="divide-y divide-slate-100">
              {notes.map((note) => (
                <article
                  key={note.id}
                  className="relative grid gap-3 px-3 py-4 transition-colors hover:bg-slate-50/70 lg:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="relative flex items-start gap-2.5">
                      <span className="absolute bottom-0 left-4 top-8 hidden w-px -translate-x-1/2 rounded-full bg-slate-200 lg:block" />
                      <span className="relative z-10 mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                        <StickyNote className="h-3.5 w-3.5" />
                      </span>

                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                              <span className="inline-flex items-center gap-1.5">
                                <UserRound className="h-3 w-3" />
                                <span className="font-medium text-slate-700">
                                  {note.author.name}
                                </span>
                              </span>
                              <span className="inline-flex items-center gap-1.5">
                                <CalendarDays className="h-3 w-3" />
                                {formatDateTime(note.createdAt)}
                              </span>
                              {note.updatedAt !== note.createdAt ? (
                                <span className="inline-flex items-center gap-1.5 text-amber-700">
                                  <Clock3 className="h-3 w-3" />
                                  Edited {formatDateTime(note.updatedAt)}
                                </span>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                              {note.source.type === "SERVICE" ? (
                                <>
                                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">
                                    {note.source.followUpTemplateName || note.source.followUpStepTitle
                                      ? "follow-up note"
                                      : "service note"}
                                  </span>
                                  {note.source.contactServiceId && note.source.serviceName ? (
                                    <Link
                                      href={`/app/${tenantSlug}/contacts/${contactId}/services/${note.source.contactServiceId}`}
                                      className="text-blue-700 transition hover:text-blue-800 hover:underline"
                                    >
                                      Service: {note.source.serviceName}
                                    </Link>
                                  ) : note.source.serviceName ? (
                                    <span>
                                      Service:{" "}
                                      <span className="font-medium text-slate-700">
                                        {note.source.serviceName}
                                      </span>
                                    </span>
                                  ) : null}
                                  {note.source.followUpTemplateName ? (
                                    <span>
                                      Template:{" "}
                                      <span className="font-medium text-slate-700">
                                        {note.source.followUpTemplateName}
                                      </span>
                                    </span>
                                  ) : null}
                                  {note.source.followUpStepTitle ? (
                                    <span>
                                      Step:{" "}
                                      <span className="font-medium text-slate-700">
                                        {note.source.followUpStepTitle}
                                      </span>
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">
                                  contact note
                                </span>
                              )}
                            </div>

                          </div>

                        </div>

                        <div className="rounded-2xl bg-slate-50/80 px-3 py-2.5">
                          {note.permissions.canEdit ? (
                            <button
                              type="button"
                              onClick={() => openEditDialog(note)}
                              className="block w-full cursor-pointer text-left"
                            >
                              <h2 className="truncate text-sm font-semibold tracking-tight text-slate-950 underline-offset-4 transition hover:text-blue-950 hover:underline">
                                {note.title}
                              </h2>
                            </button>
                          ) : (
                            <h2 className="truncate text-sm font-semibold tracking-tight text-slate-950">
                              {note.title}
                            </h2>
                          )}
                          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[13px] leading-5 text-slate-700">
                            {note.body}
                          </p>
                        </div>

                        {note.attachments.length > 0 ? (
                          <div className="flex flex-wrap gap-2 border-t border-dashed border-slate-200 pt-2">
                            {note.attachments.map((attachment) => {
                              const AttachmentIcon = attachmentIcon(
                                attachment.contentType,
                              )
                              const tone = attachmentTone(attachment.contentType)

                              return (
                                <button
                                  key={attachment.id}
                                  type="button"
                                  onClick={() =>
                                    void handlePreviewAttachment(attachment)
                                  }
                                  disabled={downloadingKey === attachment.key}
                                  className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-60 ${tone.chip}`}
                                >
                                  {downloadingKey === attachment.key ? (
                                    <Loader2 className="h-3 w-3 animate-spin text-slate-500" />
                                  ) : (
                                    <AttachmentIcon className={`h-3 w-3 ${tone.icon}`} />
                                  )}
                                  <span className="truncate">
                                    {attachment.fileName}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
              </div>

              <div className="mt-auto flex flex-col gap-3 border-t border-slate-100 px-2 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm text-slate-500">
                    Showing{" "}
                    <span className="font-semibold text-slate-950">
                      {notes.length}
                    </span>{" "}
                    of{" "}
                    <span className="font-semibold text-slate-950">
                      {pagination.total}
                    </span>
                  </p>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(value) => {
                      setPageSize(
                        Number(value) as (typeof PAGE_SIZE_OPTIONS)[number],
                      )
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className="w-[110px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {option} / page
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <p className="mr-2 text-sm text-slate-500">
                    Page{" "}
                    <span className="font-semibold text-slate-900">
                      {pagination.page}
                    </span>{" "}
                    of{" "}
                    <span className="font-semibold text-slate-900">
                      {pagination.totalPages}
                    </span>
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pagination.page <= 1 || isLoading}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      pagination.page >= pagination.totalPages || isLoading
                    }
                    onClick={() =>
                      setPage((current) =>
                        Math.min(pagination.totalPages, current + 1),
                      )
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
              <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <StickyNote className="h-5 w-5" />
              </span>
              <h2 className="mt-4 text-lg font-semibold text-slate-950">
                {pagination.total === 0 && !debouncedQuery.trim()
                  ? "No notes yet"
                  : "No matching notes"}
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {pagination.total === 0
                  ? "Add the first note to keep important context and attachments with this contact."
                  : "Try a different keyword or clear the search to see more notes."}
              </p>
              {pagination.total === 0 ? (
                <Button
                  onClick={openCreateDialog}
                  className="mt-5 cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
                >
                  Add first note
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && isSaving) return
          setDialogOpen(nextOpen)
          if (!nextOpen) {
            resetDialog()
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[28px] border-slate-200 bg-white p-0 shadow-2xl sm:max-w-3xl [&>button]:right-5 [&>button]:top-5 [&>button]:cursor-pointer [&>button]:rounded-full [&>button]:bg-white/80 [&>button]:opacity-100 [&>button]:shadow-sm [&>button]:backdrop-blur">
          <DialogHeader className="relative overflow-hidden border-b border-blue-100 bg-[#f1f7ff] px-6 py-6 text-left sm:px-7">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(30,64,175,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,.08)_1px,transparent_1px)] [background-size:42px_42px]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-12 -bottom-20 size-48 rounded-full bg-blue-300/30 blur-3xl"
            />
            <div className="relative pr-10">
              <div className="flex max-w-2xl min-w-0 flex-col gap-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-700">
                  Contact activity
                </p>
                <DialogTitle className="text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
                  {dialogMode === "create" ? "Create a note" : "Edit note"}
                </DialogTitle>
                <DialogDescription className="max-w-xl text-sm leading-6 text-slate-600">
                  Capture the context your team needs and keep supporting files with the contact.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
            <div className="flex flex-col gap-7">
              <FieldGroup className="gap-5">
                <Field
                  data-invalid={Boolean(fieldErrors.title)}
                  data-disabled={!activeNoteCanEdit || isSaving}
                  className="gap-2"
                >
                  <FieldLabel htmlFor="contact-note-title" className="text-slate-800">
                    Note title
                  </FieldLabel>
                  <Input
                    id="contact-note-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={160}
                    placeholder="Example: Medicare paperwork pending"
                    disabled={!activeNoteCanEdit || isSaving}
                    aria-invalid={Boolean(fieldErrors.title)}
                    className="h-11 rounded-xl border-slate-200 bg-slate-50/60 px-4 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                  />
                  <FieldDescription className="flex items-start justify-between gap-4 text-xs">
                    <span>Make it easy to recognize in the activity timeline.</span>
                    <span className="shrink-0 tabular-nums">{title.length}/160</span>
                  </FieldDescription>
                  <FieldError>{fieldErrors.title}</FieldError>
                </Field>

                <Field
                  data-invalid={Boolean(fieldErrors.body)}
                  data-disabled={!activeNoteCanEdit || isSaving}
                  className="gap-2"
                >
                  <FieldLabel htmlFor="contact-note-body" className="text-slate-800">
                    Note details
                  </FieldLabel>
                  <Textarea
                    id="contact-note-body"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    maxLength={5000}
                    placeholder="Add the context, decisions, and follow-up details the team should know..."
                    className="min-h-40 resize-y rounded-xl border-slate-200 bg-slate-50/60 px-4 py-3 leading-6 shadow-none focus-visible:border-blue-400 focus-visible:ring-blue-100"
                    disabled={!activeNoteCanEdit || isSaving}
                    aria-invalid={Boolean(fieldErrors.body)}
                  />
                  <FieldDescription className="flex items-start justify-between gap-4 text-xs">
                    <span>Include useful context and any next steps.</span>
                    <span className="shrink-0 tabular-nums">{body.length}/5000</span>
                  </FieldDescription>
                  <FieldError>{fieldErrors.body}</FieldError>
                </Field>
              </FieldGroup>

              <section className="flex flex-col gap-4 rounded-[22px] border border-blue-100 bg-[#f1f7ff] p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-white text-blue-800 shadow-sm">
                      <Paperclip className="size-4" aria-hidden="true" />
                    </span>
                    <div className="flex flex-col gap-1">
                      <h3 className="text-sm font-semibold text-slate-950">
                        Supporting files
                      </h3>
                      <p className="text-xs leading-5 text-slate-600">
                        PNG, JPG, or WEBP up to 5 MB; PDF up to 20 MB.
                      </p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!activeNoteCanEdit || isSaving}
                    className="self-start rounded-xl border-blue-200 bg-white text-blue-950 shadow-sm hover:bg-blue-50 sm:self-center"
                  >
                    <Upload data-icon="inline-start" />
                    {existingAttachments.length + pendingUploads.length > 0
                      ? "Add more"
                      : "Choose files"}
                  </Button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
                  multiple
                  className="hidden"
                  onChange={handleSelectFiles}
                  disabled={!activeNoteCanEdit || isSaving}
                />

                {fieldErrors.attachments ? (
                  <p role="alert" className="text-sm text-rose-700">
                    {fieldErrors.attachments}
                  </p>
                ) : null}

                <div className="flex flex-col gap-2.5">
                  {existingAttachments.map((attachment) => {
                    const AttachmentIcon = attachmentIcon(attachment.contentType)
                    const tone = attachmentTone(attachment.contentType)

                    return (
                      <div
                        key={attachment.id}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-white px-3 py-3 shadow-sm"
                      >
                        <div className="min-w-0 flex items-center gap-3">
                          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-50">
                            <AttachmentIcon className={cn("size-4", tone.icon)} />
                          </span>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {attachment.fileName}
                            </p>
                            <p className="text-xs text-slate-500">
                              Saved attachment · {formatFileSize(attachment.size)}
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() =>
                            setExistingAttachments((current) =>
                              current.filter((item) => item.id !== attachment.id),
                            )
                          }
                          disabled={!activeNoteCanEdit || isSaving}
                          className="rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          aria-label={`Remove ${attachment.fileName}`}
                        >
                          <X />
                        </Button>
                      </div>
                    )
                  })}

                  {pendingUploads.map((attachment, index) => {
                    const contentType = inferContentType(attachment.file)
                    const AttachmentIcon = attachmentIcon(contentType)
                    const tone = attachmentTone(contentType)
                    const isUploaded =
                      isSaving &&
                      saveProgress !== null &&
                      (saveProgress.phase === "saving" ||
                        index < saveProgress.completed)
                    const isUploading =
                      isSaving &&
                      saveProgress?.phase === "uploading" &&
                      index === saveProgress.completed

                    return (
                      <div
                        key={attachment.id}
                        className={cn(
                          "flex items-center justify-between gap-3 rounded-2xl border bg-white px-3 py-3 transition shadow-sm",
                          isUploading ? "border-blue-300 ring-2 ring-blue-100" : "border-blue-100",
                        )}
                      >
                        <div className="min-w-0 flex items-center gap-3">
                          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-50">
                            {isUploaded ? (
                              <CheckCircle2 className="size-4 text-blue-700" />
                            ) : isUploading ? (
                              <Loader2 className="size-4 animate-spin text-blue-700" />
                            ) : (
                              <AttachmentIcon className={cn("size-4", tone.icon)} />
                            )}
                          </span>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {attachment.file.name}
                            </p>
                            <p
                              className={cn(
                                "text-xs",
                                isUploading || isUploaded
                                  ? "font-medium text-blue-700"
                                  : "text-slate-500",
                              )}
                            >
                              {isUploaded
                                ? "Upload complete"
                                : isUploading
                                  ? "Uploading now"
                                  : `Ready to upload · ${formatFileSize(attachment.file.size)}`}
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
                          disabled={!activeNoteCanEdit || isSaving}
                          className="rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          aria-label={`Remove ${attachment.file.name}`}
                        >
                          <X />
                        </Button>
                      </div>
                    )
                  })}

                  {existingAttachments.length === 0 && pendingUploads.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!activeNoteCanEdit || isSaving}
                      className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-blue-200 bg-white/70 px-4 py-6 text-center transition hover:border-blue-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:pointer-events-none disabled:opacity-60"
                    >
                      <span className="inline-flex size-10 items-center justify-center rounded-full bg-blue-50 text-blue-800">
                        <Upload className="size-4" aria-hidden="true" />
                      </span>
                      <span className="text-sm font-medium text-slate-800">
                        Add an image or document
                      </span>
                      <span className="text-xs text-slate-500">
                        Up to {MAX_ATTACHMENTS} supporting files
                      </span>
                    </button>
                  ) : null}
                </div>

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
                              ? `Uploading ${Math.min(saveProgress.completed + 1, saveProgress.total)} of ${saveProgress.total}`
                              : "Finishing your note"}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {saveProgress.phase === "uploading"
                              ? saveProgress.currentFileName
                              : saveProgress.total > 0
                                ? "Files are ready. Saving the note to this contact..."
                                : "Saving the note to this contact..."}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-blue-900">
                        {saveProgressPercent}%
                      </span>
                    </div>
                    <Progress
                      value={saveProgressPercent}
                      aria-label="Note upload progress"
                      className="h-2 bg-blue-100 [&_[data-slot=progress-indicator]]:bg-blue-950"
                    />
                  </div>
                ) : null}
              </section>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:items-center sm:px-7">
            {activeNoteCanDelete && activeNote ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleDelete(activeNote)}
                disabled={isSaving || isDeletingNoteId === activeNote.id}
                className="border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:mr-auto"
              >
                {isDeletingNoteId === activeNote.id ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Trash2 data-icon="inline-start" />
                )}
                Delete
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isSaving}
              className="border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || !activeNoteCanEdit}
              className="min-w-32 bg-blue-950 text-white shadow-sm hover:bg-blue-900"
            >
              {isSaving ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <StickyNote data-icon="inline-start" />
              )}
              {isSaving
                ? saveProgress?.phase === "uploading"
                  ? "Uploading..."
                  : "Saving..."
                : dialogMode === "create"
                  ? "Save note"
                  : "Update note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={previewAttachment !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPreviewAttachment(null)
            setPreviewUrl(null)
            setPreviewError(null)
          }
        }}
      >
        <DialogContent className="h-[94vh] w-[96vw] max-w-[96vw] overflow-hidden p-0 sm:max-w-[96vw] [&>button]:right-4 [&>button]:top-4 [&>button]:flex [&>button]:h-9 [&>button]:w-9 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-full [&>button]:border [&>button]:border-blue-900 [&>button]:bg-blue-950 [&>button]:p-0 [&>button]:text-white [&>button]:opacity-100 [&>button]:shadow-sm [&>button]:transition [&>button]:cursor-pointer [&>button:hover]:border-blue-950 [&>button:hover]:bg-blue-900 [&>button:focus-visible]:ring-2 [&>button:focus-visible]:ring-blue-200 [&>button_svg]:h-3.5 [&>button_svg]:w-3.5 [&>button_svg]:shrink-0 [&>button_svg]:text-white">
          <div className="flex h-full max-h-[94vh] flex-col bg-slate-50">
            <DialogHeader className="border-b border-slate-200 bg-white px-6 py-4 text-left">
              <div className="flex items-start justify-between gap-4 pr-10">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle className="truncate text-base font-semibold text-slate-950">
                      {previewAttachment?.fileName ?? "Attachment preview"}
                    </DialogTitle>
                    {previewAttachment ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${attachmentTone(previewAttachment.contentType).chip}`}
                      >
                        {isPdfAttachment(previewAttachment.contentType)
                          ? "PDF"
                          : isImageAttachment(previewAttachment.contentType)
                            ? "Image"
                            : "File"}
                      </span>
                    ) : null}
                  </div>

                  {previewAttachment &&
                  !isPdfAttachment(previewAttachment.contentType) ? (
                    <DialogDescription className="text-sm text-slate-500">
                      {isImageAttachment(previewAttachment.contentType)
                        ? "Preview the selected image without leaving this page."
                        : "Preview is limited for this file type. You can still download it."}
                    </DialogDescription>
                  ) : null}
                </div>

                {previewUrl ? (
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      download={previewAttachment?.fileName}
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </a>
                  </Button>
                ) : null}
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1">
              {previewAttachment && downloadingKey === previewAttachment.key ? (
                <div className="flex h-full min-h-[420px] items-center justify-center">
                  <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading preview...
                    </span>
                  </div>
                </div>
              ) : previewError ? (
                <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-4 px-6 text-center">
                  <div className="space-y-2 rounded-2xl border border-rose-200 bg-white px-6 py-5 shadow-sm">
                    <p className="text-sm font-medium text-rose-700">
                      {previewError}
                    </p>
                    <p className="text-sm text-slate-500">
                      Try downloading the file instead.
                    </p>
                  </div>
                </div>
              ) : previewAttachment && previewUrl ? (
                isImageAttachment(previewAttachment.contentType) ? (
                  <div className="flex h-full min-h-[420px] items-center justify-center p-8">
                    {/* eslint-disable-next-line @next/next/no-img-element -- Presigned file URLs are rendered directly instead of next/image. */}
                    <img
                      src={previewUrl}
                      alt={previewAttachment.fileName}
                      className="max-h-full max-w-full rounded-2xl border border-slate-200 bg-white object-contain shadow-sm"
                    />
                  </div>
                ) : isPdfAttachment(previewAttachment.contentType) ? (
                  <div className="h-full bg-slate-200/70 p-3">
                    <iframe
                      src={previewUrl}
                      title={previewAttachment.fileName}
                      className="h-full min-h-0 w-full rounded-xl border border-slate-200 bg-white shadow-sm"
                    />
                  </div>
                ) : (
                  <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-4 px-6 text-center">
                    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
                      <FileText className="mx-auto h-10 w-10 text-slate-400" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-slate-900">
                          Preview is not available for this file type.
                        </p>
                        <p className="text-sm text-slate-500">
                          Use the download action to open it in your preferred app.
                        </p>
                      </div>
                    </div>
                  </div>
                )
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
