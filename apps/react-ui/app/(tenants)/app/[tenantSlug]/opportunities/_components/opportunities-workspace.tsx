"use client"

import { isAxiosError } from "axios"
import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  Blocks,
  CalendarPlus,
  CheckCircle2,
  ListTodo,
  Loader2,
  NotebookPen,
  Plus,
  Search,
  Tags,
  Target,
  X,
  XCircle,
} from "lucide-react"
import { type ReactNode, startTransition, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { ContactTagAssignDialog } from "../../contacts/_components/contact-tag-assign-dialog"
import { CreateContactNoteDialog } from "../../contacts/_components/create-contact-note-dialog"
import { CreateTaskDialog } from "../../tasks/_components/create-task-dialog"
import { CreateAppointmentDialog } from "../../calendar/_components/create-appointment-dialog"
import { type CalendarMetaResponse } from "../../calendar/_lib/calendar-api"
import { AddContactOpportunityDialog } from "./add-contact-opportunity-dialog"
import { OpportunityDetailDrawer } from "./opportunity-detail-drawer"
import {
  FilterButton,
  OpportunityFilterDrawer,
  type OpportunityFilters,
  type FilterOption,
  type AssigneeOption,
  type CustomFieldOption,
} from "./opportunity-filter-drawer"

type PipelineOption = {
  id: string
  name: string
  color: string
  sortOrder: number
  stageCount: number
  opportunityCount: number
}

type PipelineListResponse = {
  ok: boolean
  items: PipelineOption[]
}

type OpportunityCardRecord = {
  id: string
  tenantId: string
  contactId: string
  pipelineId: string
  stageId: string
  valueCents: number
  result: "OPEN" | "WON" | "LOST"
  closedAt: string | null
  createdAt: string
  updatedAt: string
  contact: {
    id: string
    fullName: string
    email: string | null
    phoneNumber: string | null
  }
  assignedTo: {
    userId: string
    name: string
    email: string
    image: string | null
  } | null
}

type StageColumnRecord = {
  id: string
  name: string
  sortOrder: number
  count: number
  totalValueCents: number
  cards: OpportunityCardRecord[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type BoardPipelineRecord = {
  id: string
  name: string
  color: string
  sortOrder: number
  stages: StageColumnRecord[]
}

type PipelineBoardResponse = {
  ok: boolean
  pipeline: BoardPipelineRecord
}

type StageCardsResponse = {
  ok: boolean
  stage: {
    id: string
    name: string
    sortOrder: number
    count: number
    totalValueCents: number
  }
  items: OpportunityCardRecord[]
  pagination: StageColumnRecord["pagination"]
}

type MoveOpportunityResponse = {
  ok: boolean
  opportunity: OpportunityCardRecord
  automation?: {
    matchedCount: number
    executedCount: number
  }
}

type OpportunityOutcome = "WON" | "LOST"

type OpportunitiesWorkspaceProps = {
  tenantSlug: string
  tenantId: string
  tenantTimezone: string | null
  currentUserId: string
  canManageTags: boolean
  taskStatusOptions: Array<{
    label: string
    value: string
    bgColor?: string
    textColor?: string
  }>
  taskAssigneeOptions: Array<{
    value: string
    label: string
    email: string
    image: string | null
  }>
  calendarMeta: Pick<CalendarMetaResponse, "settings" | "filters">
  opportunityFilterOptions: {
    statuses: FilterOption[]
    tags: FilterOption[]
    assignees: AssigneeOption[]
    customFields: CustomFieldOption[]
  }
}

const STAGE_PAGE_SIZE = 10
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function getInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function toTranslateString(transform: { x: number; y: number } | null) {
  if (!transform) return undefined
  return `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
}

function formatUsdCents(valueCents: number) {
  return currencyFormatter.format(valueCents / 100)
}

function stopDragPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

function formatErrorMessage(error: unknown, fallback: string) {
  if (!isAxiosError(error)) {
    return fallback
  }

  const backendMessage = error.response?.data?.message
  if (typeof backendMessage === "string" && backendMessage.trim()) {
    return backendMessage
  }

  const backendError = error.response?.data?.error
  if (typeof backendError !== "string") {
    return fallback
  }

  return backendError
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function cleanSearchInput(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
}

function recalculatePagination(
  pagination: StageColumnRecord["pagination"],
  total: number,
) {
  return {
    ...pagination,
    total,
    totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
  }
}

function findOpportunityStage(
  pipeline: BoardPipelineRecord,
  opportunityId: string,
) {
  for (const stage of pipeline.stages) {
    const card = stage.cards.find((item) => item.id === opportunityId)
    if (card) {
      return {
        card,
        stageId: stage.id,
      }
    }
  }

  return null
}

function moveOpportunityLocally(
  pipeline: BoardPipelineRecord,
  opportunityId: string,
  targetStageId: string,
  nextOpportunity?: OpportunityCardRecord,
) {
  const located = findOpportunityStage(pipeline, opportunityId)
  if (!located || located.stageId === targetStageId) {
    return pipeline
  }

  const movingCard = located.card
  const sourceStageId = located.stageId
  const updatedCard = nextOpportunity ?? {
    ...movingCard,
    stageId: targetStageId,
    updatedAt: new Date().toISOString(),
  }

  return {
    ...pipeline,
    stages: pipeline.stages.map((stage) => {
      if (stage.id === sourceStageId) {
        const nextCards = stage.cards.filter((card) => card.id !== opportunityId)
        const nextTotal = Math.max(0, stage.count - 1)
        return {
          ...stage,
          count: nextTotal,
          totalValueCents: Math.max(0, stage.totalValueCents - movingCard.valueCents),
          cards: nextCards,
          pagination: recalculatePagination(stage.pagination, nextTotal),
        }
      }

      if (stage.id === targetStageId) {
        const dedupedCards = stage.cards.filter((card) => card.id !== opportunityId)
        const nextCards = [updatedCard, ...dedupedCards]
        const nextTotal = stage.count + 1
        return {
          ...stage,
          count: nextTotal,
          totalValueCents: stage.totalValueCents + updatedCard.valueCents,
          cards: nextCards,
          pagination: recalculatePagination(stage.pagination, nextTotal),
        }
      }

      return stage
    }),
  }
}

function insertOpportunityLocally(
  pipeline: BoardPipelineRecord,
  opportunity: OpportunityCardRecord,
) {
  return {
    ...pipeline,
    stages: pipeline.stages.map((stage) => {
      if (stage.id !== opportunity.stageId) return stage

      const nextTotal = stage.count + 1
      return {
        ...stage,
        count: nextTotal,
        totalValueCents: stage.totalValueCents + opportunity.valueCents,
        cards: [opportunity, ...stage.cards],
        pagination: recalculatePagination(stage.pagination, nextTotal),
      }
    }),
  }
}

function closeOpportunityLocally(
  pipeline: BoardPipelineRecord,
  opportunityId: string,
) {
  const located = findOpportunityStage(pipeline, opportunityId)
  if (!located) return pipeline

  return {
    ...pipeline,
    stages: pipeline.stages.map((stage) => {
      if (stage.id !== located.stageId) return stage

      const nextCards = stage.cards.filter((card) => card.id !== opportunityId)
      const nextTotal = Math.max(0, stage.count - 1)
      return {
        ...stage,
        count: nextTotal,
        totalValueCents: Math.max(0, stage.totalValueCents - located.card.valueCents),
        cards: nextCards,
        pagination: recalculatePagination(stage.pagination, nextTotal),
      }
    }),
  }
}

function DroppableStageColumn({
  stage,
  children,
  showDropHint = false,
}: {
  stage: StageColumnRecord
  children: ReactNode
  showDropHint?: boolean
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `stage:${stage.id}`,
  })

  return (
    <section className="flex w-[340px] shrink-0 flex-col gap-3">
      <header className="rounded-[24px] bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-slate-950">{stage.name}</p>
              <Badge className="h-6 rounded-full border-slate-200 bg-slate-50 px-2.5 py-0 text-[11px] text-slate-600 hover:bg-slate-50">
                {stage.count}
              </Badge>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold text-slate-700">
              {formatUsdCents(stage.totalValueCents)}
            </p>
          </div>
        </div>
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-[280px] flex-1 flex-col gap-4 rounded-[28px] p-1 transition-colors",
          isOver && "bg-blue-50/70",
        )}
      >
        {showDropHint ? (
          <div
            className={cn(
              "flex min-h-[120px] items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-white/80 px-4 text-center shadow-[0_10px_30px_rgba(15,23,42,0.04)] transition-colors",
              isOver && "border-blue-300 bg-blue-50/90",
            )}
          >
            <p className="text-sm font-medium text-slate-500">
              Drop opportunity here
            </p>
          </div>
        ) : null}
        {children}
      </div>
    </section>
  )
}

function OpportunityCard({
  opportunity,
  tenantId,
  tenantSlug,
  tenantTimezone,
  currentUserId,
  canManageTags,
  taskStatusOptions,
  taskAssigneeOptions,
  calendarMeta,
  overlay = false,
  onOpenDetail,
}: {
  opportunity: OpportunityCardRecord
  tenantId: string
  tenantSlug: string
  tenantTimezone: string | null
  currentUserId: string
  canManageTags: boolean
  taskStatusOptions: OpportunitiesWorkspaceProps["taskStatusOptions"]
  taskAssigneeOptions: OpportunitiesWorkspaceProps["taskAssigneeOptions"]
  calendarMeta: OpportunitiesWorkspaceProps["calendarMeta"]
  overlay?: boolean
  onOpenDetail?: (opportunity: OpportunityCardRecord) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: overlay ? `overlay:${opportunity.id}` : opportunity.id,
    data: {
      opportunityId: opportunity.id,
      stageId: opportunity.stageId,
    },
    disabled: overlay,
  })

  const dragInteractionProps = overlay ? {} : { ...attributes, ...listeners }

  const handleCardClick = () => {
    if (!overlay && onOpenDetail) {
      onOpenDetail(opportunity)
    }
  }

  return (
    <article
      ref={setNodeRef}
      style={{ transform: toTranslateString(transform) }}
      {...dragInteractionProps}
      onClick={handleCardClick}
      className={cn(
        "group relative overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.08)] transition-all",
        !overlay &&
          "cursor-pointer hover:border-slate-300 hover:shadow-[0_14px_34px_rgba(15,23,42,0.12)]",
        isDragging && !overlay && "opacity-70 shadow-md",
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/app/${tenantSlug}/contacts/${opportunity.contact.id}/overview`}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950 transition hover:text-blue-950"
                onPointerDown={stopDragPropagation}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="truncate">{opportunity.contact.fullName}</span>
              </a>
            </div>
            <p className="mt-1.5 truncate text-xs text-slate-500">
              {opportunity.contact.email ?? opportunity.contact.phoneNumber ?? "No contact details"}
            </p>
          </div>
          {opportunity.assignedTo ? (
            <div className="flex shrink-0 items-start">
              <Avatar
                className="h-9 w-9 border border-slate-200 bg-white shadow-sm"
                title={opportunity.assignedTo.name}
              >
                <AvatarImage
                  src={opportunity.assignedTo.image ?? undefined}
                  alt={opportunity.assignedTo.name}
                />
                <AvatarFallback className="bg-blue-100 text-xs font-semibold text-blue-900">
                  {getInitials(opportunity.assignedTo.name)}
                </AvatarFallback>
              </Avatar>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5">
            <span className="text-sm font-semibold text-slate-950">
              {formatUsdCents(opportunity.valueCents)}
            </span>
          </div>
          {!overlay ? (
            <div className="flex items-center gap-1.5">
              <ContactTagAssignDialog
                tenantId={tenantId}
                contactId={opportunity.contact.id}
                canManageTags={canManageTags}
                presentation="drawer"
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 cursor-pointer rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    onPointerDown={stopDragPropagation}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Tags className="h-4 w-4" />
                  </Button>
                }
              />
              <CreateContactNoteDialog
                tenantId={tenantId}
                contactId={opportunity.contact.id}
                presentation="drawer"
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 cursor-pointer rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    onPointerDown={stopDragPropagation}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <NotebookPen className="h-4 w-4" />
                  </Button>
                }
              />
              <CreateTaskDialog
                tenantId={tenantId}
                tenantTimezone={tenantTimezone}
                statusOptions={taskStatusOptions}
                assigneeOptions={taskAssigneeOptions}
                presentation="drawer"
                initialContact={{
                  id: opportunity.contact.id,
                  fullName: opportunity.contact.fullName,
                  email: opportunity.contact.email,
                  phoneNumber: opportunity.contact.phoneNumber,
                }}
                lockContact
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 cursor-pointer rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    onPointerDown={stopDragPropagation}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ListTodo className="h-4 w-4" />
                  </Button>
                }
              />
              <CreateAppointmentDialog
                tenantId={tenantId}
                tenantTimezone={tenantTimezone}
                currentUserId={currentUserId}
                initialContact={{
                  id: opportunity.contact.id,
                  fullName: opportunity.contact.fullName,
                  email: opportunity.contact.email,
                  phoneNumber: opportunity.contact.phoneNumber,
                }}
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 cursor-pointer rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    onPointerDown={stopDragPropagation}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <CalendarPlus className="h-4 w-4" />
                  </Button>
                }
                meetingIntervalMinutes={calendarMeta.settings.meetingIntervalMinutes}
                meetingDurationMinutes={calendarMeta.settings.meetingDurationMinutes}
                serviceOptions={calendarMeta.filters.services}
                assigneeOptions={calendarMeta.filters.users}
              />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function OutcomeDropZone({
  id,
  label,
  description,
  tone,
  icon,
}: {
  id: string
  label: string
  description: string
  tone: "green" | "rose"
  icon: ReactNode
}) {
  const { isOver, setNodeRef } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-w-[220px] flex-1 items-center gap-3 rounded-[22px] border px-4 py-4 shadow-lg transition-all",
        tone === "green" &&
          "border-emerald-200 bg-white text-emerald-950 shadow-emerald-950/5",
        tone === "rose" && "border-rose-200 bg-white text-rose-950 shadow-rose-950/5",
        isOver &&
          (tone === "green"
            ? "scale-[1.02] border-emerald-400 bg-emerald-50"
            : "scale-[1.02] border-rose-400 bg-rose-50"),
      )}
    >
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
          tone === "green" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
    </div>
  )
}

