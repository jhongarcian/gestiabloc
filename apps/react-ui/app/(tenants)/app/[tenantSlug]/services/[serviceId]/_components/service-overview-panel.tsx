"use client"

import { format } from "date-fns"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { isAxiosError } from "axios"
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Route,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { type DateRange } from "react-day-picker"
import { toast } from "sonner"
import { z } from "zod"

import {
  StackedAvatarGroup,
  type StackedAvatarGroupItem,
} from "@/components/stacked-avatar-group"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent } from "@/components/ui/card"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  flowNodeCount: number
  flowEdgeCount: number
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
  initialSummary?: ServiceSummaryResponse["summary"] | null
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

type TransactionFormState = {
  contactId: string
  templateId: string
  assignedProfessionalId: string
  followUpAssignedToUserId: string
  paymentMode: "FULL" | "PARTIAL" | "LATER"
  initialPaymentUsd: string
  notes: string
}

type TransactionFormErrors = Partial<Record<keyof TransactionFormState, string>>

type DateRangePreset = "THIS_MONTH" | "LAST_MONTH" | "LAST_3_MONTHS" | "CUSTOM"

type ServiceSummaryResponse = {
  ok: boolean
  summary: {
    grossSalesCents: number
    servicesSold: number
    activeFollowUpServices: number
    remainingBalanceCents: number
    range: {
      preset: DateRangePreset
      from: string
      to: string
    }
  }
}

const INSTALLMENT_FREQUENCY_LABELS = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  MONTHLY: "Monthly",
} as const

const DATE_RANGE_PRESET_OPTIONS: Array<{ value: DateRangePreset; label: string }> = [
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "LAST_3_MONTHS", label: "Last 3 months" },
  { value: "CUSTOM", label: "Custom range" },
]

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

const optionalStringIdSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value
    const trimmed = value.trim()
    return trimmed.length ? trimmed : undefined
  },
  z.string().trim().min(1).optional(),
)

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

