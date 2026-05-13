"use client"

import { isAxiosError } from "axios"
import {
  closestCenter,
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { startTransition, useCallback, useEffect, useMemo, useState } from "react"
import { GripVertical, Plus } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
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

import {
  OpportunityPipelineEditor,
  type OpportunityPipelineRecord,
} from "./opportunity-pipeline-editor"
import { Clock3, Layers3, Target } from "lucide-react"

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
  disabled,
  onOpen,
}: {
  pipeline: OpportunityPipelineRecord
  tenantSlug: string
  disabled: boolean
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
  } = useSortable({ id: pipeline.id, disabled })

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
      <TableCell className="w-12">
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Reorder ${pipeline.name}`}
          disabled={disabled}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500",
            disabled
              ? "cursor-not-allowed opacity-50"
              : "cursor-grab hover:bg-slate-100 active:cursor-grabbing",
          )}
          onClick={(event) => event.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </TableCell>
      <TableCell className="font-medium text-slate-900">
        {pipeline.name}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-3 rounded-full border border-slate-200"
            style={{ backgroundColor: pipeline.color }}
          />
          <span className="font-mono text-xs text-slate-600">
            {pipeline.color}
          </span>
        </div>
      </TableCell>
      <TableCell className="font-medium text-slate-900">
        {pipeline.stages.length} stage
        {pipeline.stages.length === 1 ? "" : "s"}
      </TableCell>
      <TableCell className="text-slate-700">
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
  const [isReordering, setIsReordering] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [data, setData] = useState<OpportunitiesResponse | null>(null)
  const [pipelines, setPipelines] = useState<OpportunityPipelineRecord[]>([])
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [page, setPage] = useState(() => parsePositiveInt(searchParams.get("page"), 1))
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(() => {
    const parsed = parsePositiveInt(searchParams.get("pageSize"), 10)
    return parsed === 25 ? 25 : 10
  })
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  )

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
  }, [page, pageSize, tenantId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams.toString())

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
  }, [page, pageSize, pathname, router, searchParams])

  const total = data?.pagination.total ?? 0
  const totalPages = data?.pagination.totalPages ?? 1
  const startIndex = (page - 1) * pageSize
  const canGoPrevious = page > 1
  const canGoNext = page < totalPages
  const visibleStageCount = useMemo(
    () => pipelines.reduce((totalStages, pipeline) => totalStages + pipeline.stages.length, 0),
    [pipelines],
  )
  const summaryLabel = useMemo(() => {
    if (!total) {
      return "No pipelines configured"
    }

    const start = startIndex + 1
    const end = start + pipelines.length - 1
    return `Showing ${start}-${end} of ${total} pipelines`
  }, [pipelines.length, startIndex, total])

  const persistReorder = useCallback(
    async (
      reordered: OpportunityPipelineRecord[],
      movement: {
        activeId: string
        overId: string
        position: "before" | "after"
      },
    ) => {
      setPipelines(reordered)
      setIsReordering(true)

      try {
        await api.patch(`/api/account-settings/${tenantId}/opportunities/reorder`, {
          pipelineId: movement.activeId,
          targetPipelineId: movement.overId,
          position: movement.position,
        })
        await load()
        toast.success("Pipeline order updated.")
      } catch (error) {
        const backendError = isAxiosError(error) ? error.response?.data?.error : undefined
        toast.error(
          typeof backendError === "string"
            ? backendError.replace(/_/g, " ").toLowerCase()
            : "Could not save pipeline order.",
        )
        await load()
      } finally {
        setIsReordering(false)
      }
    },
    [load, tenantId],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || isReordering) return

      const oldIndex = pipelines.findIndex((pipeline) => pipeline.id === active.id)
      const newIndex = pipelines.findIndex((pipeline) => pipeline.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return

      const position: "before" | "after" = oldIndex < newIndex ? "after" : "before"
      void persistReorder(arrayMove(pipelines, oldIndex, newIndex), {
        activeId: String(active.id),
        overId: String(over.id),
        position,
      })
    },
    [isReordering, persistReorder, pipelines],
  )

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_46%,#fff7ed_100%)]">
          <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.3fr)_280px] lg:p-7">
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                  Opportunities Admin
                </p>
                <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-slate-950">
                  Configure how {tenantSlug} tracks pipeline progress.
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-slate-600">
                  Create opportunity pipelines, control their stage flow, and keep tenant-specific
                  lifecycle rules aligned with the rest of the admin workspace.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge
                  variant="secondary"
                  className="rounded-full border border-white/70 bg-white/85 px-3 py-1 text-slate-700"
                >
                  <Target className="mr-1.5 h-3.5 w-3.5" />
                  {summaryLabel}
                </Badge>
                <Badge
                  variant="secondary"
                  className="rounded-full border border-white/70 bg-white/85 px-3 py-1 text-slate-700"
                >
                  <Clock3 className="mr-1.5 h-3.5 w-3.5" />
                  {pageSize} rows per page
                </Badge>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="rounded-[24px] border border-white/70 bg-white/85 p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Total Pipelines
                </p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
                  {total}
                </p>
              </div>
              <div className="rounded-[24px] border border-slate-300/60 bg-slate-950 p-4 text-white shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/90">
                  Visible Stages
                </p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">
                  {visibleStageCount}
                </p>
                <p className="mt-2 text-xs text-slate-300">
                  Across the pipelines shown on this page
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 shadow-sm md:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-slate-950">
                Opportunity Pipelines
              </h3>
              <p className="text-sm text-slate-600">
                Open a pipeline to edit its stages, color theme, and lifecycle structure.
              </p>
            </div>

            <Button
              type="button"
              onClick={() => setIsCreateDialogOpen(true)}
              className="bg-slate-950 text-white hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              Create pipeline
            </Button>
          </div>

          <div className="mt-5 min-h-0 flex-1 overflow-auto rounded-[20px] border border-slate-200 bg-white">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <Table className="[&_td]:py-2 [&_th]:h-8">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12" />
                    <TableHead className="min-w-44 text-xs">Pipeline</TableHead>
                    <TableHead className="min-w-36 text-xs">Color</TableHead>
                    <TableHead className="min-w-44 text-xs">Stages</TableHead>
                    <TableHead className="min-w-36 text-xs">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                        Loading opportunity pipelines...
                      </TableCell>
                    </TableRow>
                  ) : errorMessage ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-rose-600">
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
                          disabled={isReordering}
                          onOpen={(href) => router.push(href)}
                        />
                      ))}
                    </SortableContext>
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                        No pipelines configured yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </DndContext>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Drag rows to control the same pipeline order shown in the opportunities selector.
            </p>
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
        </section>
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
