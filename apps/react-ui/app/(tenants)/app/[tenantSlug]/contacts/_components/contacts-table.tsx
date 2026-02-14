"use client"

import { isAxiosError } from "axios"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { api } from "@/lib/api"
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
}: ContactsTableProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState(ALL_STATUS_VALUE)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<ContactsListResponse | null>(null)

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
            statusConfigId:
              statusFilter === ALL_STATUS_VALUE ? undefined : statusFilter,
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
  }, [tenantId, page, pageSize, debouncedQuery, statusFilter])

  useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  const contacts = data?.items ?? []
  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const startIndex = (page - 1) * pageSize
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages

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
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_200px_auto]">
          <Input
            placeholder="Search by name, email, or phone"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
          />
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value)
              setPage(1)
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            className="border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
            onClick={() => {
              setQuery("")
              setDebouncedQuery("")
              setStatusFilter(ALL_STATUS_VALUE)
              setPage(1)
            }}
          >
            Clear Filters
          </Button>
        </div>
      </div>

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
                        {contact.phoneNumber ?? "—"}
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
