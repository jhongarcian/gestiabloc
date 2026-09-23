"use client"

import { isAxiosError } from "axios"
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
  Search,
} from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"

import { StackedAvatarGroup } from "@/components/stacked-avatar-group"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import { formatPhoneNumber } from "@/lib/format-phone-number"
import { cn } from "@/lib/utils"
import { AddContactsToAutomationDialog } from "./add-contacts-to-automation-dialog"
import { ContactDetailsLoadingSkeleton } from "./contact-details-loading-skeleton"
import { CreateContactDialog } from "./create-contact-dialog"

type ContactsTableProps = {
  tenantSlug: string
  tenantId: string
  statusOptions: Array<{
    label: string
    value: string
    bgColor?: string
    textColor?: string
  }>
  tagOptions: Array<{
    label: string
    value: string
    bgColor?: string
    textColor?: string
  }>
}

type ContactItem = {
  id: string
  fullName: string
  dateOfBirth: string | null
  phoneNumber: string | null
  email: string | null
  assignedTo: {
    userId: string
    name: string
    email: string
    image: string | null
  } | null
  activeFollowUpServices?: Array<{
    id: string
    name: string
  }>
  status: string
  statusConfigId: string
  statusBgColor: string
  statusTextColor: string
}

type ContactsListResponse = {
  ok: boolean
  items: ContactItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type AssigneeOption = {
  value: string
  label: string
  email: string
  image: string | null
}

type ContactSort =
  | "NAME_ASC"
  | "NAME_DESC"
  | "CREATED_DESC"
  | "CREATED_ASC"
  | "UPDATED_DESC"

const PAGE_SIZE_OPTIONS = [10, 25] as const
const ALL_STATUS_VALUE = "ALL"
const ALL_ASSIGNEE_FILTER = "ALL"
const UNASSIGNED_ASSIGNEE_FILTER = "__UNASSIGNED__"
const DEFAULT_SORT: ContactSort = "NAME_ASC"

const SORT_OPTIONS: Array<{ value: ContactSort; label: string }> = [
  { value: "NAME_ASC", label: "Last name A–Z" },
  { value: "NAME_DESC", label: "Last name Z–A" },
  { value: "CREATED_DESC", label: "Recently added" },
  { value: "CREATED_ASC", label: "Oldest added" },
  { value: "UPDATED_DESC", label: "Recently updated" },
]

const COMPACT_PRIMARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full bg-blue-950 px-3 py-1 text-xs font-semibold text-white shadow-sm ring-1 ring-black/5 transition hover:bg-blue-900 hover:text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"

const COMPACT_SECONDARY_BUTTON_CLASS =
  "h-8 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"

function parseSort(value: string | null): ContactSort {
  return SORT_OPTIONS.some((option) => option.value === value)
    ? (value as ContactSort)
    : DEFAULT_SORT
}

function normalizeAssigneeFilter(value: string | null) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : ALL_ASSIGNEE_FILTER
}

function parseCsvParam(value: string | null) {
  if (!value) return []

  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
}

function StatusBadge({
  label,
  bgColor,
  textColor,
}: {
  label: string
  bgColor?: string
  textColor?: string
}) {
  return (
    <Badge
      variant="secondary"
      className="bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700"
      style={
        bgColor && textColor
          ? { backgroundColor: bgColor, color: textColor }
          : undefined
      }
    >
      {label}
    </Badge>
  )
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2)

  if (parts.length === 0) return "?"
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("")
}

