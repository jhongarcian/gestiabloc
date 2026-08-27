import { headers } from "next/headers"
import Link from "next/link"
import {
  ArrowLeft,
  ChevronRight,
  ListTodo,
  NotebookPen,
  ShoppingBag,
} from "lucide-react"

import {
  StackedAvatarGroup,
  type StackedAvatarGroupItem,
} from "@/components/stacked-avatar-group"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { formatPhoneNumber } from "@/lib/format-phone-number"
import { CreateAppointmentDialog } from "../../calendar/_components/create-appointment-dialog"
import { getCalendarMeta, type CalendarMetaResponse } from "../../calendar/_lib/calendar-api"
import { CreateContactNoteDialog } from "../_components/create-contact-note-dialog"
import { AddContactOpportunityDialog } from "../../opportunities/_components/add-contact-opportunity-dialog"
import { CreateTaskDialog } from "../../tasks/_components/create-task-dialog"
import { ContactBreadcrumbSync } from "./_components/contact-breadcrumb-sync"
import { ContactDetailNavigation } from "./_components/contact-detail-navigation"
import { ContactHeaderAssignee } from "./_components/contact-header-assignee"
import { ContactHeaderStatus } from "./_components/contact-header-status"
import { ContactServiceProgress } from "./_components/contact-service-progress"
import {
  formatContactDate,
  getContactDetailsContext,
} from "./_lib/contact-details"
import { getAllContactServices } from "./_lib/contact-overview-metrics"

type ContactAssigneesResponse = {
  ok: boolean
  items: Array<{
    value: string
    label: string
    email: string
    image: string | null
  }>
}

type ContactStatusesResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    bgColor: string | null
    textColor: string | null
  }>
}

type TaskStatusesResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    bgColor: string
    textColor: string
    isActive: boolean
    sortOrder: number
  }>
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return "No due date"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "No due date"

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parsed)
}

function isPastDue(value: string | null | undefined) {
  if (!value) return false
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return false

  return parsed.getTime() < Date.now()
}

const ACTIVE_CONTACT_SERVICE_STATUSES = new Set(["IN_PROGRESS", "PENDING_PAYMENT"])

function sortTags<
  T extends {
    sortOrder: number
    name: string
  },
>(tags: T[]) {
  return [...tags].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  )
}

function sortRelationships<
  T extends {
    relationshipLabel: string
    relatedContact: {
      fullName: string
    }
  },
>(relationships: T[]) {
  return [...relationships].sort(
    (a, b) =>
      a.relationshipLabel.localeCompare(b.relationshipLabel) ||
      a.relatedContact.fullName.localeCompare(b.relatedContact.fullName),
  )
}