function OpportunityCardSkeleton() {
  return (
    <article className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-32 rounded-md" />
            <Skeleton className="h-3 w-44 rounded-md" />
          </div>
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <Skeleton className="h-8 w-24 rounded-full" />
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </div>
      </div>
    </article>
  )
}

function OpportunitiesBoardSkeleton({ columnCount }: { columnCount: number }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-4 overflow-x-auto p-4">
      {Array.from({ length: columnCount }).map((_, index) => (
        <section
          key={`opportunities-board-skeleton-${index}`}
          className="flex w-[340px] shrink-0 flex-col gap-3"
        >
          <header className="px-1 py-1">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-28 rounded-md" />
                <Skeleton className="h-5 w-8 rounded-full" />
              </div>
              <div className="text-right">
                <Skeleton className="ml-auto h-4 w-16 rounded-md" />
              </div>
            </div>
          </header>

          <div className="flex min-h-[280px] flex-1 flex-col gap-4 p-1">
            <OpportunityCardSkeleton />
            <OpportunityCardSkeleton />
            <OpportunityCardSkeleton />
          </div>
        </section>
      ))}
    </div>
  )
}

export function OpportunitiesWorkspace({
  tenantSlug,
  tenantId,
  tenantTimezone,
  currentUserId,
  canManageTags,
  taskStatusOptions,
  taskAssigneeOptions,
  calendarMeta,
  opportunityFilterOptions,
}: OpportunitiesWorkspaceProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const selectedPipelineId = searchParams.get("pipelineId")?.trim() ?? ""
  const searchParam = cleanSearchInput(searchParams.get("search") ?? "")

  const [pipelineOptions, setPipelineOptions] = useState<PipelineOption[]>([])
  const [boardPipeline, setBoardPipeline] = useState<BoardPipelineRecord | null>(null)
  const [isLoadingPipelines, setIsLoadingPipelines] = useState(false)
  const [isLoadingBoard, setIsLoadingBoard] = useState(false)
  const [boardError, setBoardError] = useState<string | null>(null)
  const [loadingStageIds, setLoadingStageIds] = useState<string[]>([])
  const [activeOpportunityId, setActiveOpportunityId] = useState<string | null>(null)
  const [query, setQuery] = useState(searchParam)
  const [debouncedQuery, setDebouncedQuery] = useState(searchParam)
  const [selectedOpportunity, setSelectedOpportunity] = useState<OpportunityCardRecord | null>(null)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [filters, setFilters] = useState<OpportunityFilters>({
    tagIds: [],
    statusConfigIds: [],
    assignedToUserIds: [],
    customFieldFilters: [],
  })

  const activeOpportunity = useMemo(() => {
    if (!activeOpportunityId || !boardPipeline) return null

    for (const stage of boardPipeline.stages) {
      const match = stage.cards.find((card) => card.id === activeOpportunityId)
      if (match) return match
    }

    return null
  }, [activeOpportunityId, boardPipeline])

  const selectedPipeline = useMemo(
    () => pipelineOptions.find((pipeline) => pipeline.id === selectedPipelineId) ?? null,
    [pipelineOptions, selectedPipelineId],
  )

  const loadingSkeletonColumnCount = Math.max(
    1,
    selectedPipeline?.stageCount ?? boardPipeline?.stages.length ?? 3,
  )

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(cleanSearchInput(query))
    }, 300)

    return () => window.clearTimeout(timeout)
  }, [query])

  const updatePipelineQuery = (pipelineId: string) => {
    const nextParams = new URLSearchParams(searchParams.toString())
    if (pipelineId) {
      nextParams.set("pipelineId", pipelineId)
    } else {
      nextParams.delete("pipelineId")
    }

    startTransition(() => {
      router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false })
    })
  }

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams.toString())
    if (debouncedQuery) {
      nextParams.set("search", debouncedQuery)
    } else {
      nextParams.delete("search")
    }

    const nextQuery = nextParams.toString()
    const currentQuery = searchParams.toString()
    if (nextQuery === currentQuery) return

    startTransition(() => {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
    })
  }, [debouncedQuery, pathname, router, searchParams])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setIsLoadingPipelines(true)

      try {
        const { data } = await api.get<PipelineListResponse>(`/api/opportunities/${tenantId}/pipelines`)
        if (cancelled) return
        setPipelineOptions(data.items)
      } catch (error) {
        if (cancelled) return
        toast.error(formatErrorMessage(error, "Could not load opportunity pipelines."))
        setPipelineOptions([])
      } finally {
        if (!cancelled) {
          setIsLoadingPipelines(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [tenantId])

  useEffect(() => {
    if (isLoadingPipelines) return

    if (pipelineOptions.length === 0) {
      setBoardPipeline(null)
      return
    }

    const pipelineExists = pipelineOptions.some((item) => item.id === selectedPipelineId)
    if (!selectedPipelineId || !pipelineExists) {
      const nextPipelineId = pipelineOptions[0]?.id
      if (!nextPipelineId) return

      const nextParams = new URLSearchParams(searchParams.toString())
      nextParams.set("pipelineId", nextPipelineId)

      startTransition(() => {
        router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false })
      })
    }
  }, [isLoadingPipelines, pathname, pipelineOptions, router, searchParams, selectedPipelineId])

  useEffect(() => {
    if (!selectedPipelineId) return

    let cancelled = false
    void (async () => {
      setIsLoadingBoard(true)
      setBoardError(null)

      try {
        const { data } = await api.get<PipelineBoardResponse>(
          `/api/opportunities/${tenantId}/pipelines/${selectedPipelineId}/board`,
          {
            params: {
              pageSize: STAGE_PAGE_SIZE,
              search: debouncedQuery || undefined,
              tagIds: filters.tagIds.length > 0 ? filters.tagIds.join(",") : undefined,
              statusConfigIds:
                filters.statusConfigIds.length > 0
                  ? filters.statusConfigIds.join(",")
                  : undefined,
              assignedToUserIds:
                filters.assignedToUserIds.length > 0
                  ? filters.assignedToUserIds.join(",")
                  : undefined,
              customFieldFilters:
                filters.customFieldFilters.length > 0
                  ? JSON.stringify(filters.customFieldFilters)
                  : undefined,
            },
          },
        )

        if (!cancelled) {
          setBoardPipeline(data.pipeline)
        }
      } catch (error) {
        if (cancelled) return
        setBoardPipeline(null)
        setBoardError(formatErrorMessage(error, "Could not load the opportunities board."))
      } finally {
        if (!cancelled) {
          setIsLoadingBoard(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [debouncedQuery, filters, selectedPipelineId, tenantId])

  const handleLoadMore = async (stageId: string) => {
    if (!selectedPipelineId || !boardPipeline) return

    const stage = boardPipeline.stages.find((item) => item.id === stageId)
    if (!stage || stage.pagination.page >= stage.pagination.totalPages) return

    setLoadingStageIds((current) => [...current, stageId])

    try {
      const nextPage = stage.pagination.page + 1
      const { data } = await api.get<StageCardsResponse>(
        `/api/opportunities/${tenantId}/pipelines/${selectedPipelineId}/stages/${stageId}`,
        {
          params: {
            page: nextPage,
            pageSize: stage.pagination.pageSize,
            search: debouncedQuery || undefined,
            tagIds: filters.tagIds.length > 0 ? filters.tagIds.join(",") : undefined,
            statusConfigIds:
              filters.statusConfigIds.length > 0
                ? filters.statusConfigIds.join(",")
                : undefined,
            assignedToUserIds:
              filters.assignedToUserIds.length > 0
                ? filters.assignedToUserIds.join(",")
                : undefined,
            customFieldFilters:
              filters.customFieldFilters.length > 0
                ? JSON.stringify(filters.customFieldFilters)
                : undefined,
          },
        },
      )

      setBoardPipeline((current) => {
        if (!current) return current

        return {
          ...current,
          stages: current.stages.map((item) =>
            item.id === stageId
              ? {
                  ...item,
                  count: data.stage.count,
                  totalValueCents: data.stage.totalValueCents,
                  cards: [...item.cards, ...data.items],
                  pagination: data.pagination,
                }
              : item,
          ),
        }
      })
    } catch (error) {
      toast.error(formatErrorMessage(error, "Could not load more opportunities."))
    } finally {
      setLoadingStageIds((current) => current.filter((id) => id !== stageId))
    }
  }

  const handleOpportunityCreated = async (opportunity: OpportunityCardRecord) => {
    setPipelineOptions((current) =>
      current.map((item) =>
        item.id === opportunity.pipelineId
          ? { ...item, opportunityCount: item.opportunityCount + 1 }
          : item,
      ),
    )

    setBoardPipeline((current) => {
      if (!current || current.id !== opportunity.pipelineId) return current
      return insertOpportunityLocally(current, opportunity)
    })
  }

  const handleDrawerStageChange = async (opportunityId: string, targetStageId: string) => {
    if (!boardPipeline) return

    const previousPipeline = boardPipeline
    setBoardPipeline(moveOpportunityLocally(boardPipeline, opportunityId, targetStageId))

    setSelectedOpportunity((current) => {
      if (!current || current.id !== opportunityId) return current
      return { ...current, stageId: targetStageId }
    })

    try {
      const { data } = await api.patch<MoveOpportunityResponse>(
        `/api/opportunities/${tenantId}/${opportunityId}`,
        { stageId: targetStageId },
      )

      setBoardPipeline((current) => {
        if (!current) return current
        return moveOpportunityLocally(current, opportunityId, targetStageId, data.opportunity)
      })

      setSelectedOpportunity((current) => {
        if (!current || current.id !== opportunityId) return current
        return data.opportunity
      })
      if ((data.automation?.executedCount ?? 0) > 0) {
        toast.success(`${data.automation!.executedCount} automation${data.automation!.executedCount === 1 ? "" : "s"} ran.`)
      }
    } catch (error) {
      setBoardPipeline(previousPipeline)
      setSelectedOpportunity((current) => {
        if (!current || current.id !== opportunityId) return current
        const original = findOpportunityStage(previousPipeline, opportunityId)
        return original?.card ?? current
      })
      throw error
    }
  }

  const handleDrawerCloseOpportunity = async (opportunityId: string, result: "WON" | "LOST") => {
    if (!boardPipeline) return

    const previousPipeline = boardPipeline
    setBoardPipeline(closeOpportunityLocally(boardPipeline, opportunityId))
    setPipelineOptions((current) =>
      current.map((item) =>
        item.id === boardPipeline.id
          ? { ...item, opportunityCount: Math.max(0, item.opportunityCount - 1) }
          : item,
      ),
    )

    try {
      await api.patch<MoveOpportunityResponse>(`/api/opportunities/${tenantId}/${opportunityId}`, {
        result,
      })
    } catch (error) {
      setBoardPipeline(previousPipeline)
      setPipelineOptions((current) =>
        current.map((item) =>
          item.id === boardPipeline.id
            ? { ...item, opportunityCount: item.opportunityCount + 1 }
            : item,
        ),
      )
      toast.error(formatErrorMessage(error, `Could not mark opportunity as ${result.toLowerCase()}.`))
      throw error
    }
  }

  const handleDrawerValueChange = async (opportunityId: string, newValueCents: number) => {
    if (!boardPipeline) return

    const updateValueInPipeline = (pipeline: BoardPipelineRecord): BoardPipelineRecord => ({
      ...pipeline,
      stages: pipeline.stages.map((stage) => ({
        ...stage,
        cards: stage.cards.map((card) =>
          card.id === opportunityId ? { ...card, valueCents: newValueCents } : card,
        ),
        totalValueCents: stage.cards.reduce((sum, card) => {
          if (card.id === opportunityId) return sum + newValueCents
          return sum + card.valueCents
        }, 0),
      })),
    })

    const previousPipeline = boardPipeline
    setBoardPipeline(updateValueInPipeline(boardPipeline))
    setSelectedOpportunity((current) => {
      if (!current || current.id !== opportunityId) return current
      return { ...current, valueCents: newValueCents }
    })

    try {
      await api.patch(`/api/opportunities/${tenantId}/${opportunityId}`, {
        valueCents: newValueCents,
      })
    } catch (error) {
      setBoardPipeline(previousPipeline)
      setSelectedOpportunity((current) => {
        if (!current || current.id !== opportunityId) return current
        return { ...current, valueCents: previousPipeline.stages.reduce((sum, stage) => {
          const card = stage.cards.find((c) => c.id === opportunityId)
          return card ? card.valueCents : sum
        }, 0) }
      })
      toast.error(formatErrorMessage(error, "Could not update opportunity value."))
      throw error
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveOpportunityId(null)

    const opportunityId = String(event.active.id)
    const overId = event.over?.id ? String(event.over.id) : null
    if (!boardPipeline || !overId) return

    if (overId.startsWith("outcome:")) {
      const result = overId.replace("outcome:", "") as OpportunityOutcome
      const previousPipeline = boardPipeline

      setBoardPipeline(closeOpportunityLocally(boardPipeline, opportunityId))
      setPipelineOptions((current) =>
        current.map((item) =>
          item.id === boardPipeline.id
            ? { ...item, opportunityCount: Math.max(0, item.opportunityCount - 1) }
            : item,
        ),
      )

      try {
        await api.patch<MoveOpportunityResponse>(`/api/opportunities/${tenantId}/${opportunityId}`, {
          result,
        })
      } catch (error) {
        setBoardPipeline(previousPipeline)
        setPipelineOptions((current) =>
          current.map((item) =>
            item.id === boardPipeline.id
              ? { ...item, opportunityCount: item.opportunityCount + 1 }
              : item,
          ),
        )
        toast.error(formatErrorMessage(error, `Could not mark opportunity as ${result.toLowerCase()}.`))
      }

      return
    }

    if (!overId.startsWith("stage:")) return

    const targetStageId = overId.replace("stage:", "")
    const sourceStage = boardPipeline.stages.find((stage) =>
      stage.cards.some((card) => card.id === opportunityId),
    )
    if (!sourceStage || sourceStage.id === targetStageId) return

    const previousPipeline = boardPipeline
    setBoardPipeline(moveOpportunityLocally(boardPipeline, opportunityId, targetStageId))

    try {
      const { data } = await api.patch<MoveOpportunityResponse>(
        `/api/opportunities/${tenantId}/${opportunityId}`,
        { stageId: targetStageId },
      )

      setBoardPipeline((current) => {
        if (!current) return current
        return moveOpportunityLocally(current, opportunityId, targetStageId, data.opportunity)
      })
      if ((data.automation?.executedCount ?? 0) > 0) {
        toast.success(`${data.automation!.executedCount} automation${data.automation!.executedCount === 1 ? "" : "s"} ran.`)
      }
    } catch (error) {
      setBoardPipeline(previousPipeline)
      toast.error(formatErrorMessage(error, "Could not move opportunity."))
    }
  }

  const hasPipelines = pipelineOptions.length > 0
  const totalOpenOpportunities = boardPipeline
    ? boardPipeline.stages.reduce((sum, stage) => sum + stage.count, 0)
    : 0
  const activeOpportunityStageId = activeOpportunity?.stageId ?? null

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)]">
        <div className="space-y-3 p-4 md:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-col gap-3 lg:flex-1 lg:flex-row lg:items-center">
              <h1 className="shrink-0 text-xl font-semibold tracking-tight text-slate-950">
                Opportunities
              </h1>

              <div className="w-full min-w-0 lg:max-w-[320px]">
                <Select
                  value={selectedPipelineId}
                  onValueChange={updatePipelineQuery}
                  disabled={isLoadingPipelines || pipelineOptions.length === 0}
                >
                  <SelectTrigger className="h-12 w-full rounded-2xl border-slate-200 bg-white px-4 shadow-sm transition hover:border-slate-300 focus-visible:ring-blue-200">
                    <div className="flex min-w-0 items-center gap-2">
                      {selectedPipeline ? (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-200"
                          style={{ backgroundColor: selectedPipeline.color }}
                        />
                      ) : null}
                      <span className="truncate text-sm font-medium text-slate-900">
                        {selectedPipeline?.name ??
                          (isLoadingPipelines ? "Loading pipelines..." : "Select a pipeline")}
                      </span>
                    </div>
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    side="bottom"
                    align="start"
                    sideOffset={8}
                    avoidCollisions={false}
                    className="w-[--radix-select-trigger-width] rounded-2xl border-slate-200 bg-white p-1 shadow-xl"
                  >
                    {pipelineOptions.map((pipeline) => (
                      <SelectItem key={pipeline.id} value={pipeline.id}>
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full border border-slate-200"
                            style={{ backgroundColor: pipeline.color }}
                          />
                          <span className="truncate font-medium text-slate-900">
                            {pipeline.name}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Badge className="inline-flex  shrink-0 items-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-white">
                {totalOpenOpportunities} opportunit{totalOpenOpportunities === 1 ? "y" : "ies"}
              </Badge>
            </div>

            {hasPipelines ? (
              <AddContactOpportunityDialog
                tenantId={tenantId}
                initialPipelineId={selectedPipelineId}
                lockPipeline
                onCreated={handleOpportunityCreated}
                trigger={
                  <Button className="h-10 cursor-pointer bg-blue-950 text-white hover:bg-blue-900">
                    <Plus className="h-4 w-4" />
                    Add opportunity
                  </Button>
                }
              />
            ) : null}
          </div>

          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by contact name or phone number"
                className="h-12 rounded-2xl border-slate-200 bg-white pl-9 pr-12 shadow-sm transition hover:border-slate-300 focus-visible:ring-blue-200"
              />
              {query ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1.5 top-1/2 h-8 w-8 -translate-y-1/2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  onClick={() => setQuery("")}
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Clear search</span>
                </Button>
              ) : null}
            </div>

            <FilterButton
                activeFilterCount={
                  filters.tagIds.length +
                  filters.statusConfigIds.length +
                  filters.assignedToUserIds.length +
                  filters.customFieldFilters.filter((f) => {
                    if (f.type === "text") return Boolean(f.text)
                    if (f.type === "number" || f.type === "currency")
                      return f.min !== undefined || f.max !== undefined
                    if (f.type === "date") return Boolean(f.dateFrom || f.dateTo)
                    if (f.type === "select" || f.type === "multi_select")
                      return Boolean(f.values && f.values.length > 0)
                    if (f.type === "checkbox") return f.checked !== undefined
                    return false
                  }).length
                }
                onClick={() => setIsFilterOpen(true)}
              />

              <Button
                type="button"
                variant="outline"
                className="h-12 cursor-pointer rounded-2xl border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                onClick={() => {
                  toast.info("Bulk actions are not available yet.")
                }}
              >
                <Blocks className="h-4 w-4" />
                Bulk actions
              </Button>
            </div>
          </div>
        </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        {!hasPipelines && !isLoadingPipelines ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            <div className="rounded-full bg-blue-50 p-3 text-blue-700">
              <Target className="h-6 w-6" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-950">No pipelines yet</h2>
              <p className="max-w-md text-sm text-slate-500">
                Create at least one opportunity pipeline in account settings before you start enrolling contacts into the board.
              </p>
            </div>
            <a
              href={`/app/${tenantSlug}/account-settings/opportunities`}
              className="inline-flex items-center rounded-xl bg-blue-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-900"
            >
              Open pipeline settings
            </a>
          </div>
        ) : isLoadingBoard ? (
          <OpportunitiesBoardSkeleton columnCount={loadingSkeletonColumnCount} />
        ) : boardError ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-rose-600">
            {boardError}
          </div>
        ) : boardPipeline ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={(event) => setActiveOpportunityId(String(event.active.id))}
            onDragCancel={() => setActiveOpportunityId(null)}
            onDragEnd={(event) => void handleDragEnd(event)}
          >
            <div className="relative flex min-h-0 min-w-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 gap-4 overflow-x-auto p-4 pb-32">
                {boardPipeline.stages.map((stage) => (
                  <DroppableStageColumn
                    key={stage.id}
                    stage={stage}
                    showDropHint={Boolean(activeOpportunityId) && activeOpportunityStageId !== stage.id}
                  >
                    {stage.cards.length > 0 ? (
                      <>
                        {stage.cards.map((opportunity) => (
                          <OpportunityCard
                            key={opportunity.id}
                            opportunity={opportunity}
                            tenantId={tenantId}
                            tenantSlug={tenantSlug}
                            tenantTimezone={tenantTimezone}
                            currentUserId={currentUserId}
                            canManageTags={canManageTags}
                            taskStatusOptions={taskStatusOptions}
                            taskAssigneeOptions={taskAssigneeOptions}
                            calendarMeta={calendarMeta}
                            onOpenDetail={setSelectedOpportunity}
                          />
                        ))}

                        {stage.pagination.page < stage.pagination.totalPages ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="mt-1 cursor-pointer border-dashed border-slate-300 text-slate-600 hover:bg-slate-50"
                            disabled={loadingStageIds.includes(stage.id)}
                            onClick={() => void handleLoadMore(stage.id)}
                          >
                            {loadingStageIds.includes(stage.id) ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : null}
                            Load more
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <div className="min-h-[180px] flex-1" />
                    )}
                  </DroppableStageColumn>
                ))}
              </div>

              {activeOpportunity ? (
                <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-4">
                  <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-[28px] border border-slate-200/80 bg-white/95 p-3 shadow-2xl backdrop-blur">
                    <OutcomeDropZone
                      id="outcome:WON"
                      label="Won"
                      description="Drop here to mark this opportunity as won."
                      tone="green"
                      icon={<CheckCircle2 className="h-5 w-5" />}
                    />
                    <OutcomeDropZone
                      id="outcome:LOST"
                      label="Lost"
                      description="Drop here to remove it from the active pipeline."
                      tone="rose"
                      icon={<XCircle className="h-5 w-5" />}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <DragOverlay>
              {activeOpportunity ? (
                <div className="w-[340px]">
                  <OpportunityCard
                    opportunity={activeOpportunity}
                    tenantId={tenantId}
                    tenantSlug={tenantSlug}
                    tenantTimezone={tenantTimezone}
                    currentUserId={currentUserId}
                    canManageTags={canManageTags}
                    taskStatusOptions={taskStatusOptions}
                    taskAssigneeOptions={taskAssigneeOptions}
                    calendarMeta={calendarMeta}
                    overlay
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : null}
      </div>

      {selectedOpportunity && boardPipeline ? (
        <OpportunityDetailDrawer
          opportunity={selectedOpportunity}
          tenantSlug={tenantSlug}
          stages={boardPipeline.stages.map((stage) => ({ id: stage.id, name: stage.name }))}
          open={Boolean(selectedOpportunity)}
          onOpenChange={(open) => {
            if (!open) setSelectedOpportunity(null)
          }}
          onStageChange={handleDrawerStageChange}
          onCloseOpportunity={handleDrawerCloseOpportunity}
          onValueChange={handleDrawerValueChange}
        />
      ) : null}

      <OpportunityFilterDrawer
        open={isFilterOpen}
        onOpenChange={setIsFilterOpen}
        tagOptions={opportunityFilterOptions.tags}
        statusOptions={opportunityFilterOptions.statuses}
        assigneeOptions={opportunityFilterOptions.assignees}
        customFieldOptions={opportunityFilterOptions.customFields}
        currentFilters={filters}
        onApply={setFilters}
      />
    </section>
  )
}