function AssigneeFilterPicker({
  assignees,
  value,
  onValueChange,
  id,
}: {
  assignees: AssigneeOption[]
  value: string
  onValueChange: (value: string) => void
  id: string
}) {
  const [open, setOpen] = useState(false)

  const selectedAssignee = useMemo(
    () => assignees.find((assignee) => assignee.value === value) ?? null,
    [assignees, value],
  )
  const isUnassigned = value === UNASSIGNED_ASSIGNEE_FILTER
  const hasUserFilter = value !== ALL_ASSIGNEE_FILTER && !isUnassigned
  const triggerLabel = isUnassigned
    ? "Not assigned"
    : selectedAssignee?.label ?? (hasUserFilter ? "Selected assignee" : "All assignees")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-expanded={open}
          className="h-11 w-full justify-between rounded-xl border-blue-100 bg-white px-3 shadow-none hover:bg-white focus-visible:border-blue-400 focus-visible:ring-blue-100"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Avatar
              size="sm"
              className={
                selectedAssignee || hasUserFilter ? "ring-2 ring-blue-50" : undefined
              }
            >
              {selectedAssignee?.image ? (
                <AvatarImage
                  src={selectedAssignee.image}
                  alt={`${selectedAssignee.label} profile photo`}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback
                className={
                  selectedAssignee || hasUserFilter
                    ? "bg-blue-950 font-semibold text-white"
                    : "bg-slate-100 font-semibold text-slate-500"
                }
              >
                {selectedAssignee
                  ? getInitials(selectedAssignee.label)
                  : hasUserFilter
                    ? "?"
                    : "—"}
              </AvatarFallback>
            </Avatar>
            <span className="truncate font-medium text-slate-800">
              {triggerLabel}
            </span>
          </span>
          <ChevronDown data-icon="inline-end" className="ml-auto text-slate-400" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput placeholder="Search team members..." />
          <CommandList>
            <CommandEmpty>No team members found.</CommandEmpty>
            <CommandGroup heading="Assignee">
              <CommandItem
                value="All assignees no owner filter"
                onSelect={() => {
                  onValueChange(ALL_ASSIGNEE_FILTER)
                  setOpen(false)
                }}
                className="cursor-pointer gap-3 py-2.5"
              >
                <Avatar size="sm">
                  <AvatarFallback className="bg-slate-100 font-semibold text-slate-500">
                    —
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 font-medium text-slate-700">
                  All assignees
                </span>
                <Check
                  className={cn(
                    "text-blue-800",
                    value === ALL_ASSIGNEE_FILTER ? "opacity-100" : "opacity-0",
                  )}
                />
              </CommandItem>

              <CommandItem
                value="Not assigned unassigned no owner"
                onSelect={() => {
                  onValueChange(UNASSIGNED_ASSIGNEE_FILTER)
                  setOpen(false)
                }}
                className="cursor-pointer gap-3 py-2.5"
              >
                <Avatar size="sm">
                  <AvatarFallback className="bg-slate-100 font-semibold text-slate-500">
                    —
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 font-medium text-slate-700">
                  Not assigned
                </span>
                <Check
                  className={cn(
                    "text-blue-800",
                    value === UNASSIGNED_ASSIGNEE_FILTER
                      ? "opacity-100"
                      : "opacity-0",
                  )}
                />
              </CommandItem>

              {assignees.map((assignee) => (
                <CommandItem
                  key={assignee.value}
                  value={`${assignee.label} ${assignee.email ?? ""} ${assignee.value}`}
                  onSelect={() => {
                    onValueChange(assignee.value)
                    setOpen(false)
                  }}
                  className="cursor-pointer gap-3 py-2.5"
                >
                  <Avatar size="sm" className="ring-2 ring-blue-50">
                    {assignee.image ? (
                      <AvatarImage
                        src={assignee.image}
                        alt={`${assignee.label} profile photo`}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="bg-blue-950 font-semibold text-white">
                      {getInitials(assignee.label)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-slate-900">
                      {assignee.label}
                    </span>
                    {assignee.email ? (
                      <span className="truncate text-xs text-slate-500">
                        {assignee.email}
                      </span>
                    ) : null}
                  </span>
                  <Check
                    className={cn(
                      "text-blue-800",
                      value === assignee.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

const formatDate = (value: string | null) => {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date)
}

function ContactMobileCard({
  contact,
  selected,
  onOpen,
}: {
  contact: ContactItem
  selected: boolean
  onOpen: (contactId: string) => void
}) {
  const followUpServices = contact.activeFollowUpServices ?? []
  const openCard = () => onOpen(contact.id)

  return (
    <Card
      role="link"
      tabIndex={0}
      aria-label={`Open ${contact.fullName} details`}
      className={cn(
        "group min-w-0 flex-1 cursor-pointer gap-0 rounded-[22px] border-slate-200 bg-white py-0 shadow-sm outline-none transition-[border-color,box-shadow,transform] hover:border-blue-200 hover:shadow-md focus-visible:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-500/40 active:scale-[0.995] motion-reduce:transform-none motion-reduce:transition-none",
        selected && "border-blue-300 bg-blue-50/30 ring-2 ring-blue-500/15",
      )}
      onClick={openCard}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          openCard()
        }
      }}
    >
      <CardHeader className="gap-1.5 px-4 pt-4 pb-3 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle
          className="truncate pr-2 text-base text-slate-950"
          title={contact.fullName}
        >
          {contact.fullName}
        </CardTitle>
        <CardDescription className="flex min-w-0 items-center gap-2 text-sm">
          <span className="shrink-0 text-xs font-medium text-slate-500">
            Phone
          </span>
          <span
            className="truncate font-medium text-slate-700"
            title={contact.phoneNumber ?? undefined}
          >
            {formatPhoneNumber(contact.phoneNumber)}
          </span>
        </CardDescription>
        <CardAction className="flex items-center gap-1.5">
          <StatusBadge
            label={contact.status}
            bgColor={contact.statusBgColor ?? undefined}
            textColor={contact.statusTextColor ?? undefined}
          />
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5"
          />
        </CardAction>
      </CardHeader>

      <CardContent className="grid min-w-0 grid-cols-2 items-start gap-4 px-4 pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium text-slate-500">Email</p>
          <p
            className="truncate text-sm font-medium text-slate-700"
            title={contact.email ?? undefined}
          >
            {contact.email ?? "No email"}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-xs font-medium text-slate-500">Assigned to</p>
          {contact.assignedTo ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar size="sm">
                {contact.assignedTo.image ? (
                  <AvatarImage
                    src={contact.assignedTo.image}
                    alt={`${contact.assignedTo.name} profile photo`}
                    className="object-cover"
                  />
                ) : null}
                <AvatarFallback>
                  {getInitials(contact.assignedTo.name)}
                </AvatarFallback>
              </Avatar>
              <span
                className="truncate text-sm font-medium text-slate-700"
                title={contact.assignedTo.name}
              >
                {contact.assignedTo.name}
              </span>
            </div>
          ) : (
            <span className="text-sm text-slate-500">Unassigned</span>
          )}
        </div>
      </CardContent>

      <Separator />
      <CardFooter className="grid grid-cols-2 gap-4 bg-slate-50/60 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium text-slate-500">Date of birth</p>
          <p className="text-xs leading-5 text-slate-700">
            {formatDate(contact.dateOfBirth)}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium text-slate-500">Follow-ups</p>
          <StackedAvatarGroup
            items={followUpServices.map((service) => ({
              id: service.id,
              label: service.name,
              tone: "neutral",
            }))}
            maxVisible={3}
            avatarSize="sm"
            enableHoverEffect={false}
            emptyLabel="None"
            className="pl-0"
          />
        </div>
      </CardFooter>
    </Card>
  )
}

function ContactMobileCardSkeleton() {
  return (
    <Card
      aria-hidden="true"
      className="min-w-0 flex-1 gap-0 rounded-[22px] py-0 shadow-sm"
    >
      <CardHeader className="gap-2 px-4 pt-4 pb-3 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle><Skeleton className="h-5 w-3/5" /></CardTitle>
        <CardDescription><Skeleton className="h-4 w-2/5" /></CardDescription>
        <CardAction><Skeleton className="h-5 w-20 rounded-full" /></CardAction>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 px-4 pb-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      </CardContent>
      <Separator />
      <CardFooter className="grid grid-cols-2 gap-4 bg-slate-50/60 px-4 py-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-20" />
        </div>
      </CardFooter>
    </Card>
  )
}

export function ContactsTable({
  tenantSlug,
  tenantId,
  statusOptions,
  tagOptions,
}: ContactsTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get("search") ?? "")
  const [debouncedQuery, setDebouncedQuery] = useState(() =>
    (searchParams.get("search") ?? "").trim(),
  )
  const [statusFilters, setStatusFilters] = useState<string[]>(() => {
    const multi = parseCsvParam(searchParams.get("statusConfigIds"))
    if (multi.length) return multi

    const legacySingle = searchParams.get("statusConfigId")
    return legacySingle ? [legacySingle] : []
  })
  const [tagFilters, setTagFilters] = useState<string[]>(() =>
    parseCsvParam(searchParams.get("tagIds")),
  )
  const [assigneeFilter, setAssigneeFilter] = useState(
    () => normalizeAssigneeFilter(searchParams.get("assignedToUserId")),
  )
  const [sort, setSort] = useState<ContactSort>(() =>
    parseSort(searchParams.get("sort")),
  )
  const [tagFilterOptions, setTagFilterOptions] = useState(tagOptions)
  const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>([])
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false)
  const [isSortSheetOpen, setIsSortSheetOpen] = useState(false)
  const [draftStatusFilters, setDraftStatusFilters] = useState<string[]>([])
  const [draftTagFilters, setDraftTagFilters] = useState<string[]>([])
  const [draftAssigneeFilter, setDraftAssigneeFilter] = useState(
    () => normalizeAssigneeFilter(searchParams.get("assignedToUserId")),
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
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<ContactsListResponse | null>(null)
  const [selectedContacts, setSelectedContacts] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [openingContactId, setOpeningContactId] = useState<string | null>(null)
  const openingContactIdRef = useRef<string | null>(null)
  const [isContactNavigationPending, startContactNavigation] = useTransition()

  const openContact = useCallback(
    (contactId: string) => {
      if (openingContactIdRef.current === contactId) return

      openingContactIdRef.current = contactId
      setOpeningContactId(contactId)
      startContactNavigation(() => {
        router.push(`/app/${tenantSlug}/contacts/${contactId}`)
      })
    },
    [router, tenantSlug],
  )

  useEffect(() => {
    if (isContactNavigationPending) return
    openingContactIdRef.current = null
  }, [isContactNavigationPending])

  const selectableStatusOptions = useMemo(
    () => statusOptions.filter((option) => option.value !== ALL_STATUS_VALUE),
    [statusOptions],
  )

  useEffect(() => {
    setTagFilterOptions(tagOptions)
  }, [tagOptions])

  useEffect(() => {
    if (tagFilterOptions.length > 0) return

    let cancelled = false

    const loadTagOptions = async () => {
      try {
        const { data } = await api.get<{
          ok: boolean
          items: Array<{
            id: string
            name: string
            bgColor: string
            textColor: string
          }>
        }>(`/api/contacts/${tenantId}/tags`)

        if (cancelled) return

        setTagFilterOptions(
          data.items.map((tag) => ({
            label: tag.name,
            value: tag.id,
            bgColor: tag.bgColor,
            textColor: tag.textColor,
          })),
        )
      } catch {
        if (cancelled) return
      }
    }

    void loadTagOptions()

    return () => {
      cancelled = true
    }
  }, [tagFilterOptions.length, tenantId])

  useEffect(() => {
    let cancelled = false

    const loadAssigneeOptions = async () => {
      try {
        const { data: response } = await api.get<{
          ok: boolean
          items: AssigneeOption[]
        }>(`/api/tasks/${encodeURIComponent(tenantId)}/assignees`)

        if (cancelled) return
        setAssigneeOptions(response.items ?? [])
      } catch {
        if (cancelled) return
        setAssigneeOptions([])
      }
    }

    void loadAssigneeOptions()

    return () => {
      cancelled = true
    }
  }, [tenantId])

  useEffect(() => {
    const normalizedQuery = query.trim()
    if (normalizedQuery === debouncedQuery) return

    const timeout = window.setTimeout(() => {
      setDebouncedQuery(normalizedQuery)
      setPage(1)
    }, 300)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [debouncedQuery, query])

  useEffect(() => {
    const nextParams = new URLSearchParams()

    if (debouncedQuery) nextParams.set("search", debouncedQuery)
    if (statusFilters.length)
      nextParams.set("statusConfigIds", statusFilters.join(","))
    if (tagFilters.length) nextParams.set("tagIds", tagFilters.join(","))
    if (assigneeFilter !== ALL_ASSIGNEE_FILTER) {
      nextParams.set("assignedToUserId", assigneeFilter)
    }
    if (sort !== DEFAULT_SORT) nextParams.set("sort", sort)
    if (page > 1) nextParams.set("page", String(page))
    if (pageSize !== 10) nextParams.set("pageSize", String(pageSize))

    const nextQuery = nextParams.toString()
    const currentQuery = searchParams.toString()
    if (nextQuery === currentQuery) return

    startTransition(() => {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      })
    })
  }, [
    debouncedQuery,
    page,
    pageSize,
    pathname,
    router,
    searchParams,
    assigneeFilter,
    sort,
    statusFilters,
    tagFilters,
  ])

  const loadContacts = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data: response } = await api.get<ContactsListResponse>(
        `/api/contacts/${tenantId}`,
        {
          params: {
            page,
            pageSize,
            search: debouncedQuery || undefined,
            statusConfigIds: statusFilters.length
              ? statusFilters.join(",")
              : undefined,
            tagIds: tagFilters.length ? tagFilters.join(",") : undefined,
            assignedToUserId:
              assigneeFilter === ALL_ASSIGNEE_FILTER
                ? undefined
                : assigneeFilter,
            sort,
          },
        },
      )
      setData(response)
      if (page > response.pagination.totalPages) {
        setPage(response.pagination.totalPages)
      }
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (typeof backendError === "string") {
          setErrorMessage(backendError.replace(/_/g, " "))
        } else {
          setErrorMessage("Could not load contacts.")
        }
      } else {
        setErrorMessage("Could not load contacts.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [
    assigneeFilter,
    tenantId,
    page,
    pageSize,
    debouncedQuery,
    sort,
    statusFilters,
    tagFilters,
  ])

  useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  const contacts = data?.items ?? []
  const selectedContactItems = Array.from(
    selectedContacts,
    ([id, name]) => ({ id, name }),
  )
  const selectedContactCount = selectedContacts.size
  const visibleSelectedCount = contacts.filter((contact) =>
    selectedContacts.has(contact.id),
  ).length
  const allVisibleContactsSelected =
    contacts.length > 0 && visibleSelectedCount === contacts.length
  const someVisibleContactsSelected =
    visibleSelectedCount > 0 && !allVisibleContactsSelected
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const startIndex = (page - 1) * pageSize
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages
  const activeFilterCount =
    statusFilters.length +
    tagFilters.length +
    (assigneeFilter !== ALL_ASSIGNEE_FILTER ? 1 : 0)
  const hasActiveQueryOrFilters = Boolean(debouncedQuery) || activeFilterCount > 0
  const hasDraftFilters =
    draftStatusFilters.length > 0 ||
    draftTagFilters.length > 0 ||
    draftAssigneeFilter !== ALL_ASSIGNEE_FILTER
  const placeholderRowCount =
    contacts.length === 0
      ? pageSize - 1
      : Math.max(0, pageSize - contacts.length)
  const visiblePageCount = Math.min(5, totalPages)
  const firstVisiblePage = Math.max(
    1,
    Math.min(page - 2, totalPages - visiblePageCount + 1),
  )
  const visiblePages = Array.from(
    { length: visiblePageCount },
    (_, index) => firstVisiblePage + index,
  )

  const summaryLabel = useMemo(() => {
    if (!total) return "No contacts found"
    const start = startIndex + 1
    const end = start + contacts.length - 1
    return `Showing ${start}-${end} of ${total} contacts`
  }, [contacts.length, startIndex, total])
  const selectedSortLabel =
    SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "Last name A–Z"

  const updateContactSelection = useCallback(
    (contact: ContactItem, checked: boolean) => {
      setSelectedContacts((current) => {
        const next = new Map(current)
        if (checked) next.set(contact.id, contact.fullName)
        else next.delete(contact.id)
        return next
      })
    },
    [],
  )

  const toggleVisibleContactSelection = () => {
    setSelectedContacts((current) => {
      const next = new Map(current)

      for (const contact of contacts) {
        if (allVisibleContactsSelected) next.delete(contact.id)
        else next.set(contact.id, contact.fullName)
      }

      return next
    })
  }

  const clearFilters = () => {
    setStatusFilters([])
    setTagFilters([])
    setAssigneeFilter(ALL_ASSIGNEE_FILTER)
    setDraftStatusFilters([])
    setDraftTagFilters([])
    setDraftAssigneeFilter(ALL_ASSIGNEE_FILTER)
    setPage(1)
  }

  if (isContactNavigationPending && openingContactId) {
    const openingContactName = contacts.find(
      (contact) => contact.id === openingContactId,
    )?.fullName

    return <ContactDetailsLoadingSkeleton contactName={openingContactName} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <header className="shrink-0 rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-4 sm:p-5">
        <h1 className="sr-only">Contacts</h1>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <form
            role="search"
            className="relative w-full lg:min-w-0 lg:flex-1"
            onSubmit={(event) => {
              event.preventDefault()
              setDebouncedQuery(query.trim())
              setPage(1)
            }}
          >
            <Input
              type="search"
              maxLength={120}
              placeholder="Search contacts"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
              }}
              aria-label="Search contacts by name, email, or phone"
              className="h-11 w-full rounded-xl border-white/80 bg-white/85 pr-14 pl-4 text-sm shadow-sm backdrop-blur placeholder:text-slate-400 focus-visible:border-blue-300 focus-visible:ring-blue-100"
            />
            <Button
              type="submit"
              size="icon-lg"
              aria-label="Search contacts"
              className="absolute inset-y-0 right-0 h-11 w-12 rounded-l-none rounded-r-xl bg-blue-950 text-white shadow-none hover:bg-blue-900"
            >
              <Search aria-hidden="true" />
            </Button>
          </form>

          <div className="grid w-full grid-cols-3 gap-2 md:grid-cols-4 lg:flex lg:w-auto lg:shrink-0">
            <Button
              type="button"
              variant="outline"
              aria-label={
                activeFilterCount > 0
                  ? `Open filters, ${activeFilterCount} active`
                  : "Open filters"
              }
              aria-expanded={isFilterSheetOpen}
              aria-controls="contact-filter-sheet"
              className="h-11 min-w-0 cursor-pointer rounded-full border-white/80 bg-white/85 px-2.5 text-xs font-semibold text-blue-950 shadow-sm backdrop-blur hover:bg-white hover:text-blue-950 sm:px-3 sm:text-sm"
              onClick={() => {
                setDraftStatusFilters(statusFilters)
                setDraftTagFilters(tagFilters)
                setDraftAssigneeFilter(assigneeFilter)
                setIsFilterSheetOpen(true)
              }}
            >
              <Filter data-icon="inline-start" aria-hidden="true" />
              <span className="sm:hidden">Filter</span>
              <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 ? (
                <Badge className="h-5 min-w-5 rounded-full bg-blue-950 px-1.5 text-[10px] text-white">
                  {activeFilterCount}
                </Badge>
              ) : null}
            </Button>

            <Button
              type="button"
              variant="outline"
              aria-label={`Sort contacts, currently ${selectedSortLabel}`}
              aria-expanded={isSortSheetOpen}
              aria-controls="contact-sort-sheet"
              className="h-11 min-w-0 cursor-pointer rounded-full border-white/80 bg-white/70 px-2.5 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur hover:bg-white hover:text-slate-950 sm:px-3 sm:text-sm lg:hidden"
              onClick={() => setIsSortSheetOpen(true)}
            >
              <span className="sm:hidden">Sort</span>
              <span className="hidden truncate sm:inline">
                {selectedSortLabel}
              </span>
              <ChevronDown data-icon="inline-end" aria-hidden="true" />
            </Button>

            <Select
              value={sort}
              onValueChange={(value) => {
                setSort(parseSort(value))
                setPage(1)
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={`Sort contacts, currently ${selectedSortLabel}`}
                className="hidden min-w-48 rounded-full border-white/80 bg-white/70 px-3 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur hover:bg-white data-[size=sm]:h-11 lg:flex"
              >
                <span className="text-slate-500">Sort by</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectGroup>
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="outline"
              disabled={activeFilterCount === 0}
              className="hidden h-11 min-w-0 cursor-pointer rounded-full border-white/80 bg-white/70 px-3 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur hover:bg-white hover:text-slate-950 md:inline-flex"
              onClick={clearFilters}
            >
              Clear filters
            </Button>

            <CreateContactDialog
              tenantId={tenantId}
              statusOptions={statusOptions}
              onCreated={loadContacts}
              triggerClassName="h-11 min-w-0 w-full rounded-full px-2 text-xs font-semibold shadow-sm ring-1 ring-black/5 sm:px-3 sm:text-sm lg:w-auto lg:px-4"
            />
          </div>
        </div>

        {selectedContactCount > 0 ? (
          <div
            className="mt-3 flex flex-col gap-3 rounded-2xl border border-blue-200/80 bg-white/85 p-3 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-950 text-xs font-semibold text-white">
                {selectedContactCount}
              </span>
              <p
                className="truncate text-sm font-semibold text-slate-800"
                aria-live="polite"
              >
                {selectedContactCount === 1 ? "Contact selected" : "Contacts selected"}
              </p>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={contacts.length === 0}
                className="h-9 shrink-0 cursor-pointer rounded-full border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-none"
                onClick={toggleVisibleContactSelection}
              >
                {allVisibleContactsSelected
                  ? "Unselect this page"
                  : "Select this page"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 shrink-0 cursor-pointer rounded-full px-3 text-xs font-semibold text-slate-600"
                onClick={() => setSelectedContacts(new Map())}
              >
                Clear
              </Button>
              <AddContactsToAutomationDialog
                tenantId={tenantId}
                tenantSlug={tenantSlug}
                contacts={selectedContactItems}
                onQueued={() => setSelectedContacts(new Map())}
                onCompleted={loadContacts}
              />
            </div>
          </div>
        ) : null}
      </header>

      <Sheet open={isSortSheetOpen} onOpenChange={setIsSortSheetOpen}>
        <SheetContent
          id="contact-sort-sheet"
          side="bottom"
          className="mx-auto max-h-[min(32rem,72dvh)] w-full gap-0 overflow-hidden rounded-t-[26px] border-x border-t border-slate-200 bg-white p-0 sm:bottom-4 sm:left-1/2 sm:right-auto sm:w-[min(32rem,calc(100%-2rem))] sm:-translate-x-1/2 sm:rounded-[26px] sm:border [&>button]:right-5 [&>button]:top-5 [&>button]:cursor-pointer [&>button]:rounded-full [&>button]:bg-slate-100 [&>button]:opacity-100"
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-slate-200 sm:hidden"
          />
          <SheetHeader className="border-b border-slate-100 px-5 pt-4 pb-3 text-left sm:px-6 sm:pt-5">
            <SheetTitle className="pr-10 text-lg font-semibold text-slate-950">
              Sort contacts
            </SheetTitle>
            <SheetDescription className="sr-only">
              Choose the order used for the contact register.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:px-5 sm:pb-5">
            <ToggleGroup
              type="single"
              value={sort}
              orientation="vertical"
              spacing={2}
              aria-label="Choose contact order"
              className="grid w-full gap-2"
              onValueChange={(value) => {
                if (!value) return
                setSort(parseSort(value))
                setPage(1)
                setIsSortSheetOpen(false)
              }}
            >
              {SORT_OPTIONS.map((option) => {
                const isSelected = option.value === sort

                return (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    variant="outline"
                    aria-label={`Sort by ${option.label}`}
                    className="h-12 w-full justify-between rounded-xl border-slate-200 bg-white px-4 text-left text-sm font-medium text-slate-700 shadow-none hover:bg-slate-50 hover:text-slate-950 data-[state=on]:border-blue-200 data-[state=on]:bg-blue-50 data-[state=on]:text-blue-950"
                  >
                    <span>{option.label}</span>
                    <Check
                      aria-hidden="true"
                      className={cn(
                        "text-blue-800 transition-opacity",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </ToggleGroupItem>
                )
              })}
            </ToggleGroup>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={isFilterSheetOpen} onOpenChange={setIsFilterSheetOpen}>
        <SheetContent
          id="contact-filter-sheet"
          side="right"
          className="flex h-full w-full flex-col gap-0 overflow-hidden border-l border-slate-200 bg-white p-0 sm:max-w-lg [&>button]:right-5 [&>button]:top-5 [&>button]:cursor-pointer [&>button]:rounded-full [&>button]:bg-white/80 [&>button]:opacity-100 [&>button]:shadow-sm [&>button]:backdrop-blur"
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
                <p className="text-xs font-semibold text-blue-700">
                  Contact filters
                </p>
                <SheetTitle className="text-xl font-semibold text-slate-950 sm:text-2xl">
                  Refine contacts
                </SheetTitle>
                <SheetDescription className="max-w-xl text-sm leading-6 text-slate-600">
                  Filter contacts by status, assigned tags, and owner.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 [scrollbar-gutter:stable] sm:px-7">
            <div className="flex flex-col gap-7">
              <FieldSet className="gap-2">
                <FieldLegend variant="label" className="mb-0 text-slate-800">
                  Status
                </FieldLegend>
                <FieldDescription className="text-xs">
                  Show contacts matching any selected status.
                </FieldDescription>

                {selectableStatusOptions.length ? (
                  <FieldGroup className="gap-2">
                    {selectableStatusOptions.map((option) => {
                      const checked = draftStatusFilters.includes(option.value)
                      const checkboxId = `contact-status-filter-${option.value}`

                      return (
                        <Field
                          key={option.value}
                          orientation="horizontal"
                          className="min-h-10 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 transition-colors hover:bg-white"
                        >
                          <Checkbox
                            id={checkboxId}
                            checked={checked}
                            onCheckedChange={(nextChecked) => {
                              setDraftStatusFilters((prev) =>
                                nextChecked
                                  ? [...prev, option.value]
                                  : prev.filter(
                                      (value) => value !== option.value,
                                    ),
                              )
                            }}
                          />
                          <FieldLabel
                            htmlFor={checkboxId}
                            className="cursor-pointer"
                          >
                            <span
                              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                              style={
                                option.bgColor && option.textColor
                                  ? {
                                      backgroundColor: option.bgColor,
                                      color: option.textColor,
                                    }
                                  : undefined
                              }
                            >
                              {option.label}
                            </span>
                          </FieldLabel>
                        </Field>
                      )
                    })}
                  </FieldGroup>
                ) : (
                  <p className="text-xs text-slate-500">
                    No status filters available.
                  </p>
                )}
              </FieldSet>

              <FieldSet className="gap-2 border-t border-slate-200 pt-6">
                <FieldLegend variant="label" className="mb-0 text-slate-800">
                  Tags
                </FieldLegend>
                <FieldDescription className="text-xs">
                  Show contacts matching any selected tag.
                </FieldDescription>

                {tagFilterOptions.length ? (
                  <FieldGroup className="gap-2">
                    {tagFilterOptions.map((option) => {
                      const checked = draftTagFilters.includes(option.value)
                      const checkboxId = `contact-tag-filter-${option.value}`

                      return (
                        <Field
                          key={option.value}
                          orientation="horizontal"
                          className="min-h-10 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 transition-colors hover:bg-white"
                        >
                          <Checkbox
                            id={checkboxId}
                            checked={checked}
                            onCheckedChange={(nextChecked) => {
                              setDraftTagFilters((prev) =>
                                nextChecked
                                  ? [...prev, option.value]
                                  : prev.filter(
                                      (value) => value !== option.value,
                                    ),
                              )
                            }}
                          />
                          <FieldLabel
                            htmlFor={checkboxId}
                            className="cursor-pointer"
                          >
                            <span
                              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                              style={
                                option.bgColor && option.textColor
                                  ? {
                                      backgroundColor: option.bgColor,
                                      color: option.textColor,
                                    }
                                  : undefined
                              }
                            >
                              {option.label}
                            </span>
                          </FieldLabel>
                        </Field>
                      )
                    })}
                  </FieldGroup>
                ) : (
                  <p className="text-xs text-slate-500">
                    No tag filters available.
                  </p>
                )}
              </FieldSet>

              <Field className="gap-2 border-t border-slate-200 pt-6">
                <FieldLabel
                  htmlFor="contact-assignee-filter"
                  className="text-slate-800"
                >
                  Assigned to
                </FieldLabel>
                <AssigneeFilterPicker
                  id="contact-assignee-filter"
                  assignees={assigneeOptions}
                  value={draftAssigneeFilter}
                  onValueChange={setDraftAssigneeFilter}
                />
                <FieldDescription className="text-xs">
                  Show contacts owned by a specific user or contacts without an owner.
                </FieldDescription>
              </Field>
            </div>
          </div>

          <SheetFooter className="border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:flex-row sm:justify-end sm:px-7">
            <Button
              type="button"
              variant="outline"
              disabled={!hasDraftFilters && activeFilterCount === 0}
              className={COMPACT_SECONDARY_BUTTON_CLASS}
              onClick={() => {
                clearFilters()
                setIsFilterSheetOpen(false)
              }}
            >
              Clear filters
            </Button>
            <Button
              type="button"
              className={cn("min-w-32", COMPACT_PRIMARY_BUTTON_CLASS)}
              onClick={() => {
                setStatusFilters([...new Set(draftStatusFilters)])
                setTagFilters([...new Set(draftTagFilters)])
                setAssigneeFilter(draftAssigneeFilter)
                setPage(1)
                setIsFilterSheetOpen(false)
              }}
            >
              Apply filters
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <section
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm"
        aria-label="Contact list"
        aria-busy={isLoading}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 md:hidden">
          {isLoading ? (
            <div className="flex flex-col gap-3" role="status">
              <span className="sr-only">Loading contacts</span>
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={`mobile-contact-skeleton-${index}`}
                  className="flex min-w-0 items-start gap-2"
                >
                  <Skeleton className="mt-5 size-5 shrink-0 rounded" />
                  <ContactMobileCardSkeleton />
                </div>
              ))}
            </div>
          ) : errorMessage ? (
            <div
              className="flex flex-col items-start gap-3 rounded-[20px] border border-rose-200 bg-rose-50/60 p-4 text-sm text-rose-700"
              role="alert"
            >
              <p>{errorMessage}</p>
              <Button
                type="button"
                variant="outline"
                className={COMPACT_SECONDARY_BUTTON_CLASS}
                onClick={() => void loadContacts()}
              >
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : contacts.length ? (
            <div className="flex flex-col gap-3" role="list">
              {contacts.map((contact) => {
                const isSelected = selectedContacts.has(contact.id)
                const checkboxId = `mobile-contact-selection-${contact.id}`

                return (
                  <div
                    key={`mobile-${contact.id}`}
                    role="listitem"
                    className="flex min-w-0 items-start gap-2"
                  >
                    <div className="flex shrink-0 pt-5">
                      <Checkbox
                        id={checkboxId}
                        checked={isSelected}
                        aria-label={`Select ${contact.fullName}`}
                        className="size-5 cursor-pointer border-slate-300 bg-white"
                        onCheckedChange={(checked) =>
                          updateContactSelection(contact, checked === true)
                        }
                      />
                    </div>
                    <ContactMobileCard
                      contact={contact}
                      selected={isSelected}
                      onOpen={openContact}
                    />
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center">
              <p className="text-sm leading-6 text-slate-500">
                {hasActiveQueryOrFilters
                  ? "No contacts match the current search and filters."
                  : "No contacts to display yet."}
              </p>
            </div>
          )}
        </div>

        <div className="hidden min-h-0 flex-1 overflow-auto px-4 pt-4 md:block">
          <Table
            className="min-w-[1120px] table-fixed border-separate border-spacing-0"
            aria-label="Contacts"
          >
            <TableHeader className="drop-shadow-sm [&_tr]:border-0">
              <TableRow className="h-14 border-0 hover:bg-transparent">
                <TableHead className="w-12 rounded-l-xl border-y border-l bg-slate-50 px-4">
                  <Checkbox
                    checked={
                      allVisibleContactsSelected
                        ? true
                        : someVisibleContactsSelected
                          ? "indeterminate"
                          : false
                    }
                    disabled={isLoading || contacts.length === 0}
                    aria-label="Select all contacts on this page"
                    className="cursor-pointer border-slate-300 bg-white"
                    onCheckedChange={toggleVisibleContactSelection}
                  />
                </TableHead>
                <TableHead className="w-[16%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Full name
                </TableHead>
                <TableHead className="w-[12%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Date of birth
                </TableHead>
                <TableHead className="w-[14%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Phone number
                </TableHead>
                <TableHead className="w-[20%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Email
                </TableHead>
                <TableHead className="w-[18%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Assigned user
                </TableHead>
                <TableHead className="w-[10%] border-y bg-slate-50 px-4 text-xs text-slate-600">
                  Status
                </TableHead>
                <TableHead className="w-[10%] rounded-r-xl border-y border-r bg-slate-50 px-4 text-xs text-slate-600">
                  Follow-ups
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                aria-hidden="true"
                className="h-2 border-0 hover:bg-transparent"
              >
                <TableCell colSpan={8} className="p-0" />
              </TableRow>

              {isLoading ? (
                Array.from({ length: pageSize }, (_, index) => (
                  <TableRow
                    key={`contact-skeleton-${index}`}
                    className="h-14 hover:bg-transparent"
                  >
                    <TableCell className="px-4 py-0">
                      <Skeleton className="size-4 rounded" />
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <Skeleton className="h-4 w-4/5" />
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <Skeleton className="h-4 w-24" />
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <Skeleton className="h-4 w-28" />
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <Skeleton className="h-4 w-4/5" />
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <div className="flex items-center gap-2.5">
                        <Skeleton className="size-6 rounded-full" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </TableCell>
                    <TableCell className="px-4 py-0">
                      <Skeleton className="h-6 w-20" />
                    </TableCell>
                  </TableRow>
                ))
              ) : errorMessage ? (
                <TableRow className="h-14 hover:bg-transparent">
                  <TableCell
                    colSpan={8}
                    className="px-4 py-0 text-center text-rose-600"
                  >
                    {errorMessage}
                  </TableCell>
                </TableRow>
              ) : contacts.length ? (
                contacts.map((contact) => {
                  const isSelected = selectedContacts.has(contact.id)

                  return (
                    <TableRow
                      key={contact.id}
                      tabIndex={0}
                      role="link"
                      aria-label={`Open ${contact.fullName} details`}
                      data-selected={isSelected ? "true" : undefined}
                      className={cn(
                        "h-14 cursor-pointer outline-none hover:bg-blue-50/50 focus-visible:bg-blue-50/50 focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-inset",
                        isSelected && "bg-blue-50/70 hover:bg-blue-50/80",
                      )}
                      onClick={() => {
                        openContact(contact.id)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          openContact(contact.id)
                        }
                      }}
                    >
                      <TableCell
                        className="px-4 py-0"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          checked={isSelected}
                          aria-label={`Select ${contact.fullName}`}
                          className="cursor-pointer border-slate-300 bg-white"
                          onCheckedChange={(checked) =>
                            updateContactSelection(contact, checked === true)
                          }
                        />
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <span
                          className="block truncate font-medium text-slate-950"
                          title={contact.fullName}
                        >
                          {contact.fullName}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-0 text-slate-700">
                        {formatDate(contact.dateOfBirth)}
                      </TableCell>
                      <TableCell className="px-4 py-0 text-slate-700">
                        {formatPhoneNumber(contact.phoneNumber)}
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <span
                          className="block truncate text-slate-700"
                          title={contact.email ?? undefined}
                        >
                          {contact.email ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        {contact.assignedTo ? (
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar size="sm">
                              {contact.assignedTo.image ? (
                                <AvatarImage
                                  src={contact.assignedTo.image}
                                  alt={`${contact.assignedTo.name} profile photo`}
                                />
                              ) : null}
                              <AvatarFallback>
                                {getInitials(contact.assignedTo.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span
                              className="truncate text-slate-700"
                              title={contact.assignedTo.name}
                            >
                              {contact.assignedTo.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-500">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-0">
                        <StatusBadge
                          label={contact.status}
                          bgColor={contact.statusBgColor ?? undefined}
                          textColor={contact.statusTextColor ?? undefined}
                        />
                      </TableCell>
                      <TableCell className="px-4 py-0 text-slate-700">
                        <StackedAvatarGroup
                          items={(contact.activeFollowUpServices ?? []).map(
                            (service) => ({
                              id: service.id,
                              label: service.name,
                              tone: "neutral",
                            }),
                          )}
                          maxVisible={4}
                          avatarSize="sm"
                          enableHoverEffect={false}
                          emptyLabel="—"
                          className="pl-0"
                        />
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow className="h-14 hover:bg-transparent">
                  <TableCell
                    colSpan={8}
                    className="px-4 py-0 text-center text-slate-500"
                  >
                    {hasActiveQueryOrFilters
                      ? "No contacts match the current search and filters."
                      : "No contacts to display yet."}
                  </TableCell>
                </TableRow>
              )}

              {!isLoading && !errorMessage
                ? Array.from({ length: placeholderRowCount }, (_, index) => (
                    <TableRow
                      key={`empty-contact-row-${index}`}
                      aria-hidden="true"
                      className="h-14 hover:bg-transparent"
                    >
                      <TableCell colSpan={8} className="px-4 py-0" />
                    </TableRow>
                  ))
                : null}
            </TableBody>
          </Table>
        </div>

        <footer className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/40 px-3 py-3 md:flex-row md:items-center md:justify-between md:bg-white md:px-4 md:py-4">
          <div className="flex w-full items-center justify-between gap-3 md:w-auto md:flex-wrap md:justify-start md:gap-x-5 md:gap-y-3">
            {isLoading ? (
              <Skeleton className="h-4 w-36" />
            ) : (
              <p
                className="min-w-0 truncate text-xs text-slate-500 sm:text-sm"
                aria-live="polite"
              >
                {summaryLabel}
              </p>
            )}
            <div className="flex shrink-0 items-center gap-2 text-xs text-slate-600 sm:text-sm">
              <span className="sm:hidden">Per page</span>
              <span className="hidden sm:inline">Rows per page</span>
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
                <SelectTrigger
                  size="sm"
                  aria-label="Rows per page"
                  className="w-16 rounded-lg bg-white sm:w-20"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <nav
            className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm md:flex md:w-auto md:justify-start md:self-auto md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none"
            aria-label="Contact list pagination"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Previous page"
              disabled={!canGoPrevious || isLoading}
              className="h-10 min-w-0 rounded-xl px-3 text-xs text-slate-700 shadow-none md:size-8 md:rounded-md md:px-0"
              onClick={() => setPage((previous) => Math.max(1, previous - 1))}
            >
              <ChevronLeft aria-hidden="true" />
              <span className="md:sr-only">Previous</span>
            </Button>

            <span
              className="min-w-20 rounded-xl bg-slate-50 px-2 py-2 text-center text-xs tabular-nums text-slate-500 md:hidden"
              aria-live="polite"
            >
              <span className="font-semibold text-slate-900">{page}</span> of {totalPages}
            </span>

            {visiblePages.map((pageNumber) => (
              <Button
                key={pageNumber}
                type="button"
                variant={pageNumber === page ? "default" : "outline"}
                size="icon-sm"
                aria-label={
                  pageNumber === page
                    ? `Page ${pageNumber}`
                    : `Go to page ${pageNumber}`
                }
                aria-current={pageNumber === page ? "page" : undefined}
                disabled={isLoading || pageNumber === page}
                className={cn(
                  "hidden md:inline-flex",
                  pageNumber === page &&
                    "bg-blue-950 text-white hover:bg-blue-900 disabled:opacity-100",
                )}
                onClick={() => setPage(pageNumber)}
              >
                {pageNumber}
              </Button>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Next page"
              disabled={!canGoNext || isLoading}
              className="h-10 min-w-0 rounded-xl px-3 text-xs text-slate-700 shadow-none md:size-8 md:rounded-md md:px-0"
              onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))}
            >
              <span className="md:sr-only">Next</span>
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        </footer>
      </section>
    </div>
  )
}
