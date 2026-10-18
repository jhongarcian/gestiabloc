import assert from "node:assert/strict"
import { test } from "node:test"

import { runBirthdayReminderScan } from "./automation-birthday-scheduler.js"

test("birthday scan catches late same-day contacts and does not repeat yearly claims", async () => {
  const contacts: string[] = ["contact-1"]
  const claims = new Set<string>()
  const queued: string[] = []
  let kicks = 0
  const prismaClient = {
    automation: { findMany: async () => [{ id: "automation-1", tenantId: "tenant-1", birthdayLocalTime: "09:00", tenant: { timezone: "America/Chicago" } }] },
    $queryRawUnsafe: async (_sql: string, _tenantId: string, _afterId: string, month: number, day: number) =>
      month === 10 && day === 16 ? contacts.map((id) => ({ id })) : [],
    automationBirthdayClaim: { findMany: async () => [...claims].map((value) => {
      const [automationId, contactId] = value.split(":")
      return { automationId, contactId }
    }) },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({}),
  }
  const dependencies = {
    queueEvent: async (_tx: any, event: any) => {
      const key = `${event.automationId}:${event.contactId}`
      claims.add(key)
      queued.push(key)
      return { automationEventId: `event-${queued.length}`, automationStatus: "QUEUED" as const, queuedAutomationCount: 1, matchedCount: 1, executedCount: 0, contactDeleted: false as const }
    },
    kickWorker: () => { kicks += 1 },
  }
  const scanAt = (iso: string) => runBirthdayReminderScan(prismaClient, () => new Date(iso), dependencies)
  assert.equal((await scanAt("2026-10-16T13:59:00.000Z")).queuedCount, 0)
  assert.equal((await scanAt("2026-10-16T14:00:00.000Z")).queuedCount, 1)
  assert.equal((await scanAt("2026-10-16T18:00:00.000Z")).queuedCount, 0)
  contacts.push("contact-2")
  assert.equal((await scanAt("2026-10-16T20:00:00.000Z")).queuedCount, 1)
  assert.equal((await scanAt("2026-10-17T14:00:00.000Z")).queuedCount, 0)
  assert.deepEqual(queued, ["automation-1:contact-1", "automation-1:contact-2"])
  assert.equal(kicks, 2)
})
