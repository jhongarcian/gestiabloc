"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { isAxiosError } from "axios"
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Route,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import {
  StackedAvatarGroup,
  type StackedAvatarGroupItem,
} from "@/components/stacked-avatar-group"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
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
  DialogTrigger,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type ServiceProfessional = {
  id: string
  kind: "INTERNAL_USER" | "EXTERNAL"
  userId: string | null
  externalProfessionalName: string | null
  externalContact: string | null
  notes: string | null
  sortOrder: number
  user: {
    name: string | null
    email: string | null
    image: string | null
  } | null
}

type ServiceChecklistItem = {
  id: string
  label: string
  description: string | null
  isRequired: boolean
  sortOrder: number
}

type ServiceFollowUpTemplate = {
  id: string
  name: string
  isPublished: boolean
  sortOrder: number
  flowNodes: unknown[] | null
  flowEdges: unknown[] | null
}

export type ServiceOverviewPanelProps = {
  tenantId: string
  tenantSlug: string
  service: {
    id: string
    name: string
    description: string | null
    basePriceCents: number
    currency: string
    isTaxExempt: boolean
    allowPartialPayments: boolean
    minimumPartialPaymentCents: number | null
    installmentCount: number | null
    installmentFrequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY" | null
    isActive: boolean
    checklistItems: ServiceChecklistItem[]
    followUpTemplates: ServiceFollowUpTemplate[]
    professionals: ServiceProfessional[]
    tenantBilling: {
      taxEnabled: boolean
      taxLabel: string | null
      defaultTaxRatePercent: number | null
    }
  }
}

type ContactSearchResult = {
  id: string
  fullName: string
  phoneNumber: string | null
  email: string | null
}

type ContactSearchResponse = {
  ok: boolean
  items: ContactSearchResult[]
}

type TenantAssigneeOption = {
  value: string
  label: string
  email: string
  image: string | null
}

type TenantAssigneesResponse = {
  ok: boolean
  items: TenantAssigneeOption[]
}

type CreateContactServiceResponse = {
  ok: boolean
  contactService: {
    id: string
  }
}

const INSTALLMENT_FREQUENCY_LABELS = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  MONTHLY: "Monthly",
} as const

const PROFESSIONAL_TONE_STYLES = {
  internal: {
    surfaceClassName: "border-sky-200 bg-sky-50 text-sky-900",
    fallbackClassName: "bg-sky-100 text-sky-900",
  },
  external: {
    surfaceClassName: "border-orange-200 bg-orange-50 text-orange-900",
    fallbackClassName: "bg-orange-100 text-orange-900",
  },
} as const

function formatCurrency(valueCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((valueCents || 0) / 100)
}

function centsToUsdInput(valueCents: number) {
  return ((valueCents || 0) / 100).toFixed(2)
}

function parseUsdToCents(value: string) {
  const normalized = value.replace(/\$/g, "").replace(/,/g, "").trim()
  if (!normalized) return null

  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return null

  return Math.round(parsed * 100)
}

function getInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)

  if (parts.length === 0) return "?"

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("")
}

function getProfessionalLabel(professional: ServiceProfessional) {
  return (
    professional.externalProfessionalName?.trim() ||
    professional.user?.name?.trim() ||
    professional.user?.email?.trim() ||
    professional.externalContact?.trim() ||
    "Assigned professional"
  )
}

function getProfessionalTone(professional: ServiceProfessional) {
  return professional.kind === "INTERNAL_USER" ? "internal" : "external"
}

function getProfessionalMeta(professional: ServiceProfessional) {
  if (professional.kind === "INTERNAL_USER") {
    return professional.user?.email?.trim() || "Internal user"
  }

  return professional.externalContact?.trim() || "External professional"
}

function toProfessionalAvatarItem(
  professional: ServiceProfessional,
): StackedAvatarGroupItem {
  return {
    id: professional.id,
    label: getProfessionalLabel(professional),
    imageUrl: professional.user?.image ?? null,
    tone: professional.kind === "INTERNAL_USER" ? "internal" : "external",
  }
}