function formatDateOnly(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function parseDateOnlyToLocalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function getDefaultCustomDateRange() {
  const today = new Date()
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  return {
    from: formatDateOnly(startOfMonth),
    to: formatDateOnly(today),
  }
}

function formatCalendarRangeLabel(range?: DateRange) {
  if (!range?.from) return "Pick a custom range"
  if (!range.to) return format(range.from, "MMM d, yyyy")
  return `${format(range.from, "MMM d, yyyy")} - ${format(range.to, "MMM d, yyyy")}`
}

function formatSummaryRangeLabel(range: ServiceSummaryResponse["summary"]["range"]) {
  const presetLabel =
    DATE_RANGE_PRESET_OPTIONS.find((option) => option.value === range.preset)?.label ?? "This month"

  if (range.preset !== "CUSTOM") return presetLabel

  return `${range.from} to ${range.to}`
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
  open,
  onOpenChange,
}: {
  tenantId: string
  tenantSlug: string
  service: ServiceOverviewPanelProps["service"]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
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
  const [errors, setErrors] = useState<TransactionFormErrors>({})

  const contactStepSchema = useMemo(
    () =>
      z.object({
        contactId: z.string().trim().min(1, "Select a contact."),
      }),
    [],
  )

  const followUpStepSchema = useMemo(
    () =>
      z
        .object({
          templateId: optionalStringIdSchema,
          assignedProfessionalId: optionalStringIdSchema,
          followUpAssignedToUserId: optionalStringIdSchema,
        })
        .superRefine((value, ctx) => {
          if (
            value.templateId &&
            !service.followUpTemplates.some((template) => template.id === value.templateId)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["templateId"],
              message: "Select a valid follow-up template.",
            })
          }

          if (
            value.assignedProfessionalId &&
            !service.professionals.some(
              (professional) => professional.id === value.assignedProfessionalId,
            )
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["assignedProfessionalId"],
              message: "Select a valid professional.",
            })
          }

          if (
            value.followUpAssignedToUserId &&
            !followUpAssigneeOptions.some(
              (assignee) => assignee.value === value.followUpAssignedToUserId,
            )
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["followUpAssignedToUserId"],
              message: "Select a valid follow-up owner.",
            })
          }
        }),
    [followUpAssigneeOptions, service.followUpTemplates, service.professionals],
  )

  const paymentStepSchema = useMemo(
    () =>
      z
        .object({
          paymentMode: z.enum(["FULL", "PARTIAL", "LATER"]),
          initialPaymentUsd: z.string(),
          notes: z.string().trim().max(4000, "Notes must be 4,000 characters or less."),
        })
        .superRefine((value, ctx) => {
          if (value.paymentMode === "PARTIAL" && !service.allowPartialPayments) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["paymentMode"],
              message: "This service does not allow partial payments.",
            })
          }

          if (value.paymentMode !== "PARTIAL") {
            return
          }

          const initialPaymentCents = parseUsdToCents(value.initialPaymentUsd)

          if (initialPaymentCents === null || initialPaymentCents <= 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["initialPaymentUsd"],
              message: "Enter a valid partial payment amount in USD.",
            })
            return
          }

          if (initialPaymentCents > service.basePriceCents) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["initialPaymentUsd"],
              message: "Partial payment cannot be greater than total amount.",
            })
          }

          if (
            service.minimumPartialPaymentCents !== null &&
            service.minimumPartialPaymentCents !== undefined &&
            initialPaymentCents < service.minimumPartialPaymentCents
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["initialPaymentUsd"],
              message: "Partial payment is below the minimum allowed for this service.",
            })
          }
        }),
    [service.allowPartialPayments, service.basePriceCents, service.minimumPartialPaymentCents],
  )

  const clearFieldError = (field: keyof TransactionFormErrors) => {
    setErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  const applySchemaErrors = <T extends keyof TransactionFormState>(
    result: { error: z.ZodError },
    fields: T[],
  ) => {
    const nextFieldErrors: TransactionFormErrors = {}

    for (const field of fields) {
      const issue = result.error.issues.find(
        (entry: z.ZodIssue) => entry.path[0] === field,
      )
      if (issue?.message) {
        nextFieldErrors[field] = issue.message
      }
    }

    setErrors((current) => ({
      ...current,
      ...Object.fromEntries(fields.map((field) => [field, undefined])),
      ...nextFieldErrors,
    }))
  }

  const validateContactStep = () => {
    const result = contactStepSchema.safeParse({
      contactId: selectedContact?.id ?? "",
    })

    if (result.success) {
      clearFieldError("contactId")
      return true
    }

    applySchemaErrors(result, ["contactId"])
    return false
  }

  const validateFollowUpStep = () => {
    const result = followUpStepSchema.safeParse({
      templateId,
      assignedProfessionalId,
      followUpAssignedToUserId,
    })

    if (result.success) {
      setErrors((current) => ({
        ...current,
        templateId: undefined,
        assignedProfessionalId: undefined,
        followUpAssignedToUserId: undefined,
      }))
      return true
    }

    applySchemaErrors(result, [
      "templateId",
      "assignedProfessionalId",
      "followUpAssignedToUserId",
    ])
    return false
  }

  const validatePaymentStep = () => {
    const result = paymentStepSchema.safeParse({
      paymentMode,
      initialPaymentUsd,
      notes,
    })

    if (result.success) {
      setErrors((current) => ({
        ...current,
        paymentMode: undefined,
        initialPaymentUsd: undefined,
        notes: undefined,
      }))
      return true
    }

    applySchemaErrors(result, ["paymentMode", "initialPaymentUsd", "notes"])
    return false
  }

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
    setErrors({})
  }

  useEffect(() => {
    if (!open) return
    if (followUpAssigneeOptions.length > 0) return

    const loadAssignees = async () => {
      setIsLoadingAssignees(true)

      try {
        const { data } = await api.get<TenantAssigneesResponse>(
          `/api/tasks/${encodeURIComponent(tenantId)}/assignees`,
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
          `/api/contacts/${encodeURIComponent(tenantId)}/search`,
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
      if (!validateContactStep()) {
        toast.error("Select a contact.")
        return
      }

      setStep(2)
      return
    }

    if (step === 2) {
      if (!validateFollowUpStep()) {
        toast.error("Review the follow-up selections.")
        return
      }

      setStep(3)
      return
    }

    if (!validatePaymentStep()) {
      toast.error("Review the payment details.")
      return
    }

    setStep(4)
  }

  const goToPreviousStep = () => {
    setStep((current) => (current === 1 ? 1 : ((current - 1) as 1 | 2 | 3 | 4)))
  }

  const onSubmit = async () => {
    if (!validateContactStep()) {
      setStep(1)
      toast.error("Select a contact.")
      return
    }

    if (!validateFollowUpStep()) {
      setStep(2)
      toast.error("Review the follow-up selections.")
      return
    }

    if (!validatePaymentStep()) {
      setStep(4)
      toast.error("Review the payment details.")
      return
    }

    if (!selectedContact) {
      setStep(1)
      toast.error("Select a contact.")
      return
    }

    const totalPriceCents = service.basePriceCents

    const initialPaymentCents =
      paymentMode === "FULL"
        ? totalPriceCents
        : paymentMode === "LATER"
          ? 0
          : parseUsdToCents(initialPaymentUsd)

    setIsSaving(true)

    try {
      const { data } = await api.post<CreateContactServiceResponse>(
        `/api/services/${encodeURIComponent(tenantId)}/contact-services`,
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
      onOpenChange(false)
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
        onOpenChange(nextOpen)
        if (!nextOpen) resetForm()
      }}
    >
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
                      onChange={(event) => {
                        clearFieldError("contactId")
                        setContactSearchQuery(event.target.value)
                      }}
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
                              clearFieldError("contactId")
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
                {errors.contactId ? (
                  <p className="text-xs text-rose-600">{errors.contactId}</p>
                ) : null}
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
                    onValueChange={(value) => {
                      clearFieldError("templateId")
                      setTemplateId(value === "default" ? "" : value)
                    }}
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
                  {errors.templateId ? (
                    <p className="text-xs text-rose-600">{errors.templateId}</p>
                  ) : null}
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
                    onValueChange={(value) => {
                      clearFieldError("assignedProfessionalId")
                      setAssignedProfessionalId(value)
                    }}
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
                  {errors.assignedProfessionalId ? (
                    <p className="text-xs text-rose-600">{errors.assignedProfessionalId}</p>
                  ) : null}
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
                    onValueChange={(value) => {
                      clearFieldError("followUpAssignedToUserId")
                      setFollowUpAssignedToUserId(value)
                    }}
                    disabled={isLoadingAssignees}
                  />
                  {isLoadingAssignees ? (
                    <p className="text-xs text-slate-500">Loading tenant users...</p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      You can leave this unassigned and route follow-up later.
                    </p>
                  )}
                  {errors.followUpAssignedToUserId ? (
                    <p className="text-xs text-rose-600">
                      {errors.followUpAssignedToUserId}
                    </p>
                  ) : null}
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
                    onValueChange={(value) => {
                      clearFieldError("paymentMode")
                      clearFieldError("initialPaymentUsd")
                      setPaymentMode(value as "FULL" | "PARTIAL" | "LATER")
                    }}
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
                  {errors.paymentMode ? (
                    <p className="text-xs text-rose-600">{errors.paymentMode}</p>
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
                    onChange={(event) => {
                      clearFieldError("initialPaymentUsd")
                      setInitialPaymentUsd(event.target.value)
                    }}
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
                  {errors.initialPaymentUsd ? (
                    <p className="text-xs text-rose-600">{errors.initialPaymentUsd}</p>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-notes">Notes</Label>
                  <Textarea
                    id="service-transaction-notes"
                    rows={4}
                    value={notes}
                    onChange={(event) => {
                      clearFieldError("notes")
                      setNotes(event.target.value)
                    }}
                    placeholder="Add any notes about this service transaction"
                  />
                  {errors.notes ? (
                    <p className="text-xs text-rose-600">{errors.notes}</p>
                  ) : null}
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
  initialSummary = null,
}: ServiceOverviewPanelProps) {
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<
    "overview" | "checklist" | "follow-up-templates" | "professionals"
  >("overview")
  const [rangePreset, setRangePreset] = useState<DateRangePreset>("THIS_MONTH")
  const defaultCustomRange = getDefaultCustomDateRange()
  const [customFrom, setCustomFrom] = useState(defaultCustomRange.from)
  const [customTo, setCustomTo] = useState(defaultCustomRange.to)
  const [summary, setSummary] = useState<ServiceSummaryResponse["summary"] | null>(
    initialSummary,
  )
  const [isSummaryLoading, setIsSummaryLoading] = useState(false)
  const [summaryErrorMessage, setSummaryErrorMessage] = useState<string | null>(null)
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
    (total, template) => total + template.flowNodeCount,
    0,
  )
  const customDateRange = useMemo<DateRange | undefined>(
    () => ({
      from: parseDateOnlyToLocalDate(customFrom),
      to: parseDateOnlyToLocalDate(customTo),
    }),
    [customFrom, customTo],
  )
  const summaryRangeLabel = summary ? formatSummaryRangeLabel(summary.range) : ""

  const paymentSummary = service.allowPartialPayments
    ? service.installmentCount && service.installmentFrequency
      ? `Minimum deposit ${service.minimumPartialPaymentCents !== null ? formatCurrency(service.minimumPartialPaymentCents, service.currency) : "required"} · ${service.installmentCount} ${INSTALLMENT_FREQUENCY_LABELS[service.installmentFrequency].toLowerCase()} installments`
      : "Partial payments allowed"
    : "Full payment only"

  useEffect(() => {
    if (rangePreset === "CUSTOM") {
      if (!customFrom || !customTo) {
        setSummary(null)
        setSummaryErrorMessage("Select a start and end date for the custom range.")
        return
      }

      if (customFrom > customTo) {
        setSummary(null)
        setSummaryErrorMessage("End date must be the same day or after start date.")
        return
      }
    }

    const matchesInitialSummary =
      initialSummary &&
      initialSummary.range.preset === rangePreset &&
      (rangePreset !== "CUSTOM" ||
        (initialSummary.range.from === customFrom && initialSummary.range.to === customTo))

    if (matchesInitialSummary) {
      setSummary(initialSummary)
      setIsSummaryLoading(false)
      setSummaryErrorMessage(null)
      return
    }

    let cancelled = false

    const loadSummary = async () => {
      setIsSummaryLoading(true)
      setSummaryErrorMessage(null)

      try {
        const { data } = await api.get<ServiceSummaryResponse>(
          `/api/services/${encodeURIComponent(tenantId)}/catalog/${encodeURIComponent(service.id)}/summary`,
          {
            params: {
              preset: rangePreset,
              ...(rangePreset === "CUSTOM"
                ? {
                    from: customFrom,
                    to: customTo,
                  }
                : {}),
            },
          },
        )

        if (cancelled) return
        setSummary(data.summary)
      } catch (error) {
        if (cancelled) return
        setSummary(null)
        if (isAxiosError(error)) {
          const backendError = error.response?.data?.error
          setSummaryErrorMessage(
            typeof backendError === "string"
              ? backendError.replace(/_/g, " ")
              : "Could not load service summary.",
          )
        } else {
          setSummaryErrorMessage("Could not load service summary.")
        }
      } finally {
        if (cancelled) return
        setIsSummaryLoading(false)
      }
    }

    void loadSummary()

    return () => {
      cancelled = true
    }
  }, [customFrom, customTo, initialSummary, rangePreset, service.id, tenantId])

  useEffect(() => {
    window.__tenantShellServiceBreadcrumbLabel = service.name
    window.dispatchEvent(
      new CustomEvent("service-breadcrumb-updated", {
        detail: { label: service.name },
      }),
    )

    return () => {
      window.__tenantShellServiceBreadcrumbLabel = null
      window.dispatchEvent(
        new CustomEvent("service-breadcrumb-updated", {
          detail: { label: null },
        }),
      )
    }
  }, [service.name])

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)]">
        <div className="space-y-5 p-5 lg:p-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
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
                  {service.description?.trim() || "Review the service details, checklist, follow-up setup, and payment rules before you create a transaction."}
                </p>
              </div>
            </div>

            <Button
              type="button"
              className="bg-blue-950 text-white hover:bg-blue-900 lg:self-start"
              onClick={() => setIsTransactionDialogOpen(true)}
            >
              Create transaction
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
                Checklist
              </p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">
                {service.checklistItems.length}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {requiredChecklistCount} required · {optionalChecklistCount} optional
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
      </section>

      <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold tracking-tight text-slate-950">
                Service performance
              </h2>
              <p className="text-sm text-slate-600">
                Review booked sales, open follow-up workload, and remaining balance for this service.
              </p>
            </div>

            <div className="flex flex-col gap-2 xl:items-end">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                {rangePreset === "CUSTOM" ? (
                  <div className="grid gap-1">
                    <Label htmlFor="service-summary-calendar" className="text-xs text-slate-500">
                      Date range
                    </Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          id="service-summary-calendar"
                          type="button"
                          variant="outline"
                          className="min-w-[260px] justify-start border-white/80 bg-white/80 text-left font-normal text-blue-950 shadow-sm hover:bg-white"
                        >
                          <CalendarDays className="mr-2 h-4 w-4 shrink-0 text-blue-700" />
                          <span className="truncate">{formatCalendarRangeLabel(customDateRange)}</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-auto border-none bg-transparent p-0 shadow-none"
                      >
                        <Card className="w-fit gap-0 rounded-2xl border-slate-200 p-0 shadow-xl">
                          <CardContent className="p-0">
                            <Calendar
                              mode="range"
                              defaultMonth={customDateRange?.from}
                              selected={customDateRange}
                              onSelect={(nextRange) => {
                                const nextFrom = nextRange?.from
                                const nextTo = nextRange?.to
                                setCustomFrom(nextFrom ? formatDateOnly(nextFrom) : "")
                                setCustomTo(nextTo ? formatDateOnly(nextTo) : "")
                              }}
                              numberOfMonths={2}
                              disabled={(date) =>
                                date > new Date() || date < new Date("1900-01-01")
                              }
                            />
                          </CardContent>
                        </Card>
                      </PopoverContent>
                    </Popover>
                  </div>
                ) : null}

                <div className="grid gap-1">
                  <Label htmlFor="service-summary-range" className="text-xs text-slate-500">
                    Summary range
                  </Label>
                  <Select
                    value={rangePreset}
                    onValueChange={(value) => {
                      const nextPreset = value as DateRangePreset
                      setRangePreset(nextPreset)

                      if (nextPreset === "CUSTOM" && (!customFrom || !customTo)) {
                        const nextRange = getDefaultCustomDateRange()
                        setCustomFrom(nextRange.from)
                        setCustomTo(nextRange.to)
                      }
                    }}
                  >
                    <SelectTrigger
                      id="service-summary-range"
                      className="w-full min-w-[180px] border-white/80 bg-white/80 text-blue-950 shadow-sm sm:w-[180px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_RANGE_PRESET_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          {summaryErrorMessage ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {summaryErrorMessage}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <article className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-6 shadow-sm backdrop-blur">
              <div className="flex items-center gap-2 text-slate-400">
                <Wallet className="h-4 w-4 text-emerald-600" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Gross Sales</p>
              </div>
              {isSummaryLoading && !summary ? (
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-8 w-28 rounded-lg" />
                  <Skeleton className="h-4 w-40 rounded-md" />
                </div>
              ) : (
                <>
                  <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-950">
                    {formatCurrency(summary?.grossSalesCents ?? 0, service.currency)}
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    {summary ? summaryRangeLabel : "Sales booked in the selected range."}
                  </p>
                </>
              )}
            </article>

            <article className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-6 shadow-sm backdrop-blur">
              <div className="flex items-center gap-2 text-slate-400">
                <CalendarDays className="h-4 w-4 text-blue-600" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Services Sold</p>
              </div>
              {isSummaryLoading && !summary ? (
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-8 w-16 rounded-lg" />
                  <Skeleton className="h-4 w-44 rounded-md" />
                </div>
              ) : (
                <>
                  <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-950">
                    {summary?.servicesSold ?? 0}
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    Transactions created in the selected range.
                  </p>
                </>
              )}
            </article>

            <article className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-6 shadow-sm backdrop-blur">
              <div className="flex items-center gap-2 text-slate-400">
                <Route className="h-4 w-4 text-amber-600" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Active Follow-Ups</p>
              </div>
              {isSummaryLoading && !summary ? (
                <div className="mt-3 flex flex-col items-start gap-2">
                  <Skeleton className="h-8 w-16 rounded-lg" />
                  <Skeleton className="h-6 w-12 rounded-full" />
                </div>
              ) : (
                <div className="mt-3 flex flex-col items-start gap-2">
                  <p className="truncate text-2xl font-semibold tracking-tight text-slate-950">
                    {summary?.activeFollowUpServices ?? 0}
                  </p>
                  <Badge
                    variant="secondary"
                    className="border border-amber-200 bg-amber-50 text-amber-700"
                  >
                    Live
                  </Badge>
                </div>
              )}
            </article>

            <article className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-6 shadow-sm backdrop-blur">
              <div className="flex items-center gap-2 text-slate-400">
                <Wallet className="h-4 w-4 text-violet-600" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Remaining Balance</p>
              </div>
              {isSummaryLoading && !summary ? (
                <div className="mt-3 flex flex-col items-start gap-2">
                  <Skeleton className="h-8 w-28 rounded-lg" />
                  <Skeleton className="h-6 w-12 rounded-full" />
                </div>
              ) : (
                <div className="mt-3 flex flex-col items-start gap-2">
                  <p className="truncate text-2xl font-semibold tracking-tight text-slate-950">
                    {formatCurrency(summary?.remainingBalanceCents ?? 0, service.currency)}
                  </p>
                  <Badge
                    variant="secondary"
                    className="border border-violet-200 bg-violet-50 text-violet-700"
                  >
                    Live
                  </Badge>
                </div>
              )}
            </article>
          </div>
        </div>
      </section>

      <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
        <Tabs
          value={activeTab}
          onValueChange={(value) =>
            setActiveTab(
              value as "overview" | "checklist" | "follow-up-templates" | "professionals",
            )
          }
          className="space-y-5"
        >
          <div className="overflow-x-auto">
            <TabsList className="inline-flex h-auto min-w-max items-center gap-2 rounded-none bg-transparent p-0">
              <TabsTrigger
                value="overview"
                className="inline-flex h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-slate-600 shadow-none transition hover:bg-blue-900/10 hover:text-slate-900 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-none md:text-sm"
              >
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="checklist"
                className="inline-flex h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-slate-600 shadow-none transition hover:bg-blue-900/10 hover:text-slate-900 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-none md:text-sm"
              >
                Checklist
              </TabsTrigger>
              <TabsTrigger
                value="follow-up-templates"
                className="inline-flex h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-slate-600 shadow-none transition hover:bg-blue-900/10 hover:text-slate-900 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-none md:text-sm"
              >
                Follow-Up Templates
              </TabsTrigger>
              <TabsTrigger
                value="professionals"
                className="inline-flex h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-slate-600 shadow-none transition hover:bg-blue-900/10 hover:text-slate-900 data-[state=active]:bg-blue-950 data-[state=active]:text-white data-[state=active]:shadow-none md:text-sm"
              >
                Professionals
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="mt-0 space-y-5">
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
          </TabsContent>

          <TabsContent value="checklist" className="mt-0">
            <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
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
            </section>
          </TabsContent>

          <TabsContent value="follow-up-templates" className="mt-0">
            <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
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
                              {template.flowNodeCount}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700">
                              {template.flowEdgeCount}
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
            </section>
          </TabsContent>

          <TabsContent value="professionals" className="mt-0">
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
          </TabsContent>
        </Tabs>
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
          <Button
            type="button"
            className="bg-blue-950 text-white hover:bg-blue-900"
            onClick={() => setIsTransactionDialogOpen(true)}
          >
            Create transaction
          </Button>
        </div>
      </section>
      {isTransactionDialogOpen ? (
        <CreateTransactionDialog
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          service={service}
          open={isTransactionDialogOpen}
          onOpenChange={setIsTransactionDialogOpen}
        />
      ) : null}
    </div>
  )
}
