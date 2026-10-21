import { Prisma } from "../generated/prisma/index.js"
import { getFollowUpListDateRanges } from "./service-followup-list-date-range.js"
import {
  resolveEffectiveNextFollowUp,
  selectFollowUpListStep,
} from "./service-followup-next-follow-up.js"
import {
  getUserScheduledWaitByActionId,
  getWorkflowWaitByActionId,
} from "./service-followup-v3-definition.js"

export type FollowUpQueueState = "ACTIONABLE" | "SCHEDULED" | "NEEDS_ATTENTION" | "FINISHED"
export function followUpUrgency(
  input: {
    enteredAt: Date | null
    dueAt: Date | null
    actionable: boolean
  },
  now: Date,
) {
  const { enteredAt, dueAt } = input
  if (!input.actionable || !enteredAt || !dueAt || enteredAt > now || dueAt <= enteredAt)
    return { status: "NONE" as const, remainingMs: null, timeframeMs: null, warningAt: null }
  const timeframeMs = dueAt.getTime() - enteredAt.getTime()
  const remainingMs = dueAt.getTime() - now.getTime()
  const warningAt = new Date(dueAt.getTime() - timeframeMs * 0.25)
  return {
    status:
      remainingMs <= 0
        ? ("OVERDUE" as const)
        : now >= warningAt
          ? ("DUE_SOON" as const)
          : ("ON_TRACK" as const),
    remainingMs,
    timeframeMs,
    warningAt,
  }
}

// Read only the latest entry of each saved step. Earlier overrides/audits and live
// service definitions cannot affect queue timing or progress after a revisit.
const queueSelect = {
  id: true,
  status: true,
  workflowKind: true,
  startedAt: true,
  updatedAt: true,
  service: {
    select: { id: true, name: true, parentService: { select: { id: true, name: true } } },
  },
  contact: { select: { id: true, firstName: true, middleName: true, lastName: true, phone: true } },
  followUpTemplate: { select: { id: true, name: true } },
  followUpTemplateVersion: { select: { id: true, versionNumber: true, definition: true } },
  followUpRun: {
    select: {
      id: true,
      status: true,
      resumeAt: true,
      waitingNodeId: true,
      failureMessage: true,
    },
  },
  followUpSteps: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      status: true,
      availableAt: true,
      dueAt: true,
      completedAt: true,
      resolutionSource: true,
      resolutionReason: true,
      assignedToUserId: true,
      note: true,
      sortOrder: true,
      assignedTo: { select: { name: true, email: true } },
    },
  },
  serviceSteps: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      instructions: true,
      assignedToUserId: true,
      assignedTo: { select: { name: true, email: true } },
      sortOrder: true,
      occurrences: {
        orderBy: { occurrenceNumber: "desc" },
        take: 1,
        select: {
          id: true,
          enteredAt: true,
          dueAt: true,
          status: true,
          resolvedAt: true,
          supersededAt: true,
          progressionStatus: true,
          progressionMessage: true,
          completionEventId: true,
        },
      },
    },
  },
} satisfies Prisma.ContactServiceSelect
type QueueService = Prisma.ContactServiceGetPayload<{ select: typeof queueSelect }>
type QueueStep = {
  id: string
  title: string
  status: string
  availableAt: Date | null
  dueAt: Date | null
  effectiveDueAt: Date | null
  effectiveDueSource: string | null
  effectiveDueProjected: boolean
  completedAt: Date | null
  assignedToUserId: string | null
  assignedToName: string | null
  note: string | null
  sortOrder: number
  stepNumber: number | null
  occurrenceId?: string
  resolutionSource?: string | null
  resolutionReason?: string | null
}
type QueueProjection = {
  currentStep: QueueStep | null
  queueState: FollowUpQueueState
  queueMessage: string | null
  scheduledAt: Date | null
  enteredAt: Date | null
  completedCount: number
  totalCount: number
}

