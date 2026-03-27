"use client"

import { format } from "date-fns"
import Link from "next/link"
import { isAxiosError } from "axios"
import {
  CalendarDays,
  Check,
  ChevronDown,
  Route,
  UserRound,
  Wallet,
} from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  startTransition,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import { type DateRange } from "react-day-picker"
import { toast } from "sonner"

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
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
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
}

type ServiceListItem = {
  id: string
  name: string
  description: string | null
  basePriceCents: number
  currency: string
  allowPartialPayments: boolean
  minimumPartialPaymentCents: number | null
  isActive: boolean
  sortOrder: number
  checklistItems: ServiceChecklistItem[]
  followUpTemplates: ServiceFollowUpTemplate[]
  professionals: ServiceProfessional[]
}

type ServicesResponse = {
  ok: boolean
  items: ServiceListItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type ServiceOptionsResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
  }>
}

type ServiceDetailsResponse = {
  ok: boolean
  service: {
    id: string
    name: string
    description: string | null
    basePriceCents: number
    currency: string
    allowPartialPayments: boolean
    minimumPartialPaymentCents: number | null
    checklistItems: ServiceChecklistItem[]
    professionals: ServiceProfessional[]
  }
}

type FollowUpTemplatesResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    isPublished: boolean
  }>
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

type ServicesRegistryPanelProps = {
  tenantId: string
  tenantSlug: string
}

type DateRangePreset = "THIS_MONTH" | "LAST_MONTH" | "LAST_3_MONTHS" | "CUSTOM"

type ServicesCatalogSummaryResponse = {
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

const PAGE_SIZE_OPTIONS = [10, 25] as const
const DATE_RANGE_PRESET_OPTIONS: Array<{
  value: DateRangePreset
  label: string
}> = [
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "LAST_3_MONTHS", label: "Last 3 months" },
  { value: "CUSTOM", label: "Custom range" },
]

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
}

function parseDateRangePreset(value: string | null): DateRangePreset {
  return DATE_RANGE_PRESET_OPTIONS.some((option) => option.value === value)
    ? (value as DateRangePreset)
    : "THIS_MONTH"
}

function sanitizeDateOnly(value: string | null) {
  if (!value) return ""
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : ""
}

function formatDateOnly(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function getDefaultCustomDateRange() {
  const today = new Date()
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  return {
    from: formatDateOnly(startOfMonth),
    to: formatDateOnly(today),
  }
}

function parseDateOnlyToLocalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined

  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return undefined
  return date
}

function formatCalendarRangeLabel(range?: DateRange) {
  if (!range?.from) return "Pick a custom range"
  if (!range.to) return format(range.from, "MMM d, yyyy")
  return `${format(range.from, "MMM d, yyyy")} - ${format(range.to, "MMM d, yyyy")}`
}

function formatSummaryRangeLabel(
  range: ServicesCatalogSummaryResponse["summary"]["range"],
) {
  const presetLabel =
    DATE_RANGE_PRESET_OPTIONS.find((option) => option.value === range.preset)
      ?.label ?? "This month"

  if (range.preset !== "CUSTOM") return presetLabel

  return `${range.from} to ${range.to}`
}

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

function getProfessionalLabel(professional: ServiceProfessional) {
  return (
    professional.externalProfessionalName?.trim() ||
    professional.user?.name?.trim() ||
    professional.user?.email?.trim() ||
    professional.externalContact?.trim() ||
    "Assigned professional"
  )
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

function getProfessionalTone(professional: ServiceProfessional) {
  return professional.kind === "INTERNAL_USER" ? "internal" : "external"
}

function getProfessionalMeta(professional: ServiceProfessional) {
  if (professional.kind === "INTERNAL_USER") {
    return professional.user?.email?.trim() || "Internal user"
  }

  return professional.externalContact?.trim() || "External professional"
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2)

  if (parts.length === 0) return "?"

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("")
}

