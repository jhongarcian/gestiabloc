/** Disposable staging harness. Never reads the application's configured database. */
import assert from "node:assert/strict"
import { randomUUID, createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import express from "express"
import cookieParser from "cookie-parser"
import { PrismaClient } from "../src/generated/prisma/index.js"
import { PrismaPg } from "@prisma/adapter-pg"
import { claimAutomationExecutionJobs, releaseAutomationExecutionLease } from "../src/lib/automation-execution-budget.js"
import { resumeAutomationRun } from "../src/lib/opportunity-automations.js"
import { ENROLLMENT_TRIGGER_TYPES } from "../src/lib/service-automation-triggers.js"
import { processClaimedAutomationEvent } from "../src/lib/automation-event-queue.js"

async function main() {
  const url = process.env.SERVICE_CONFIGURATION_TEST_DATABASE_URL
  if (!url) throw new Error("Set SERVICE_CONFIGURATION_TEST_DATABASE_URL to a disposable staging database.")
  process.env.DATABASE_URL = url
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 20 }) })
  const second = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 20 }) })
  const count = Number(process.env.SERVICE_LOAD_JOBS ?? 5000)
  const tenantCount = 10
  assert.ok(Number.isSafeInteger(count) && count >= 20 && count % 20 === 0, "Job count must be a positive multiple of twenty")
  const userId = randomUUID(), token = randomUUID(), tenantIds: string[] = []
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined
  let probing = false
  const activeSamples: number[] = [], apiLatencies: number[] = [], baseline: number[] = []
  let peakTenantUsage = 0, duplicateDeliveriesTested = 0, processedClaims = 0
  const served = new Set<string>(), firstRound: string[] = []
  const started = Date.now()
  try {
    await db.user.create({ data: { id: userId, name: "Load test", email: `${userId}@example.test` } })
    await db.session.create({ data: { userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000) } })
    for (let tenantIndex = 0; tenantIndex < tenantCount; tenantIndex++) {
      const tenantId = randomUUID(), groupId = randomUUID(), serviceId = randomUUID(), sourceStepId = randomUUID(), statusId = randomUUID()
      tenantIds.push(tenantId)
      await db.tenant.create({ data: { id: tenantId, name: `Queue staging ${tenantIndex}`, slug: randomUUID(), timezone: "UTC" } })
      await db.membership.create({ data: { tenantId, userId, role: "TENANT_ADMIN", securityLevel: "MAX" } })
      await db.contactStatusConfig.create({ data: { id: statusId, tenantId, name: "Active", bgColor: "#fff", textColor: "#000" } })
      await db.service.createMany({ data: [ { id: groupId, tenantId, kind: "GROUP", name: "Medicare", basePriceCents: 0 }, { id: serviceId, tenantId, kind: "OFFERING", parentServiceId: groupId, name: "Advantage", basePriceCents: 0 } ] })
      await db.serviceStep.create({ data: { id: sourceStepId, tenantId, serviceId: groupId, title: "Review", completionDuration: 1, completionUnit: "DAYS", sortOrder: 10 } })
      const rows = Array.from({ length: Math.floor(count / tenantCount) }, (_, i) => ({ contactId: randomUUID(), enrollmentId: randomUUID(), stepId: randomUUID(), occurrenceId: randomUUID(), eventId: randomUUID(), runId: randomUUID(), attemptId: randomUUID(), dispatchId: randomUUID(), triggerId: randomUUID(), event: i % 8 < 4, triggerType: ENROLLMENT_TRIGGER_TYPES[i % 4]! }))
      const enteredAt = new Date(), dueAt = new Date(Date.now() + 86400000)
      const ownerNode = randomUUID(), noteNode = randomUUID()
      const actions = [{ nodeKey: ownerNode, type: "SET_SERVICE_COORDINATOR", serviceConfig: { assignedToUserId: userId } }, { nodeKey: noteNode, type: "ADD_CONTACT_NOTE", noteTitle: "Load result", noteBody: "Exactly once after the service checkpoint" }]
      const context = (row: typeof rows[number]) => ({ contactServiceId: row.enrollmentId, serviceId, contactServiceStepId: null, serviceStepId: null, serviceStepOccurrenceId: null })
      await db.contact.createMany({ data: rows.map(row => ({ id: row.contactId, tenantId, statusConfigId: statusId, firstName: "Load", lastName: "Test" })) })
      await db.contactService.createMany({ data: rows.map(row => ({ id: row.enrollmentId, tenantId, contactId: row.contactId, serviceId, totalPriceCents: 0, workflowKind: "SERVICE_STEPS" })) })
      await db.contactServiceStep.createMany({ data: rows.map(row => ({ id: row.stepId, tenantId, contactServiceId: row.enrollmentId, sourceStepId, title: "Review", completionDuration: 1, completionUnit: "DAYS", sortOrder: 10 })) })
      await db.serviceStepOccurrence.createMany({ data: rows.map(row => ({ id: row.occurrenceId, tenantId, contactServiceId: row.enrollmentId, stepId: row.stepId, entryKey: "enrollment", occurrenceNumber: 1, enteredAt, dueAt, defaultDueAt: dueAt })) })
      await db.automationRun.createMany({ data: rows.filter(row => !row.event).map(row => ({ id: row.runId, tenantId, contactId: row.contactId, contactName: "Load Test", automationName: "Queued service updates", attemptId: row.attemptId, eventSource: row.triggerType, triggerType: row.triggerType, serviceContext: context(row), actionSnapshot: actions, status: "QUEUED" })) })
      await db.automationEvent.createMany({ data: rows.filter(row => row.event).map(row => ({ id: row.eventId, tenantId, contactId: row.contactId, contactName: "Load Test", triggerType: row.triggerType, serviceContext: context(row), dispatchCount: 1, chainId: row.eventId })) })
      await db.automationDispatch.createMany({ data: rows.filter(row => row.event).map(row => ({ id: row.dispatchId, tenantId, eventId: row.eventId, automationSnapshotId: randomUUID(), automationName: "Initial service updates", automationOrder: 0, triggerType: row.triggerType, decision: "RUN", decisionDetails: "Staging fixture", actionSnapshot: actions, attemptId: row.attemptId, triggerExecutionId: row.triggerId })) })
      await db.automationNodeExecution.createMany({ data: rows.filter(row => row.event).map(row => ({ id: row.triggerId, tenantId, contactId: row.contactId, contactName: "Load Test", automationName: "Initial service updates", attemptId: row.attemptId, eventSource: row.triggerType, nodeKind: "TRIGGER", nodeKey: row.triggerType, nodeOrder: 0, nodeLabel: "Step entered", status: "QUEUED", serviceContext: context(row), occurredAt: enteredAt })) })
    }
    const app = express()
    app.use(express.json(), cookieParser())
    app.use("/api/services", require("../src/routes/services.routes.js").default)
    server = await new Promise<any>(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)) })
    const address = server!.address() as { port: number }
    const probe = async (samples: number[]) => {
      const start = performance.now()
      const response = await fetch(`http://127.0.0.1:${address.port}/api/services/${tenantIds[0]}/follow-ups?pageSize=25`, { headers: { Cookie: `sid=${token}` }, signal: AbortSignal.timeout(10000) })
      assert.equal(response.status, 200, await response.text())
      samples.push(performance.now() - start)
    }
    for (let i = 0; i < 12; i++) await probe(baseline)
    // Simulate a backend restart after claiming a segment. Its old fencing token must be inert.
    const abandoned = await claimAutomationExecutionJobs(db, "RUN")
    await db.automationRun.updateMany({ where: { id: { in: abandoned.map(row => row.id) } }, data: { leaseExpiresAt: new Date(0) } })
    await db.automationExecutionLease.updateMany({ where: { jobId: { in: abandoned.map(row => row.id) } }, data: { expiresAt: new Date(0) } })
    const recovered = await claimAutomationExecutionJobs(second, "RUN")
    for (const old of abandoned) {
      if (recovered.some(claim => claim.id === old.id)) assert.equal((await resumeAutomationRun(db, old.id, old.leaseToken)).status, "NOT_CLAIMED")
    }
    for (const claim of recovered) { await resumeAutomationRun(second, claim.id, claim.leaseToken); await releaseAutomationExecutionLease(second, "RUN", claim.id, claim.leaseToken) }
    // Release any abandoned claim not immediately selected by the fair rotation.
    await db.automationExecutionLease.deleteMany({ where: { jobId: { in: abandoned.map(row => row.id) }, expiresAt: { lte: new Date() } } })
    probing = true
    const probes = (async () => { while (probing) { await probe(apiLatencies); await new Promise(resolve => setTimeout(resolve, 100)) } })()
    let workDone = false
    const worker = async (client: PrismaClient, workerIndex: number) => {
      let turn = workerIndex, empty = 0
      while (!workDone) {
        const kind = ++turn % 2 ? "EVENT" : "RUN"
        const claims = await claimAutomationExecutionJobs(client, kind)
        const leases = await db.automationExecutionLease.groupBy({ by: ["tenantId"], _count: true })
        const active = leases.reduce((sum, row) => sum + row._count, 0)
        activeSamples.push(active)
        peakTenantUsage = Math.max(peakTenantUsage, ...leases.map(row => row._count))
        assert.ok(active <= 4, `Global concurrency ${active}`)
        assert.ok(leases.every(row => row._count <= 2), "Tenant concurrency exceeded two")
        for (const claim of claims) if (tenantIds.includes(claim.tenantId) && !served.has(claim.tenantId)) { served.add(claim.tenantId); firstRound.push(claim.tenantId) }
        await Promise.all(claims.map(async claim => {
          try {
            const execute = () => kind === "EVENT" ? processClaimedAutomationEvent(client, { eventId: claim.id, leaseToken: claim.leaseToken }) : resumeAutomationRun(client, claim.id, claim.leaseToken)
            if (++processedClaims % 100 === 0) {
              duplicateDeliveriesTested++
              await Promise.all([execute(), execute()])
            } else await execute()
          } finally { await releaseAutomationExecutionLease(client, kind, claim.id, claim.leaseToken) }
        }))
        if (!claims.length) {
          empty++
          if (empty % 10 === 0) {
            const [events, runs] = await Promise.all([
              db.automationEvent.count({ where: { tenantId: { in: tenantIds }, status: { in: ["QUEUED", "PROCESSING"] } } }),
              db.automationRun.count({ where: { tenantId: { in: tenantIds }, status: { in: ["QUEUED", "RUNNING", "WAITING"] } } }),
            ])
            workDone = events + runs === 0
          }
          await new Promise(resolve => setTimeout(resolve, 10))
        } else empty = 0
        if (Date.now() - started > 900000) throw new Error("Load test exceeded 15 minutes")
      }
    }
    await Promise.all([worker(db, 0), worker(second, 1)])
    probing = false
    await probes
    const scope = { tenantId: { in: tenantIds } }
    const terminal = await db.automationRun.groupBy({ by: ["status"], where: scope, _count: true })
    assert.deepEqual(terminal.map(row => [row.status, row._count]), [["SUCCEEDED", count]])
    assert.equal(await db.serviceAutomationActionResult.count({ where: scope }), count)
    assert.equal(await db.contactService.count({ where: { ...scope, followUpCoordinatorUserId: userId } }), count)
    assert.equal(await db.contactNote.count({ where: { ...scope, title: "Load result" } }), count)
    assert.equal(await db.serviceFollowUpExecutionLog.count({ where: { ...scope, eventType: "SET_SERVICE_COORDINATOR" } }), count)
    assert.equal(firstRound.length, tenantCount)
    const percentile = (values: number[], percentile: number) => Math.round([...values].sort((a,b) => a-b)[Math.min(values.length - 1, Math.floor(values.length * percentile))]!)
    const report = { environment: "Disposable local PostgreSQL staging harness with real CRM API routes", jobs: count, tenants: tenantCount, initialEvents: await db.automationEvent.count({ where: scope }), resumedRuns: count - await db.automationEvent.count({ where: scope }), triggerTypes: ENROLLMENT_TRIGGER_TYPES, totalMs: Date.now() - started, maxActiveExecutions: Math.max(...activeSamples), maxPerTenant: peakTenantUsage, duplicateDeliveriesTested, tenantsServed: served.size, terminal, uniqueMutations: count, duplicateChanges: 0, api: { baselineRequests: baseline.length, baselineP50Ms: percentile(baseline, .5), baselineP95Ms: percentile(baseline, .95), loadedRequests: apiLatencies.length, loadedP50Ms: percentile(apiLatencies, .5), loadedP95Ms: percentile(apiLatencies, .95), loadedMaxMs: Math.round(Math.max(...apiLatencies)), timeouts: 0 } }
    writeFileSync(process.env.SERVICE_LOAD_REPORT ?? "/private/tmp/gestiabloc-chunk17-load-report.json", JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ loadReport: report }))
  } finally {
    probing = false
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
    await db.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    await db.user.deleteMany({ where: { id: userId } })
    await Promise.all([db.$disconnect(), second.$disconnect()])
    const { prisma } = require("../src/lib/prisma.js") as { prisma: PrismaClient }
    await prisma.$disconnect()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