function serviceStepProjection(service: QueueService, resumes: Map<string, Date>): QueueProjection {
  const entries = service.serviceSteps.flatMap((step, index) => {
    const entry = step.occurrences[0]
    return entry ? [{ step, entry, index }] : []
  })
  const current =
    entries.find(({ entry }) => entry.status === "ACTIVE" && !entry.supersededAt) ??
    entries.find(
      ({ entry }) =>
        !entry.supersededAt && ["WAITING_AUTOMATION", "PAUSED"].includes(entry.progressionStatus),
    ) ??
    entries
      .filter(({ entry }) => !entry.supersededAt)
      .sort(
        (a, b) => b.entry.enteredAt.getTime() - a.entry.enteredAt.getTime() || b.index - a.index,
      )[0]
  const entry = current?.entry
  const finished =
    service.status === "COMPLETED" ||
    (entry && ["FINISHED", "ADVANCED"].includes(entry.progressionStatus))
  const queueState: FollowUpQueueState = finished
    ? "FINISHED"
    : entry?.status === "ACTIVE"
      ? "ACTIONABLE"
      : entry?.progressionStatus === "WAITING_AUTOMATION"
        ? "SCHEDULED"
        : "NEEDS_ATTENTION"
  const dueAt = queueState === "ACTIONABLE" ? entry!.dueAt : null
  return {
    queueState,
    queueMessage:
      queueState === "SCHEDULED"
        ? "Completion automation is running or waiting."
        : queueState === "NEEDS_ATTENTION"
          ? (entry?.progressionMessage ?? "Review this enrollment before continuing.")
          : queueState === "FINISHED" && service.status === "PENDING_PAYMENT"
            ? "Step work finished; payment is pending."
            : null,
    scheduledAt:
      queueState === "SCHEDULED" && entry?.completionEventId
        ? (resumes.get(entry.completionEventId) ?? null)
        : null,
    enteredAt: queueState === "ACTIONABLE" ? entry!.enteredAt : null,
    currentStep: current
      ? {
          id: current.step.id,
          occurrenceId: current.entry.id,
          title: current.step.title,
          status: current.entry.status,
          availableAt: current.entry.enteredAt,
          dueAt,
          effectiveDueAt: dueAt,
          effectiveDueSource: dueAt ? "STEP_DUE" : null,
          effectiveDueProjected: false,
          completedAt: current.entry.resolvedAt,
          assignedToUserId: current.step.assignedToUserId,
          assignedToName: current.step.assignedTo?.name?.trim() || current.step.assignedTo?.email || null,
          note: current.step.instructions,
          sortOrder: current.step.sortOrder,
          stepNumber: current.index + 1,
        }
      : null,
    totalCount: service.serviceSteps.length,
    completedCount: entries.filter(({ entry }) => ["COMPLETED", "SKIPPED"].includes(entry.status))
      .length,
  }
}

type QueueQuery = {
  page: number
  pageSize: number
  search?: string
  sort: string
  status?: string
  dueDatePreset?: string
  followUpTemplateId?: string
  assignedToUserId?: string
  queueState?: FollowUpQueueState
}

function legacyProjection(
  service: QueueService,
  query: QueueQuery,
  now: Date,
  matchesDate: (date: Date | null) => boolean,
): QueueProjection | null {
  const definition = service.followUpTemplateVersion?.definition
  const waitId = service.followUpRun?.waitingNodeId
  const effective = resolveEffectiveNextFollowUp({
    steps: service.followUpSteps,
    run: service.followUpRun,
    isWorkflowWait: Boolean(waitId && getWorkflowWaitByActionId(definition, waitId)),
    isUserScheduledWait: Boolean(waitId && getUserScheduledWaitByActionId(definition, waitId)),
  })
  const candidates = service.followUpSteps.filter((step) => {
    if (query.assignedToUserId && step.assignedToUserId !== query.assignedToUserId) return false
    const due = effective?.stepId === step.id ? effective.at : step.dueAt
    return query.dueDatePreset === "NO_DUE_DATE" ? !due : matchesDate(due)
  })
  const step = selectFollowUpListStep({
    steps: candidates,
    effectiveNextFollowUp: effective,
    status: query.status,
  }) as QueueService["followUpSteps"][number] | null
  if (!step) return null
  const effectiveForStep = effective?.stepId === step.id ? effective : null
  const terminal = ["COMPLETED", "SKIPPED"].includes(step.status)
  const scheduled =
    Boolean(effectiveForStep?.projected) || Boolean(step.availableAt && step.availableAt > now)
  const queueState: FollowUpQueueState =
    service.status === "COMPLETED" || terminal
      ? "FINISHED"
      : ["FAILED", "NEEDS_REVIEW", "CANCELED"].includes(service.followUpRun?.status ?? "")
        ? "NEEDS_ATTENTION"
        : scheduled
          ? "SCHEDULED"
          : "ACTIONABLE"
  const dueAt = terminal ? null : (effectiveForStep?.at ?? step.dueAt ?? step.availableAt)
  return {
    queueState,
    queueMessage:
      queueState === "NEEDS_ATTENTION"
        ? (service.followUpRun?.failureMessage ?? "Review this workflow before continuing.")
        : null,
    scheduledAt:
      queueState === "SCHEDULED"
        ? effectiveForStep?.projected
          ? effectiveForStep.at
          : step.availableAt
        : null,
    // A prefilled date on a pending/unentered legacy step is not an elapsed timeframe.
    enteredAt: ["ACTIVE", "POSTPONED"].includes(step.status)
      ? (step.availableAt ?? service.startedAt)
      : null,
    currentStep: {
      ...step,
      dueAt,
      effectiveDueAt: dueAt,
      effectiveDueSource: effectiveForStep?.source ?? (dueAt ? "STEP_DUE" : null),
      effectiveDueProjected: Boolean(effectiveForStep?.projected),
      assignedToName: step.assignedTo?.name?.trim() || step.assignedTo?.email || null,
      stepNumber: service.followUpSteps.findIndex((item) => item.id === step.id) + 1,
    },
    completedCount: service.followUpSteps.filter((item) =>
      ["COMPLETED", "SKIPPED"].includes(item.status),
    ).length,
    totalCount: service.followUpSteps.length,
  }
}

