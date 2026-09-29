import { randomUUID } from "node:crypto"

import { prisma } from "./prisma.js"
import {
  processClaimedAutomationEvent,
} from "./automation-event-queue.js"
import { emitStoredTaskNotifications } from "./task-notifications.js"
import { deleteAutomationContactFileObjects } from "./opportunity-automations.js"
import { emitAutomationEventCompleted } from "./realtime.js"

function positiveInteger(name: string, fallback: number, maximum: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}.`)
  }
  return value
}

function percentage(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be a number between 0 and 100.`)
  }
  return value
}

export const AUTOMATION_EVENT_WORKER_CONFIG = {
  pollMs: positiveInteger("AUTOMATION_EVENT_POLL_MS", 1_000, 60_000),
  concurrency: positiveInteger("AUTOMATION_EVENT_CONCURRENCY", 8, 64),
  perTenantConcurrency: positiveInteger("AUTOMATION_EVENT_TENANT_CONCURRENCY", 4, 32),
  claimSize: positiveInteger("AUTOMATION_EVENT_CLAIM_SIZE", 16, 100),
  leaseMs: positiveInteger("AUTOMATION_EVENT_LEASE_MS", 120_000, 900_000),
  metricsMs: positiveInteger("AUTOMATION_EVENT_METRICS_MS", 60_000, 900_000),
  failureAlertPercent: percentage("AUTOMATION_EVENT_FAILURE_ALERT_PERCENT", 10),
}

type ClaimedEvent = { id: string; tenantId: string; actorUserId: string | null; leaseToken: string }

let running = false
let kickPending = false

async function recoverExpiredLeases() {
  const recovered = await prisma.automationEvent.updateMany({
    where: {
      status: "PROCESSING",
      leaseExpiresAt: { lt: new Date() },
    },
    data: {
      status: "QUEUED",
      leaseToken: null,
      leaseExpiresAt: null,
      availableAt: new Date(),
      lastError: "Recovered after an automation worker lease expired.",
    },
  })
  if (recovered.count > 0) {
    console.warn(JSON.stringify({ metric: "automation_queue_expired_leases", count: recovered.count }))
  }
}

async function claimEvents(): Promise<ClaimedEvent[]> {
  const config = AUTOMATION_EVENT_WORKER_CONFIG
  const leaseToken = randomUUID()
  const leaseExpiresAt = new Date(Date.now() + config.leaseMs)
  const limit = config.claimSize
  return prisma.$queryRawUnsafe<ClaimedEvent[]>(`
    WITH running AS (
      SELECT "tenantId", COUNT(*)::int AS count
      FROM "AutomationEvent"
      WHERE status = 'PROCESSING'
        AND "leaseExpiresAt" > NOW()
      GROUP BY "tenantId"
    ), ranked AS (
      SELECT e.id,
             ROW_NUMBER() OVER (PARTITION BY e."tenantId" ORDER BY e."availableAt", e."createdAt") AS tenant_rank,
             ROW_NUMBER() OVER (PARTITION BY e."tenantId", e."contactId" ORDER BY e."availableAt", e."createdAt") AS contact_rank,
             GREATEST($1::int - COALESCE(r.count, 0), 0) AS tenant_capacity
      FROM "AutomationEvent" e
      LEFT JOIN running r ON r."tenantId" = e."tenantId"
      WHERE e.status = 'QUEUED'
        AND e."availableAt" <= NOW()
        AND NOT EXISTS (
          SELECT 1
          FROM "AutomationEvent" active
          WHERE active.status = 'PROCESSING'
            AND active."leaseExpiresAt" > NOW()
            AND active."tenantId" = e."tenantId"
            AND active."contactId" IS NOT DISTINCT FROM e."contactId"
        )
    ), candidates AS (
      SELECT e.id
      FROM "AutomationEvent" e
      JOIN ranked ON ranked.id = e.id
      WHERE ranked.tenant_rank <= ranked.tenant_capacity
        AND ranked.contact_rank = 1
      ORDER BY e."availableAt", e."createdAt"
      FOR UPDATE OF e SKIP LOCKED
      LIMIT $2
    )
    UPDATE "AutomationEvent" e
    SET status = 'PROCESSING',
        "leaseToken" = $3,
        "leaseExpiresAt" = $4,
        "processingStartedAt" = COALESCE(e."processingStartedAt", NOW()),
        "attemptCount" = e."attemptCount" + 1,
        "updatedAt" = NOW()
    FROM candidates
    WHERE e.id = candidates.id
    RETURNING e.id, e."tenantId", e."actorUserId", e."leaseToken"
  `, config.perTenantConcurrency, limit, leaseToken, leaseExpiresAt)
}

async function processClaim(claim: ClaimedEvent) {
  const startedAt = Date.now()
  try {
    const result = await processClaimedAutomationEvent(prisma as any, {
      eventId: claim.id,
      leaseToken: claim.leaseToken,
    })
    if (result && result.status !== "PROCESSING") {
      const event = await prisma.automationEvent.findUnique({
        where: { id: claim.id },
        select: {
          actorUserId: true,
          tenantId: true,
          contactId: true,
          createdAt: true,
          processingStartedAt: true,
        },
      })
      if (event?.actorUserId) {
        emitAutomationEventCompleted(event.actorUserId, {
          eventId: claim.id,
          tenantId: event.tenantId,
          status: result.status,
          completed: result.completedCount,
          skipped: result.skippedCount,
          failed: result.failedCount,
          contactDeleted: event.contactId === null,
        })
      }
      console.info(JSON.stringify({
        metric: "automation_event_completed",
        eventId: claim.id,
        tenantId: claim.tenantId,
        durationMs: Date.now() - startedAt,
        queueWaitMs: event?.processingStartedAt
          ? event.processingStartedAt.getTime() - event.createdAt.getTime()
          : null,
        eventToCompletionMs: event ? Date.now() - event.createdAt.getTime() : null,
        status: result.status,
      }))
    }
  } catch (error) {
    console.error("Automation event worker failed", { eventId: claim.id, error })
    await prisma.automationEvent.updateMany({
      where: { id: claim.id, leaseToken: claim.leaseToken, status: "PROCESSING" },
      data: {
        status: "QUEUED",
        availableAt: new Date(Date.now() + 5_000),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: String((error as Error)?.message ?? error).slice(0, 500),
      },
    }).catch(() => undefined)
  }
}

