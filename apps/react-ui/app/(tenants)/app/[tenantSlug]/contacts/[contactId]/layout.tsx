import { headers } from "next/headers"
import Link from "next/link"
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarClock,
  CircleDollarSign,
  ListTodo,
} from "lucide-react"

import {
  StackedAvatarGroup,
  type StackedAvatarGroupItem,
} from "@/components/stacked-avatar-group"
import { Badge } from "@/components/ui/badge"
import { api } from "@/lib/api"
import { formatPhoneNumber } from "@/lib/format-phone-number"
import { ContactBreadcrumbSync } from "./_components/contact-breadcrumb-sync"
import { ContactDetailTabs } from "./_components/contact-detail-tabs"
import { ContactHeaderAssignee } from "./_components/contact-header-assignee"
import { ContactHeaderStatus } from "./_components/contact-header-status"
import {
  formatContactDate,
  getContactDetailsContext,
} from "./_lib/contact-details"

type ContactServicesPageResponse = {
  ok: boolean
  items: Array<{
    id: string
    status: string
    totalPriceCents: number
    paidCents: number
    service: {
      id: string
      name: string
    }
    followUpSteps: Array<{
      id: string
      title: string
      status: string
      dueAt?: string | null
      availableAt?: string | null
      completedAt: string | null
      assignedToUserId?: string | null
      assignedTo?: {
        id: string
        name: string | null
        email: string | null
        image: string | null
      } | null
    }>
  }>
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type ContactTasksPageResponse = {
  ok: boolean
  items: Array<{
    status: string
  }>
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

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

async function loadAllContactServices(
  tenantId: string,
  contactId: string,
  cookie: string,
) {
  const firstPage = await api.get<ContactServicesPageResponse>(
    `/api/services/${tenantId}/contact-services`,
    {
      headers: { cookie },
      params: {
        contactId,
        page: 1,
        pageSize: 25,
      },
    },
  )

  const totalPages = firstPage.data.pagination.totalPages
  if (totalPages <= 1) {
    return firstPage.data.items
  }

  const restPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      api.get<ContactServicesPageResponse>(
        `/api/services/${tenantId}/contact-services`,
        {
          headers: { cookie },
          params: {
            contactId,
            page: index + 2,
            pageSize: 25,
          },
        },
      ),
    ),
  )

  return [
    ...firstPage.data.items,
    ...restPages.flatMap((response) => response.data.items),
  ]
}

async function loadAllContactTasks(
  tenantId: string,
  contactId: string,
  cookie: string,
) {
  const firstPage = await api.get<ContactTasksPageResponse>(
    `/api/tasks/${tenantId}`,
    {
      headers: { cookie },
      params: {
        contactId,
        page: 1,
        pageSize: 25,
      },
    },
  )

  const totalPages = firstPage.data.pagination.totalPages
  if (totalPages <= 1) {
    return firstPage.data.items
  }

  const restPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      api.get<ContactTasksPageResponse>(`/api/tasks/${tenantId}`, {
        headers: { cookie },
        params: {
          contactId,
          page: index + 2,
          pageSize: 25,
        },
      }),
    ),
  )

  return [
    ...firstPage.data.items,
    ...restPages.flatMap((response) => response.data.items),
  ]
}

