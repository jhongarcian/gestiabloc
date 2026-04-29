import { api } from "@/lib/api"

export type CalendarMetaResponse = {
  ok: boolean
  settings: {
    meetingIntervalMinutes: 15 | 30 | 45 | 60 | 120
    meetingDurationMinutes: 15 | 30 | 45 | 60 | 120
    minimumScheduleNoticeMinutes: number
    maximumBookingsPerDay: number | null
    maximumBookingsPerSlot: number
    preBufferMinutes: number
    postBufferMinutes: number
    bufferAvailabilityMode: "BUSY" | "UNAVAILABLE"
  }
  filters: {
    users: Array<{
      id: string
      label: string
      email: string
      role: string
      image: string | null
      color: string | null
    }>
    groups: Array<{
      id: string
      name: string
      description: string | null
      memberUserIds: string[]
      members: Array<{
        userId: string
        label: string
        email: string
        image: string | null
        color: string | null
      }>
    }>
    services: Array<{
      id: string
      name: string
    }>
  }
}

export type AppointmentSlotsResponse = {
  ok: boolean
  timezone: string
  meetingIntervalMinutes: 15 | 30 | 45 | 60 | 120
  meetingDurationMinutes: 15 | 30 | 45 | 60 | 120
  bookingRules: {
    minimumScheduleNoticeMinutes: number
    maximumBookingsPerDay: number | null
    maximumBookingsPerSlot: number
    preBufferMinutes: number
    postBufferMinutes: number
    bufferAvailabilityMode: "BUSY" | "UNAVAILABLE"
  }
  assignee: {
    id: string
    label: string
  }
  date: string
  slots: Array<{
    startAt: string
    endAt: string
    startLabel: string
    endLabel: string
    available: boolean
    reason: string | null
  }>
}

export type CalendarEventItem = {
  id: string
  title: string
  notes: string | null
  startAt: string
  endAt: string
  assignedToUserId: string | null
  assignedToLabel: string
  assignedToImage: string | null
  assignedToColor: string | null
  contactId: string
  contactName: string
  contactEmail: string | null
  contactPhone: string | null
  serviceId: string | null
  serviceName: string | null
  status: string
}

export type CalendarEventsResponse = {
  ok: boolean
  items: CalendarEventItem[]
  range: {
    from: string | null
    to: string | null
  }
  filters: {
    view: "month" | "week" | "day" | "list"
    filterMode: "users" | "groups"
    assignedToUserId: string | null
    assignedToUserIds: string[]
    groupIds: string[]
    contactId: string | null
    serviceId: string | null
  }
  emptyState: {
    title: string
    description: string
  }
}

export type AppointmentAvailabilityResponse = {
  ok: boolean
  available: boolean
  timezone: string
  assignee: {
    id: string
    label: string
  }
  reasons: string[]
  windows: {
    tenantOpen: Array<{
      start: string
      end: string
      label: string | null
    }>
    userOpen: Array<{
      start: string
      end: string
      label: string | null
    }>
    blocked: Array<{
      start: string
      end: string
      label: string | null
    }>
  }
  conflicts: {
    appointments: Array<{
      id: string
      title: string
      startAt: string
      endAt: string
    }>
    blocks: Array<{
      id: string
      title: string
      startsAt: string
      endsAt: string
    }>
  }
}

export type CreateAppointmentPayload = {
  contactId: string
  serviceId?: string | null
  assignedToUserId: string
  title?: string | null
  notes?: string | null
  startAt: string
  endAt: string
  isAllDay?: boolean
}

export type AppointmentMutationResponse = {
  ok: boolean
  item: {
    id: string
    title: string
    startAt: string
    endAt: string
    status: string
    assignedToUserId: string | null
    contactId: string
    serviceId: string | null
  }
}

export async function getCalendarMeta(tenantId: string, cookie?: string) {
  const { data } = await api.get<CalendarMetaResponse>(`/api/appointments/${tenantId}/meta`, {
    headers: cookie ? { cookie } : undefined,
  })

  return data
}

export async function getCalendarEvents(
  tenantId: string,
  params?: Partial<{
    view: "month" | "week" | "day" | "list"
    filterMode: "users" | "groups"
    assignedToUserId: string
    assignedToUserIds: string[]
    groupIds: string[]
    contactId: string
    serviceId: string
    from: string
    to: string
  }>,
  cookie?: string,
) {
  const { data } = await api.get<CalendarEventsResponse>(`/api/appointments/${tenantId}`, {
    params: {
      ...params,
      assignedToUserIds: params?.assignedToUserIds?.join(","),
      groupIds: params?.groupIds?.join(","),
    },
    headers: cookie ? { cookie } : undefined,
  })

  return data
}

export async function checkAppointmentAvailability(
  tenantId: string,
  payload: {
    assignedToUserId: string
    startAt: string
    endAt: string
    appointmentId?: string
  },
) {
  const { data } = await api.post<AppointmentAvailabilityResponse>(
    `/api/appointments/${tenantId}/availability`,
    payload,
  )

  return data
}

export async function getAppointmentSlots(
  tenantId: string,
  params: {
    assignedToUserId: string
    date: string
    appointmentId?: string
  },
) {
  const { data } = await api.get<AppointmentSlotsResponse>(
    `/api/appointments/${tenantId}/slots`,
    { params },
  )

  return data
}

export async function createAppointment(tenantId: string, payload: CreateAppointmentPayload) {
  const { data } = await api.post<AppointmentMutationResponse>(
    `/api/appointments/${tenantId}`,
    payload,
  )

  return data
}

export async function updateAppointment(
  tenantId: string,
  appointmentId: string,
  payload: Partial<CreateAppointmentPayload> & {
    status?: "SCHEDULED" | "CANCELED"
  },
) {
  const { data } = await api.patch<AppointmentMutationResponse>(
    `/api/appointments/${tenantId}/${appointmentId}`,
    payload,
  )

  return data
}