export async function getServiceFollowUpQueue(
  client: Prisma.TransactionClient,
  tenantId: string,
  timezone: string,
  query: QueueQuery,
  now = new Date(),
) {
  const { today, nextSevenDaysEnd } = getFollowUpListDateRanges(timezone, now)
  const matchesDate = (date: Date | null) => {
    if (
      !query.dueDatePreset ||
      query.dueDatePreset === "NO_DUE_DATE" ||
      query.dueDatePreset === "DUE_SOON"
    )
      return true
    if (!date) return false
    if (query.dueDatePreset === "OVERDUE") return date <= now
    return (
      date >= today.start && date < (query.dueDatePreset === "TODAY" ? today.end : nextSevenDaysEnd)
    )
  }
  // Summary and pagination use one projection of both workflow types. In particular,
  // never sort a fetched page: deadline overrides must move rows across page boundaries.
  // Omit deadline histories and service automation snapshots. Legacy definitions are
  // still needed to identify workflow waits until the template cutover.
  const services = await client.contactService.findMany({
    where: {
      tenantId,
      status: { in: ["IN_PROGRESS", "PENDING_PAYMENT", "COMPLETED"] },
      OR: [
        { workflowKind: "SERVICE_STEPS", serviceSteps: { some: {} } },
        { workflowKind: { not: "SERVICE_STEPS" }, followUpSteps: { some: {} } },
      ],
    },
    select: queueSelect,
  })
  const eventIds = services.flatMap((service) =>
    service.serviceSteps.flatMap((step) => {
      const entry = step.occurrences[0]
      return entry &&
        !entry.supersededAt &&
        entry.progressionStatus === "WAITING_AUTOMATION" &&
        entry.completionEventId
        ? [entry.completionEventId]
        : []
    }),
  )
  const waits = eventIds.length
    ? await client.automationRun.findMany({
        where: {
          tenantId,
          eventSource: "SERVICE_STEP_COMPLETED",
          exitRequestedAt: null,
          status: { in: ["WAITING", "RUNNING"] },
          resumeAt: { not: null },
          waitingNodeExecutionId: { not: null },
          dispatch: { eventId: { in: eventIds }, event: { tenantId } },
        },
        select: { resumeAt: true, dispatch: { select: { eventId: true } } },
        orderBy: [{ resumeAt: "asc" }, { id: "asc" }],
      })
    : []
  const resumes = new Map<string, Date>()
  for (const wait of waits)
    if (wait.dispatch && wait.resumeAt && !resumes.has(wait.dispatch.eventId))
      resumes.set(wait.dispatch.eventId, wait.resumeAt)
  const project = (service: QueueService, filters: QueueQuery) => {
    const projection =
      service.workflowKind === "SERVICE_STEPS"
        ? serviceStepProjection(service, resumes)
        : legacyProjection(service, filters, now, filters === query ? matchesDate : () => true)
    if (!projection) return null
    const { totalCount, completedCount } = projection
    const timing = followUpUrgency(
      {
        enteredAt: projection.enteredAt,
        dueAt: projection.currentStep?.effectiveDueAt ?? null,
        actionable: projection.queueState === "ACTIONABLE",
      },
      now,
    )
    return {
      ...projection,
      timing,
      id: service.id,
      status: service.status,
      workflowKind: service.workflowKind,
      contactId: service.contact.id,
      contactName: [service.contact.firstName, service.contact.middleName, service.contact.lastName]
        .filter(Boolean)
        .join(" "),
      phoneNumber: service.contact.phone,
      serviceId: service.service.id,
      serviceName: service.service.name,
      parentService: service.service.parentService,
      followUpTemplateId: service.followUpTemplate?.id ?? null,
      followUpTemplateName: service.followUpTemplate?.name ?? null,
      followUpTemplateVersion: service.followUpTemplateVersion
        ? {
            id: service.followUpTemplateVersion.id,
            versionNumber: service.followUpTemplateVersion.versionNumber,
          }
        : null,
      followUpRun: service.followUpRun,
      progress: {
        totalCount,
        completedCount,
        remainingCount: Math.max(0, totalCount - completedCount),
        completionPercentage: totalCount ? Math.round((completedCount / totalCount) * 100) : 0,
      },
      overdue: timing.status === "OVERDUE",
      updatedAt: service.updatedAt,
      startedAt: service.startedAt,
    }
  }
  const summaryItems = services
    .filter((service) => service.status !== "COMPLETED")
    .flatMap((service) => {
      const item = project(service, { page: 1, pageSize: 10, sort: "URGENCY" })
      return item && item.queueState !== "FINISHED" ? [item] : []
    })
  const summary = {
    servicesInProgress: summaryItems.length,
    overdueEnrollments: summaryItems.filter((item) => item.overdue).length,
    dueToday: summaryItems.filter(
      (item) =>
        item.queueState === "ACTIONABLE" &&
        item.currentStep?.effectiveDueAt &&
        item.currentStep.effectiveDueAt >= today.start &&
        item.currentStep.effectiveDueAt < today.end,
    ).length,
    averageProgress: summaryItems.length
      ? Math.round(
          summaryItems.reduce((sum, item) => sum + item.progress.completionPercentage, 0) /
            summaryItems.length,
        )
      : 0,
    dueSoon: summaryItems.filter((item) => item.timing.status === "DUE_SOON").length,
    actionable: summaryItems.filter((item) => item.queueState === "ACTIONABLE").length,
    scheduled: summaryItems.filter((item) => item.queueState === "SCHEDULED").length,
    needsAttention: summaryItems.filter((item) => item.queueState === "NEEDS_ATTENTION").length,
  }
  const search = query.search?.toLocaleLowerCase()
  const items = services.flatMap((service) => {
    const item = project(service, query)
    if (
      !item ||
      (query.queueState && item.queueState !== query.queueState) ||
      (query.status && item.currentStep?.status !== query.status) ||
      (query.followUpTemplateId && item.followUpTemplateId !== query.followUpTemplateId) ||
      (query.assignedToUserId && item.currentStep?.assignedToUserId !== query.assignedToUserId)
    )
      return []
    const phoneSearch = search && /^[+()\d\s.-]+$/.test(search) ? search.replace(/\D/g, "") : ""
    if (
      search &&
      ![
        item.contactName,
        item.phoneNumber,
        item.serviceName,
        item.parentService?.name,
        item.currentStep?.title,
        item.currentStep?.note,
      ].some((value) => value?.toLocaleLowerCase().includes(search)) &&
      !(phoneSearch && item.phoneNumber?.replace(/\D/g, "").includes(phoneSearch))
    )
      return []
    const date =
      item.queueState === "SCHEDULED"
        ? item.scheduledAt
        : (item.currentStep?.effectiveDueAt ?? null)
    if (query.dueDatePreset === "OVERDUE" && !item.overdue) return []
    if (query.dueDatePreset === "DUE_SOON" && item.timing.status !== "DUE_SOON") return []
    if (query.dueDatePreset === "NO_DUE_DATE" ? Boolean(date) : !matchesDate(date)) return []
    return [item]
  })
  const queueRank = { ACTIONABLE: 0, NEEDS_ATTENTION: 1, SCHEDULED: 2, FINISHED: 3 }
  const sortDate = (item: (typeof items)[number]) =>
    (item.queueState === "SCHEDULED"
      ? item.scheduledAt
      : item.currentStep?.effectiveDueAt
    )?.getTime() ?? Number.MAX_SAFE_INTEGER
  items.sort((a, b) => {
    const compared =
      query.sort === "UPDATED_DESC"
        ? b.updatedAt.getTime() - a.updatedAt.getTime()
        : query.sort === "STARTED_DESC"
          ? (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0)
          : query.sort === "CONTACT_ASC"
            ? a.contactName.localeCompare(b.contactName)
            : query.sort === "SERVICE_ASC"
              ? a.serviceName.localeCompare(b.serviceName)
              : queueRank[a.queueState] - queueRank[b.queueState] || sortDate(a) - sortDate(b)
    return compared || a.id.localeCompare(b.id)
  })
  return {
    ok: true,
    asOf: now,
    items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: items.length,
      totalPages: Math.max(1, Math.ceil(items.length / query.pageSize)),
    },
    summary,
  }
}
