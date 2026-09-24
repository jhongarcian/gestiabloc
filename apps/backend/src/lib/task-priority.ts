import { prisma } from "./prisma.js"
import {
  getTaskPriorityFromDueDate,
  isCompletedStatusName,
} from "./task-priority-values.js"

export {
  getTaskDueDayOffset,
  getTaskPriorityFromDueDate,
  isCompletedStatusName,
  isSameLocalDay,
  type TaskPriority,
} from "./task-priority-values.js"

const prismaWithTasks = prisma as any
const DAY_IN_MS = 24 * 60 * 60 * 1000
const DEFAULT_TIMEZONE = "America/Chicago"

function getSafeTimezone(timezone?: string | null) {
  return timezone?.trim() || DEFAULT_TIMEZONE
}

export async function getTenantTimezone(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { timezone: true },
  })

  return getSafeTimezone(tenant?.timezone)
}

export async function refreshTaskPrioritiesForTenants(
  tenantTimezones?: Array<{ tenantId: string; timezone?: string | null }>,
) {
  const scopedTenants =
    tenantTimezones ??
    (await prisma.tenant.findMany({
      select: {
        id: true,
        timezone: true,
      },
    })).map((tenant) => ({
      tenantId: tenant.id,
      timezone: tenant.timezone,
    }))

  if (!scopedTenants.length) {
    return { updated: 0 }
  }

  const tenantTimezoneMap = new Map(
    scopedTenants.map((tenant) => [tenant.tenantId, getSafeTimezone(tenant.timezone)]),
  )

  const tasks = await prismaWithTasks.task.findMany({
    where: {
      tenantId: {
        in: scopedTenants.map((tenant) => tenant.tenantId),
      },
    },
    select: {
      id: true,
      tenantId: true,
      dueDate: true,
      priority: true,
      statusConfig: {
        select: {
          name: true,
        },
      },
    },
  })

  const updates = tasks
    .map((task: any) => ({
      id: task.id,
      priority: getTaskPriorityFromDueDate(
        task.dueDate,
        tenantTimezoneMap.get(task.tenantId),
        isCompletedStatusName(task.statusConfig?.name),
      ),
      currentPriority: task.priority,
    }))
    .filter((task: any) => task.priority !== task.currentPriority)

  if (!updates.length) {
    return { updated: 0 }
  }

  await prisma.$transaction(
    updates.map((task: any) =>
      prismaWithTasks.task.update({
        where: { id: task.id },
        data: { priority: task.priority },
      }),
    ),
  )

  return { updated: updates.length }
}

function getMsUntilNextMidnightInTimezone(
  timezone: string,
  now = new Date(),
) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

  const parts = formatter.formatToParts(now)
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0")
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0")
  const second = Number(parts.find((part) => part.type === "second")?.value ?? "0")

  const elapsed = ((hour * 60 + minute) * 60 + second) * 1000
  const remaining = DAY_IN_MS - elapsed

  return remaining > 0 ? remaining : DAY_IN_MS
}

export async function getNextPriorityRefreshSchedule() {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      timezone: true,
    },
  })

  if (!tenants.length) {
    return null
  }

  const grouped = new Map<string, string[]>()
  for (const tenant of tenants) {
    const timezone = getSafeTimezone(tenant.timezone)
    const existing = grouped.get(timezone) ?? []
    existing.push(tenant.id)
    grouped.set(timezone, existing)
  }

  let selectedTimezone = DEFAULT_TIMEZONE
  let selectedDelay = Number.POSITIVE_INFINITY

  for (const timezone of grouped.keys()) {
    const delay = getMsUntilNextMidnightInTimezone(timezone)
    if (delay < selectedDelay) {
      selectedDelay = delay
      selectedTimezone = timezone
    }
  }

  return {
    delayMs: selectedDelay,
    timezone: selectedTimezone,
    tenantIds: grouped.get(selectedTimezone) ?? [],
  }
}
