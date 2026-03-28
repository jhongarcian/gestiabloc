import { headers } from "next/headers"
import Link from "next/link"
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarClock,
  CircleDollarSign,
  ListTodo,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { api } from "@/lib/api"
import { formatPhoneNumber } from "@/lib/format-phone-number"
import { ContactBreadcrumbSync } from "./_components/contact-breadcrumb-sync"
import { ContactDetailTabs } from "./_components/contact-detail-tabs"
import { ContactHeaderAssignee } from "./_components/contact-header-assignee"
import { ContactHeaderStatus } from "./_components/contact-header-status"
import { ContactSupportingSidebar } from "./_components/contact-supporting-sidebar"
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

async function loadAllContactServices(tenantId: string, contactId: string, cookie: string) {
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
      api.get<ContactServicesPageResponse>(`/api/services/${tenantId}/contact-services`, {
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

async function loadAllContactTasks(tenantId: string, contactId: string, cookie: string) {
  const firstPage = await api.get<ContactTasksPageResponse>(`/api/tasks/${tenantId}`, {
    headers: { cookie },
    params: {
      contactId,
      page: 1,
      pageSize: 25,
    },
  })

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

function getInitials(value: string | null | undefined) {
  return (
    value
      ?.split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "NA"
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
  const { tenantId, contact, canManageContactTags } = await getContactDetailsContext(
    tenantSlug,
    contactId,
  )
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
    ownerName: string | null
    ownerImage: string | null
  }> = []
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

    totalSpendingCents = services.reduce((sum, service) => sum + service.paidCents, 0)
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
              ownerName:
                currentStep?.assignedTo?.name?.trim() ||
                currentStep?.assignedTo?.email?.trim() ||
                null,
              ownerImage: currentStep?.assignedTo?.image ?? null,
            }
          : null
      })
      .filter((service): service is NonNullable<typeof service> => service !== null)
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
    assigneeOptions = []
    statusOptions = []
  }

  const visibleActiveFollowUpServices = activeFollowUpServices.slice(0, 3)
  const remainingActiveFollowUpServicesCount = Math.max(
    0,
    activeFollowUpServices.length - visibleActiveFollowUpServices.length,
  )

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <ContactBreadcrumbSync label={contact.fullName} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          <header className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_46%,#fff7ed_100%)]">
            <div className="space-y-4 p-4 md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Link
                    href={`/app/${tenantSlug}/contacts`}
                    aria-label="Back to contacts"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-white hover:text-slate-950"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Link>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                      Contact Record
                    </p>
                    <h1 className="truncate text-[1.7rem] font-semibold tracking-tight text-slate-950">
                      {contact.fullName}
                    </h1>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-slate-500">
                      <span>{formatPhoneNumber(contact.phoneNumber)}</span>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span className="truncate">{contact.email ?? "—"}</span>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span>{formatContactDate(contact.dateOfBirth)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <ContactHeaderAssignee
                    tenantId={tenantId}
                    contactId={contactId}
                    initialAssignedTo={contact.assignedTo}
                    assigneeOptions={assigneeOptions}
                  />
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
              </div>

              <div className="space-y-3">
                <div className="grid gap-3 xl:grid-cols-3">
                  <div className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-6 shadow-sm backdrop-blur">
                    <div className="flex items-center gap-2 text-slate-400">
                      <CircleDollarSign className="h-4 w-4" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                        Total Spending
                      </p>
                    </div>
                    <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-950">
                      {formatUsdAmount(totalSpendingCents)}
                    </p>
                  </div>
                  <div className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-6 shadow-sm backdrop-blur">
                    <div className="flex items-center gap-2 text-slate-400">
                      <BriefcaseBusiness className="h-4 w-4" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                        Opportunities
                      </p>
                    </div>
                    <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-950">Soon</p>
                  </div>
                  <div className="min-w-0 rounded-[24px] border border-white/80 bg-white/70 p-6 shadow-sm backdrop-blur">
                    <div className="flex items-center gap-2 text-slate-400">
                      <ListTodo className="h-4 w-4" />
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                        Active Tasks
                      </p>
                    </div>
                    <p className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-950">
                      {activeTasks}
                    </p>
                  </div>
                </div>

                {activeFollowUpServices.length > 0 ? (
                  <div className="grid gap-3 xl:grid-cols-2">
                    {visibleActiveFollowUpServices.map((service) => (
                      <div
                        key={service.id}
                        className="rounded-[22px] border border-white/80 bg-white/70 px-4 py-3 shadow-sm backdrop-blur"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-slate-400">
                              <CalendarClock className="h-4 w-4" />
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                                Active Follow Up
                              </p>
                            </div>
                            <p className="mt-2 truncate text-sm font-semibold text-slate-950">
                              {service.name}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {service.currentStepTitle
                                ? `Current step: ${service.currentStepTitle}`
                                : "Follow-up in progress"}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-2.5 py-1">
                              <Avatar className="h-7 w-7 shrink-0">
                                <AvatarImage
                                  src={service.ownerImage ?? undefined}
                                  alt={service.ownerName ?? "Unassigned follow-up owner"}
                                />
                                <AvatarFallback className="bg-slate-200 text-[10px] font-semibold text-slate-700">
                                  {getInitials(service.ownerName)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="max-w-[140px] truncate text-xs font-medium text-slate-700">
                                {service.ownerName ?? "Unassigned"}
                              </span>
                            </div>
                            <span className="shrink-0 text-sm font-semibold text-slate-900">
                              {service.percentage}%
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200/80">
                          <div
                            className="h-full rounded-full bg-blue-950 transition-[width]"
                            style={{ width: `${service.percentage}%` }}
                          />
                        </div>

                        <p className="mt-2 text-xs text-slate-500">
                          {service.completed} of {service.total} follow-up step
                          {service.total === 1 ? "" : "s"} completed.
                        </p>
                      </div>
                    ))}

                    {remainingActiveFollowUpServicesCount > 0 ? (
                      <Link
                        href={`/app/${tenantSlug}/contacts/${contactId}/follow-ups`}
                        className="rounded-[22px] border border-dashed border-white/80 bg-white/55 px-4 py-3 shadow-sm backdrop-blur transition hover:bg-white/75"
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
                            Open the follow-ups tab to review the remaining active services.
                          </p>
                        </div>
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-4 md:px-5">
              <ContactDetailTabs tenantSlug={tenantSlug} contactId={contactId} />
            </div>
            <div className="min-h-0 flex-1 p-5 md:p-6">{children}</div>
          </div>
        </div>

        <ContactSupportingSidebar
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          contactId={contactId}
          initialRelationships={contact.relationships}
          initialTags={contact.tags}
          canManageTags={canManageContactTags}
          activeFollowUpCount={activeFollowUpServices.length}
        />
      </div>
    </section>
  )
}
