"use client"

import dynamic from "next/dynamic"
import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { getCalendarMeta, type CalendarMetaResponse } from "../../../calendar/_lib/calendar-api"

const AppointmentSheet = dynamic(() => import("../../../calendar/_components/create-appointment-dialog").then((module) => module.CreateAppointmentDialog))

export type ContactAiBookingContext = {
  currentUserId: string
  tenantTimezone: string | null
  contact: { id: string; fullName: string; phoneNumber: string | null; email: string | null }
}

export function ContactAiBooking({ tenantId, serviceId, context, className, disabled }: {
  tenantId: string
  serviceId: string
  context: ContactAiBookingContext
  className?: string
  disabled?: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [booking, setBooking] = useState<{ serviceId: string; meta: CalendarMetaResponse; context: ContactAiBookingContext } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const mounted = useRef(true)
  const pending = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function openBooking() {
    if (pending.current) return
    pending.current = true
    setLoading(true)
    // Freeze the service while the sheet is open, even if chat scope changes.
    const target = serviceId
    try {
      const meta = await getCalendarMeta(tenantId)
      if (!mounted.current) return
      if (!meta.filters.services.some((service) => service.id === target)) {
        toast.error("This service is no longer available for booking.")
        return
      }
      setBooking({ serviceId: target, meta, context })
    } catch {
      if (mounted.current) toast.error("Could not load appointment availability. Try again.")
    } finally {
      pending.current = false
      if (mounted.current) setLoading(false)
    }
  }

  return <>
    <Button ref={trigger} type="button" variant="outline" className={className} disabled={disabled || loading} onClick={() => void openBooking()}>
      {loading ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : null}
      {loading ? "Loading booking…" : "Book appointment"}
    </Button>
    {booking ? <AppointmentSheet
      tenantId={tenantId}
      tenantTimezone={booking.context.tenantTimezone}
      currentUserId={booking.context.currentUserId}
      initialContact={booking.context.contact}
      lockContact
      initialServiceId={booking.serviceId}
      lockService
      defaultToCurrentUser={false}
      meetingIntervalMinutes={booking.meta.settings.meetingIntervalMinutes}
      meetingDurationMinutes={booking.meta.settings.meetingDurationMinutes}
      serviceOptions={booking.meta.filters.services}
      assigneeOptions={booking.meta.filters.users}
      hideTrigger
      open
      onOpenChange={(open) => { if (!open) { setBooking(null); queueMicrotask(() => trigger.current?.focus()) } }}
    /> : null}
  </>
}