function FlowStepCard({
  stepNumber,
  title,
  description,
  children,
}: {
  stepNumber: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-950 text-xs font-semibold text-white">
          {stepNumber}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function AssignedProfessionalPicker({
  professionals,
  value,
  onValueChange,
}: {
  professionals: ServiceProfessional[]
  value: string
  onValueChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)

  const selectedProfessional = useMemo(
    () => professionals.find((professional) => professional.id === value) ?? null,
    [professionals, value],
  )

  const selectedLabel = selectedProfessional
    ? getProfessionalLabel(selectedProfessional)
    : "No assigned professional"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-between rounded-xl border-slate-200 bg-white px-3 text-left font-normal shadow-sm hover:bg-slate-50"
        >
          <div className="flex min-w-0 items-center gap-2">
            {selectedProfessional ? (
              <>
                <Avatar className="h-6 w-6 shrink-0 border border-white shadow-sm">
                  {selectedProfessional.user?.image ? (
                    <AvatarImage
                      src={selectedProfessional.user.image}
                      alt={selectedLabel}
                      className="object-cover"
                    />
                  ) : null}
                  <AvatarFallback
                    className={cn(
                      "text-[11px] font-semibold",
                      PROFESSIONAL_TONE_STYLES[getProfessionalTone(selectedProfessional)]
                        .fallbackClassName,
                    )}
                  >
                    {getInitials(selectedLabel)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-[13px] font-medium text-slate-900">
                  {selectedLabel}
                </span>
              </>
            ) : (
              <>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <UserRound className="h-3.5 w-3.5" />
                </span>
                <span className="truncate text-[13px] text-slate-500">Unassigned</span>
              </>
            )}
          </div>
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-slate-500" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[360px] p-0">
        <Command>
          <CommandInput placeholder="Assign professional..." />
          <CommandList>
            <CommandEmpty>No professionals found.</CommandEmpty>
            <CommandItem
              onSelect={() => {
                onValueChange("")
                setOpen(false)
              }}
              className="cursor-pointer gap-2.5 px-3 py-2"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <UserRound className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-slate-900">
                  No assigned professional
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  Create the transaction without assigning anyone yet.
                </p>
              </div>
              <Check
                className={cn(
                  "h-3.5 w-3.5 text-blue-950",
                  selectedProfessional ? "opacity-0" : "opacity-100",
                )}
              />
            </CommandItem>

            {professionals.map((professional) => {
              const label = getProfessionalLabel(professional)
              const meta = getProfessionalMeta(professional)
              const toneStyles =
                PROFESSIONAL_TONE_STYLES[getProfessionalTone(professional)]

              return (
                <CommandItem
                  key={professional.id}
                  onSelect={() => {
                    onValueChange(professional.id)
                    setOpen(false)
                  }}
                  className="cursor-pointer gap-2.5 px-3 py-2"
                >
                  <Avatar
                    className={cn(
                      "h-8 w-8 border shadow-sm",
                      toneStyles.surfaceClassName,
                    )}
                  >
                    {professional.user?.image ? (
                      <AvatarImage
                        src={professional.user.image}
                        alt={label}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback
                      className={cn("text-xs font-semibold", toneStyles.fallbackClassName)}
                    >
                      {getInitials(label)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-slate-900">
                      {label}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">{meta}</p>
                  </div>
                  <Check
                    className={cn(
                      "h-3.5 w-3.5 text-blue-950",
                      selectedProfessional?.id === professional.id
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function FollowUpAssigneePicker({
  assignees,
  value,
  disabled,
  onValueChange,
}: {
  assignees: TenantAssigneeOption[]
  value: string
  disabled?: boolean
  onValueChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)

  const selectedAssignee = useMemo(
    () => assignees.find((assignee) => assignee.value === value) ?? null,
    [assignees, value],
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-between rounded-xl border-slate-200 bg-white px-3 text-left font-normal shadow-sm hover:bg-slate-50"
          disabled={disabled}
        >
          <div className="flex min-w-0 items-center gap-2">
            {selectedAssignee ? (
              <>
                <Avatar className="h-6 w-6 shrink-0 border border-white shadow-sm">
                  {selectedAssignee.image ? (
                    <AvatarImage
                      src={selectedAssignee.image}
                      alt={selectedAssignee.label}
                      className="object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="bg-blue-100 text-[11px] font-semibold text-blue-900">
                    {getInitials(selectedAssignee.label)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-[13px] font-medium text-slate-900">
                  {selectedAssignee.label}
                </span>
              </>
            ) : (
              <>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                  <UserRound className="h-3.5 w-3.5" />
                </span>
                <span className="truncate text-[13px] text-slate-500">Unassigned</span>
              </>
            )}
          </div>
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-slate-500" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[360px] p-0">
        <Command>
          <CommandInput placeholder="Assign follow-up to..." />
          <CommandList>
            <CommandEmpty>No users found.</CommandEmpty>
            <CommandItem
              onSelect={() => {
                onValueChange("")
                setOpen(false)
              }}
              className="cursor-pointer gap-2.5 px-3 py-2"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <UserRound className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-slate-900">
                  No follow-up owner
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  Leave the enrolled follow-up steps unassigned.
                </p>
              </div>
              <Check
                className={cn(
                  "h-3.5 w-3.5 text-blue-950",
                  selectedAssignee ? "opacity-0" : "opacity-100",
                )}
              />
            </CommandItem>

            {assignees.map((assignee) => (
              <CommandItem
                key={assignee.value}
                onSelect={() => {
                  onValueChange(assignee.value)
                  setOpen(false)
                }}
                className="cursor-pointer gap-2.5 px-3 py-2"
              >
                <Avatar className="h-8 w-8 border border-blue-200 bg-blue-50 shadow-sm">
                  {assignee.image ? (
                    <AvatarImage
                      src={assignee.image}
                      alt={assignee.label}
                      className="object-cover"
                    />
                  ) : null}
                  <AvatarFallback className="bg-blue-100 text-xs font-semibold text-blue-900">
                    {getInitials(assignee.label)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-slate-900">
                    {assignee.label}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">{assignee.email}</p>
                </div>
                <Check
                  className={cn(
                    "h-3.5 w-3.5 text-blue-950",
                    selectedAssignee?.value === assignee.value
                      ? "opacity-100"
                      : "opacity-0",
                  )}
                />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function CreateTransactionDialog({
  tenantId,
  tenantSlug,
  service,
}: {
  tenantId: string
  tenantSlug: string
  service: ServiceOverviewPanelProps["service"]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingAssignees, setIsLoadingAssignees] = useState(false)
  const [isSearchingContacts, setIsSearchingContacts] = useState(false)
  const [followUpAssigneeOptions, setFollowUpAssigneeOptions] = useState<
    TenantAssigneeOption[]
  >([])
  const [selectedContact, setSelectedContact] = useState<ContactSearchResult | null>(null)
  const [contactResults, setContactResults] = useState<ContactSearchResult[]>([])
  const [contactSearchQuery, setContactSearchQuery] = useState("")
  const [debouncedContactSearchQuery, setDebouncedContactSearchQuery] = useState("")
  const [templateId, setTemplateId] = useState("")
  const [assignedProfessionalId, setAssignedProfessionalId] = useState("")
  const [followUpAssignedToUserId, setFollowUpAssignedToUserId] = useState("")
  const [paymentMode, setPaymentMode] = useState<"FULL" | "PARTIAL" | "LATER">("FULL")
  const [initialPaymentUsd, setInitialPaymentUsd] = useState("")
  const [notes, setNotes] = useState("")

  const resetForm = () => {
    setStep(1)
    setIsSaving(false)
    setSelectedContact(null)
    setContactResults([])
    setContactSearchQuery("")
    setDebouncedContactSearchQuery("")
    setTemplateId("")
    setAssignedProfessionalId("")
    setFollowUpAssignedToUserId("")
    setPaymentMode("FULL")
    setInitialPaymentUsd("")
    setNotes("")
  }

  useEffect(() => {
    if (!open) return
    if (followUpAssigneeOptions.length > 0) return

    const loadAssignees = async () => {
      setIsLoadingAssignees(true)

      try {
        const { data } = await api.get<TenantAssigneesResponse>(
          `/api/tasks/${tenantId}/assignees`,
        )
        setFollowUpAssigneeOptions(data.items ?? [])
      } catch {
        setFollowUpAssigneeOptions([])
        toast.error("Could not load follow-up users.")
      } finally {
        setIsLoadingAssignees(false)
      }
    }

    void loadAssignees()
  }, [followUpAssigneeOptions.length, open, tenantId])

  useEffect(() => {
    if (!open) return

    const timeout = window.setTimeout(() => {
      setDebouncedContactSearchQuery(contactSearchQuery.trim())
    }, 350)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [contactSearchQuery, open])

  useEffect(() => {
    if (!open || selectedContact) return

    if (debouncedContactSearchQuery.length < 2) {
      setContactResults([])
      setIsSearchingContacts(false)
      return
    }

    let cancelled = false

    const searchContacts = async () => {
      setIsSearchingContacts(true)

      try {
        const { data } = await api.get<ContactSearchResponse>(
          `/api/contacts/${tenantId}/search`,
          {
            params: {
              q: debouncedContactSearchQuery,
            },
          },
        )

        if (cancelled) return
        setContactResults(data.items ?? [])
      } catch {
        if (cancelled) return
        setContactResults([])
      } finally {
        if (cancelled) return
        setIsSearchingContacts(false)
      }
    }

    void searchContacts()

    return () => {
      cancelled = true
    }
  }, [debouncedContactSearchQuery, open, selectedContact, tenantId])

  const goToNextStep = () => {
    if (step === 1) {
      if (!selectedContact) {
        toast.error("Select a contact.")
        return
      }

      setStep(2)
      return
    }

    if (step === 2) {
      setStep(3)
      return
    }

    setStep(4)
  }

  const goToPreviousStep = () => {
    setStep((current) => (current === 1 ? 1 : ((current - 1) as 1 | 2 | 3 | 4)))
  }

  const onSubmit = async () => {
    if (!selectedContact) {
      toast.error("Select a contact.")
      return
    }

    const totalPriceCents = service.basePriceCents

    if (paymentMode === "PARTIAL" && !service.allowPartialPayments) {
      toast.error("This service does not allow partial payments.")
      return
    }

    const initialPaymentCents =
      paymentMode === "FULL"
        ? totalPriceCents
        : paymentMode === "LATER"
          ? 0
          : parseUsdToCents(initialPaymentUsd)

    if (paymentMode === "PARTIAL") {
      if (initialPaymentCents === null || initialPaymentCents <= 0) {
        toast.error("Enter a valid partial payment amount in USD.")
        return
      }

      if (initialPaymentCents > totalPriceCents) {
        toast.error("Partial payment cannot be greater than total amount.")
        return
      }

      if (
        service.minimumPartialPaymentCents !== null &&
        service.minimumPartialPaymentCents !== undefined &&
        initialPaymentCents < service.minimumPartialPaymentCents
      ) {
        toast.error("Partial payment is below the minimum allowed for this service.")
        return
      }
    }

    setIsSaving(true)

    try {
      const { data } = await api.post<CreateContactServiceResponse>(
        `/api/services/${tenantId}/contact-services`,
        {
          contactId: selectedContact.id,
          serviceId: service.id,
          ...(templateId ? { followUpTemplateId: templateId } : {}),
          ...(followUpAssignedToUserId ? { followUpAssignedToUserId } : {}),
          ...(assignedProfessionalId ? { assignedProfessionalId } : {}),
          ...(initialPaymentCents !== null ? { initialPaymentCents } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      )

      toast.success("Service transaction created.")
      setOpen(false)
      resetForm()
      router.push(
        `/app/${tenantSlug}/contacts/${selectedContact.id}/services/${data.contactService.id}`,
      )
      router.refresh()
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not create service transaction.",
        )
      } else {
        toast.error("Could not create service transaction.")
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) resetForm()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" className="bg-blue-950 text-white hover:bg-blue-900">
          Create transaction
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Create service transaction</DialogTitle>
          <DialogDescription>
            This transaction is already tied to {service.name}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto py-1 pr-1">
          <div className="flex items-center gap-2">
            {[
              { value: 1, label: "Contact" },
              { value: 2, label: "Follow up" },
              { value: 3, label: "Checklist" },
              { value: 4, label: "Payment" },
            ].map((item) => {
              const isActive = step === item.value
              const isComplete = step > item.value

              return (
                <div key={item.value} className="flex items-center gap-2">
                  <div
                    className={
                      isActive
                        ? "flex h-8 min-w-8 items-center justify-center rounded-full bg-blue-950 px-3 text-xs font-semibold text-white"
                        : isComplete
                          ? "flex h-8 min-w-8 items-center justify-center rounded-full bg-blue-100 px-3 text-xs font-semibold text-blue-900"
                          : "flex h-8 min-w-8 items-center justify-center rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-500"
                    }
                  >
                    {item.value}
                  </div>
                  <span
                    className={
                      isActive
                        ? "text-sm font-medium text-slate-900"
                        : "text-sm text-slate-500"
                    }
                  >
                    {item.label}
                  </span>
                  {item.value < 4 ? <div className="mx-1 h-px w-6 bg-slate-200" /> : null}
                </div>
              )
            })}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Selected service
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900">{service.name}</p>
            <p className="mt-1 text-sm text-slate-600">
              {formatCurrency(service.basePriceCents, service.currency)}
            </p>
          </div>

          {step === 1 ? (
            <section className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="service-transaction-contact-search">Contact</Label>
                {selectedContact ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-slate-900">
                          {selectedContact.fullName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {selectedContact.email || selectedContact.phoneNumber || "No email or phone"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-slate-200 text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          setSelectedContact(null)
                          setContactSearchQuery("")
                          setDebouncedContactSearchQuery("")
                          setContactResults([])
                        }}
                      >
                        Change
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Input
                      id="service-transaction-contact-search"
                      value={contactSearchQuery}
                      onChange={(event) => setContactSearchQuery(event.target.value)}
                      placeholder="Search contacts by name, email, or phone"
                    />
                    <div className="rounded-xl border border-slate-200 bg-white">
                      {contactSearchQuery.trim().length < 2 ? (
                        <p className="px-3 py-3 text-sm text-slate-500">
                          Type at least 2 characters to search contacts.
                        </p>
                      ) : isSearchingContacts ? (
                        <p className="px-3 py-3 text-sm text-slate-500">Searching contacts...</p>
                      ) : contactResults.length ? (
                        <div className="max-h-56 overflow-auto">
                          {contactResults.map((contact) => (
                            <button
                              key={contact.id}
                              type="button"
                              className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                              onClick={() => {
                                setSelectedContact(contact)
                                setContactResults([])
                              }}
                            >
                              <span className="text-sm font-medium text-slate-900">
                                {contact.fullName}
                              </span>
                              <span className="text-xs text-slate-500">
                                {contact.email || contact.phoneNumber || "No email or phone"}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="px-3 py-3 text-sm text-slate-500">No contacts found.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="space-y-3">
              <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-3.5">
                <p className="text-sm font-semibold text-violet-950">
                  Set up the follow-up workflow for this service
                </p>
                <p className="mt-1 text-sm leading-5 text-violet-900/80">
                  Choose the template, optionally assign a professional, and decide who should own the follow-up work.
                </p>
              </div>

              <FlowStepCard
                stepNumber="1"
                title="Which follow-up template should start?"
                description="Use the default published template or choose one of the published templates already configured for this service."
              >
                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-template">Follow-Up Template</Label>
                  <Select
                    value={templateId || "default"}
                    onValueChange={(value) =>
                      setTemplateId(value === "default" ? "" : value)
                    }
                  >
                    <SelectTrigger id="service-transaction-template">
                      <SelectValue placeholder="Use default template selection" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Use default published template</SelectItem>
                      {service.followUpTemplates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {service.followUpTemplates.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No published templates are available for this service. The transaction can still proceed if the service has default follow-up steps.
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Leaving this on default uses the service&apos;s standard published template.
                    </p>
                  )}
                </div>
              </FlowStepCard>

              <FlowStepCard
                stepNumber="2"
                title="Assign a professional?"
                description="Optional. Use this when someone should own or deliver the service from the start."
              >
                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-professional">Professional</Label>
                  <AssignedProfessionalPicker
                    value={assignedProfessionalId}
                    onValueChange={setAssignedProfessionalId}
                    professionals={service.professionals}
                  />
                  {service.professionals.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      This service does not have professionals configured yet.
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      You can leave this unassigned and decide later.
                    </p>
                  )}
                </div>
              </FlowStepCard>

              <FlowStepCard
                stepNumber="3"
                title="Who should be in charge of the follow up?"
                description="Optional. This user will be assigned to the follow-up steps created from the selected template."
              >
                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-follow-up-assignee">Follow-Up Owner</Label>
                  <FollowUpAssigneePicker
                    assignees={followUpAssigneeOptions}
                    value={followUpAssignedToUserId}
                    onValueChange={setFollowUpAssignedToUserId}
                    disabled={isLoadingAssignees}
                  />
                  {isLoadingAssignees ? (
                    <p className="text-xs text-slate-500">Loading tenant users...</p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      You can leave this unassigned and route follow-up later.
                    </p>
                  )}
                </div>
              </FlowStepCard>
            </section>
          ) : null}

          {step === 3 ? (
            <section className="grid gap-4">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                <p className="text-sm font-semibold text-emerald-950">
                  Review what needs to be completed for this service
                </p>
                <p className="mt-1 text-sm leading-6 text-emerald-900/80">
                  These checklist items will be attached to{" "}
                  <span className="font-medium text-emerald-950">
                    {selectedContact?.fullName}
                  </span>{" "}
                  when the transaction is created.
                </p>
              </div>

              {service.checklistItems.length > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">
                      Checklist for {service.name}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      Required items should be completed for the contact before the service is considered finished.
                    </p>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">#</TableHead>
                        <TableHead>Checklist Item</TableHead>
                        <TableHead className="w-36">Requirement</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {service.checklistItems.map((item, index) => (
                        <TableRow key={item.id}>
                          <TableCell className="align-middle text-sm text-slate-500">
                            {index + 1}
                          </TableCell>
                          <TableCell className="align-middle">
                            <div className="space-y-0.5">
                              <p className="text-sm font-medium text-slate-900">{item.label}</p>
                              {item.description ? (
                                <p className="text-sm text-slate-500">{item.description}</p>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="align-middle">
                            <Badge
                              variant="secondary"
                              className={
                                item.isRequired
                                  ? "border border-rose-200 bg-rose-50 text-rose-700"
                                  : "border border-slate-200 bg-slate-100 text-slate-600"
                              }
                            >
                              {item.isRequired ? "Required" : "Optional"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5">
                  <p className="text-sm font-medium text-slate-900">
                    No checklist items for this service
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    This transaction will not create any checklist requirements.
                  </p>
                </div>
              )}
            </section>
          ) : null}

          {step === 4 ? (
            <section className="grid gap-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-payment-type">Payment Type</Label>
                  <Select
                    value={paymentMode}
                    onValueChange={(value) =>
                      setPaymentMode(value as "FULL" | "PARTIAL" | "LATER")
                    }
                  >
                    <SelectTrigger id="service-transaction-payment-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FULL">Pay in Full</SelectItem>
                      <SelectItem value="PARTIAL" disabled={!service.allowPartialPayments}>
                        Partial Payment
                      </SelectItem>
                      <SelectItem value="LATER">Pay Later</SelectItem>
                    </SelectContent>
                  </Select>
                  {!service.allowPartialPayments ? (
                    <p className="text-xs text-slate-500">
                      This service supports full payment or pay later only.
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-cost">Service Cost</Label>
                  <Input
                    id="service-transaction-cost"
                    readOnly
                    value={centsToUsdInput(service.basePriceCents)}
                    className="bg-slate-50 text-slate-600"
                  />
                </div>
              </div>

              {assignedProfessionalId ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Assigned professional:{" "}
                  <span className="font-medium text-slate-900">
                    {getProfessionalLabel(
                      service.professionals.find((item) => item.id === assignedProfessionalId)!,
                    )}
                  </span>
                </div>
              ) : null}

              {followUpAssignedToUserId ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Follow-up owner:{" "}
                  <span className="font-medium text-slate-900">
                    {followUpAssigneeOptions.find((item) => item.value === followUpAssignedToUserId)?.label ?? "Assigned user"}
                  </span>
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-payment-now">
                    {paymentMode === "PARTIAL" ? "Partial Payment Amount" : "Payment Now"}
                  </Label>
                  <Input
                    id="service-transaction-payment-now"
                    value={
                      paymentMode === "PARTIAL"
                        ? initialPaymentUsd
                        : paymentMode === "LATER"
                          ? "0.00"
                          : centsToUsdInput(service.basePriceCents)
                    }
                    onChange={(event) => setInitialPaymentUsd(event.target.value)}
                    readOnly={paymentMode !== "PARTIAL"}
                    inputMode="decimal"
                    placeholder="0.00"
                    className={paymentMode === "PARTIAL" ? undefined : "bg-slate-50 text-slate-600"}
                  />
                  {paymentMode === "PARTIAL" && service.minimumPartialPaymentCents ? (
                    <p className="text-xs text-slate-500">
                      Minimum partial payment:{" "}
                      {formatCurrency(service.minimumPartialPaymentCents, service.currency)}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-notes">Notes</Label>
                  <Textarea
                    id="service-transaction-notes"
                    rows={4}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Add any notes about this service transaction"
                  />
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-slate-200 pt-4 sm:justify-between">
          <div className="text-sm text-slate-500">
            {step === 1 ? "Pick the contact first." : "Review the details before continuing."}
          </div>
          <div className="flex items-center gap-2">
            {step > 1 ? (
              <Button
                type="button"
                variant="outline"
                onClick={goToPreviousStep}
                className="border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                Back
              </Button>
            ) : null}
            {step < 4 ? (
              <Button type="button" onClick={goToNextStep} className="bg-blue-950 text-white hover:bg-blue-900">
                Next
              </Button>
            ) : (
              <Button
                type="button"
                onClick={onSubmit}
                disabled={isSaving}
                className="bg-blue-950 text-white hover:bg-blue-900"
              >
                {isSaving ? "Creating..." : "Create transaction"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ServiceOverviewPanel({
  tenantId,
  tenantSlug,
  service,
}: ServiceOverviewPanelProps) {
  const taxApplies =
    service.tenantBilling.taxEnabled &&
    !service.isTaxExempt &&
    service.tenantBilling.defaultTaxRatePercent !== null

  const estimatedTaxCents = taxApplies
    ? Math.round(service.basePriceCents * ((service.tenantBilling.defaultTaxRatePercent ?? 0) / 100))
    : 0
  const totalWithTaxCents = service.basePriceCents + estimatedTaxCents
  const requiredChecklistCount = service.checklistItems.filter((item) => item.isRequired).length
  const optionalChecklistCount = service.checklistItems.length - requiredChecklistCount
  const internalProfessionalsCount = service.professionals.filter(
    (item) => item.kind === "INTERNAL_USER",
  ).length
  const totalTemplateNodes = service.followUpTemplates.reduce(
    (total, template) => total + (Array.isArray(template.flowNodes) ? template.flowNodes.length : 0),
    0,
  )
  const totalTemplateEdges = service.followUpTemplates.reduce(
    (total, template) => total + (Array.isArray(template.flowEdges) ? template.flowEdges.length : 0),
    0,
  )

  const paymentSummary = service.allowPartialPayments
    ? service.installmentCount && service.installmentFrequency
      ? `Minimum deposit ${service.minimumPartialPaymentCents !== null ? formatCurrency(service.minimumPartialPaymentCents, service.currency) : "required"} · ${service.installmentCount} ${INSTALLMENT_FREQUENCY_LABELS[service.installmentFrequency].toLowerCase()} installments`
      : "Partial payments allowed"
    : "Full payment only"

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)]">
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.2fr)_360px] lg:p-7">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Button
                asChild
                type="button"
                variant="outline"
                size="sm"
                className="border-white/70 bg-white/80 text-slate-700 hover:bg-white"
              >
                <Link href={`/app/${tenantSlug}/services`}>
                  <ArrowLeft className="h-4 w-4" />
                  Back to services
                </Link>
              </Button>
              <Badge
                variant="secondary"
                className={cn(
                  "border",
                  service.isActive
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-100 text-slate-600",
                )}
              >
                {service.isActive ? "Available" : "Unavailable"}
              </Badge>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                Service Overview
              </p>
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-slate-950">
                {service.name}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-600">
                {service.description?.trim() || "This service is ready to review and enroll."}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Base Price
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">
                  {formatCurrency(service.basePriceCents, service.currency)}
                </p>
                <p className="mt-1 text-sm text-slate-500">{paymentSummary}</p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Total With Tax
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">
                  {formatCurrency(totalWithTaxCents, service.currency)}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {taxApplies
                    ? `${service.tenantBilling.taxLabel || "Tax"} ${(service.tenantBilling.defaultTaxRatePercent ?? 0).toFixed(2).replace(/\.00$/, "")}% applies`
                    : service.isTaxExempt
                      ? "This service is tax exempt"
                      : "No tax applies"}
                </p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Professionals
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">
                  {service.professionals.length}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {internalProfessionalsCount} internal · {service.professionals.length - internalProfessionalsCount} external
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-[24px] border border-slate-300/60 bg-slate-950 p-5 text-white shadow-sm">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-200/90">
                Ready To Enroll
              </p>
              <p className="text-sm leading-6 text-slate-300">
                Review the service details, confirm the checklist and follow-up coverage, then start the transaction with this service already selected.
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <CreateTransactionDialog
                tenantId={tenantId}
                tenantSlug={tenantSlug}
                service={service}
              />
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                The transaction flow will ask for the contact, follow-up setup, checklist review, and payment details.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Price</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">
            {formatCurrency(service.basePriceCents, service.currency)}
          </p>
          <p className="mt-1 text-sm text-slate-500">Service base price before tax.</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Payment</p>
          <p className="mt-2 text-lg font-semibold text-slate-950">{paymentSummary}</p>
          <p className="mt-1 text-sm text-slate-500">
            Contacts can still pay the full amount any time.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Tax</p>
          <p className="mt-2 text-lg font-semibold text-slate-950">
            {service.tenantBilling.taxEnabled
              ? service.isTaxExempt
                ? "Tax exempt"
                : service.tenantBilling.defaultTaxRatePercent !== null
                  ? `${service.tenantBilling.taxLabel || "Tax"} ${(service.tenantBilling.defaultTaxRatePercent).toFixed(2).replace(/\.00$/, "")}%`
                  : "Tax settings incomplete"
              : "No tax"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {taxApplies
              ? `Estimated tax: ${formatCurrency(estimatedTaxCents, service.currency)}`
              : "This service does not add tax to the total."}
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Professionals</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{service.professionals.length}</p>
          <p className="mt-1 text-sm text-slate-500">People who can deliver or own this service.</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Follow-Up Templates</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{service.followUpTemplates.length}</p>
          <p className="mt-1 text-sm text-slate-500">{totalTemplateNodes} nodes · {totalTemplateEdges} connections</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Checklist</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{service.checklistItems.length}</p>
          <p className="mt-1 text-sm text-slate-500">{requiredChecklistCount} required · {optionalChecklistCount} optional</p>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <article className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-slate-950">About this service</h2>
            <p className="text-sm text-slate-500">
              A clear overview of what the service includes before you create a transaction.
            </p>
          </div>
          <div className="mt-4 grid gap-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-sm font-medium text-slate-900">Description</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {service.description?.trim() || "No description is configured for this service yet."}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-sm font-medium text-slate-900">What to expect</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                This service has {service.checklistItems.length} checklist item{service.checklistItems.length === 1 ? "" : "s"}, {service.followUpTemplates.length} published follow-up template{service.followUpTemplates.length === 1 ? "" : "s"}, and {service.professionals.length} available professional{service.professionals.length === 1 ? "" : "s"}.
              </p>
            </div>
          </div>
        </article>

        <article className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-1">
            <h2 className="inline-flex items-center gap-2 text-xl font-semibold text-slate-950">
              <CreditCard className="h-5 w-5 text-blue-700" />
              Pricing & Payment
            </h2>
            <p className="text-sm text-slate-500">
              Billing expectations for this service based on its configured rules.
            </p>
          </div>

          <div className="mt-4 grid gap-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-sm font-medium text-slate-900">Payment summary</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Base price</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {formatCurrency(service.basePriceCents, service.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Payment mode</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {service.allowPartialPayments ? "Partial payments allowed" : "Full payment only"}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Minimum deposit</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {service.minimumPartialPaymentCents !== null
                      ? formatCurrency(service.minimumPartialPaymentCents, service.currency)
                      : "Not applicable"}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Installments</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {service.installmentCount && service.installmentFrequency
                      ? `${service.installmentCount} ${INSTALLMENT_FREQUENCY_LABELS[service.installmentFrequency].toLowerCase()}`
                      : "Not configured"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-sm font-medium text-slate-900">Tax</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Tax status</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {service.tenantBilling.taxEnabled
                      ? service.isTaxExempt
                        ? "Tax exempt"
                        : "Taxable"
                      : "No tax"}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Rate</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {taxApplies
                      ? `${service.tenantBilling.taxLabel || "Tax"} ${(service.tenantBilling.defaultTaxRatePercent ?? 0).toFixed(2).replace(/\.00$/, "")}%`
                      : "Not applied"}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Estimated tax</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {formatCurrency(estimatedTaxCents, service.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Estimated total</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {formatCurrency(totalWithTaxCents, service.currency)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
              <h2 className="inline-flex items-center gap-2 text-xl font-semibold text-slate-950">
                <Users className="h-5 w-5 text-blue-700" />
                Professionals
              </h2>
              <p className="text-sm text-slate-500">
                People who can own or deliver this service.
              </p>
            </div>
            {service.professionals.length ? (
              <StackedAvatarGroup items={service.professionals.map(toProfessionalAvatarItem)} />
            ) : null}
          </div>
        </div>

        <div className="p-5">
          {service.professionals.length ? (
            <div className="overflow-auto rounded-2xl border border-slate-200">
              <Table className="[&_td]:py-3 [&_th]:h-10">
                <TableHeader className="bg-slate-50/80">
                  <TableRow>
                    <TableHead className="min-w-14 text-xs">#</TableHead>
                    <TableHead className="min-w-36 text-xs">Type</TableHead>
                    <TableHead className="min-w-48 text-xs">Name</TableHead>
                    <TableHead className="min-w-40 text-xs">Contact</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {service.professionals.map((professional, index) => (
                    <TableRow key={professional.id} className="hover:bg-blue-50/40">
                      <TableCell>
                        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700">
                          {index + 1}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs font-medium",
                            professional.kind === "INTERNAL_USER"
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-orange-200 bg-orange-50 text-orange-700",
                          )}
                        >
                          {professional.kind === "INTERNAL_USER" ? "Internal user" : "External professional"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <p className="font-medium text-slate-900">
                            {getProfessionalLabel(professional)}
                          </p>
                          <p className="text-sm text-slate-500">{getProfessionalMeta(professional)}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {professional.kind === "EXTERNAL"
                          ? professional.externalContact || "No contact added"
                          : professional.user?.email || "Internal user"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
              <p className="text-base font-medium text-slate-900">No professionals listed yet</p>
              <p className="mt-2 text-sm text-slate-500">
                This service can still be reviewed, but no professionals are currently shown for it.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <article className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="inline-flex items-center gap-2 text-xl font-semibold text-slate-950">
                  <Route className="h-5 w-5 text-blue-700" />
                  Follow-Up Templates
                </h2>
                <p className="text-sm text-slate-500">
                  Published templates available for this service.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50">
                  {service.followUpTemplates.length} templates
                </Badge>
                <Badge variant="secondary" className="border-slate-200 bg-slate-100 text-slate-700">
                  {totalTemplateNodes} nodes
                </Badge>
              </div>
            </div>
          </div>

          <div className="p-5">
            {service.followUpTemplates.length ? (
              <div className="overflow-auto rounded-2xl border border-slate-200">
                <Table className="[&_td]:py-3 [&_th]:h-10">
                  <TableHeader className="bg-slate-50/80">
                    <TableRow>
                      <TableHead className="min-w-14 text-xs">#</TableHead>
                      <TableHead className="min-w-56 text-xs">Template</TableHead>
                      <TableHead className="min-w-28 text-xs">Nodes</TableHead>
                      <TableHead className="min-w-28 text-xs">Connections</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {service.followUpTemplates.map((template, index) => (
                      <TableRow key={template.id} className="hover:bg-blue-50/40">
                        <TableCell>
                          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700">
                            {index + 1}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="font-medium text-slate-900">{template.name}</p>
                            <p className="text-sm text-slate-500">Published follow-up path</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                            {Array.isArray(template.flowNodes) ? template.flowNodes.length : 0}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                            {Array.isArray(template.flowEdges) ? template.flowEdges.length : 0}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
                <p className="text-base font-medium text-slate-900">No follow-up templates available</p>
                <p className="mt-2 text-sm text-slate-500">
                  This service does not currently expose any published follow-up templates.
                </p>
              </div>
            )}
          </div>
        </article>

        <article className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 className="inline-flex items-center gap-2 text-xl font-semibold text-slate-950">
                  <ClipboardList className="h-5 w-5 text-blue-700" />
                  Checklist
                </h2>
                <p className="text-sm text-slate-500">
                  Requirements that may be created with the service enrollment.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-50">
                  {requiredChecklistCount} required
                </Badge>
                <Badge variant="secondary" className="border-slate-200 bg-slate-100 text-slate-700">
                  {optionalChecklistCount} optional
                </Badge>
              </div>
            </div>
          </div>

          <div className="p-5">
            {service.checklistItems.length ? (
              <div className="space-y-3">
                {service.checklistItems.map((item, index) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-slate-900">{item.label}</p>
                          <Badge
                            variant="secondary"
                            className={
                              item.isRequired
                                ? "border border-rose-200 bg-rose-50 text-rose-700"
                                : "border border-slate-200 bg-slate-100 text-slate-600"
                            }
                          >
                            {item.isRequired ? "Required" : "Optional"}
                          </Badge>
                        </div>
                        {item.description ? (
                          <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>
                        ) : (
                          <p className="mt-2 text-sm text-slate-400">No description added</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
                <p className="text-base font-medium text-slate-900">No checklist items required</p>
                <p className="mt-2 text-sm text-slate-500">
                  This service does not currently define any checklist requirements.
                </p>
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <h2 className="inline-flex items-center gap-2 text-xl font-semibold text-slate-950">
              <ShieldCheck className="h-5 w-5 text-blue-700" />
              Ready to create a transaction?
            </h2>
            <p className="text-sm text-slate-500">
              Start the same transaction flow used in services, with this service already selected.
            </p>
          </div>
          <CreateTransactionDialog
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            service={service}
          />
        </div>
      </section>
    </div>
  )
}
