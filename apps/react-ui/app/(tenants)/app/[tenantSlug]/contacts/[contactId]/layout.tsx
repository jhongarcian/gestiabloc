import { headers } from "next/headers"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { api } from "@/lib/api"
import { serviceOfferingLabel } from "@/lib/service-hierarchy"
import { getCalendarMeta, type CalendarMetaResponse } from "../../calendar/_lib/calendar-api"
import { ContactBreadcrumbSync } from "./_components/contact-breadcrumb-sync"
import { ContactDetailNavigation } from "./_components/contact-detail-navigation"
import { ContactHeaderActions } from "./_components/contact-header-actions"
import {
  ContactSupportingSidebar,
  type ContactSidebarFollowUp,
} from "./_components/contact-supporting-sidebar"
import {
  formatContactDate,
  getContactDetailsContext,
} from "./_lib/contact-details"
import { getAllContactServices, type ContactServiceSummaryItem } from "./_lib/contact-overview-metrics"

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

function isPastDue(value: string | null | undefined) {
  if (!value) return false
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return false

  return parsed.getTime() < Date.now()
}

const ACTIVE_CONTACT_SERVICE_STATUSES = new Set(["IN_PROGRESS", "PENDING_PAYMENT"])

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

  let contactServices: ContactServiceSummaryItem[] | null = null
  let activeFollowUpServices: ContactSidebarFollowUp[] = []
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
      getAllContactServices(tenantId, contactId, cookie).catch(() => null),
      api.get<ContactAssigneesResponse>(`/api/tasks/${tenantId}/assignees`, {
        headers: { cookie },
      }).catch(() => null),
      api.get<ContactStatusesResponse>(`/api/contacts/${tenantId}/statuses`, {
        headers: { cookie },
      }).catch(() => null),
      getCalendarMeta(tenantId, cookie).catch(() => null),
      api
        .get<TaskStatusesResponse>(`/api/tasks/${tenantId}/statuses`, {
          headers: { cookie },
        })
        .catch(() => null),
    ])

    contactServices = services
    activeFollowUpServices = (services ?? [])
      .filter((service) => ACTIVE_CONTACT_SERVICE_STATUSES.has(service.status))
      .map((service) => {
        if (service.workflowKind === "SERVICE_STEPS") {
          const steps = service.serviceSteps ?? []
          const entries = steps.flatMap(step => step.occurrences.filter(entry => !entry.supersededAt).map(entry => ({ ...entry, step })))
          const current = entries.find(entry => entry.status === "ACTIVE" || ["WAITING_AUTOMATION", "PAUSED"].includes(entry.progressionStatus))
          if (!current) return null
          const progress = service.stepProgress ?? { total: steps.length, completed: 0, percentage: 0 }
          return {
            id: service.id,
            name: serviceOfferingLabel(service.service),
            ...progress,
            currentStepTitle: current.step.title,
            currentStepDueAt: current.dueAt,
            currentStepIsScheduled: false,
            isOverdue: current.status === "ACTIVE" && isPastDue(current.dueAt),
            collaborators: steps.flatMap(step => step.assignedTo ? [{ id: step.assignedTo.id, label: step.assignedTo.name || step.assignedTo.email, tone: "internal" as const }] : []),
          }
        }
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
              name: serviceOfferingLabel(service.service),
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
    assigneeOptions = assignees?.data.items ?? []
    statusOptions = (statuses?.data.items ?? []).map((status) => ({
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
      settings: metaResponse?.settings ?? calendarMeta.settings,
      filters: {
        users: Array.isArray(metaResponse?.filters?.users)
          ? metaResponse.filters.users
          : [],
        groups: Array.isArray(metaResponse?.filters?.groups)
          ? metaResponse.filters.groups
          : [],
        services: Array.isArray(metaResponse?.filters?.services)
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

  const sidebarServices = contactServices
    ? [...contactServices]
      .sort((a, b) => Number(ACTIVE_CONTACT_SERVICE_STATUSES.has(b.status)) - Number(ACTIVE_CONTACT_SERVICE_STATUSES.has(a.status)) || serviceOfferingLabel(a.service).localeCompare(serviceOfferingLabel(b.service)))
      .map((service) => ({ id: service.id, name: serviceOfferingLabel(service.service), status: service.status }))
    : null

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <ContactBreadcrumbSync label={contact.fullName} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip rounded-[28px] border border-slate-200/80 bg-white shadow-sm">
        {/* Match the page behind the rounded corners so scrolling content cannot show through. */}
        <header className="sticky top-[var(--tenant-shell-header-height)] z-20 shrink-0 bg-slate-100">
          <div className="flex flex-col gap-3 rounded-t-[27px] border-b border-slate-200/80 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_46%,#fff7ed_100%)] p-3 shadow-sm md:px-5 xl:flex-row xl:items-start xl:justify-between">
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
                <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold text-slate-950">
                  {contact.fullName}
                </h1>
              </div>
            </div>
            <ContactHeaderActions
              tenantId={tenantId}
              tenantSlug={tenantSlug}
              contactId={contactId}
              tenantTimezone={tenantTimezone}
              currentUserId={currentUserId}
              initialContact={{
                id: contact.id,
                fullName: contact.fullName,
                email: contact.email,
                phoneNumber: contact.phoneNumber,
              }}
              meetingIntervalMinutes={calendarMeta.settings.meetingIntervalMinutes}
              meetingDurationMinutes={calendarMeta.settings.meetingDurationMinutes}
              calendarServiceOptions={calendarMeta.filters.services}
              calendarAssigneeOptions={calendarMeta.filters.users}
              taskStatusOptions={taskStatusOptions}
              taskAssigneeOptions={assigneeOptions}
              initialStatus={{
                label: contact.status,
                value: contact.statusConfigId,
                bgColor: contact.statusBgColor,
                textColor: contact.statusTextColor,
              }}
              contactStatusOptions={statusOptions}
              initialAssignedTo={contact.assignedTo}
              contactAssigneeOptions={assigneeOptions}
            />
            </div>
        </header>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col xl:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ContactDetailNavigation tenantSlug={tenantSlug} contactId={contactId} />
            <div className="@container/contact-content min-h-0 min-w-0 flex-1 bg-background px-4 py-5 md:px-5 md:py-6">
              {children}
            </div>
          </div>

          <ContactSupportingSidebar
            tenantSlug={tenantSlug}
            contactId={contactId}
            tenantTimezone={tenantTimezone}
            contact={{
              email: contact.email,
              phoneNumber: contact.phoneNumber,
              secondaryPhoneNumber: contact.secondaryPhoneNumber,
              address: contact.address,
              mailingAddress: contact.mailingAddress,
              tags: contact.tags,
              relationships: contact.relationships,
            }}
            dateOfBirthLabel={formatContactDate(contact.dateOfBirth)}
            services={sidebarServices}
            followUpServices={activeFollowUpServices}
          />
        </div>
      </div>
    </section>
  )
}