function formatUsdAmount(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
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
  const { tenantId, contact } = await getContactDetailsContext(tenantSlug, contactId)
  const cookie = (await headers()).get("cookie") ?? ""

  let totalSpendingCents = 0
  let activeTasks = 0
  let activeFollowUpServices: Array<{
    id: string
    name: string
    completed: number
    total: number
    percentage: number
    currentStepTitle: string | null
    currentStepDueAt: string | null
    ownerName: string | null
    ownerId: string | null
    ownerImage: string | null
  }> = []
  let activeFollowUpOwnerItems: StackedAvatarGroupItem[] = []
  let assigneeOptions: ContactAssigneesResponse["items"] = []
  let statusOptions: Array<{
    value: string
    label: string
    bgColor: string | null
    textColor: string | null
  }> = []

  try {
    const [services, tasks, assignees, statuses] = await Promise.all([
      loadAllContactServices(tenantId, contactId, cookie),
      loadAllContactTasks(tenantId, contactId, cookie),
      api.get<ContactAssigneesResponse>(`/api/tasks/${tenantId}/assignees`, {
        headers: { cookie },
      }),
      api.get<ContactStatusesResponse>(`/api/contacts/${tenantId}/statuses`, {
        headers: { cookie },
      }),
    ])

    totalSpendingCents = services.reduce(
      (sum, service) => sum + service.paidCents,
      0,
    )
    activeFollowUpServices = services
      .filter((service) => service.status !== "COMPLETED")
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

        return hasActiveFollowUp
          ? {
              id: service.id,
              name: service.service.name,
              completed,
              total,
              percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
              currentStepTitle: currentStep?.title ?? null,
              currentStepDueAt: currentStep?.dueAt ?? null,
              ownerName:
                currentStep?.assignedTo?.name?.trim() ||
                currentStep?.assignedTo?.email?.trim() ||
                null,
              ownerId: currentStep?.assignedTo?.id ?? null,
              ownerImage: currentStep?.assignedTo?.image ?? null,
            }
          : null
      })
      .filter(
        (service): service is NonNullable<typeof service> => service !== null,
      )
    activeFollowUpOwnerItems = Array.from(
      new Map(
        activeFollowUpServices
          .filter((service) => service.ownerName)
          .map((service) => [
            service.ownerId ?? service.ownerName ?? service.id,
            {
              id: service.ownerId ?? service.ownerName ?? service.id,
              label: service.ownerName ?? "Assigned user",
              imageUrl: service.ownerImage,
              tone: "internal" as const,
            },
          ]),
      ).values(),
    )
    activeTasks = tasks.filter((task) => task.status !== "Completed").length
    assigneeOptions = assignees.data.items
    statusOptions = statuses.data.items.map((status) => ({
      value: status.id,
      label: status.name,
      bgColor: status.bgColor,
      textColor: status.textColor,
    }))
  } catch {
    totalSpendingCents = 0
    activeTasks = 0
    activeFollowUpServices = []
    activeFollowUpOwnerItems = []
    assigneeOptions = []
    statusOptions = []
  }

  const visibleActiveFollowUpServices = activeFollowUpServices.slice(0, 3)
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
  const upcomingAppointmentDateLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date("2026-04-04T09:00:00.000Z"))

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <ContactBreadcrumbSync label={contact.fullName} />
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <header className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_46%,#fff7ed_100%)]">
          <div className="space-y-4 p-4 md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 space-y-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/app/${tenantSlug}/contacts`}
                      aria-label="Back to contacts"
                      className="inline-flex h-6 items-center gap-1 rounded-full border border-slate-200 bg-white/85 px-2 text-[11px] font-medium text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-white hover:text-slate-900"
                    >
                      <ArrowLeft className="h-3 w-3" />
                      Contacts
                    </Link>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                      Contact Record
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-[1.7rem] font-semibold tracking-tight text-slate-950">
                      {contact.fullName}
                    </h1>
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
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs text-slate-500">
                    <span>{formatPhoneNumber(contact.phoneNumber)}</span>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span className="truncate">{contact.email ?? "—"}</span>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span>{formatContactDate(contact.dateOfBirth)}</span>
                  </div>
                  {visibleHeaderTags.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-1.5">
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
                  {visibleHeaderRelationships.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Relationships
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        {visibleHeaderRelationships.map((relationship) => (
                          <Link
                            key={relationship.id}
                            href={`/app/${tenantSlug}/contacts/${relationship.relatedContact.id}/overview`}
                            className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/80 bg-white/85 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-200 hover:bg-white hover:text-slate-950"
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
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <ContactHeaderAssignee
                  tenantId={tenantId}
                  contactId={contactId}
                  initialAssignedTo={contact.assignedTo}
                  assigneeOptions={assigneeOptions}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="min-w-0 rounded-[22px] border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2 text-slate-400">
                  <CircleDollarSign className="h-4 w-4" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                    Total Spending
                  </p>
                </div>
                <p className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-950">
                  {formatUsdAmount(totalSpendingCents)}
                </p>
              </div>
              <div className="min-w-0 rounded-[22px] border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2 text-slate-400">
                  <BriefcaseBusiness className="h-4 w-4" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                    Opportunities
                  </p>
                </div>
                <p className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-950">
                  Soon
                </p>
              </div>
              <div className="min-w-0 rounded-[22px] border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2 text-slate-400">
                  <ListTodo className="h-4 w-4" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                    Active Tasks
                  </p>
                </div>
                <p className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-950">
                  {activeTasks}
                </p>
              </div>
              <div className="min-w-0 rounded-[22px] border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2 text-slate-400">
                  <CalendarClock className="h-4 w-4" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                    Next Appointment
                  </p>
                </div>
                <p className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-950">
                  {upcomingAppointmentDateLabel}
                </p>
              </div>
            </div>
          </div>
        </header>

        {activeFollowUpServices.length > 0 ? (
          <section className="overflow-hidden rounded-[24px]  bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-4 md:px-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold tracking-tight text-slate-950">
                    Services currently in progress
                  </h2>
                </div>
                {activeFollowUpOwnerItems.length > 0 ? (
                  <div className="flex items-center gap-2 self-start rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1.5 sm:self-center">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Involved
                    </span>
                    <StackedAvatarGroup
                      items={activeFollowUpOwnerItems}
                      avatarSize="sm"
                      maxVisible={5}
                      className="pl-0"
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 p-4 md:p-5 lg:grid-cols-2 xl:grid-cols-3">
              {visibleActiveFollowUpServices.map((service) => (
                <div
                  key={service.id}
                  className="rounded-[20px] border border-slate-200 bg-slate-50/60 px-4 py-3.5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold tracking-tight text-slate-950">
                        {service.name}
                      </p>
                      <p className="mt-0.5 truncate text-[13px] font-medium text-slate-600">
                        Next:{" "}
                        {service.currentStepTitle ?? "Follow-up in progress"}
                      </p>
                    </div>
                    <div className="flex items-start gap-2">
                      <Badge className="border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700 hover:bg-sky-50">
                        In Progress
                      </Badge>
                      {service.ownerName ? (
                        <StackedAvatarGroup
                          items={[
                            {
                              id: service.ownerId ?? service.id,
                              label: service.ownerName,
                              imageUrl: service.ownerImage,
                              tone: "internal",
                            },
                          ]}
                          avatarSize="sm"
                          maxVisible={1}
                          className="pl-0"
                        />
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200/80">
                    <div
                      className="h-full rounded-full bg-teal-500 transition-[width]"
                      style={{ width: `${service.percentage}%` }}
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-4">
                    <p className="text-[13px] font-semibold text-slate-950">
                      {service.percentage}% Complete
                    </p>
                    <div className="flex items-center gap-1.5 text-[13px] text-slate-600">
                      <CalendarClock className="h-3.5 w-3.5" />
                      <span>
                        Due: {formatShortDate(service.currentStepDueAt)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {remainingActiveFollowUpServicesCount > 0 ? (
                <Link
                  href={`/app/${tenantSlug}/contacts/${contactId}/follow-ups`}
                  className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50/60 px-4 py-3.5 shadow-sm transition hover:bg-slate-50"
                >
                  <div className="flex h-full flex-col justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        More Active Follow Ups
                      </p>
                      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                        +{remainingActiveFollowUpServicesCount}
                      </p>
                    </div>
                    <p className="text-sm leading-5 text-slate-600">
                      Open the follow-ups tab to review the remaining active
                      services.
                    </p>
                  </div>
                </Link>
              ) : null}
            </div>
          </section>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-4 py-4 md:px-5">
            <ContactDetailTabs tenantSlug={tenantSlug} contactId={contactId} />
          </div>
          <div className="min-h-0 flex-1 p-5 md:p-6">{children}</div>
        </div>
      </div>
    </section>
  )
}