function AssignedProfessionalPicker({
  professionals,
  value,
  disabled,
  onValueChange,
}: {
  professionals: ServiceProfessional[]
  value: string
  disabled?: boolean
  onValueChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)

  const selectedProfessional = useMemo(
    () =>
      professionals.find((professional) => professional.id === value) ?? null,
    [professionals, value],
  )

  const selectedLabel = selectedProfessional
    ? getProfessionalLabel(selectedProfessional)
    : "No assigned professional"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id="service-transaction-professional"
          type="button"
          variant="outline"
          className="h-10 w-full justify-between rounded-xl border-slate-200 bg-white px-3 text-left font-normal shadow-sm hover:bg-slate-50"
          disabled={disabled}
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
                      PROFESSIONAL_TONE_STYLES[
                        getProfessionalTone(selectedProfessional)
                      ].fallbackClassName,
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
                <span className="truncate text-[13px] text-slate-500">
                  Unassigned
                </span>
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
                      className={cn(
                        "text-xs font-semibold",
                        toneStyles.fallbackClassName,
                      )}
                    >
                      {getInitials(label)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-slate-900">
                      {label}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {meta}
                    </p>
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
          id="service-transaction-follow-up-assignee"
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
                <span className="truncate text-[13px] text-slate-500">
                  Unassigned
                </span>
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
                  <p className="truncate text-[11px] text-slate-500">
                    {assignee.email}
                  </p>
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

function FlowStepCard({
  stepNumber,
  title,
  description,
  disabled = false,
  children,
}: {
  stepNumber: string
  title: string
  description: string
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3.5 transition-colors",
        disabled
          ? "border-slate-200 bg-slate-50/70"
          : "border-slate-200 bg-white",
      )}
    >
      <div className="mb-2.5 flex items-start gap-3">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            disabled ? "bg-slate-200 text-slate-500" : "bg-blue-950 text-white",
          )}
        >
          {stepNumber}
        </div>
        <div className="min-w-0 space-y-1">
          <p
            className={cn(
              "text-sm font-semibold",
              disabled ? "text-slate-500" : "text-slate-900",
            )}
          >
            {title}
          </p>
          <p className="text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      <div className={cn(disabled ? "opacity-70" : "")}>{children}</div>
    </div>
  )
}

