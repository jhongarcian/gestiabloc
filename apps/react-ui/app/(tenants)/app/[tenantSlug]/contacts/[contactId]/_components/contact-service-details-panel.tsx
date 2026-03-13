"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleCheckBig,
  CircleDashed,
  Clock3,
  CreditCard,
  Loader2,
  NotebookPen,
  Plus,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type ContactServiceStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELED"

type ContactServiceDetails = {
  id: string
  contactId: string
  contactName?: string
  status: ContactServiceStatus
  startedAt?: string | null
  purchasedAt?: string | null
  completedAt?: string | null
  canceledAt?: string | null
  totalPriceCents: number
  paidCents: number
  remainingCents: number
  currency: string
  allowPartialPayments: boolean
  notes: string | null
  service: {
    id: string
    name: string
    description: string | null
    basePriceCents: number
  }
  followUpTemplate?: {
    id: string
    name: string
  } | null
  payments: Array<{
    id: string
    amountCents: number
    paidAt: string
    paymentMethod: string | null
    note: string | null
    recordedBy?: {
      id: string
      name: string
    } | null
  }>
  serviceNotes: Array<{
    id: string
    title: string
    body: string
    createdAt: string
    createdBy?: {
      id: string
      name: string
      image?: string | null
    } | null
  }>
  checklistItems: Array<{
    id: string
    checklistItemId: string
    completedAt: string | null
    label: string
    description: string | null
    isRequired: boolean
    sortOrder: number
  }>
}

type ContactServiceResponse = {
  ok: boolean
  contactService: ContactServiceDetails
}

type ContactServiceDetailsPanelProps = {
  tenantId: string
  tenantSlug: string
  contactId: string
  contactServiceId: string
  membershipSecurityLevel: "LOW" | "MEDIUM" | "MAX"
}

type ServiceStatusOption = {
  value: ContactServiceStatus
  label: string
  bgClassName: string
  textClassName: string
}

type ActivityItem = {
  id: string
  createdAt: string
  title: string
  description: string
  tone: string
  icon: "payment" | "checklist" | "note" | "status"
}

const currencyFormatter = (valueCents: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((valueCents || 0) / 100)

const centsToUsdInput = (valueCents: number) => ((valueCents || 0) / 100).toFixed(2)

const parseUsdToCents = (value: string) => {
  const normalized = value.replace(/\$/g, "").replace(/,/g, "").trim()
  if (!normalized) return null
  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

const toSentence = (value: string) => value.toLowerCase().replace(/_/g, " ")

const PAYMENT_METHOD_OPTIONS = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "CHECK", label: "Check" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "ACH", label: "ACH" },
] as const

const formatPaymentMethod = (value: string | null | undefined) => {
  if (!value) return null

  return PAYMENT_METHOD_OPTIONS.find((option) => option.value === value)?.label ?? value
}

const SERVICE_STATUS_OPTIONS: ServiceStatusOption[] = [
  {
    value: "PENDING",
    label: "Pending",
    bgClassName: "bg-amber-100",
    textClassName: "text-amber-800",
  },
  {
    value: "IN_PROGRESS",
    label: "In Progress",
    bgClassName: "bg-sky-100",
    textClassName: "text-sky-800",
  },
  {
    value: "COMPLETED",
    label: "Completed",
    bgClassName: "bg-emerald-100",
    textClassName: "text-emerald-800",
  },
  {
    value: "CANCELED",
    label: "Canceled",
    bgClassName: "bg-rose-100",
    textClassName: "text-rose-800",
  },
]

const STATUS_OPTION_BY_VALUE = Object.fromEntries(
  SERVICE_STATUS_OPTIONS.map((option) => [option.value, option]),
) as Record<ContactServiceStatus, ServiceStatusOption>

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "-"
  return new Date(value).toLocaleString()
}

