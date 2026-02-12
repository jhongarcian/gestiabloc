"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { isAxiosError } from "axios"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
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
import { cn } from "@/lib/utils"

type UsersMembersTableProps = {
  tenantId: string
}

type UsersResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    email: string
    avatar: string | null
    emailVerified: boolean
    isOnline: boolean
    sessionCreatedAt: string | null
    role: string
    accountStatus: string
    lastLoginAt: string | null
  }>
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  timezone: string | null
}

const PAGE_SIZE_OPTIONS = [10, 25] as const

const formatSegment = (segment: string) =>
  segment.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())

const formatDateTime = (value: string | null, timezone?: string | null) => {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Never"

  const baseOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }

  if (timezone) {
    try {
      return new Intl.DateTimeFormat("en-US", {
        ...baseOptions,
        timeZone: timezone,
      }).format(date)
    } catch {
      // falls back to system timezone below
    }
  }

  return new Intl.DateTimeFormat("en-US", baseOptions).format(date)
}

const formatSessionState = (
  isOnline: boolean,
  sessionCreatedAt: string | null,
  timezone?: string | null,
) =>
  isOnline && sessionCreatedAt
    ? `Online since ${formatDateTime(sessionCreatedAt, timezone)}`
    : "Offline"

const getInitials = (value: string) => {
  const parts = value.trim().split(/\s+/)
  if (parts.length === 0) return "U"
  const first = parts[0]?.[0] ?? ""
  const second = parts[1]?.[0] ?? ""
  return (first + second).toUpperCase() || "U"
}

function StatusBadge({
  label,
  tone,
}: {
  label: string
  tone: "success" | "muted"
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
        tone === "success"
          ? "bg-emerald-100 text-emerald-700"
          : "bg-slate-100 text-slate-600",
      )}
    >
      {label}
    </span>
  )
}

export function UsersMembersTable({ tenantId }: UsersMembersTableProps) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(
    10,
  )
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<UsersResponse | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data: response } = await api.get<UsersResponse>(
        `/api/account-settings/${tenantId}/users`,
        {
          params: {
            page,
            pageSize,
          },
        },
      )
      setData(response)
    } catch (error) {
      if (isAxiosError(error)) {
        const backendError = error.response?.data?.error
        if (typeof backendError === "string") {
          setErrorMessage(formatSegment(backendError))
        } else {
          setErrorMessage("Could not load tenant members.")
        }
      } else {
        setErrorMessage("Could not load tenant members.")
      }
    } finally {
      setIsLoading(false)
    }
  }, [tenantId, page, pageSize])

  useEffect(() => {
    void load()
  }, [load])

  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const tenantTimezone = data?.timezone ?? null
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages

  const summaryLabel = useMemo(() => {
    if (!data?.items?.length) {
      return "No members found"
    }

    const start = (page - 1) * pageSize + 1
    const end = start + data.items.length - 1

    return `Showing ${start}-${end} of ${total} members`
  }, [data?.items, page, pageSize, total])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Tenant Members</h2>
          <p className="text-sm text-slate-500">{summaryLabel}</p>
          <p className="text-xs text-slate-400">
            {tenantTimezone
              ? `Times shown in tenant timezone (${tenantTimezone}).`
              : "Times shown in system timezone."}
          </p>
        </div>

        <Button type="button" className="sm:self-start">
          Add User
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-44">User</TableHead>
              <TableHead className="min-w-56">Email</TableHead>
              <TableHead className="min-w-32">Verified</TableHead>
              <TableHead className="min-w-36">Account Status</TableHead>
              <TableHead className="min-w-44">Session</TableHead>
              <TableHead className="min-w-44">Last Login</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                  Loading members...
                </TableCell>
              </TableRow>
            ) : errorMessage ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-rose-600">
                  {errorMessage}
                </TableCell>
              </TableRow>
            ) : data?.items.length ? (
              data.items.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9 border border-slate-200">
                        {member.avatar ? (
                          <AvatarImage
                            src={member.avatar}
                            alt={member.name}
                            className="object-cover border border-blue-950"
                          />
                        ) : null}
                        <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{member.name}</p>
                        <p className="text-xs text-slate-500">{formatSegment(member.role)}</p>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="text-slate-700">{member.email}</TableCell>

                  <TableCell>
                    {member.emailVerified ? (
                      <StatusBadge label="Verified" tone="success" />
                    ) : (
                      <StatusBadge label="Not Verified" tone="muted" />
                    )}
                  </TableCell>

                  <TableCell>
                    <StatusBadge
                      label={formatSegment(member.accountStatus)}
                      tone={member.accountStatus === "ACTIVE" ? "success" : "muted"}
                    />
                  </TableCell>

                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <StatusBadge
                        label={member.isOnline ? "Online" : "Offline"}
                        tone={member.isOnline ? "success" : "muted"}
                      />
                      <span className="text-xs text-slate-500">
                        {formatSessionState(
                          member.isOnline,
                          member.sessionCreatedAt,
                          tenantTimezone,
                        )}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell className="text-slate-600">
                    {formatDateTime(member.lastLoginAt, tenantTimezone)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                  No members found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
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