export async function runAutomationEventWorkerOnce() {
  if (running) {
    kickPending = true
    return
  }
  running = true
  try {
    await recoverExpiredLeases()
    const claims = await claimEvents()
    let cursor = 0
    const workers = Array.from({ length: Math.min(
      AUTOMATION_EVENT_WORKER_CONFIG.concurrency,
      claims.length,
    ) }, async () => {
      while (cursor < claims.length) {
        const claim = claims[cursor]
        cursor += 1
        if (claim) await processClaim(claim)
      }
    })
    await Promise.all(workers)
  } finally {
    running = false
    if (kickPending) {
      kickPending = false
      queueMicrotask(() => void runAutomationEventWorkerOnce())
    }
  }
}

export function kickAutomationEventWorker() {
  void runAutomationEventWorkerOnce()
}

async function claimSideEffects() {
  const leaseToken = randomUUID()
  const leaseExpiresAt = new Date(Date.now() + 120_000)
  return prisma.$queryRawUnsafe<Array<{ id: string; type: string; payload: unknown; attemptCount: number }>>(`
    WITH candidates AS (
      SELECT id
      FROM "AutomationSideEffect"
      WHERE (
        status = 'PENDING' AND "availableAt" <= NOW()
      ) OR (
        status = 'PROCESSING' AND "leaseExpiresAt" < NOW()
      )
      ORDER BY "availableAt", "createdAt"
      FOR UPDATE SKIP LOCKED
      LIMIT 32
    )
    UPDATE "AutomationSideEffect" effect
    SET status = 'PROCESSING',
        "leaseToken" = $1,
        "leaseExpiresAt" = $2,
        "attemptCount" = effect."attemptCount" + 1,
        "updatedAt" = NOW()
    FROM candidates
    WHERE effect.id = candidates.id
    RETURNING effect.id, effect.type, effect.payload, effect."attemptCount"
  `, leaseToken, leaseExpiresAt)
}

async function processSideEffect(effect: { id: string; type: string; payload: unknown; attemptCount: number }) {
  const payload = effect.payload && typeof effect.payload === "object"
    ? effect.payload as Record<string, unknown>
    : {}
  try {
    if (effect.type === "NOTIFICATION_DELIVERY" && typeof payload.notificationId === "string") {
      await emitStoredTaskNotifications([payload.notificationId])
    } else if (effect.type === "FILE_DELETE" && typeof payload.key === "string") {
      await deleteAutomationContactFileObjects([{
        id: typeof payload.fileId === "string" ? payload.fileId : effect.id,
        tenantId: "",
        key: payload.key,
      }])
    }
    await prisma.automationSideEffect.update({
      where: { id: effect.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    })
  } catch (error) {
    const terminal = effect.attemptCount >= 5
    await prisma.automationSideEffect.update({
      where: { id: effect.id },
      data: {
        status: terminal ? "FAILED" : "PENDING",
        availableAt: new Date(Date.now() + Math.min(120_000, 5_000 * 2 ** effect.attemptCount)),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: String((error as Error)?.message ?? error).slice(0, 500),
      },
    })
  }
}

export async function runAutomationSideEffectWorkerOnce() {
  const effects = await claimSideEffects()
  await Promise.all(effects.map(processSideEffect))
}

export async function reportAutomationQueueMetrics() {
  const fiveMinutesAgo = new Date(Date.now() - 300_000)
  const [queued, failed, terminal, retried] = await Promise.all([
    prisma.automationEvent.aggregate({
      where: { status: "QUEUED" },
      _count: { _all: true },
      _min: { createdAt: true },
    }),
    prisma.automationDispatch.count({
      where: { status: "FAILED", completedAt: { gte: fiveMinutesAgo } },
    }),
    prisma.automationDispatch.count({
      where: { attemptCount: { gt: 0 }, updatedAt: { gte: fiveMinutesAgo } },
    }),
    prisma.automationDispatch.count({
      where: {
        status: { in: ["COMPLETED", "FAILED", "SKIPPED", "CANCELED"] },
        completedAt: { gte: fiveMinutesAgo },
      },
    }),
  ])
  const oldestAgeMs = queued._min.createdAt ? Date.now() - queued._min.createdAt.getTime() : 0
  const failureRatePercent = terminal > 0 ? (failed / terminal) * 100 : 0
  const payload = {
    metric: "automation_queue_health",
    queueDepth: queued._count._all,
    oldestQueuedAgeMs: oldestAgeMs,
    permanentFailuresLast5m: failed,
    failureRatePercent,
    runsPerMinute: terminal / 5,
    retriesLast5m: retried,
  }
  if (oldestAgeMs > 120_000 || failureRatePercent > AUTOMATION_EVENT_WORKER_CONFIG.failureAlertPercent) console.warn(JSON.stringify(payload))
  else console.info(JSON.stringify(payload))
}
