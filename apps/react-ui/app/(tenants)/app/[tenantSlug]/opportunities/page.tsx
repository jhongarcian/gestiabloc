
import { redirect } from "next/navigation"

import { api } from "@/lib/api"
import { getTenantMembershipContext } from "../_lib/tenant-session"
import { getCalendarMeta, type CalendarMetaResponse } from "../calendar/_lib/calendar-api"
import { OpportunitiesWorkspace } from "./_components/opportunities-workspace"

type TaskStatusOptionsResponse = {
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

type TaskAssigneesResponse = {
  ok: boolean
  items: Array<{
    value: string
    label: string
    email: string
    image: string | null
  }>
}

type OpportunityFiltersResponse = {
  ok: boolean
  filters: {
    statuses: Array<{
      id: string
      name: string
      bgColor: string | null
      textColor: string | null
    }>
    tags: Array<{
      id: string
      name: string
      bgColor: string | null
      textColor: string | null
    }>
    assignees: Array<{
      userId: string
      name: string
      email: string
      image: string | null
    }>
    customFields: Array<{
      id: string
      key: string
      label: string
      fieldType: string
      options: string[]
    }>
  }
}

export default async function OpportunitiesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { cookie, membership, tenantTimezone, user } = await getTenantMembershipContext(tenantSlug)

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  let taskStatusOptions: Array<{
    label: string
    value: string
    bgColor?: string
    textColor?: string
  }> = []
  let taskAssigneeOptions: TaskAssigneesResponse["items"] = []
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
  let opportunityFilterOptions: OpportunityFiltersResponse["filters"] = {
    statuses: [],
    tags: [],
    assignees: [],
    customFields: [],
  }

  try {
    const [taskStatusesResponse, taskAssigneesResponse, calendarMetaResponse, filtersResponse] =
      await Promise.all([
        api.get<TaskStatusOptionsResponse>(`/api/tasks/${membership.tenant.id}/statuses`, {
          headers: { cookie },
        }),
        api.get<TaskAssigneesResponse>(`/api/tasks/${membership.tenant.id}/assignees`, {
          headers: { cookie },
        }),
        getCalendarMeta(membership.tenant.id, cookie),
        api.get<OpportunityFiltersResponse>(
          `/api/opportunities/${membership.tenant.id}/filters`,
          { headers: { cookie } },
        ),
      ])

    taskStatusOptions = taskStatusesResponse.data.items.map((status) => ({
      label: status.name,
      value: status.id,
      bgColor: status.bgColor,
      textColor: status.textColor,
    }))
    taskAssigneeOptions = taskAssigneesResponse.data.items
    calendarMeta = {
      settings: calendarMetaResponse.settings,
      filters: {
        users: Array.isArray(calendarMetaResponse.filters?.users)
          ? calendarMetaResponse.filters.users
          : [],
        groups: Array.isArray(calendarMetaResponse.filters?.groups)
          ? calendarMetaResponse.filters.groups
          : [],
        services: Array.isArray(calendarMetaResponse.filters?.services)
          ? calendarMetaResponse.filters.services
          : [],
      },
    }
    opportunityFilterOptions = filtersResponse.data.filters
  } catch {
    taskStatusOptions = []
    taskAssigneeOptions = []
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
    opportunityFilterOptions = {
      statuses: [],
      tags: [],
      assignees: [],
      customFields: [],
    }
  }

  return (
    <OpportunitiesWorkspace
      tenantSlug={tenantSlug}
      tenantId={membership.tenant.id}
      tenantTimezone={tenantTimezone}
      currentUserId={user.id}
      canManageTags={membership.role === "TENANT_ADMIN" || membership.securityLevel !== "LOW"}
      taskStatusOptions={taskStatusOptions}
      taskAssigneeOptions={taskAssigneeOptions}
      calendarMeta={calendarMeta}
      opportunityFilterOptions={opportunityFilterOptions}
    />
  )
}
