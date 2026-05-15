"use client"

import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { startTransition, useCallback, useEffect, useMemo, useState } from "react"
import { GripVertical, Plus, Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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

import {
  OpportunityPipelineEditor,
  type OpportunityPipelineRecord,
} from "./opportunity-pipeline-editor"

type OpportunitiesConfigPanelProps = {
  tenantId: string
  tenantSlug: string
}

type OpportunitiesResponse = {
  ok: boolean
  items: OpportunityPipelineRecord[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

const PAGE_SIZE_OPTIONS = [10, 25] as const

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error) && typeof error !== "object") {
    return fallback
  }

  const backendError =
    typeof error === "object" && error !== null && "response" in error
      ? (error as { response?: { data?: { error?: unknown } } }).response?.data?.error
      : undefined

  if (typeof backendError !== "string") {
    return fallback
  }

  return backendError
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
}

function SortablePipelineRow({
  pipeline,
  tenantSlug,
  onOpen,
}: {
  pipeline: OpportunityPipelineRecord
  tenantSlug: string
  onOpen: (href: string) => void
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: pipeline.id })

  const href = `/app/${tenantSlug}/account-settings/opportunities/${pipeline.id}`

  return (
    <TableRow
      ref={setNodeRef}
      tabIndex={0}
      role="link"
      aria-label={`Open ${pipeline.name} pipeline`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "cursor-pointer transition-colors hover:bg-slate-50 focus-visible:bg-slate-50",
        isDragging && "bg-slate-50",
      )}
      onClick={() => {
        onOpen(href)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen(href)
        }
      }}
    >
      <TableCell className="w-10">
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Reorder ${pipeline.name}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 transition-colors cursor-grab hover:bg-slate-50 hover:text-slate-600 active:cursor-grabbing"
          onClick={(event) => event.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <span
            className="h-3 w-3 shrink-0 rounded-full border border-slate-200"
            style={{ backgroundColor: pipeline.color }}
          />
          <span className="font-medium text-slate-900">{pipeline.name}</span>
        </div>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
          {pipeline.stages.length} stage{pipeline.stages.length === 1 ? "" : "s"}
        </span>
      </TableCell>
      <TableCell className="text-slate-600">
        {formatDateTime(pipeline.updatedAt)}
      </TableCell>
    </TableRow>
  )
}

export function OpportunitiesConfigPanel({
  tenantId,
  tenantSlug,
}: OpportunitiesConfigPanelProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<OpportunitiesResponse | null>(null)
  const [pipelines, setPipelines] = useState<OpportunityPipelineRecord[]>([])
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [query, setQuery] = useState(() => searchParams.get("search") ?? "")
  const [debouncedQuery, setDebouncedQuery] = useState(query)
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1))
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(() => {
    const parsed = parsePositiveInt(searchParams.get("pageSize"), 10)
    return parsed === 25 ? 25 : 10
  })

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
    }, 350)

    return () => window.clearTimeout(timeout)
  }, [query])

  const load = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const { data } = await api.get<OpportunitiesResponse>(
        `/api/account-settings/${tenantId}/opportunities`,
        {
          params: {
            page,
            pageSize,
            search: debouncedQuery || undefined,
          },
        },
      )

      setPipelines(data.items)
      setData(data)
    } catch (error) {
      setErrorMessage(formatErrorMessage(error, "Could not load opportunity pipelines."))
    } finally {
      setIsLoading(false)
    }
  }, [page, pageSize, debouncedQuery, tenantId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams.toString())

    if (debouncedQuery) {
      nextParams.set("search", debouncedQuery)
    } else {
      nextParams.delete("search")
    }

    if (page > 1) {
      nextParams.set("page", String(page))
    } else {
      nextParams.delete("page")
    }

    if (pageSize !== 10) {
      nextParams.set("pageSize", String(pageSize))
    } else {
      nextParams.delete("pageSize")
    }

    const nextQuery = nextParams.toString()
    const currentQuery = searchParams.toString()
    if (nextQuery === currentQuery) {
      return
    }

    startTransition(() => {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      })
    })
  }, [page, pageSize, debouncedQuery, pathname, router, searchParams])

  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const startIndex = (page - 1) * pageSize
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages

  const summaryLabel = useMemo(() => {
    if (!total) {
      return "No pipelines found"
    }

    const start = startIndex + 1
    const end = Math.min(start + pipelines.length - 1, total)
    return `Showing ${start}-${end} of ${total} pipelines`
  }, [pipelines.length, startIndex, total])

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-4">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Opportunity Pipelines
            </h2>
            <p className="text-sm text-slate-500">
              {summaryLabel}
            </p>
          </div>
          <Button
            type="button"
            onClick={() => setIsCreateDialogOpen(true)}
            className="bg-blue-950 text-white hover:bg-blue-950/90"
          >
            <Plus className="h-4 w-4" />
            Create pipeline
          </Button>
        </div>

        {/* Table Module */}
        <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-white p-2 md:p-4">
          {/* Search and Controls */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPage(1)
                }}
                placeholder="Search pipelines..."
                className="h-9 pl-9 pr-9"
              />
              {query ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  onClick={() => {
                    setQuery("")
                    setPage(1)
                  }}
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Clear search</span>
                </Button>
              ) : null}
            </div>

            <p className="text-xs text-slate-500">
              Drag rows to reorder pipelines
            </p>
          </div>

          {/* Table */}
          <div className="flex min-h-0 flex-1 flex-col rounded-lg bg-white">
            <div className="min-h-0 flex-1 overflow-auto">
              <Table className="[&_td]:py-2 [&_th]:h-8">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead className="min-w-44 text-xs">Pipeline</TableHead>
                    <TableHead className="min-w-32 text-xs">Stages</TableHead>
                    <TableHead className="min-w-36 text-xs">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-slate-500">
                        Loading pipelines...
                      </TableCell>
                    </TableRow>
                  ) : errorMessage ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-rose-600">
                        {errorMessage}
                      </TableCell>
                    </TableRow>
                  ) : pipelines.length ? (
                    <SortableContext
                      items={pipelines.map((pipeline) => pipeline.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {pipelines.map((pipeline) => (
                        <SortablePipelineRow
                          key={pipeline.id}
                          pipeline={pipeline}
                          tenantSlug={tenantSlug}
                          onOpen={(href) => router.push(href)}
                        />
                      ))}
                    </SortableContext>
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-slate-500">
                        {debouncedQuery ? "No pipelines match your search." : "No pipelines configured yet."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                <SelectTrigger className="h-8 w-16">
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

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
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
                className="h-8 border-blue-200 text-blue-950 hover:bg-blue-50 hover:text-blue-950"
                disabled={!canGoNext || isLoading}
                onClick={() => setPage((prev) => prev + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create pipeline</DialogTitle>
            <DialogDescription>
              Each pipeline needs at least one stage. Drag the handle to reorder stages.
            </DialogDescription>
          </DialogHeader>

          <OpportunityPipelineEditor
            tenantId={tenantId}
            onCancel={() => setIsCreateDialogOpen(false)}
            onSaved={async () => {
              setIsCreateDialogOpen(false)
              setPage(1)
              await load()
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