function PurchaseTransactionDialog({
  tenantId,
  tenantSlug,
}: {
  tenantId: string
  tenantSlug: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingServiceOptions, setIsLoadingServiceOptions] = useState(false)
  const [isLoadingServiceDetails, setIsLoadingServiceDetails] = useState(false)
  const [isLoadingAssignees, setIsLoadingAssignees] = useState(false)
  const [isSearchingContacts, setIsSearchingContacts] = useState(false)
  const [serviceOptions, setServiceOptions] = useState<
    Array<{ id: string; name: string }>
  >([])
  const [followUpAssigneeOptions, setFollowUpAssigneeOptions] = useState<
    TenantAssigneeOption[]
  >([])
  const [templateOptions, setTemplateOptions] = useState<
    Array<{ id: string; name: string }>
  >([])
  const [selectedContact, setSelectedContact] =
    useState<ContactSearchResult | null>(null)
  const [contactResults, setContactResults] = useState<ContactSearchResult[]>(
    [],
  )
  const [contactSearchQuery, setContactSearchQuery] = useState("")
  const [debouncedContactSearchQuery, setDebouncedContactSearchQuery] =
    useState("")
  const [serviceId, setServiceId] = useState("")
  const [templateId, setTemplateId] = useState("")
  const [assignedProfessionalId, setAssignedProfessionalId] = useState("")
  const [followUpAssignedToUserId, setFollowUpAssignedToUserId] = useState("")
  const [paymentMode, setPaymentMode] = useState<"FULL" | "PARTIAL" | "LATER">(
    "FULL",
  )
  const [initialPaymentUsd, setInitialPaymentUsd] = useState("")
  const [notes, setNotes] = useState("")
  const [serviceDetails, setServiceDetails] = useState<
    ServiceDetailsResponse["service"] | null
  >(null)

  const resetForm = useCallback(() => {
    setStep(1)
    setIsSaving(false)
    setSelectedContact(null)
    setContactResults([])
    setContactSearchQuery("")
    setDebouncedContactSearchQuery("")
    setServiceId("")
    setTemplateId("")
    setAssignedProfessionalId("")
    setFollowUpAssignedToUserId("")
    setPaymentMode("FULL")
    setInitialPaymentUsd("")
    setNotes("")
    setTemplateOptions([])
    setServiceDetails(null)
  }, [])

  const loadServiceOptions = useCallback(async () => {
    setIsLoadingServiceOptions(true)

    try {
      const { data } = await api.get<ServiceOptionsResponse>(
        `/api/account-settings/${tenantId}/services/options`,
      )
      setServiceOptions(data.items ?? [])
    } catch {
      setServiceOptions([])
      toast.error("Could not load services.")
    } finally {
      setIsLoadingServiceOptions(false)
    }
  }, [tenantId])

  const loadFollowUpAssigneeOptions = useCallback(async () => {
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
  }, [tenantId])

  const loadTemplateOptions = useCallback(
    async (nextServiceId: string) => {
      if (!nextServiceId) {
        setTemplateOptions([])
        return
      }

      try {
        const { data } = await api.get<FollowUpTemplatesResponse>(
          `/api/account-settings/${tenantId}/services/${nextServiceId}/follow-up-templates`,
        )

        setTemplateOptions(
          (data.items ?? [])
            .filter((item) => item.isPublished !== false)
            .map((item) => ({ id: item.id, name: item.name })),
        )
      } catch {
        setTemplateOptions([])
      }
    },
    [tenantId],
  )

  const loadServiceDetails = useCallback(
    async (nextServiceId: string) => {
      if (!nextServiceId) {
        setServiceDetails(null)
        return
      }

      setIsLoadingServiceDetails(true)

      try {
        const { data } = await api.get<ServiceDetailsResponse>(
          `/api/account-settings/${tenantId}/services/${nextServiceId}`,
        )
        setServiceDetails(data.service)
        setPaymentMode((current) => {
          if (current === "PARTIAL" && !data.service.allowPartialPayments) {
            return "FULL"
          }
          return current
        })
      } catch {
        setServiceDetails(null)
        toast.error("Could not load service details.")
      } finally {
        setIsLoadingServiceDetails(false)
      }
    },
    [tenantId],
  )

  useEffect(() => {
    if (!open) return
    if (serviceOptions.length > 0) return
    void loadServiceOptions()
  }, [open, serviceOptions.length, loadServiceOptions])

  useEffect(() => {
    if (!open) return
    if (followUpAssigneeOptions.length > 0) return
    void loadFollowUpAssigneeOptions()
  }, [open, followUpAssigneeOptions.length, loadFollowUpAssigneeOptions])

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
    if (!open || serviceId.length === 0) return
    void loadTemplateOptions(serviceId)
    void loadServiceDetails(serviceId)
  }, [open, serviceId, loadTemplateOptions, loadServiceDetails])

  useEffect(() => {
    if (!templateOptions.some((item) => item.id === templateId)) {
      setTemplateId("")
    }
  }, [templateId, templateOptions])

  useEffect(() => {
    if (!serviceDetails) {
      setAssignedProfessionalId("")
      return
    }

    if (
      !serviceDetails.professionals.some(
        (item) => item.id === assignedProfessionalId,
      )
    ) {
      setAssignedProfessionalId("")
    }
  }, [assignedProfessionalId, serviceDetails])

  useEffect(() => {
    if (!open) return
    if (selectedContact) return

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

  const stepTitle = useMemo(() => {
    if (step === 1) return "Pick contact"
    if (step === 2) return "Choose service"
    if (step === 3) return "Set up follow up"
    if (step === 4) return "Review checklist"
    return "Payment details"
  }, [step])

  const stepDescription = useMemo(() => {
    if (step === 1) {
      return "Choose the contact that is purchasing this service."
    }
    if (step === 2) {
      return "Choose the service and optionally assign the professional delivering it."
    }
    if (step === 3) {
      return "Choose the follow-up template and the user responsible for the enrolled follow-up work."
    }
    if (step === 4) {
      return "Review the checklist items that will be created for this contact before you move to payment."
    }
    return "Review payment, cost, and notes before creating the transaction."
  }, [step])

  const goToNextStep = () => {
    if (step === 1) {
      if (!selectedContact) {
        toast.error("Select a contact.")
        return
      }

      setStep(2)
      return
    }

    if (!serviceId) {
      toast.error("Select a service.")
      return
    }

    if (!serviceDetails || isLoadingServiceDetails) {
      toast.error("Wait for the service details to finish loading.")
      return
    }

    if (step === 2) {
      setStep(3)
      return
    }

    if (step === 3) {
      setStep(4)
      return
    }

    setStep(5)
  }

  const goToPreviousStep = () => {
    setStep((current) =>
      current === 1 ? 1 : ((current - 1) as 1 | 2 | 3 | 4 | 5),
    )
  }

  const onSubmit = async () => {
    if (!selectedContact) {
      toast.error("Select a contact.")
      return
    }

    if (!serviceId) {
      toast.error("Select a service.")
      return
    }

    const totalPriceCents = serviceDetails?.basePriceCents ?? null
    if (totalPriceCents === null) {
      toast.error("Select a valid service.")
      return
    }

    if (paymentMode === "PARTIAL" && !serviceDetails?.allowPartialPayments) {
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
        serviceDetails?.minimumPartialPaymentCents !== null &&
        serviceDetails?.minimumPartialPaymentCents !== undefined &&
        initialPaymentCents < serviceDetails.minimumPartialPaymentCents
      ) {
        toast.error(
          "Partial payment is below the minimum allowed for this service.",
        )
        return
      }
    }

    setIsSaving(true)

    try {
      const { data } = await api.post<CreateContactServiceResponse>(
        `/api/services/${tenantId}/contact-services`,
        {
          contactId: selectedContact.id,
          serviceId,
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
        <Button
          type="button"
          className="bg-blue-950 text-white hover:bg-blue-950/90"
        >
          Create transaction
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Create service transaction</DialogTitle>
          <DialogDescription>{stepDescription}</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto py-1 pr-1">
          <div className="flex items-center gap-2">
            {[
              { value: 1, label: "Contact" },
              { value: 2, label: "Service" },
              { value: 3, label: "Follow up" },
              { value: 4, label: "Checklist" },
              { value: 5, label: "Payment" },
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
                  {item.value < 5 ? (
                    <div className="mx-1 h-px w-6 bg-slate-200" />
                  ) : null}
                </div>
              )
            })}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                {stepTitle}
              </p>
              {selectedContact ? (
                <p className="text-sm text-slate-600">
                  Contact:{" "}
                  <span className="font-medium text-slate-900">
                    {selectedContact.fullName}
                  </span>
                </p>
              ) : null}
              {serviceDetails ? (
                <p className="text-sm text-slate-600">
                  Service:{" "}
                  <span className="font-medium text-slate-900">
                    {serviceDetails.name}
                  </span>
                </p>
              ) : null}
            </div>
          </div>

          {step === 1 ? (
            <section className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="service-transaction-contact-search">
                  Contact
                </Label>
                {selectedContact ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-slate-900">
                          {selectedContact.fullName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {selectedContact.email ||
                            selectedContact.phoneNumber ||
                            "No email or phone"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
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
                      onChange={(event) =>
                        setContactSearchQuery(event.target.value)
                      }
                      placeholder="Search contacts by name, email, or phone"
                    />
                    <div className="rounded-xl border border-slate-200 bg-white">
                      {contactSearchQuery.trim().length < 2 ? (
                        <p className="px-3 py-3 text-sm text-slate-500">
                          Type at least 2 characters to search contacts.
                        </p>
                      ) : isSearchingContacts ? (
                        <p className="px-3 py-3 text-sm text-slate-500">
                          Searching contacts...
                        </p>
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
                                {contact.email ||
                                  contact.phoneNumber ||
                                  "No email or phone"}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="px-3 py-3 text-sm text-slate-500">
                          No contacts found.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="space-y-3">
              <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-3.5">
                <p className="text-sm font-semibold text-blue-950">
                  Set up what this transaction should start
                </p>
                <p className="mt-1 text-sm leading-5 text-blue-900/80">
                  Pick the service first. That unlocks the follow-up template
                  and the professionals available for this transaction.
                </p>
              </div>

              <FlowStepCard
                stepNumber="1"
                title="Which service is being purchased?"
                description="This decides the cost, payment rules, checklist items, and which professionals can be assigned."
              >
                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-service">Service</Label>
                  <Select
                    value={serviceId}
                    onValueChange={(value) => {
                      setServiceId(value)
                      setTemplateId("")
                    }}
                    disabled={isLoadingServiceOptions}
                  >
                    <SelectTrigger id="service-transaction-service">
                      <SelectValue
                        placeholder={
                          isLoadingServiceOptions
                            ? "Loading services..."
                            : "Select a service"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {serviceOptions.map((service) => (
                        <SelectItem key={service.id} value={service.id}>
                          {service.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    Start by choosing the service the contact is buying.
                  </p>
                </div>
              </FlowStepCard>

              <FlowStepCard
                stepNumber="2"
                title="Assign a professional?"
                description="Optional. Use this when someone should own or deliver the service from the start."
                disabled={!serviceId}
              >
                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-professional">
                    Professional
                  </Label>
                  <AssignedProfessionalPicker
                    value={assignedProfessionalId}
                    onValueChange={setAssignedProfessionalId}
                    professionals={serviceDetails?.professionals ?? []}
                    disabled={!serviceDetails}
                  />
                  {!serviceId ? (
                    <p className="text-xs text-slate-500">
                      Choose a service first to load the professionals linked to
                      it.
                    </p>
                  ) : serviceDetails &&
                    serviceDetails.professionals.length === 0 ? (
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
            </section>
          ) : null}

          {step === 3 ? (
            <section className="space-y-3">
              <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-3.5">
                <p className="text-sm font-semibold text-violet-950">
                  Set up the follow-up workflow
                </p>
                <p className="mt-1 text-sm leading-5 text-violet-900/80">
                  Choose which follow-up template to start and who should be in
                  charge of the enrolled follow-up steps.
                </p>
              </div>

              <FlowStepCard
                stepNumber="1"
                title="Which follow-up plan should start?"
                description="Use the default published template or choose a different one for this transaction."
                disabled={!serviceId}
              >
                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-template">
                    Follow-Up Template
                  </Label>
                  <Select
                    value={templateId || "default"}
                    onValueChange={(value) =>
                      setTemplateId(value === "default" ? "" : value)
                    }
                    disabled={!serviceId}
                  >
                    <SelectTrigger id="service-transaction-template">
                      <SelectValue placeholder="Use default template selection" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">
                        Use default published template
                      </SelectItem>
                      {templateOptions.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!serviceId ? (
                    <p className="text-xs text-slate-500">
                      Choose a service first to load its available follow-up
                      templates.
                    </p>
                  ) : templateOptions.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No published templates are available for this service. The
                      transaction can still proceed if the service has default
                      follow-up steps.
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Leaving this on default uses the service&apos;s standard
                      published template.
                    </p>
                  )}
                </div>
              </FlowStepCard>

              <FlowStepCard
                stepNumber="2"
                title="Who should be in charge of the follow up?"
                description="Optional. This user will be assigned to the follow-up steps created from the selected template."
                disabled={!serviceId}
              >
                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-follow-up-assignee">
                    Follow-Up Owner
                  </Label>
                  <FollowUpAssigneePicker
                    assignees={followUpAssigneeOptions}
                    value={followUpAssignedToUserId}
                    onValueChange={setFollowUpAssignedToUserId}
                    disabled={!serviceId || isLoadingAssignees}
                  />
                  {!serviceId ? (
                    <p className="text-xs text-slate-500">
                      Choose a service first before assigning follow-up
                      ownership.
                    </p>
                  ) : isLoadingAssignees ? (
                    <p className="text-xs text-slate-500">
                      Loading tenant users...
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      You can leave this unassigned and route follow-up later.
                    </p>
                  )}
                </div>
              </FlowStepCard>
            </section>
          ) : null}

          {step === 4 ? (
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

              {serviceDetails && serviceDetails.checklistItems.length > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">
                      Checklist for {serviceDetails.name}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      Required items should be completed for the contact before
                      the service is considered finished.
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
                      {serviceDetails.checklistItems.map((item, index) => (
                        <TableRow key={item.id}>
                          <TableCell className="align-middle text-sm text-slate-500">
                            {index + 1}
                          </TableCell>
                          <TableCell className="align-middle">
                            <span className="text-sm font-medium text-slate-900">
                              {item.label}
                            </span>
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
                    You can continue directly to payment.
                  </p>
                </div>
              )}

              <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Next
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  After this, you&apos;ll choose the payment type, confirm how
                  much is paid now, and add any notes.
                </p>
              </div>
            </section>
          ) : null}

          {step === 5 ? (
            <section className="grid gap-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-payment-type">
                    Payment Type
                  </Label>
                  <Select
                    value={paymentMode}
                    onValueChange={(value) =>
                      setPaymentMode(value as "FULL" | "PARTIAL" | "LATER")
                    }
                    disabled={!serviceDetails}
                  >
                    <SelectTrigger id="service-transaction-payment-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FULL">Pay in Full</SelectItem>
                      <SelectItem
                        value="PARTIAL"
                        disabled={!serviceDetails?.allowPartialPayments}
                      >
                        Partial Payment
                      </SelectItem>
                      <SelectItem value="LATER">Pay Later</SelectItem>
                    </SelectContent>
                  </Select>
                  {!serviceDetails?.allowPartialPayments && serviceId ? (
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
                    value={
                      serviceDetails
                        ? centsToUsdInput(serviceDetails.basePriceCents)
                        : ""
                    }
                    className="bg-slate-50 text-slate-600"
                  />
                </div>
              </div>

              {assignedProfessionalId && serviceDetails ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Assigned professional:{" "}
                  <span className="font-medium text-slate-900">
                    {getProfessionalLabel(
                      serviceDetails.professionals.find(
                        (item) => item.id === assignedProfessionalId,
                      )!,
                    )}
                  </span>
                </div>
              ) : null}

              {followUpAssignedToUserId ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Follow-up owner:{" "}
                  <span className="font-medium text-slate-900">
                    {followUpAssigneeOptions.find(
                      (item) => item.value === followUpAssignedToUserId,
                    )?.label ?? "Assigned user"}
                  </span>
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-payment-now">
                    {paymentMode === "PARTIAL"
                      ? "Partial Payment Amount"
                      : "Payment Now"}
                  </Label>
                  <Input
                    id="service-transaction-payment-now"
                    value={
                      paymentMode === "PARTIAL"
                        ? initialPaymentUsd
                        : paymentMode === "LATER"
                          ? "0.00"
                          : serviceDetails
                            ? centsToUsdInput(serviceDetails.basePriceCents)
                            : ""
                    }
                    onChange={(event) =>
                      setInitialPaymentUsd(event.target.value)
                    }
                    readOnly={paymentMode !== "PARTIAL"}
                    inputMode="decimal"
                    placeholder="0.00"
                    className={
                      paymentMode === "PARTIAL"
                        ? undefined
                        : "bg-slate-50 text-slate-600"
                    }
                  />
                  {paymentMode === "PARTIAL" &&
                  serviceDetails?.minimumPartialPaymentCents ? (
                    <p className="text-xs text-slate-500">
                      Minimum partial payment:{" "}
                      {formatCurrency(
                        serviceDetails.minimumPartialPaymentCents,
                        serviceDetails.currency,
                      )}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="service-transaction-notes">Notes</Label>
                  <Textarea
                    id="service-transaction-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={3}
                    placeholder="Add context for this service purchase"
                  />
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t border-slate-200 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          {step > 1 ? (
            <Button type="button" variant="outline" onClick={goToPreviousStep}>
              Back
            </Button>
          ) : null}
          {step < 5 ? (
            <Button
              type="button"
              onClick={goToNextStep}
              className="bg-blue-950 text-white hover:bg-blue-950/90"
            >
              Next
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void onSubmit()}
              disabled={isSaving}
              className="bg-blue-950 text-white hover:bg-blue-950/90"
            >
              {isSaving ? "Creating..." : "Create transaction"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ServicesRegistryPanel({
  tenantId,
  tenantSlug,
}: ServicesRegistryPanelProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const initialRangePreset = parseDateRangePreset(
    searchParams.get("rangePreset"),
  )
  const initialCustomRange = getDefaultCustomDateRange()
  const [query, setQuery] = useState(() => searchParams.get("search") ?? "")
  const [debouncedQuery, setDebouncedQuery] = useState(() =>
    (searchParams.get("search") ?? "").trim(),
  )
  const [page, setPage] = useState(() =>
    parsePositiveInt(searchParams.get("page"), 1),
  )
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(
    () => {
      const parsed = parsePositiveInt(searchParams.get("pageSize"), 10)
      return parsed === 25 ? 25 : 10
    },
  )
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<ServicesResponse | null>(null)
  const [rangePreset, setRangePreset] =
    useState<DateRangePreset>(initialRangePreset)
  const [customFrom, setCustomFrom] = useState(() =>
    initialRangePreset === "CUSTOM"
      ? sanitizeDateOnly(searchParams.get("from")) || initialCustomRange.from
      : "",
  )
  const [customTo, setCustomTo] = useState(() =>
    initialRangePreset === "CUSTOM"
      ? sanitizeDateOnly(searchParams.get("to")) || initialCustomRange.to
      : "",
  )
  const [summary, setSummary] = useState<
    ServicesCatalogSummaryResponse["summary"] | null
  >(null)
  const [isSummaryLoading, setIsSummaryLoading] = useState(false)
  const [summaryErrorMessage, setSummaryErrorMessage] = useState<string | null>(
    null,
  )
  const customDateRange = useMemo<DateRange | undefined>(() => {
    if (!customFrom && !customTo) return undefined

    return {
      from: customFrom ? parseDateOnlyToLocalDate(customFrom) : undefined,
      to: customTo ? parseDateOnlyToLocalDate(customTo) : undefined,
    }
  }, [customFrom, customTo])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(1)
    }, 350)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [query])

  useEffect(() => {
    const nextParams = new URLSearchParams()

    if (debouncedQuery) nextParams.set("search", debouncedQuery)
    if (page > 1) nextParams.set("page", String(page))
    if (pageSize !== 10) nextParams.set("pageSize", String(pageSize))
    if (rangePreset !== "THIS_MONTH") nextParams.set("rangePreset", rangePreset)
    if (rangePreset === "CUSTOM") {
      if (customFrom) nextParams.set("from", customFrom)
      if (customTo) nextParams.set("to", customTo)
    }

    const nextQuery = nextParams.toString()
    const currentQuery = searchParams.toString()
    if (nextQuery === currentQuery) return

    startTransition(() => {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      })
    })
  }, [
    customFrom,
    customTo,
    debouncedQuery,
    page,
    pageSize,
    pathname,
    rangePreset,
    router,
    searchParams,
  ])

  const loadServices = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data: response } = await api.get<ServicesResponse>(
        `/api/account-settings/${tenantId}/services`,
        {
          params: {
            page,
            pageSize,
            search: debouncedQuery || undefined,
            isActive: true,
          },
        },
      )

      if (page > response.pagination.totalPages) {
        setPage(response.pagination.totalPages)
        return
      }

      setData(response)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        setErrorMessage(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ")
            : "Could not load services.",
        )
      } else {
        setErrorMessage("Could not load services.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [debouncedQuery, page, pageSize, tenantId])

  const loadSummary = useCallback(async () => {
    if (rangePreset === "CUSTOM") {
      if (!customFrom || !customTo) {
        setSummary(null)
        setSummaryErrorMessage(
          "Select a start and end date for the custom range.",
        )
        return
      }

      if (customFrom > customTo) {
        setSummary(null)
        setSummaryErrorMessage(
          "End date must be the same day or after start date.",
        )
        return
      }
    }

    setIsSummaryLoading(true)
    setSummaryErrorMessage(null)

    try {
      const { data: response } = await api.get<ServicesCatalogSummaryResponse>(
        `/api/services/${tenantId}/catalog-summary`,
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

      setSummary(response.summary)
    } catch (error) {
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
      setIsSummaryLoading(false)
    }
  }, [customFrom, customTo, rangePreset, tenantId])

  useEffect(() => {
    void loadServices()
  }, [loadServices])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const services = data?.items ?? []
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const startIndex = (page - 1) * pageSize
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages
  const summaryRangeLabel = summary
    ? formatSummaryRangeLabel(summary.range)
    : ""

  const summaryLabel = useMemo(() => {
    if (!total) return "No active services found"
    const start = startIndex + 1
    const end = start + services.length - 1
    return `Showing ${start}-${end} of ${total} services`
  }, [services.length, startIndex, total])

  return (
    <div className="flex h-full w-full min-h-0 flex-col gap-4">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-2">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
                  Service overview
                </h1>
                <p className="text-sm text-slate-600">
                  Track booked sales, open follow-up workload, and remaining
                  balance in one place.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 xl:items-end">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                {rangePreset === "CUSTOM" ? (
                  <div className="grid gap-1">
                    <Label
                      htmlFor="services-summary-calendar"
                      className="text-xs text-slate-500"
                    >
                      Date range
                    </Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          id="services-summary-calendar"
                          type="button"
                          variant="outline"
                          className="min-w-[260px] justify-start border-white/80 bg-white/80 text-left font-normal text-blue-950 shadow-sm hover:bg-white"
                        >
                          <CalendarDays className="mr-2 h-4 w-4 shrink-0 text-blue-700" />
                          <span className="truncate">
                            {formatCalendarRangeLabel(customDateRange)}
                          </span>
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
                                setCustomFrom(
                                  nextFrom ? formatDateOnly(nextFrom) : "",
                                )
                                setCustomTo(
                                  nextTo ? formatDateOnly(nextTo) : "",
                                )
                              }}
                              numberOfMonths={2}
                              disabled={(date) =>
                                date > new Date() ||
                                date < new Date("1900-01-01")
                              }
                            />
                          </CardContent>
                        </Card>
                      </PopoverContent>
                    </Popover>
                  </div>
                ) : null}

                <div className="grid gap-1">
                  <Label
                    htmlFor="services-summary-range"
                    className="text-xs text-slate-500"
                  >
                    Summary range
                  </Label>
                  <Select
                    value={rangePreset}
                    onValueChange={(value) => {
                      const nextPreset = value as DateRangePreset
                      setRangePreset(nextPreset)

                      if (
                        nextPreset === "CUSTOM" &&
                        (!customFrom || !customTo)
                      ) {
                        const nextRange = getDefaultCustomDateRange()
                        setCustomFrom(nextRange.from)
                        setCustomTo(nextRange.to)
                      }
                    }}
                  >
                    <SelectTrigger
                      id="services-summary-range"
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                  Gross Sales
                </p>
              </div>
              {isSummaryLoading && !summary ? (
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-8 w-28 rounded-lg" />
                  <Skeleton className="h-4 w-40 rounded-md" />
                </div>
              ) : (
                <>
                  <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-950">
                    {formatCurrency(summary?.grossSalesCents ?? 0, "USD")}
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    {summary
                      ? summaryRangeLabel
                      : "Sales booked in the selected range."}
                  </p>
                </>
              )}
            </article>

            <article className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-6 shadow-sm backdrop-blur">
              <div className="flex items-center gap-2 text-slate-400">
                <CalendarDays className="h-4 w-4 text-blue-600" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                  Services Sold
                </p>
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
                    {summary
                      ? summaryRangeLabel
                      : "Transactions created in the selected range."}
                  </p>
                </>
              )}
            </article>

            <article className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-6 shadow-sm backdrop-blur">
              <div className="flex items-center gap-2 text-slate-400">
                <Route className="h-4 w-4 text-amber-600" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                  Active Follow-Ups
                </p>
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
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                  Remaining Balance
                </p>
              </div>
              {isSummaryLoading && !summary ? (
                <div className="mt-3 flex flex-col items-start gap-2">
                  <Skeleton className="h-8 w-28 rounded-lg" />
                  <Skeleton className="h-6 w-12 rounded-full" />
                </div>
              ) : (
                <div className="mt-3 flex flex-col items-start gap-2">
                  <p className="truncate text-2xl font-semibold tracking-tight text-slate-950">
                    {formatCurrency(summary?.remainingBalanceCents ?? 0, "USD")}
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
      </div>

      <div className="flex min-h-[680px] w-full flex-1 flex-col rounded-lg bg-white">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-4 md:px-5">
          <div>
            <p className="text-sm text-slate-500">{summaryLabel}</p>
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(320px,1fr)_auto_auto]">
            <Input
              placeholder="Search by service name"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
              onClick={() => {
                setQuery("")
                setDebouncedQuery("")
                setPage(1)
              }}
            >
              Clear Search
            </Button>
            <PurchaseTransactionDialog
              tenantId={tenantId}
              tenantSlug={tenantSlug}
            />
          </div>
        </div>

        <div className="min-h-[520px] flex-1 overflow-auto">
          <Table className="min-w-[1080px] w-full table-fixed [&_td]:px-3 [&_td]:py-3 [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th]:px-3 [&_th]:h-8 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4 md:[&_td:first-child]:pl-5 md:[&_td:last-child]:pr-5 md:[&_th:first-child]:pl-5 md:[&_th:last-child]:pr-5">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[24%] text-xs">Name</TableHead>
                <TableHead className="w-[12%] text-xs">Cost</TableHead>
                <TableHead className="w-[16%] text-xs">
                  Min Partial Payment
                </TableHead>
                <TableHead className="w-[12%] text-xs">Checklists</TableHead>
                <TableHead className="w-[22%] text-xs">Professionals</TableHead>
                <TableHead className="w-[14%] text-xs">
                  Follow-Up Templates
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-slate-500"
                  >
                    Loading services...
                  </TableCell>
                </TableRow>
              ) : errorMessage ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-rose-600"
                  >
                    {errorMessage}
                  </TableCell>
                </TableRow>
              ) : services.length ? (
                services.map((service) => {
                  const checklistCount = service.checklistItems.length
                  const publishedTemplateCount =
                    service.followUpTemplates.filter(
                      (template) => template.isPublished,
                    ).length
                  const serviceHref = `/app/${tenantSlug}/services/${service.id}`

                  return (
                    <TableRow
                      key={service.id}
                      className="transition-colors hover:bg-slate-50"
                    >
                      <TableCell className="align-middle font-medium text-slate-900">
                        <Link
                          href={serviceHref}
                          className="block truncate text-slate-900 hover:text-slate-900"
                        >
                          {service.name}
                        </Link>
                      </TableCell>
                      <TableCell className="align-middle text-slate-700">
                        <Link
                          href={serviceHref}
                          className="block truncate text-slate-700 hover:text-slate-700"
                        >
                          {formatCurrency(
                            service.basePriceCents,
                            service.currency,
                          )}
                        </Link>
                      </TableCell>
                      <TableCell className="align-middle text-slate-700">
                        <Link
                          href={serviceHref}
                          className="block truncate text-slate-700 hover:text-slate-700"
                        >
                          {service.allowPartialPayments
                            ? service.minimumPartialPaymentCents !== null
                              ? formatCurrency(
                                  service.minimumPartialPaymentCents,
                                  service.currency,
                                )
                              : "No minimum"
                            : "Full only"}
                        </Link>
                      </TableCell>
                      <TableCell className="align-middle">
                        <Link href={serviceHref} className="block">
                          <span
                            className={
                              checklistCount > 0
                                ? "inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-emerald-700"
                                : "inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide text-slate-700"
                            }
                          >
                            {checklistCount > 0 ? "Yes" : "No"}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="align-middle">
                        <Link href={serviceHref} className="block">
                          <StackedAvatarGroup
                            items={service.professionals.map(
                              toProfessionalAvatarItem,
                            )}
                            emptyLabel="No professionals assigned."
                          />
                        </Link>
                      </TableCell>
                      <TableCell className="align-middle">
                        <Link href={serviceHref} className="block truncate">
                          <Badge
                            variant="secondary"
                            className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-50"
                          >
                            {publishedTemplateCount} follow-up template
                            {publishedTemplateCount === 1 ? "" : "s"}
                          </Badge>
                        </Link>
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-slate-500"
                  >
                    No active services are available yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span>Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                const next = Number(value)
                if (next === 10 || next === 25) {
                  setPageSize(next)
                  setPage(1)
                }
              }}
            >
              <SelectTrigger size="sm" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 self-end md:self-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
              disabled={!canGoPrevious || isLoading}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Previous
            </Button>
            <span className="px-1 text-sm text-slate-600">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
              disabled={!canGoNext || isLoading}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
