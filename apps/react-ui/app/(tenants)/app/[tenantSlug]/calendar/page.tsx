import { redirect } from "next/navigation"

import { getTenantMembershipContext } from "../_lib/tenant-session"
import { CalendarWorkspace } from "./_components/calendar-workspace"
import {
  getCalendarEvents,
  getCalendarMeta,
  type CalendarEventsResponse,
  type CalendarMetaResponse,
} from "./_lib/calendar-api"

function normalizeCalendarEventsResponse(
  response: Partial<CalendarEventsResponse> | null | undefined,
): CalendarEventsResponse {
  return {
    ok: response?.ok ?? true,
    items: Array.isArray(response?.items) ? response.items : [],
    blockedPeriods: Array.isArray(response?.blockedPeriods) ? response.blockedPeriods : [],
    range: {
      from: response?.range?.from ?? null,
      to: response?.range?.to ?? null,
    },
    filters: {
      view: response?.filters?.view ?? "month",
      filterMode: response?.filters?.filterMode ?? "users",
      assignedToUserId: response?.filters?.assignedToUserId ?? null,
      assignedToUserIds: Array.isArray(response?.filters?.assignedToUserIds)
        ? response.filters.assignedToUserIds
        : [],
      groupIds: Array.isArray(response?.filters?.groupIds)
        ? response.filters.groupIds
        : [],
      contactId: response?.filters?.contactId ?? null,
      serviceId: response?.filters?.serviceId ?? null,
    },
    emptyState: {
      title: response?.emptyState?.title ?? "No appointments yet",
      description:
        response?.emptyState?.description ??
        "The calendar route and backend appointment API are now in place. The next step is FullCalendar plus appointment persistence.",
    },
  }
}

export default async function CalendarPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params
  const { cookie, membership, tenantTimezone, user } = await getTenantMembershipContext(tenantSlug)

  if (!membership?.tenant?.id) {
    redirect(`/app/${tenantSlug}`)
  }

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  let meta: CalendarMetaResponse = {
    ok: true,
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
    availability: {
      weeklyAvailability: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        enabled: dayOfWeek >= 1 && dayOfWeek <= 5,
        startTime: "09:00",
        endTime: "17:00",
      })),
    },
    filters: {
      users: [],
      groups: [],
      services: [],
    },
  }

  let events: CalendarEventsResponse = {
    ok: true,
    items: [],
    blockedPeriods: [],
    range: {
      from: null,
      to: null,
    },
    filters: {
      view: "month" as const,
      filterMode: "users" as const,
      assignedToUserId: null,
      assignedToUserIds: [],
      groupIds: [],
      contactId: null,
      serviceId: null,
    },
    emptyState: {
      title: "No appointments yet",
      description:
        "The calendar route and backend appointment API are now in place. The next step is FullCalendar plus appointment persistence.",
    },
  }

  try {
    const [metaResponse, eventsResponse] = await Promise.all([
      getCalendarMeta(membership.tenant.id, cookie),
      getCalendarEvents(
        membership.tenant.id,
        {
          view: "month",
          from: monthStart.toISOString(),
          to: nextMonthStart.toISOString(),
        },
        cookie,
      ),
    ])

    meta = metaResponse
    events = normalizeCalendarEventsResponse(eventsResponse)
  } catch {
    // Keep the route reachable even if the first API iteration changes during implementation.
  }

  return (
    <CalendarWorkspace
      tenantSlug={tenantSlug}
      tenantId={membership.tenant.id}
      tenantTimezone={tenantTimezone}
      currentUserId={user.id}
      canViewAuditLogs={membership.securityLevel === "MAX"}
      meta={meta}
      events={events}
    />
  )
}
