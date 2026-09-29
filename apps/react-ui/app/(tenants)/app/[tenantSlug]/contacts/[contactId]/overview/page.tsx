import { headers } from "next/headers"
import Link from "next/link"
import {
  CalendarClock,
  CircleDollarSign,
  ListTodo,
  Target,
  type LucideIcon,
} from "lucide-react"

import { api } from "@/lib/api"
import { formatDateForDisplay } from "@/lib/date-time"
import { getContactDetailsContext } from "../_lib/contact-details"
import {
  getContactOverviewMetrics,
  type ContactOverviewMetrics,
} from "../_lib/contact-overview-metrics"
import { ContactOverviewForm } from "./_components/contact-overview-form"

type ContactStatusesResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
  }>
}

type ContactLeadSourcesResponse = {
  ok: boolean
  items: Array<{
    id: string
    name: string
    sortOrder: number
    isSystemDefault: boolean
  }>
}

const EMPTY_METRICS: ContactOverviewMetrics = {
  totalSpendingCents: 0,
  lastPaymentAt: null,
  opportunityCount: 0,
  openOpportunityCount: 0,
  activeTaskCount: 0,
  overdueTaskCount: 0,
  nextAppointment: null,
}

function formatUsdAmount(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function ProfileMetric({
  href,
  icon: Icon,
  label,
  value,
  helper,
}: {
  href: string
  icon: LucideIcon
  label: string
  value: string | number
  helper: string
}) {
  return (
    <Link
      href={href}
      className="group min-w-0 rounded-[22px] outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label={`${label}: ${value}. ${helper}`}
    >
      <article className="h-full min-w-0 rounded-[22px] border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur transition group-hover:-translate-y-0.5 group-hover:border-slate-200 group-hover:bg-white group-hover:shadow-md">
        <div className="flex items-center gap-2 text-slate-400">
          <Icon aria-hidden="true" className="size-4" />
          <p className="text-xs font-medium text-slate-500">
            {label}
          </p>
        </div>
        <p className="mt-2 truncate text-xl font-semibold text-slate-950">
          {value}
        </p>
        <p className="mt-1 truncate text-xs text-slate-500">{helper}</p>
      </article>
    </Link>
  )
}

function formatTimeForDisplay(value: string, timezone?: string | null) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""

  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone?.trim() || "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

export default async function ContactOverviewPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; contactId: string }>
}) {
  const { tenantSlug, contactId } = await params
  const {
    tenantId,
    contact,
    currentUserId,
    membershipSecurityLevel,
    canApproveSensitiveFieldAccess,
    canManageContactTags,
    tenantTimezone,
  } = await getContactDetailsContext(tenantSlug, contactId)
  const cookie = (await headers()).get("cookie") ?? ""

  let statusOptions: Array<{ label: string; value: string }> = []
  let leadSourceOptions: Array<{ label: string; value: string }> = []
  let metrics = EMPTY_METRICS
  let metricsErrorMessage: string | null = null

  const [statusesResult, leadSourcesResult, metricsResult] = await Promise.allSettled([
    api.get<ContactStatusesResponse>(
      `/api/contacts/${tenantId}/statuses`,
      {
        headers: { cookie },
      },
    ),
    api.get<ContactLeadSourcesResponse>(
      `/api/contacts/${tenantId}/lead-sources`,
      {
        headers: { cookie },
      },
    ),
    getContactOverviewMetrics(tenantId, contactId, cookie),
  ])

  if (statusesResult.status === "fulfilled") {
    statusOptions = statusesResult.value.data.items.map((status) => ({
      label: status.name,
      value: status.id,
    }))
  }

  if (leadSourcesResult.status === "fulfilled") {
    leadSourceOptions = leadSourcesResult.value.data.items.map((source) => ({
      label: source.name,
      value: source.name,
    }))
  }

  if (
    contact.leadSource &&
    !leadSourceOptions.some((option) => option.value === contact.leadSource)
  ) {
    leadSourceOptions = [
      { label: contact.leadSource, value: contact.leadSource },
      ...leadSourceOptions,
    ]
  }

  if (metricsResult.status === "fulfilled") {
    metrics = metricsResult.value
  } else {
    metricsErrorMessage = "Could not load contact summary."
  }

  const nextAppointmentLabel = metrics.nextAppointment
    ? formatDateForDisplay(metrics.nextAppointment.startAt, tenantTimezone)
    : "None scheduled"
  const lastPaymentHelper = metrics.lastPaymentAt
    ? `Last payment: ${formatDateForDisplay(metrics.lastPaymentAt, tenantTimezone)}`
    : "No payments recorded"
  const opportunitiesHelper =
    metrics.openOpportunityCount > 0
      ? `${metrics.openOpportunityCount} currently open`
      : "No open opportunities"
  const tasksHelper =
    metrics.overdueTaskCount > 0
      ? `${metrics.overdueTaskCount} overdue`
      : "No overdue tasks"
  const nextAppointmentHelper = metrics.nextAppointment
    ? `${metrics.nextAppointment.title} · ${formatTimeForDisplay(
        metrics.nextAppointment.startAt,
        tenantTimezone,
      )}`
    : "No scheduled or confirmed appointments"
  const contactBaseHref = `/app/${tenantSlug}/contacts/${contactId}`
  const summaryUnavailable = metricsErrorMessage !== null

  return (
    <section className="flex flex-col gap-5">
      <div className="relative overflow-hidden rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_48%,#fff7ed_100%)] p-5">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full bg-blue-200/30 blur-3xl"
        />

        {metricsErrorMessage ? (
          <div
            role="alert"
            className="relative mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            {metricsErrorMessage}
          </div>
        ) : null}

        <div className="relative grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ProfileMetric
            href={`${contactBaseHref}/services`}
            icon={CircleDollarSign}
            label="Total spending"
            value={
              summaryUnavailable
                ? "—"
                : formatUsdAmount(metrics.totalSpendingCents)
            }
            helper={
              summaryUnavailable ? "Summary unavailable" : lastPaymentHelper
            }
          />
          <ProfileMetric
            href={`${contactBaseHref}/opportunities`}
            icon={Target}
            label="Opportunities"
            value={summaryUnavailable ? "—" : metrics.opportunityCount}
            helper={
              summaryUnavailable ? "Summary unavailable" : opportunitiesHelper
            }
          />
          <ProfileMetric
            href={`${contactBaseHref}/tasks`}
            icon={ListTodo}
            label="Active tasks"
            value={summaryUnavailable ? "—" : metrics.activeTaskCount}
            helper={summaryUnavailable ? "Summary unavailable" : tasksHelper}
          />
          <ProfileMetric
            href={`${contactBaseHref}/appointments`}
            icon={CalendarClock}
            label="Next appointment"
            value={summaryUnavailable ? "—" : nextAppointmentLabel}
            helper={
              summaryUnavailable
                ? "Summary unavailable"
                : nextAppointmentHelper
            }
          />
        </div>
      </div>

      <ContactOverviewForm
        tenantId={tenantId}
        contactId={contactId}
        currentUserId={currentUserId}
        membershipSecurityLevel={membershipSecurityLevel}
        canApproveSensitiveFieldAccess={canApproveSensitiveFieldAccess}
        canManageTags={canManageContactTags}
        initialContact={contact}
        statusOptions={statusOptions}
        leadSourceOptions={leadSourceOptions}
      />
    </section>
  )
}
