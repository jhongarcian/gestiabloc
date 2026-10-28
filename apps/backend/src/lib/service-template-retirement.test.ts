import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"
import { Pool } from "pg"

const databaseUrl = process.env.SERVICE_CONFIGURATION_TEST_DATABASE_URL

test("template retirement archives real historical records atomically and fences live old workers", { skip: !databaseUrl, timeout: 120000 }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  const client = await pool.connect()
  const schema = `retirement_${randomUUID().replaceAll("-", "")}`
  const migrations = resolve(__dirname, "../../prisma/migrations")
  const cutover = "20261021233000_retire_service_templates"
  try {
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}", public`)
    // Build the genuine pre-cutover schema, rather than a hand-maintained approximation.
    for (const migration of readdirSync(migrations).filter(name => name < cutover).sort()) {
      if (!/^\d/.test(migration)) continue
      const sql = readFileSync(resolve(migrations, migration, "migration.sql"), "utf8")
        .replaceAll('"public".', `"${schema}".`)
      await client.query(sql)
    }
    const insert = async (table: string, values: Record<string, unknown>) => {
      const keys = Object.keys(values)
      await client.query(`INSERT INTO "${table}" (${keys.map(key => `"${key}"`).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(values))
    }
    const now = new Date()
    await insert("Tenant", { id: "tenant", name: "Original agency", slug: "original", updatedAt: now })
    await insert("User", { id: "user", name: "Original owner", email: "owner@example.test", updatedAt: now })
    await insert("ContactStatusConfig", { id: "status", tenantId: "tenant", name: "Active", bgColor: "#fff", textColor: "#000", updatedAt: now })
    await insert("Contact", { id: "contact", tenantId: "tenant", firstName: "Original", lastName: "Contact", statusConfigId: "status", updatedAt: now })
    await insert("Service", { id: "service", tenantId: "tenant", name: "Original service", basePriceCents: 100, updatedAt: now })
    await insert("ServiceFollowUpTemplate", { id: "template", tenantId: "tenant", serviceId: "service", name: "Original workflow", draftDefinition: { nodes: ["unpublished"] }, updatedAt: now })
    await insert("ServiceFollowUpTemplateVersion", { id: "version", tenantId: "tenant", templateId: "template", versionNumber: 2, checksum: "original", definition: { nodes: ["published"] } })
    await insert("ContactService", { id: "enrollment", tenantId: "tenant", contactId: "contact", serviceId: "service", followUpTemplateId: "template", followUpTemplateVersionId: "version", followUpCoordinatorUserId: "user", totalPriceCents: 100, updatedAt: now })
    await insert("ContactServiceFollowUpRun", { id: "run", tenantId: "tenant", contactServiceId: "enrollment", templateVersionId: "version", status: "WAITING", cursorNodeId: "send", variables: { saved: "original" }, leaseToken: "old-worker", leaseExpiresAt: new Date(Date.now() + 60000), updatedAt: now })
    await insert("ServiceFollowUpNodeExecution", { id: "node", tenantId: "tenant", runId: "run", nodeId: "done", status: "SUCCEEDED", input: { original: true }, output: { taskId: "task" }, completedAt: now })
    await insert("ContactServiceFollowUpStep", { id: "step", tenantId: "tenant", contactServiceId: "enrollment", runId: "run", templateNodeId: "done", title: "Finished work", status: "COMPLETED", completedAt: now, assignedToUserId: "user", resolvedByUserId: "user", resolvedAt: now, updatedAt: now })
    await insert("Task", { id: "task", tenantId: "tenant", contactId: "contact", contactServiceId: "enrollment", followUpTemplateId: "template", followUpTemplateVersionId: "version", contactServiceFollowUpStepId: "step", name: "Saved task", updatedAt: now })
    await insert("ContactNote", { id: "note", tenantId: "tenant", contactId: "contact", contactServiceId: "enrollment", followUpTemplateId: "template", followUpTemplateVersionId: "version", contactServiceFollowUpStepId: "step", title: "Saved note", body: "Original history", updatedAt: now })
    await insert("ServiceFollowUpExecutionLog", { id: "log", tenantId: "tenant", contactServiceId: "enrollment", contactId: "contact", templateId: "template", templateVersionId: "version", runId: "run", eventType: "STEP_COMPLETED", title: "Saved activity" })
    await insert("Automation", { id: "ordinary", tenantId: "tenant", name: "Ordinary automation", triggerType: "CONTACT_NOTE_ADDED", updatedAt: now })

    const migration = readFileSync(resolve(migrations, cutover, "migration.sql"), "utf8")
    await assert.rejects(client.query(migration), /LEGACY_WORKER_LEASE_ACTIVE/)
    await client.query("ROLLBACK")
    assert.equal((await client.query(`SELECT count(*)::int AS count FROM "ContactServiceFollowUpRun"`)).rows[0].count, 1)
    assert.equal((await client.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema=$1 AND table_name='ContactService' AND column_name='retiredWorkflowSnapshot'", [schema])).rows[0].count, 0)
    await client.query(`UPDATE "ContactServiceFollowUpRun" SET "leaseExpiresAt"=CURRENT_TIMESTAMP - INTERVAL '1 second'`)
    await client.query(migration)
    const enrollment = (await client.query(`SELECT * FROM "ContactService"`)).rows[0]
    const archive = enrollment.retiredWorkflowSnapshot
    assert.equal(archive.template.name, "Original workflow")
    assert.deepEqual(archive.version.definition, { nodes: ["published"] })
    assert.equal(archive.run.cursorNodeId, "send")
    assert.deepEqual(archive.run.variables, { saved: "original" })
    assert.equal(archive.run.leaseToken, undefined)
    assert.equal(archive.nodeExecutions[0].output.taskId, "task")
    assert.equal(enrollment.followUpCoordinatorUserId, "user")
    assert.equal(enrollment.followUpTemplateId, "template")
    const step = (await client.query(`SELECT * FROM "ContactServiceFollowUpStep"`)).rows[0]
    assert.equal(step.runId, "run")
    assert.equal(step.assignedToUserId, "user")
    assert.equal(step.completedAt.getTime(), now.getTime())
    for (const table of ["Task", "ContactNote"]) {
      const row = (await client.query(`SELECT * FROM "${table}"`)).rows[0]
      assert.equal(row.retiredWorkflowSnapshot.template.name, "Original workflow")
      assert.equal(row.contactServiceFollowUpStepId, "step")
    }
    assert.equal((await client.query(`SELECT "runId" FROM "ServiceFollowUpExecutionLog"`)).rows[0].runId, "run")
    assert.equal((await client.query(`SELECT name FROM "Automation"`)).rows[0].name, "Ordinary automation")
    for (const table of ["ServiceFollowUpTemplate", "ServiceFollowUpTemplateVersion", "ServiceFollowUpTemplateStep", "ContactServiceFollowUpRun", "ServiceFollowUpNodeExecution"]) {
      assert.equal((await client.query("SELECT to_regclass($1) AS relation", [`"${schema}"."${table}"`])).rows[0].relation, null)
    }
  } finally {
    await client.query("ROLLBACK")
    await client.query("SET search_path TO public")
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    client.release()
    await pool.end()
  }
})