export default async function ContactDetailsLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ tenantSlug: string; contactId: string }>
}>) {
  const { tenantSlug, contactId } = await params
  const { tenantId, contact, currentUserId, tenantTimezone } = await getContactDetailsContext(tenantSlug, contactId)
  const cookie = (await headers()).get("cookie") ?? ""

  let activeFollowUpServices: Array<{
    id: string
    name: string
    completed: number
    total: number
    percentage: number
    currentStepTitle: string | null
    currentStepDueAt: string | null
    currentStepIsScheduled: boolean
    isOverdue: boolean
    collaborators: StackedAvatarGroupItem[]
  }> = []
  let assigneeOptions: ContactAssigneesResponse["items"] = []
  let statusOptions: Array<{
    value: string
    label: string
    bgColor: string | null
    textColor: string | null
  }> = []
  let taskStatusOptions: Array<{
    value: string
    label: string
    bgColor?: string
    textColor?: string
  }> = []
  let calendarMeta: Pick<CalendarMetaResponse, "settings" | "filters"> = {
    settings: {
      meetingIntervalMinutes: 30,
      meetingDurationMinutes: 30,
      minimumScheduleNoticeMinutes: 0,
      maximumBookingsPerDay: null,
      maximumBookingsPerSlot: 1,
      preBufferMinutes: 0,
      postBufferMinutes: 0,
      bufferAvailabilityMode: "BUSY",
    },
    filters: {
      users: [],
      groups: [],
      services: [],
    },
  }
  try {
    const [services, assignees, statuses, metaResponse, taskStatusesResponse] = await Promise.all([
      getAllContactServices(tenantId, contactId, cookie),
      api.get<ContactAssigneesResponse>(`/api/tasks/${tenantId}/assignees`, {
        headers: { cookie },
      }),
      api.get<ContactStatusesResponse>(`/api/contacts/${tenantId}/statuses`, {
        headers: { cookie },
      }),
      getCalendarMeta(tenantId, cookie),
      api
        .get<TaskStatusesResponse>(`/api/tasks/${tenantId}/statuses`, {
          headers: { cookie },
        })
        .catch(() => null),
    ])

    activeFollowUpServices = services
      .filter((service) => ACTIVE_CONTACT_SERVICE_STATUSES.has(service.status))
      .map((service) => {
        const total = service.followUpSteps.length
        const completed = service.followUpSteps.filter(
          (step) =>
            step.status === "COMPLETED" ||
            step.status === "SKIPPED" ||
            Boolean(step.completedAt),
        ).length
        const hasActiveFollowUp = total > 0 && completed < total
        const currentStep =
          service.followUpSteps.find((step) => step.status === "ACTIVE") ??
          service.followUpSteps.find((step) => step.status === "POSTPONED") ??
          service.followUpSteps.find((step) => step.status === "PENDING") ??
          null
        const collaborators = Array.from(
          new Map(
            service.followUpSteps
              .filter((step) => step.assignedTo)
              .map((step) => {
                const assignee = step.assignedTo!
                const label =
                  assignee.name?.trim() || assignee.email?.trim() || "Assigned user"

                return [
                  assignee.id,
                  {
                    id: assignee.id,
                    label,
                    imageUrl: assignee.image,
                    tone: "internal" as const,
                  },
                ]
              }),
          ).values(),
        )

        return hasActiveFollowUp
          ? {
              id: service.id,
              name: service.service.name,
              completed,
              total,
              percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
              currentStepTitle: currentStep?.title ?? null,
              currentStepDueAt:
                service.nextFollowUp?.at ??
                currentStep?.effectiveDueAt ??
                currentStep?.dueAt ??
                currentStep?.availableAt ??
                null,
              currentStepIsScheduled: Boolean(service.nextFollowUp?.projected),
              isOverdue: isPastDue(
                service.nextFollowUp?.at ??
                  currentStep?.effectiveDueAt ??
                  currentStep?.dueAt ??
                  currentStep?.availableAt ??
                  null,
              ),
              collaborators,
            }
          : null
      })
      .filter(
        (service): service is NonNullable<typeof service> => service !== null,
      )
    assigneeOptions = assignees.data.items
    statusOptions = statuses.data.items.map((status) => ({
      value: status.id,
      label: status.name,
      bgColor: status.bgColor,
      textColor: status.textColor,
    }))
    taskStatusOptions = (taskStatusesResponse?.data.items ?? []).map((status) => ({
      value: status.id,
      label: status.name,
      bgColor: status.bgColor,
      textColor: status.textColor,
    }))
    calendarMeta = {
      settings: metaResponse.settings,
      filters: {
        users: Array.isArray(metaResponse.filters?.users)
          ? metaResponse.filters.users
          : [],
        groups: Array.isArray(metaResponse.filters?.groups)
          ? metaResponse.filters.groups
          : [],
        services: Array.isArray(metaResponse.filters?.services)
          ? metaResponse.filters.services
          : [],
      },
    }
  } catch {
    activeFollowUpServices = []
    assigneeOptions = []
    statusOptions = []
    taskStatusOptions = []
    calendarMeta = {
      settings: {
        meetingIntervalMinutes: 30,
        meetingDurationMinutes: 30,
        minimumScheduleNoticeMinutes: 0,
        maximumBookingsPerDay: null,
        maximumBookingsPerSlot: 1,
        preBufferMinutes: 0,
        postBufferMinutes: 0,
        bufferAvailabilityMode: "BUSY",
      },
      filters: {
        users: [],
        groups: [],
        services: [],
      },
    }
  }

  const visibleActiveFollowUpServices = activeFollowUpServices.slice(0, 4)
  const remainingActiveFollowUpServicesCount = Math.max(
    0,
    activeFollowUpServices.length - visibleActiveFollowUpServices.length,
  )
  const sortedTags = sortTags(contact.tags)
  const visibleHeaderTags = sortedTags.slice(0, 4)
  const remainingHeaderTagsCount = Math.max(0, sortedTags.length - visibleHeaderTags.length)
  const sortedRelationships = sortRelationships(contact.relationships)
  const visibleHeaderRelationships = sortedRelationships.slice(0, 3)
  const remainingHeaderRelationshipsCount = Math.max(
    0,
    sortedRelationships.length - visibleHeaderRelationships.length,
  )
  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <ContactBreadcrumbSync label={contact.fullName} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip rounded-[28px] border border-slate-200/80 bg-white shadow-sm">
        <header className="sticky top-[var(--tenant-shell-header-height)] z-20 shrink-0 rounded-t-[27px] border-b border-slate-200/80 bg-[linear-gradient(135deg,rgba(248,250,252,0.97)_0%,rgba(239,246,255,0.97)_46%,rgba(255,247,237,0.97)_100%)] shadow-sm backdrop-blur-md">
          <div className="flex flex-col gap-3 p-3 md:px-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Link
                  href={`/app/${tenantSlug}/contacts`}
                  aria-label="Back to contacts"
                  title="Back to contacts"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white/85 text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
                <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight text-slate-950">
                  {contact.fullName}
                </h1>
              </div>
              {visibleHeaderRelationships.length > 0 ? (
                <div className="min-w-0 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div className="flex min-w-max items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Relationships
                    </span>
                    {visibleHeaderRelationships.map((relationship) => (
                      <Link
                        key={relationship.id}
                        href={`/app/${tenantSlug}/contacts/${relationship.relatedContact.id}/overview`}
                        className="inline-flex max-w-72 items-center gap-1 rounded-full border border-white/80 bg-white/85 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-200 hover:bg-white hover:text-slate-950"
                      >
                        <span className="shrink-0 font-semibold text-slate-500">
                          {relationship.relationshipLabel}:
                        </span>
                        <span className="truncate">
                          {relationship.relatedContact.fullName}
                        </span>
                      </Link>
                    ))}
                    {remainingHeaderRelationshipsCount > 0 ? (
                      <Link
                        href={`/app/${tenantSlug}/contacts/${contactId}/relationships`}
                        className="inline-flex items-center rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
                      >
                        +{remainingHeaderRelationshipsCount}
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex w-full max-w-full shrink-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:none] xl:w-auto xl:justify-end xl:overflow-visible xl:pb-0 [&::-webkit-scrollbar]:hidden">
                <AddContactOpportunityDialog
                  tenantId={tenantId}
                  initialContact={{
                    id: contact.id,
                    fullName: contact.fullName,
                    email: contact.email,
                    phoneNumber: contact.phoneNumber,
                  }}
                  lockContact
                  iconOnly
                  triggerTooltip="Create opportunity"
                  triggerClassName="inline-flex h-8 w-8 items-center justify-center border-white/70 shadow-sm backdrop-blur transition hover:bg-blue-900"
                />
                <CreateAppointmentDialog
                  tenantId={tenantId}
                  tenantTimezone={tenantTimezone}
                  currentUserId={currentUserId}
                  initialContact={{
                    id: contact.id,
                    fullName: contact.fullName,
                    email: contact.email,
                    phoneNumber: contact.phoneNumber,
                  }}
                  lockContact
                  meetingIntervalMinutes={calendarMeta.settings.meetingIntervalMinutes}
                  meetingDurationMinutes={calendarMeta.settings.meetingDurationMinutes}
                  serviceOptions={calendarMeta.filters.services}
                  assigneeOptions={calendarMeta.filters.users}
                  iconOnly
                  triggerTooltip="Create appointment"
                  triggerClassName="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/70 bg-blue-950 text-white shadow-sm backdrop-blur transition hover:bg-blue-900"
                />
                <CreateTaskDialog
                  tenantId={tenantId}
                  tenantTimezone={tenantTimezone}
                  statusOptions={taskStatusOptions}
                  assigneeOptions={assigneeOptions}
                  initialContact={{
                    id: contact.id,
                    fullName: contact.fullName,
                    email: contact.email,
                    phoneNumber: contact.phoneNumber,
                  }}
                  lockContact
                  hideContact
                  triggerTooltip="Create task"
                  trigger={
                    <Button
                      type="button"
                      size="icon"
                      aria-label="Create task"
                      className="h-8 w-8 cursor-pointer rounded-full border border-white/70 bg-blue-950 text-white shadow-sm backdrop-blur transition hover:bg-blue-900"
                    >
                      <ListTodo className="size-4" aria-hidden="true" />
                    </Button>
                  }
                />
                <CreateContactNoteDialog
                  tenantId={tenantId}
                  contactId={contactId}
                  presentation="drawer"
                  triggerTooltip="Add note"
                  trigger={
                    <Button
                      type="button"
                      size="icon"
                      aria-label="Add note"
                      className="h-8 w-8 cursor-pointer rounded-full border border-white/70 bg-blue-950 text-white shadow-sm backdrop-blur transition hover:bg-blue-900"
                    >
                      <NotebookPen className="size-4" aria-hidden="true" />
                    </Button>
                  }
                />
                <TooltipProvider delayDuration={120}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        asChild
                        size="icon"
                        className="h-8 w-8 cursor-pointer rounded-full border border-white/70 bg-blue-950 text-white shadow-sm backdrop-blur transition hover:bg-blue-900"
                      >
                        <Link
                          href={`/app/${tenantSlug}/contacts/${contactId}/services?create=1`}
                          aria-label="Purchase service"
                        >
                          <ShoppingBag className="size-4" aria-hidden="true" />
                        </Link>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8}>
                      Purchase service
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <ContactHeaderStatus
                  tenantId={tenantId}
                  contactId={contactId}
                  initialStatus={{
                    label: contact.status,
                    value: contact.statusConfigId,
                    bgColor: contact.statusBgColor,
                    textColor: contact.statusTextColor,
                  }}
                  statusOptions={statusOptions}
                />
                <ContactHeaderAssignee
                  tenantId={tenantId}
                  contactId={contactId}
                  initialAssignedTo={contact.assignedTo}
                  assigneeOptions={assigneeOptions}
                />
              </div>
            </div>
        </header>

        <div className="flex shrink-0 flex-col gap-2 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_46%,#fff7ed_100%)] px-4 py-3 md:px-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>{formatPhoneNumber(contact.phoneNumber)}</span>
            <span className="size-1 rounded-full bg-slate-300" />
            <span className="truncate">{contact.email ?? "—"}</span>
            <span className="size-1 rounded-full bg-slate-300" />
            <span>{formatContactDate(contact.dateOfBirth)}</span>
          </div>

          {visibleHeaderTags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Tags
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {visibleHeaderTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm"
                    style={{
                      backgroundColor: tag.bgColor,
                      color: tag.textColor,
                    }}
                  >
                    {tag.name}
                  </span>
                ))}
                {remainingHeaderTagsCount > 0 ? (
                  <span className="inline-flex items-center rounded-full bg-white/85 px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-sm">
                    +{remainingHeaderTagsCount}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {activeFollowUpServices.length > 0 ? (
          <ContactServiceProgress count={activeFollowUpServices.length}>
            <div className="grid gap-3 px-4 pb-3 pt-2 sm:grid-cols-2 md:px-5 lg:grid-cols-4">
              {visibleActiveFollowUpServices.map((service) => (
                <Link
                  key={service.id}
                  href={`/app/${tenantSlug}/contacts/${contactId}/services/${service.id}`}
                  aria-label={`Open ${service.name} service details`}
                  className={
                    service.isOverdue
                      ? "group relative overflow-hidden rounded-[20px] border border-rose-200 bg-[linear-gradient(145deg,#fff7f7_0%,#ffffff_55%,#fff1f2_100%)] p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-rose-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2"
                      : "group relative overflow-hidden rounded-[20px] border border-blue-100 bg-[linear-gradient(145deg,#f8fbff_0%,#ffffff_55%,#eff6ff_100%)] p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
                  }
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full bg-blue-200/30 blur-3xl"
                  />

                  <div className="relative flex flex-col gap-2.5">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <h3 className="min-w-0 truncate text-sm font-semibold tracking-tight text-slate-950">
                        {service.name}
                      </h3>
                      {service.collaborators.length > 0 ? (
                        <StackedAvatarGroup
                          items={service.collaborators}
                          avatarSize="sm"
                          maxVisible={4}
                          className="shrink-0 pl-0"
                        />
                      ) : null}
                    </div>

                    <div
                      className="relative h-7 overflow-hidden rounded-full border border-blue-100 bg-blue-100/60"
                      role="progressbar"
                      aria-label={`${service.name} follow-up progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={service.percentage}
                    >
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,#1e3a8a_0%,#2563eb_100%)] transition-[width]"
                        style={{ width: `${service.percentage}%` }}
                      />
                      <span className="absolute inset-y-1 left-1 flex items-center rounded-full bg-blue-950 px-2 text-[10px] font-semibold text-white shadow-sm tabular-nums">
                        {service.percentage}%
                      </span>
                      <span
                        className={
                          service.isOverdue
                            ? "absolute inset-0 flex items-center justify-end px-3 text-[11px] font-semibold text-rose-700"
                            : "absolute inset-0 flex items-center justify-end px-3 text-[11px] font-semibold text-blue-950"
                        }
                      >
                        {service.currentStepDueAt
                          ? service.isOverdue
                            ? `Past due ${formatShortDate(service.currentStepDueAt)}`
                            : service.currentStepIsScheduled
                              ? `Scheduled ${formatShortDate(service.currentStepDueAt)}`
                              : `Due ${formatShortDate(service.currentStepDueAt)}`
                          : "No due date"}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}

              {remainingActiveFollowUpServicesCount > 0 ? (
                <Link
                  href={`/app/${tenantSlug}/contacts/${contactId}/follow-ups`}
                  className="group flex min-h-24 items-center justify-between gap-3 rounded-[20px] border border-dashed border-blue-200 bg-blue-50/45 p-3.5 transition hover:border-blue-300 hover:bg-blue-50"
                >
                  <div>
                    <p className="text-xs font-semibold text-blue-700">More follow-ups</p>
                    <p className="mt-0.5 text-2xl font-semibold tracking-[-0.04em] text-slate-950 tabular-nums">
                      +{remainingActiveFollowUpServicesCount}
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-blue-950 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          </ContactServiceProgress>
        ) : null}

        <ContactDetailNavigation tenantSlug={tenantSlug} contactId={contactId} />
        <div className="min-h-0 min-w-0 flex-1 bg-background px-4 py-5 md:px-5 md:py-6">
          {children}
        </div>
      </div>
    </section>
  )
}
