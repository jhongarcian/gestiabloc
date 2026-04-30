import { headers } from "next/headers"
import { isAxiosError } from "axios"
import { CalendarClock } from "lucide-react"
import { notFound } from "next/navigation"

import { api } from "@/lib/api"
import type { CalendarEventItem, CalendarMetaResponse } from "../../../calendar/_lib/calendar-api"
import { getCalendarMeta } from "../../../calendar/_lib/calendar-api"
import { getContactDetailsContext } from "../_lib/contact-details"
import { ContactAppointmentsPanel } from "./_components/contact-appointments-panel"

type ContactAppointmentsResponse = {
  ok: boolean
  canViewAuditLogs: boolean
  items: Array<CalendarEventItem>
}

export default async function ContactAppointmentsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
}) {
  const { tenantSlug, contactId } = await params
  const { tenantId, tenantTimezone } = await getContactDetailsContext(
    tenantSlug,
    contactId,
  )
  const cookie = (await headers()).get("cookie") ?? ""

  let appointmentsData: ContactAppointmentsResponse = {
    ok: true,
    canViewAuditLogs: false,
    items: [],
  }

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
      groups: [],
      users: [] as Array<{
        id: string
        label: string
        email: string
        role: string
        image: string | null
        color: string | null
      }>,
      services: [] as Array<{
        id: string
        name: string
      }>,
    },
  }

  try {
    const [appointmentsResponse, metaResponse] = await Promise.all([
      api.get<ContactAppointmentsResponse>(
        `/api/appointments/${tenantId}/contact/${contactId}`,
        {
          headers: { cookie },
        },
      ),
      getCalendarMeta(tenantId, cookie),
    ])

    appointmentsData = appointmentsResponse.data
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
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) {
      notFound()
    }
    throw error
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              Contact Appointments
            </p>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
                Appointment history
              </h1>
              <p className="text-sm text-slate-600">
                Review the latest appointments linked to this contact and open any item to make changes.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm">
            <span className="inline-flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-slate-500" />
              <span className="font-semibold text-slate-950">
                {appointmentsData.items.length}
              </span>{" "}
              appointments
            </span>
          </div>
        </div>
      </div>

      <ContactAppointmentsPanel
        tenantSlug={tenantSlug}
        tenantId={tenantId}
        tenantTimezone={tenantTimezone}
        canViewAuditLogs={appointmentsData.canViewAuditLogs}
        items={appointmentsData.items}
        meetingIntervalMinutes={calendarMeta.settings.meetingIntervalMinutes}
        meetingDurationMinutes={calendarMeta.settings.meetingDurationMinutes}
        serviceOptions={calendarMeta.filters.services}
        assigneeOptions={calendarMeta.filters.users}
      />
    </section>
  )
}
