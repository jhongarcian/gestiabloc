"use client"

import { isAxiosError } from "axios"
import { Filter } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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
  status: string
  statusConfigId: string | null
  statusBgColor: string | null
  statusTextColor: string | null
  followUps: number
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

const PAGE_SIZE_OPTIONS = [10, 25] as const
const ALL_STATUS_VALUE = "ALL"

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
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide bg-slate-100 text-slate-700"
      style={
        bgColor && textColor
          ? { backgroundColor: bgColor, color: textColor }
          : undefined
      }
    >
      {label}
    </span>
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
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [statusFilters, setStatusFilters] = useState<string[]>([])
  const [tagFilters, setTagFilters] = useState<string[]>([])
  const [tagFilterOptions, setTagFilterOptions] = useState(tagOptions)
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false)
  const [draftStatusFilters, setDraftStatusFilters] = useState<string[]>([])
  const [draftTagFilters, setDraftTagFilters] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10)
  const [isLoading, setIsLoading] = useState(false)
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
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(1)
    }, 350)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [query])

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
            statusConfigIds: statusFilters.length ? statusFilters.join(",") : undefined,
            tagIds: tagFilters.length ? tagFilters.join(",") : undefined,
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
  }, [tenantId, page, pageSize, debouncedQuery, statusFilters, tagFilters])

  useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  const contacts = data?.items ?? []
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const startIndex = (page - 1) * pageSize
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages
  const activeFilterCount = statusFilters.length + tagFilters.length

  const summaryLabel = useMemo(() => {
    if (!total) return "No contacts found"
    const start = startIndex + 1
    const end = start + contacts.length - 1
    return `Showing ${start}-${end} of ${total} contacts`
  }, [contacts.length, startIndex, total])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Contacts</h2>
          <p className="text-sm text-slate-500">{summaryLabel}</p>
        </div>

        <CreateContactDialog
          tenantId={tenantId}
          statusOptions={statusOptions}
          onCreated={loadContacts}
        />
      </div>

      <div className="flex flex-col gap-2 rounded-lg bg-white py-1">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <Input
            placeholder="Search by name, email, or phone"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            onClick={() => {
              setDraftStatusFilters(statusFilters)
              setDraftTagFilters(tagFilters)
              setIsFilterSheetOpen(true)
            }}
          >
            <Filter className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            onClick={() => {
              setQuery("")
              setDebouncedQuery("")
              setStatusFilters([])
              setTagFilters([])
              setPage(1)
            }}
          >
            Clear Filters
          </Button>
        </div>
      </div>

      <Sheet open={isFilterSheetOpen} onOpenChange={setIsFilterSheetOpen}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>
              Select one or more status and tag filters.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="space-y-1">
                <Label className="text-sm font-semibold text-slate-900">Status</Label>
                <p className="text-xs text-slate-500">Show contacts matching any selected status.</p>
              </div>

              {selectableStatusOptions.length ? (
                <div className="space-y-2">
                  {selectableStatusOptions.map((option) => {
                    const checked = draftStatusFilters.includes(option.value)
                    return (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-slate-50"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(nextChecked) => {
                            setDraftStatusFilters((prev) =>
                              nextChecked
                                ? [...prev, option.value]
                                : prev.filter((value) => value !== option.value),
                            )
                          }}
                        />
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                          style={
                            option.bgColor && option.textColor
                              ? { backgroundColor: option.bgColor, color: option.textColor }
                              : undefined
                          }
                        >
                          {option.label}
                        </span>
                      </label>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-500">No status filters available.</p>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="space-y-1">
                <Label className="text-sm font-semibold text-slate-900">Tags</Label>
                <p className="text-xs text-slate-500">Show contacts matching any selected tag.</p>
              </div>

              {tagFilterOptions.length ? (
                <div className="space-y-2">
                  {tagFilterOptions.map((option) => {
                    const checked = draftTagFilters.includes(option.value)
                    return (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-slate-50"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(nextChecked) => {
                            setDraftTagFilters((prev) =>
                              nextChecked
                                ? [...prev, option.value]
                                : prev.filter((value) => value !== option.value),
                            )
                          }}
                        />
                        <span
                          className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                          style={
                            option.bgColor && option.textColor
                              ? { backgroundColor: option.bgColor, color: option.textColor }
                              : undefined
                          }
                        >
                          {option.label}
                        </span>
                      </label>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-500">No tag filters available.</p>
              )}
            </section>
          </div>

          <SheetFooter>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={() => {
                setDraftStatusFilters([])
                setDraftTagFilters([])
              }}
            >
              Clear
            </Button>
            <Button
              type="button"
              className="cursor-pointer bg-blue-950 text-white hover:bg-blue-950/90"
              onClick={() => {
                setStatusFilters([...new Set(draftStatusFilters)])
                setTagFilters([...new Set(draftTagFilters)])
                setPage(1)
                setIsFilterSheetOpen(false)
              }}
            >
              Apply Filters
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg bg-white">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table className="[&_td]:py-2 [&_th]:h-8">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-44 text-xs">Full Name</TableHead>
                <TableHead className="min-w-36 text-xs">Date of Birth</TableHead>
                <TableHead className="min-w-40 text-xs">Phone Number</TableHead>
                <TableHead className="min-w-52 text-xs">Email</TableHead>
                <TableHead className="min-w-32 text-xs">Status</TableHead>
                <TableHead className="min-w-28 text-xs">Follow Ups</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                    Loading contacts...
                  </TableCell>
                </TableRow>
              ) : errorMessage ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-rose-600">
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
                      className="cursor-pointer transition-colors hover:bg-slate-50 focus-visible:bg-slate-50"
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
                      <TableCell className="font-medium text-slate-900">
                        {contact.fullName}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {formatDate(contact.dateOfBirth)}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {formatPhoneNumber(contact.phoneNumber)}
                      </TableCell>
                      <TableCell className="text-slate-700">{contact.email ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge
                          label={contact.status}
                          bgColor={contact.statusBgColor ?? undefined}
                          textColor={contact.statusTextColor ?? undefined}
                        />
                      </TableCell>
                      <TableCell className="text-slate-700">{contact.followUps}</TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                    No contacts to display yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

        <div className="flex items-center gap-2 self-end sm:self-auto">
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
  )
}
