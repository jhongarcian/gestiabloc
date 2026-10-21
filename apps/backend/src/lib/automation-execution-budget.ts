import { randomUUID } from "node:crypto"
import { Prisma } from "../generated/prisma/index.js"

export function executionBudget(env: NodeJS.ProcessEnv = process.env) {
  const pool = Number(env.PRISMA_POOL_MAX ?? (env.CONTACT_IMPORT_WORKER == "true" ? 5 : 20))
  const global = Number(env.AUTOMATION_EXECUTION_CONCURRENCY ?? Math.min(4, pool - 4))
  const tenant = Number(env.AUTOMATION_EXECUTION_TENANT_CONCURRENCY ?? Math.min(2, global))
  if (![pool, global, tenant].every(Number.isInteger) || global < 1 || global > pool - 4 || tenant < 1 || tenant > global)
    throw new Error("Automation execution concurrency must reserve four pool connections; tenant concurrency must fit the global budget.")
  return { global, tenant }
}
export type AutomationJobClaim = { id: string; tenantId: string; actorUserId: string | null; leaseToken: string }
export const AUTOMATION_EXECUTION_BUDGET = executionBudget()

// A short admission lock covers BOTH queues, across all backend instances. Leases
// bound actual execution, not just the number of candidates a process happens to fetch.
export async function claimAutomationExecutionJobs(client: any, kind: "EVENT" | "RUN", limit = 16): Promise<AutomationJobClaim[]> {
  const budget = AUTOMATION_EXECUTION_BUDGET
  const claim = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(712021016)`)
    const now = new Date()
    await tx.automationExecutionLease.deleteMany({ where: { expiresAt: { lte: now } } })
    const active = await tx.automationExecutionLease.count()
    const capacity = Math.min(limit, budget.global - active)
    if (capacity <= 0) return []
    const table = Prisma.raw(kind === "EVENT" ? '"AutomationEvent"' : '"AutomationRun"')
    const eligible = kind === "EVENT" ? Prisma.sql`((job.status = 'QUEUED' AND job."availableAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) OR (job.status = 'PROCESSING' AND job."leaseExpiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')))`
      : Prisma.sql`((job.status = 'QUEUED' AND job."availableAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) OR (job.status = 'WAITING' AND job."resumeAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) OR (job.status = 'RUNNING' AND job."leaseToken" IS NOT NULL AND job."leaseExpiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))) AND (job."leaseExpiresAt" IS NULL OR job."leaseExpiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))`
    const scope = Prisma.sql`job."tenantId" || ':contact:' || COALESCE(job."contactId", job.id)`
    const candidates = await tx.$queryRaw<Array<{ id: string; tenantId: string; actorUserId: string | null; scopeKey: string }>>(Prisma.sql`
      WITH contacts AS (
        SELECT job.id, job."tenantId", job."updatedAt",
          ROW_NUMBER() OVER (PARTITION BY ${scope} ORDER BY job."updatedAt", job.id) AS contact_rank,
          ${budget.tenant} - (SELECT COUNT(*) FROM "AutomationExecutionLease" lease WHERE lease."tenantId"=job."tenantId") AS tenant_capacity
        FROM ${table} job
        WHERE ${eligible} AND NOT EXISTS (SELECT 1 FROM "AutomationExecutionLease" lease WHERE lease."scopeKey"=${scope})
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "updatedAt", id) AS tenant_rank
        FROM contacts WHERE contact_rank=1
      )
      SELECT job.id, job."tenantId", job."actorUserId", ${scope} AS "scopeKey"
      FROM ${table} job JOIN ranked ON ranked.id=job.id
      LEFT JOIN "AutomationExecutionTenant" rotation ON rotation."tenantId"=job."tenantId"
      WHERE ranked.tenant_rank <= ranked.tenant_capacity AND ranked.contact_rank=1
      ORDER BY ranked.tenant_rank, COALESCE(rotation."lastAdmittedAt", 'epoch'::timestamp), job."updatedAt", job.id
      FOR UPDATE OF job SKIP LOCKED LIMIT ${capacity}
    `)
    const claims: AutomationJobClaim[] = []
    for (const candidate of candidates) {
      const leaseToken = randomUUID()
      const expiresAt = new Date(now.getTime() + 120000)
      await tx.automationExecutionLease.create({ data: { kind, jobId: candidate.id, tenantId: candidate.tenantId, scopeKey: candidate.scopeKey, leaseToken, expiresAt } })
      if (kind === "EVENT") await tx.automationEvent.update({ where: { id: candidate.id }, data: { status: "PROCESSING", leaseToken, leaseExpiresAt: expiresAt, processingStartedAt: now, attemptCount: { increment: 1 } } })
      else await tx.automationRun.update({ where: { id: candidate.id }, data: { status: "RUNNING", leaseToken, leaseExpiresAt: expiresAt } })
      await tx.automationExecutionTenant.upsert({ where: { tenantId: candidate.tenantId }, create: { tenantId: candidate.tenantId, lastAdmittedAt: now }, update: { lastAdmittedAt: now } })
      claims.push({ id: candidate.id, tenantId: candidate.tenantId, actorUserId: candidate.actorUserId, leaseToken })
    }
    return claims
  }
  return typeof client.$transaction === "function" ? client.$transaction(claim, { maxWait: 5000, timeout: 10000 }) : claim(client)
}

export async function releaseAutomationExecutionLease(client: any, kind: "EVENT" | "RUN", jobId: string, leaseToken: string) {
  await client.automationExecutionLease.deleteMany({ where: { kind, jobId, leaseToken } })
}
export const TRANSIENT_AUTOMATION_RETRY_DELAYS = [5000, 30000, 120000] as const
export function transientAutomationFailure(error: unknown): boolean {
  const value = error as { code?: string; message?: string; cause?: unknown }
  return ["P1001", "P1008", "P1017", "P2028", "P2034", "OPPORTUNITY_CHANGED_CONCURRENTLY"].includes(value?.code ?? "")
    || /deadlock|serializ|connection.*(?:closed|reset|terminated)|timed? out|expired transaction/i.test(value?.message ?? "")
    || Boolean(value?.cause && value.cause !== error && transientAutomationFailure(value.cause))
}