const getInitials = (value: string | null | undefined) =>
  (value ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "NA"

export function ContactServiceDetailsPanel({
  tenantId,
  tenantSlug,
  contactId,
  contactServiceId,
  membershipSecurityLevel,
}: ContactServiceDetailsPanelProps) {
  const router = useRouter()
  const canManageSensitiveServiceActions = membershipSecurityLevel !== "LOW"
  const [item, setItem] = useState<ContactServiceDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isChecklistSavingId, setIsChecklistSavingId] = useState<string | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [isStatusSaving, setIsStatusSaving] = useState(false)
  const [isPaymentOpen, setIsPaymentOpen] = useState(false)
  const [isPaymentSaving, setIsPaymentSaving] = useState(false)
  const [isPaymentEditOpen, setIsPaymentEditOpen] = useState(false)
  const [isPaymentDeleting, setIsPaymentDeleting] = useState(false)
  const [isNoteOpen, setIsNoteOpen] = useState(false)
  const [isNoteSaving, setIsNoteSaving] = useState(false)
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null)
  const [paymentAmountUsd, setPaymentAmountUsd] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<string>("")
  const [paymentNote, setPaymentNote] = useState("")
  const [editPaymentAmountUsd, setEditPaymentAmountUsd] = useState("")
  const [editPaymentMethod, setEditPaymentMethod] = useState<string>("")
  const [editPaymentNote, setEditPaymentNote] = useState("")
  const [serviceNoteTitle, setServiceNoteTitle] = useState("")
  const [serviceNoteBody, setServiceNoteBody] = useState("")

  const backHref = `/app/${tenantSlug}/contacts/${contactId}/services`

  const loadItem = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data } = await api.get<ContactServiceResponse>(
        `/api/services/${tenantId}/contact-services/${contactServiceId}`,
      )
      setItem(data.contactService)
    } catch {
      setItem(null)
      toast.error("Could not load service enrollment.")
    } finally {
      setIsLoading(false)
    }
  }, [contactServiceId, tenantId])

  useEffect(() => {
    void loadItem()
  }, [loadItem])

  const resetPaymentForm = () => {
    setPaymentAmountUsd("")
    setPaymentMethod("")
    setPaymentNote("")
  }

  const resetEditPaymentForm = () => {
    setEditPaymentAmountUsd("")
    setEditPaymentMethod("")
    setEditPaymentNote("")
    setSelectedPaymentId(null)
  }

  const resetNoteForm = () => {
    setServiceNoteTitle("")
    setServiceNoteBody("")
  }

  const updateStatus = async (nextStatus: ContactServiceStatus) => {
    if (!item || isStatusSaving || item.status === nextStatus) return

    setIsStatusSaving(true)
    try {
      await api.patch(`/api/services/${tenantId}/contact-services/${item.id}`, {
        status: nextStatus,
      })
      setItem((current) =>
        current
          ? {
              ...current,
              status: nextStatus,
            }
          : current,
      )
      setStatusOpen(false)
      toast.success("Service status updated.")
      await loadItem()
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not update service status.",
        )
      } else {
        toast.error("Could not update service status.")
      }
    } finally {
      setIsStatusSaving(false)
    }
  }

  const onAddPayment = async () => {
    if (!item) return
    const amountCents = parseUsdToCents(paymentAmountUsd)
    if (amountCents === null || amountCents <= 0) {
      toast.error("Enter a valid payment amount in USD.")
      return
    }

    setIsPaymentSaving(true)
    try {
      await api.post(`/api/services/${tenantId}/contact-services/${item.id}/payments`, {
        amountCents,
        ...(paymentMethod ? { paymentMethod } : {}),
        ...(paymentNote.trim() ? { note: paymentNote.trim() } : {}),
      })
      toast.success("Payment recorded.")
      setIsPaymentOpen(false)
      resetPaymentForm()
      await loadItem()
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not record payment.",
        )
      } else {
        toast.error("Could not record payment.")
      }
    } finally {
      setIsPaymentSaving(false)
    }
  }

  const openEditPayment = (payment: ContactServiceDetails["payments"][number]) => {
    setSelectedPaymentId(payment.id)
    setEditPaymentAmountUsd(centsToUsdInput(payment.amountCents))
    setEditPaymentMethod(payment.paymentMethod ?? "")
    setEditPaymentNote(payment.note ?? "")
    setIsPaymentEditOpen(true)
  }

  const onUpdatePayment = async () => {
    if (!item || !selectedPaymentId) return
    const amountCents = parseUsdToCents(editPaymentAmountUsd)
    if (amountCents === null || amountCents <= 0) {
      toast.error("Enter a valid payment amount in USD.")
      return
    }

    setIsPaymentSaving(true)
    try {
      await api.patch(
        `/api/services/${tenantId}/contact-services/${item.id}/payments/${selectedPaymentId}`,
        {
          amountCents,
          paymentMethod: editPaymentMethod || null,
          note: editPaymentNote.trim() || null,
        },
      )
      toast.success("Payment updated.")
      setIsPaymentEditOpen(false)
      resetEditPaymentForm()
      await loadItem()
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not update payment.",
        )
      } else {
        toast.error("Could not update payment.")
      }
    } finally {
      setIsPaymentSaving(false)
    }
  }

  const onDeletePayment = async () => {
    if (!item || !selectedPaymentId) return

    setIsPaymentDeleting(true)
    try {
      await api.delete(
        `/api/services/${tenantId}/contact-services/${item.id}/payments/${selectedPaymentId}`,
      )
      toast.success("Payment deleted.")
      setIsPaymentEditOpen(false)
      resetEditPaymentForm()
      await loadItem()
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not delete payment.",
        )
      } else {
        toast.error("Could not delete payment.")
      }
    } finally {
      setIsPaymentDeleting(false)
    }
  }

  const onAddServiceNote = async () => {
    if (!item) return
    if (!serviceNoteTitle.trim() || !serviceNoteBody.trim()) {
      toast.error("Title and body are required.")
      return
    }

    setIsNoteSaving(true)
    try {
      await api.post(`/api/services/${tenantId}/contact-services/${item.id}/notes`, {
        title: serviceNoteTitle,
        body: serviceNoteBody,
      })
      toast.success("Service note added.")
      setIsNoteOpen(false)
      resetNoteForm()
      await loadItem()
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not add service note.",
        )
      } else {
        toast.error("Could not add service note.")
      }
    } finally {
      setIsNoteSaving(false)
    }
  }

  const toggleChecklistItem = async (
    checklistItem: ContactServiceDetails["checklistItems"][number],
  ) => {
    if (!item) return
    const nextCompleted = !Boolean(checklistItem.completedAt)
    setIsChecklistSavingId(checklistItem.id)
    try {
      const { data } = await api.patch<{
        ok: boolean
        checklistItem: ContactServiceDetails["checklistItems"][number]
      }>(
        `/api/services/${tenantId}/contact-services/${item.id}/checklist-items/${checklistItem.id}`,
        {
          completed: nextCompleted,
        },
      )

      setItem((current) =>
        current
          ? {
              ...current,
              checklistItems: current.checklistItems.map((entry) =>
                entry.id === checklistItem.id ? data.checklistItem : entry,
              ),
            }
          : current,
      )
    } catch {
      toast.error("Could not update checklist item.")
    } finally {
      setIsChecklistSavingId(null)
    }
  }

  const payments = useMemo(() => item?.payments ?? [], [item?.payments])
  const serviceNotes = useMemo(() => item?.serviceNotes ?? [], [item?.serviceNotes])
  const checklistItems = useMemo(() => item?.checklistItems ?? [], [item?.checklistItems])
  const checklistCompletedCount = useMemo(
    () => checklistItems.filter((entry) => Boolean(entry.completedAt)).length,
    [checklistItems],
  )
  const canAddPayments = Boolean(item && item.remainingCents > 0)
  const currentStatusOption = item ? STATUS_OPTION_BY_VALUE[item.status] : null

  const historyItems = useMemo<ActivityItem[]>(() => {
    if (!item) return []

    const entries: ActivityItem[] = []

    if (item.purchasedAt) {
      entries.push({
        id: `purchased-${item.id}`,
        createdAt: item.purchasedAt,
        title: "Service purchased",
        description: `Enrollment started for ${item.service.name}.`,
        tone: "border-sky-200 bg-sky-50/80 text-sky-800",
        icon: "status",
      })
    }

    if (item.completedAt) {
      entries.push({
        id: `completed-${item.id}`,
        createdAt: item.completedAt,
        title: "Service completed",
        description: `${item.service.name} was marked as completed.`,
        tone: "border-emerald-200 bg-emerald-50/80 text-emerald-800",
        icon: "status",
      })
    }

    if (item.canceledAt) {
      entries.push({
        id: `canceled-${item.id}`,
        createdAt: item.canceledAt,
        title: "Service canceled",
        description: `${item.service.name} was marked as canceled.`,
        tone: "border-rose-200 bg-rose-50/80 text-rose-800",
        icon: "status",
      })
    }

    checklistItems
      .filter((checklistItem) => Boolean(checklistItem.completedAt))
      .forEach((checklistItem) => {
        entries.push({
          id: `checklist-${checklistItem.id}`,
          createdAt: checklistItem.completedAt as string,
          title: `Checklist completed: ${checklistItem.label}`,
          description: "A required service document was marked as received.",
          tone: "border-emerald-200 bg-emerald-50/80 text-emerald-800",
          icon: "checklist",
        })
      })

    payments.forEach((payment) => {
      entries.push({
        id: `payment-${payment.id}`,
        createdAt: payment.paidAt,
        title: `Payment recorded: ${currencyFormatter(payment.amountCents, item.currency)}`,
        description: payment.paymentMethod
          ? `${formatPaymentMethod(payment.paymentMethod)}${payment.recordedBy?.name ? ` by ${payment.recordedBy.name}` : ""}`
          : payment.recordedBy?.name
            ? `Recorded by ${payment.recordedBy.name}`
            : "Payment recorded for this service.",
        tone: "border-slate-200 bg-slate-50 text-slate-700",
        icon: "payment",
      })
    })

    serviceNotes.forEach((note) => {
      entries.push({
        id: `note-${note.id}`,
        createdAt: note.createdAt,
        title: `Note added: ${note.title}`,
        description: note.createdBy?.name ? `Added by ${note.createdBy.name}` : "Note added to this service.",
        tone: "border-violet-200 bg-violet-50/80 text-violet-800",
        icon: "note",
      })
    })

    return entries.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }, [checklistItems, item, payments, serviceNotes])

  if (isLoading) {
    return (
      <section className="rounded-[26px] border border-slate-200 bg-white p-5 text-sm text-slate-500">
        Loading service enrollment...
      </section>
    )
  }

  if (!item) {
    return (
      <section className="rounded-[26px] border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
        This service enrollment could not be found.
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              <span>Contact Service</span>
              {item.followUpTemplate?.name ? (
                <>
                  <span className="text-slate-300">/</span>
                  <span>{item.followUpTemplate.name}</span>
                </>
              ) : null}
            </div>
            <div className="flex items-start gap-3">
              <Link
                href={backHref}
                aria-label="Back to services"
                className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
                  {item.service.name}
                </h1>
                {item.service.description ? (
                  <p className="max-w-3xl text-sm leading-6 text-slate-600">
                    {item.service.description}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 self-center md:self-center">
            <Popover
              open={canManageSensitiveServiceActions ? statusOpen : false}
              onOpenChange={(open) => {
                if (!canManageSensitiveServiceActions) return
                setStatusOpen(open)
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-8 max-w-[220px] rounded-full px-3 py-1 text-xs font-semibold shadow-sm ring-1 ring-black/5",
                    canManageSensitiveServiceActions ? "cursor-pointer" : "cursor-default",
                    currentStatusOption?.bgClassName,
                    currentStatusOption?.textClassName,
                  )}
                  disabled={!canManageSensitiveServiceActions}
                >
                  <span className="truncate">{currentStatusOption?.label ?? toSentence(item.status)}</span>
                  {isStatusSaving ? (
                    <Loader2 className="ml-1 h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[280px] p-0">
                <Command>
                  <CommandInput placeholder="Update status..." />
                  <CommandList>
                    <CommandEmpty>No statuses found.</CommandEmpty>
                    {SERVICE_STATUS_OPTIONS.map((option) => (
                      <CommandItem
                        key={option.value}
                        onSelect={() => void updateStatus(option.value)}
                        className="cursor-pointer gap-2 px-3 py-2"
                      >
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-1 text-xs font-semibold shadow-sm ring-1 ring-black/5",
                            option.bgClassName,
                            option.textClassName,
                          )}
                        >
                          {option.label}
                        </span>
                        <span className="min-w-0 flex-1" />
                        <Check
                          className={cn(
                            "h-4 w-4 text-blue-950",
                            item.status === option.value ? "opacity-100" : "opacity-0",
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Total</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
            {currencyFormatter(item.totalPriceCents, item.currency)}
          </p>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Paid</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-sky-700">
            {currencyFormatter(item.paidCents, item.currency)}
          </p>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Balance</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-amber-700">
            {currencyFormatter(item.remainingCents, item.currency)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-[24px] border border-slate-200 bg-white p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                Checklist Tracking
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Mark documents as received as soon as the contact brings them in.
              </p>
            </div>
            <Badge variant="outline" className="w-fit border-slate-200 bg-slate-50 text-slate-700">
              {checklistCompletedCount}/{checklistItems.length} received
            </Badge>
          </div>
          {checklistItems.length ? (
            <div className="space-y-3">
              {[...checklistItems]
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((checklistItem) => {
                  const isCompleted = Boolean(checklistItem.completedAt)
                  const isSavingChecklist = isChecklistSavingId === checklistItem.id
                  return (
                    <div
                      key={checklistItem.id}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl border px-4 py-3 transition",
                        isCompleted
                          ? "border-emerald-200 bg-emerald-50/70"
                          : "border-slate-200 bg-slate-50",
                        isSavingChecklist && "opacity-70",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className={cn("text-sm font-semibold", isCompleted ? "text-emerald-900" : "text-slate-900")}>
                            {checklistItem.label}
                          </p>
                          {checklistItem.isRequired ? (
                            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                              Required
                            </Badge>
                          ) : null}
                          <Badge
                            variant="outline"
                            className={cn(
                              isCompleted
                                ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                                : "border-slate-200 bg-white text-slate-600",
                            )}
                          >
                            {isCompleted ? "Received" : "Pending"}
                          </Badge>
                        </div>
                        {checklistItem.description ? (
                          <p className="mt-1 text-sm leading-6 text-slate-600">
                            {checklistItem.description}
                          </p>
                        ) : null}
                        <p className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500">
                          {isCompleted ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                              Received {formatDateTime(checklistItem.completedAt)}
                            </>
                          ) : (
                            <>
                              <CircleDashed className="h-3.5 w-3.5" />
                              Click the circle to mark as received
                            </>
                          )}
                        </p>
                      </div>
                      <div className="ml-auto flex shrink-0 items-center self-center">
                        <button
                          type="button"
                          className="cursor-pointer rounded-full text-slate-400 transition hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => void toggleChecklistItem(checklistItem)}
                          disabled={isSavingChecklist}
                          aria-label={isCompleted ? `Uncheck ${checklistItem.label}` : `Check ${checklistItem.label}`}
                        >
                          {isCompleted ? (
                            <CircleCheckBig className="h-6 w-6 text-emerald-600" />
                          ) : (
                            <Circle className="h-6 w-6" />
                          )}
                        </button>
                      </div>
                    </div>
                  )
                })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              This service does not have checklist requirements yet.
            </div>
          )}
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-white p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Payments</p>
              <p className="mt-1 text-sm text-slate-600">
                Review payment history and record partial payments when a balance is still open.
              </p>
            </div>
            {canAddPayments && canManageSensitiveServiceActions ? (
              <Button
                type="button"
                size="sm"
                className="cursor-pointer"
                onClick={() => setIsPaymentOpen(true)}
              >
                <Plus className="h-4 w-4" />
                Add payment
              </Button>
            ) : (
              <Badge className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800 hover:bg-emerald-100">
                Paid in full
              </Badge>
            )}
          </div>
          {payments.length ? (
            <div className="space-y-3">
              {payments.map((payment, index) => (
                <button
                  key={payment.id ?? `${payment.paidAt}-${payment.amountCents}-${index}`}
                  type="button"
                  className={cn(
                    "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition",
                    canManageSensitiveServiceActions
                      ? "cursor-pointer hover:border-slate-300 hover:bg-white"
                      : "cursor-default",
                  )}
                  onClick={() => {
                    if (!canManageSensitiveServiceActions) return
                    openEditPayment(payment)
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {currencyFormatter(payment.amountCents, item.currency)}
                      </p>
                      <p className="text-xs text-slate-500">{formatDateTime(payment.paidAt)}</p>
                    </div>
                    {payment.paymentMethod ? (
                      <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
                        {formatPaymentMethod(payment.paymentMethod)}
                      </Badge>
                    ) : null}
                  </div>
                  {payment.note ? (
                    <p className="mt-2 text-sm leading-6 text-slate-600">{payment.note}</p>
                  ) : null}
                  {payment.recordedBy?.name ? (
                    <p className="mt-2 text-xs text-slate-500">Recorded by {payment.recordedBy.name}</p>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              No payments have been recorded for this service yet.
            </div>
          )}
        </section>
      </div>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Service Notes</p>
            <p className="mt-1 text-sm text-slate-600">
              Keep service-specific notes separate from general contact notes.
            </p>
          </div>
          <Button type="button" size="sm" className="cursor-pointer" onClick={() => setIsNoteOpen(true)}>
            <Plus className="h-4 w-4" />
            Add note
          </Button>
        </div>
        {serviceNotes.length ? (
          <div className="space-y-3">
            {serviceNotes.map((note) => (
              <article key={note.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarImage
                        src={note.createdBy?.image ?? undefined}
                        alt={note.createdBy?.name ?? "Service note author"}
                      />
                      <AvatarFallback className="bg-blue-950 text-xs font-semibold text-white">
                        {getInitials(note.createdBy?.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-slate-900">{note.title}</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {note.createdBy?.name ? `Added by ${note.createdBy.name}` : "Added to this service"}
                      {" · "}
                      {formatDateTime(note.createdAt)}
                    </p>
                    </div>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{note.body}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No service notes have been added yet.
          </div>
        )}
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Service History</p>
          <p className="mt-1 text-sm text-slate-600">
            Review the service timeline, including payments, checklist receipts, and note activity.
          </p>
        </div>
        {historyItems.length ? (
          <div className="space-y-3">
            {historyItems.map((historyItem) => (
              <div key={historyItem.id} className="flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className={cn("mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border", historyItem.tone)}>
                  {historyItem.icon === "payment" ? (
                    <CreditCard className="h-4 w-4" />
                  ) : historyItem.icon === "checklist" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : historyItem.icon === "note" ? (
                    <NotebookPen className="h-4 w-4" />
                  ) : (
                    <Clock3 className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{historyItem.title}</p>
                    <p className="text-xs text-slate-500">{formatDateTime(historyItem.createdAt)}</p>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{historyItem.description}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No service activity is available yet.
          </div>
        )}
      </section>

      <Dialog
        open={isPaymentOpen}
        onOpenChange={(open) => {
          setIsPaymentOpen(open)
          if (!open) resetPaymentForm()
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add payment</DialogTitle>
            <DialogDescription>
              Record an additional payment for this service enrollment.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                <CreditCard className="h-4 w-4 text-slate-500" />
                Remaining balance: {currencyFormatter(item.remainingCents, item.currency)}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Payment Amount (USD)</Label>
              <Input
                value={paymentAmountUsd}
                onChange={(event) => setPaymentAmountUsd(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            </div>
            <div className="grid gap-2">
              <Label>Payment Method</Label>
              <Select value={paymentMethod || "__none__"} onValueChange={(value) => setPaymentMethod(value === "__none__" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No method</SelectItem>
                  {PAYMENT_METHOD_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Note</Label>
              <Textarea
                value={paymentNote}
                onChange={(event) => setPaymentNote(event.target.value)}
                rows={4}
                placeholder="Optional payment note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsPaymentOpen(false)}
              disabled={isPaymentSaving}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void onAddPayment()}
              disabled={isPaymentSaving}
              className="cursor-pointer"
            >
              {isPaymentSaving ? "Saving..." : "Add payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isPaymentEditOpen}
        onOpenChange={(open) => {
          setIsPaymentEditOpen(open)
          if (!open) resetEditPaymentForm()
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit payment</DialogTitle>
            <DialogDescription>
              Correct the payment amount, method, or note. You can also delete this payment.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label>Payment Amount (USD)</Label>
              <Input
                value={editPaymentAmountUsd}
                onChange={(event) => setEditPaymentAmountUsd(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            </div>
            <div className="grid gap-2">
              <Label>Payment Method</Label>
              <Select
                value={editPaymentMethod || "__none__"}
                onValueChange={(value) => setEditPaymentMethod(value === "__none__" ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No method</SelectItem>
                  {PAYMENT_METHOD_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Note</Label>
              <Textarea
                value={editPaymentNote}
                onChange={(event) => setEditPaymentNote(event.target.value)}
                rows={4}
                placeholder="Optional payment note"
              />
            </div>
          </div>
          <DialogFooter className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={() => void onDeletePayment()}
              disabled={isPaymentDeleting || isPaymentSaving}
              className="cursor-pointer"
            >
              {isPaymentDeleting ? "Deleting..." : "Delete payment"}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsPaymentEditOpen(false)}
                disabled={isPaymentSaving}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void onUpdatePayment()}
                disabled={isPaymentSaving || isPaymentDeleting}
                className="cursor-pointer"
              >
                {isPaymentSaving ? "Saving..." : "Save payment"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isNoteOpen}
        onOpenChange={(open) => {
          setIsNoteOpen(open)
          if (!open) resetNoteForm()
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add service note</DialogTitle>
            <DialogDescription>
              Save a note that belongs to this service and stays visible in the service history.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label>Title</Label>
              <Input
                value={serviceNoteTitle}
                onChange={(event) => setServiceNoteTitle(event.target.value)}
                placeholder="Service note title"
              />
            </div>
            <div className="grid gap-2">
              <Label>Body</Label>
              <Textarea
                value={serviceNoteBody}
                onChange={(event) => setServiceNoteBody(event.target.value)}
                rows={6}
                placeholder="Add context about this service"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsNoteOpen(false)}
              disabled={isNoteSaving}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void onAddServiceNote()}
              disabled={isNoteSaving}
              className="cursor-pointer"
            >
              {isNoteSaving ? "Saving..." : "Add note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
