"use client"

import { isAxiosError } from "axios"
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"

import { StackedAvatarGroup } from "@/components/stacked-avatar-group"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { api } from "@/lib/api"
import { formatPhoneNumber } from "@/lib/format-phone-number"
import { cn } from "@/lib/utils"
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
  statusConfigId: string | null
  statusBgColor: string | null
  statusTextColor: string | null
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

const PAGE_SIZE_OPTIONS = [10, 25] as const
const ALL_STATUS_VALUE = "ALL"
const ALL_ASSIGNEE_FILTER = "ALL"
const UNASSIGNED_ASSIGNEE_FILTER = "__UNASSIGNED__"

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
  const [tagFilterOptions, setTagFilterOptions] = useState(tagOptions)
  const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>([])
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false)
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
    if (statusFilters.length)
      nextParams.set("statusConfigIds", statusFilters.join(","))
    if (tagFilters.length) nextParams.set("tagIds", tagFilters.join(","))
    if (assigneeFilter !== ALL_ASSIGNEE_FILTER) {
      nextParams.set("assignedToUserId", assigneeFilter)
    }
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
          },
        },
      )
      setData(response)
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
    statusFilters,
    tagFilters,
  ])

  useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  const contacts = data?.items ?? []
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const startIndex = (page - 1) * pageSize
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages
  const activeFilterCount =
    statusFilters.length +
    tagFilters.length +
    (assigneeFilter !== ALL_ASSIGNEE_FILTER ? 1 : 0)
  const hasActiveQueryOrFilters = Boolean(query.trim()) || activeFilterCount > 0
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <header className="shrink-0 rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold text-slate-950">
                Contacts
              </h1>
            </div>
          </div>

          <div className="md:self-center">
            <CreateContactDialog
              tenantId={tenantId}
              statusOptions={statusOptions}
              onCreated={loadContacts}
            />
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(280px,1fr)_auto_auto]">
          <Input
            type="search"
            placeholder="Search by name, email, or phone"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            aria-label="Search contacts"
            className="h-11 rounded-xl border-white/80 bg-white/85 px-4 shadow-sm backdrop-blur placeholder:text-slate-400 focus-visible:border-blue-300 focus-visible:ring-blue-100"
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 cursor-pointer rounded-xl border-white/80 bg-white/85 px-4 text-blue-950 shadow-sm backdrop-blur hover:bg-white hover:text-blue-950"
            onClick={() => {
              setDraftStatusFilters(statusFilters)
              setDraftTagFilters(tagFilters)
              setDraftAssigneeFilter(assigneeFilter)
              setIsFilterSheetOpen(true)
            }}
          >
            <Filter data-icon="inline-start" />
            Filters
            {activeFilterCount > 0 ? (
              <Badge className="min-w-5 bg-blue-950 px-1.5 text-white">
                {activeFilterCount}
              </Badge>
            ) : null}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!hasActiveQueryOrFilters}
            className="h-11 cursor-pointer rounded-xl border-white/80 bg-white/70 px-4 text-slate-700 shadow-sm backdrop-blur hover:bg-white hover:text-slate-950"
            onClick={() => {
              setQuery("")
              setDebouncedQuery("")
              setStatusFilters([])
              setTagFilters([])
              setAssigneeFilter(ALL_ASSIGNEE_FILTER)
              setDraftStatusFilters([])
              setDraftTagFilters([])
              setDraftAssigneeFilter(ALL_ASSIGNEE_FILTER)
              setPage(1)
            }}
          >
            Clear filters
          </Button>
        </div>
      </header>

      <Sheet open={isFilterSheetOpen} onOpenChange={setIsFilterSheetOpen}>
        <SheetContent
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
              className="cursor-pointer border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
              onClick={() => {
                setDraftStatusFilters([])
                setDraftTagFilters([])
                setDraftAssigneeFilter(ALL_ASSIGNEE_FILTER)
              }}
            >
              Clear
            </Button>
            <Button
              type="button"
              className="min-w-32 cursor-pointer bg-blue-950 text-white shadow-sm hover:bg-blue-900"
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
      >
        <div className="min-h-0 flex-1 overflow-auto px-4 pt-4">
          <Table
            className="min-w-[1120px] table-fixed border-separate border-spacing-0"
            aria-label="Contacts"
          >
            <TableHeader className="drop-shadow-sm [&_tr]:border-0">
              <TableRow className="h-14 border-0 hover:bg-transparent">
                <TableHead className="w-[16%] rounded-l-xl border-y border-l bg-slate-50 px-4 text-xs text-slate-600">
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
                <TableCell colSpan={7} className="p-0" />
              </TableRow>

              {isLoading ? (
                Array.from({ length: pageSize }, (_, index) => (
                  <TableRow
                    key={`contact-skeleton-${index}`}
                    className="h-14 hover:bg-transparent"
                  >
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
                    colSpan={7}
                    className="px-4 py-0 text-center text-rose-600"
                  >
                    {errorMessage}
                  </TableCell>
                </TableRow>
              ) : contacts.length ? (
                contacts.map((contact) => {
                  const href = `/app/${tenantSlug}/contacts/${contact.id}`

                  return (
                    <TableRow
                      key={contact.id}
                      tabIndex={0}
                      role="link"
                      aria-label={`Open ${contact.fullName} details`}
                      className="h-14 cursor-pointer outline-none hover:bg-blue-50/50 focus-visible:bg-blue-50/50 focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-inset"
                      onClick={() => {
                        router.push(href)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          router.push(href)
                        }
                      }}
                    >
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
                    colSpan={7}
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
                      <TableCell colSpan={7} className="px-4 py-0" />
                    </TableRow>
                  ))
                : null}
            </TableBody>
          </Table>
        </div>

        <footer className="flex flex-col gap-4 border-t border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {isLoading ? (
              <Skeleton className="h-4 w-36" />
            ) : (
              <p className="text-sm text-slate-500">{summaryLabel}</p>
            )}
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
                <SelectTrigger size="sm" className="w-20 rounded-lg">
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
            className="flex items-center gap-2 self-end sm:self-auto"
            aria-label="Contact list pagination"
          >
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Previous page"
              disabled={!canGoPrevious || isLoading}
              onClick={() => setPage((previous) => Math.max(1, previous - 1))}
            >
              <ChevronLeft />
            </Button>

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
                className={
                  pageNumber === page
                    ? "bg-blue-950 text-white hover:bg-blue-900 disabled:opacity-100"
                    : undefined
                }
                onClick={() => setPage(pageNumber)}
              >
                {pageNumber}
              </Button>
            ))}

            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="Next page"
              disabled={!canGoNext || isLoading}
              onClick={() => setPage((previous) => previous + 1)}
            >
              <ChevronRight />
            </Button>
          </nav>
        </footer>
      </section>
    </div>
  )
}
