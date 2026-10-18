import { birthdayLocalClock, birthdayTimezone, isBirthdayReminderDue } from "./automation-birthday.js"
import { queueBirthdayReminderAutomationEvent } from "./automation-event-queue.js"
import { kickAutomationEventWorker } from "./automation-event-worker.js"
import { prisma } from "./prisma.js"

const PAGE_SIZE = 200
const CONCURRENCY = 5
let running = false

type BirthdayAutomation = {
  id: string
  tenantId: string
  birthdayLocalTime: string | null
  tenant: { timezone: string | null }
}

export async function runBirthdayReminderScan(
  prismaClient: any = prisma,
  clock: () => Date = () => new Date(),
  dependencies: {
    queueEvent?: typeof queueBirthdayReminderAutomationEvent
    kickWorker?: () => void
  } = {},
) {
  const queueEvent = dependencies.queueEvent ?? queueBirthdayReminderAutomationEvent
  const automations: BirthdayAutomation[] = await prismaClient.automation.findMany({
    where: { isEnabled: true, triggerType: "BIRTHDAY_REMINDER", birthdayLocalTime: { not: null } },
    select: { id: true, tenantId: true, birthdayLocalTime: true, tenant: { select: { timezone: true } } },
  })
  const byTenant = new Map<string, BirthdayAutomation[]>()
  for (const automation of automations) {
    const group = byTenant.get(automation.tenantId) ?? []
    group.push(automation)
    byTenant.set(automation.tenantId, group)
  }

  let queuedCount = 0
  for (const [tenantId, tenantAutomations] of byTenant) {
    const timezone = birthdayTimezone(tenantAutomations[0]?.tenant.timezone)
    const today = birthdayLocalClock(clock(), timezone)
    const dueAutomations = tenantAutomations.filter((automation) =>
      automation.birthdayLocalTime && isBirthdayReminderDue(today.localTime, automation.birthdayLocalTime),
    )
    if (!dueAutomations.length) continue
    const leapYear = today.year % 4 === 0 && (today.year % 100 !== 0 || today.year % 400 === 0)
    const includeLeapBirthday = today.month === 2 && today.day === 28 && !leapYear
    let afterId = ""

    while (true) {
      if (birthdayLocalClock(clock(), timezone).localDate !== today.localDate) break
      const candidates: Array<{ id: string }> = await prismaClient.$queryRawUnsafe(`
        SELECT id FROM "Contact"
        WHERE "tenantId" = $1 AND "deceasedAt" IS NULL AND "dateOfBirth" IS NOT NULL AND id > $2
          AND (
            (EXTRACT(MONTH FROM "dateOfBirth") = $3 AND EXTRACT(DAY FROM "dateOfBirth") = $4)
            OR ($5::boolean AND EXTRACT(MONTH FROM "dateOfBirth") = 2 AND EXTRACT(DAY FROM "dateOfBirth") = 29)
          )
        ORDER BY id LIMIT $6
      `, tenantId, afterId, today.month, today.day, includeLeapBirthday, PAGE_SIZE)
      if (!candidates.length) break
      afterId = candidates.at(-1)!.id
      const claims: Array<{ automationId: string; contactId: string }> = await prismaClient.automationBirthdayClaim.findMany({
        where: {
          tenantId,
          occurrenceYear: today.year,
          automationId: { in: dueAutomations.map((item) => item.id) },
          contactId: { in: candidates.map((item) => item.id) },
        },
        select: { automationId: true, contactId: true },
      })
      const claimed = new Set(claims.map((item) => `${item.automationId}:${item.contactId}`))
      const jobs = candidates.flatMap((contact) => dueAutomations
        .filter((automation) => !claimed.has(`${automation.id}:${contact.id}`))
        .map((automation) => ({ contactId: contact.id, automation })))

      for (let offset = 0; offset < jobs.length; offset += CONCURRENCY) {
        const results = await Promise.allSettled(jobs.slice(offset, offset + CONCURRENCY).map(async ({ contactId, automation }) => {
          const clockAt = clock()
          if (birthdayLocalClock(clockAt, timezone).localDate !== today.localDate) return null
          return prismaClient.$transaction((tx: any) => queueEvent(tx, {
            tenantId,
            contactId,
            automationId: automation.id,
            occurrenceYear: today.year,
            localDate: today.localDate,
            timezone,
            scheduledLocalTime: automation.birthdayLocalTime!,
            clockAt,
            actorUserId: null,
          }), { timeout: 15_000 })
        }))
        for (const result of results) {
          if (result.status === "rejected") {
            console.error("Failed to queue birthday reminder:", result.reason)
          } else if (result.value?.automationEventId) {
            queuedCount += 1
          }
        }
      }
      if (candidates.length < PAGE_SIZE) break
    }
  }
  if (queuedCount) (dependencies.kickWorker ?? kickAutomationEventWorker)()
  return { queuedCount }
}

export async function runBirthdayReminderScanOnce() {
  if (running) return { queuedCount: 0 }
  running = true
  try {
    return await runBirthdayReminderScan()
  } finally {
    running = false
  }
}
