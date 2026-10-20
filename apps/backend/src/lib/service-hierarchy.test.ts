import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Server } from "node:http"
import { after, afterEach, before, beforeEach, describe, test } from "node:test"
import express from "express"
import cookieParser from "cookie-parser"
import { Pool } from "pg"
import { PrismaClient } from "../generated/prisma/index.js"
import { ServiceHierarchyInputSchema, assertServiceEnrollableTx } from "./service-hierarchy.js"

test("hierarchy input accepts groups and child offerings but rejects a third level shape", () => {
  assert.equal(ServiceHierarchyInputSchema.parse({}).kind, "GROUP")
  assert.equal(ServiceHierarchyInputSchema.safeParse({ kind: "GROUP", parentServiceId: randomUUID() }).success, false)
  assert.equal(ServiceHierarchyInputSchema.safeParse({ kind: "OFFERING" }).success, false)
  assert.equal(ServiceHierarchyInputSchema.parse({ kind: "OFFERING", parentServiceId: randomUUID() }).kind, "OFFERING")
})

const databaseUrl = process.env.SERVICE_CONFIGURATION_TEST_DATABASE_URL
describe("service hierarchy APIs and database constraints", { skip: !databaseUrl }, () => {
  let db: PrismaClient
  let server: Server
  let base: string
  let userId: string
  let tenantId: string
  let parentId: string
  const token = randomUUID()

  before(async () => {
    process.env.DATABASE_URL = databaseUrl!
    // Import the real routers only after selecting the disposable test database.
    const settings = (require("../routes/account-settings.routes.js") as typeof import("../routes/account-settings.routes.js")).default
    const services = (require("../routes/services.routes.js") as typeof import("../routes/services.routes.js")).default
    const { prisma } = require("./prisma.js") as typeof import("./prisma.js")
    db = prisma
    const app = express()
    app.use(express.json(), cookieParser())
    app.use("/api/account-settings", settings)
    app.use("/api/services", services)
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(400).json({ error: error instanceof Error ? error.message : "INVALID_REQUEST" })
    })
    server = await new Promise<Server>((done) => { const started = app.listen(0, "127.0.0.1", () => done(started)) })
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    base = `http://127.0.0.1:${address.port}`
    const user = await db.user.create({ data: { name: "Hierarchy tester", email: `${randomUUID()}@example.test` } })
    userId = user.id
    await db.session.create({ data: { userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000) } })
  })
  after(async () => {
    if (server) await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done()))
    if (userId) await db.user.delete({ where: { id: userId } })
    await db?.$disconnect()
  })
  beforeEach(async () => {
    const tenant = await db.tenant.create({ data: { name: "Hierarchy test", slug: randomUUID() } })
    tenantId = tenant.id
    await db.membership.create({ data: { tenantId, userId, role: "TENANT_ADMIN", securityLevel: "MAX" } })
    const parent = await db.service.create({ data: { tenantId, kind: "GROUP", name: "Medicare", basePriceCents: 0 } })
    parentId = parent.id
  })
  afterEach(async () => { await db.tenant.delete({ where: { id: tenantId } }) })

  async function request(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { Cookie: `sid=${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, data: await response.json() as any }
  }
  const settingsPath = () => `/api/account-settings/${tenantId}/services`
  const createChild = (name = "Medicare Advantage") => request(settingsPath(), "POST", {
    kind: "OFFERING", parentServiceId: parentId, name, basePriceCents: 10000,
  })

  test("creates offerings and exposes their parent and the parent's child count", async () => {
    const child = await createChild()
    assert.equal(child.status, 201)
    assert.equal(child.data.service.parentService.id, parentId)
    const parent = await request(`${settingsPath()}/${parentId}`)
    assert.equal(parent.data.service.kind, "GROUP")
    assert.equal(parent.data.service.subServiceCount, 1)
    const groups = await request(`${settingsPath()}?kind=GROUP&search=Advantage`)
    assert.deepEqual(groups.data.items.map((item: any) => item.id), [parentId])
    const children = await request(`${settingsPath()}?kind=OFFERING&parentServiceId=${parentId}`)
    assert.deepEqual(children.data.items.map((item: any) => item.id), [child.data.service.id])
  })

  test("rejects missing parents, nested parents, child-as-parent, and cross-tenant parents", async () => {
    assert.equal((await request(settingsPath(), "POST", { kind: "OFFERING", name: "Missing", basePriceCents: 0 })).status, 400)
    assert.equal((await request(settingsPath(), "POST", { kind: "GROUP", parentServiceId: parentId, name: "Nested", basePriceCents: 0 })).status, 400)
    const child = await createChild()
    const third = await request(settingsPath(), "POST", { kind: "OFFERING", parentServiceId: child.data.service.id, name: "Third level", basePriceCents: 0 })
    assert.equal(third.status, 400)
    assert.equal(third.data.error, "INVALID_PARENT_SERVICE")
    const other = await db.tenant.create({ data: { name: "Other tenant", slug: randomUUID() } })
    try {
      const foreign = await db.service.create({ data: { tenantId: other.id, name: "Other group", basePriceCents: 0 } })
      const result = await request(settingsPath(), "POST", { kind: "OFFERING", parentServiceId: foreign.id, name: "Cross tenant", basePriceCents: 0 })
      assert.equal(result.status, 400)
      assert.equal(result.data.error, "INVALID_PARENT_SERVICE")
    } finally { await db.tenant.delete({ where: { id: other.id } }) }
    await assert.rejects(db.service.create({ data: { tenantId, kind: "OFFERING", parentServiceId: child.data.service.id, name: "Invalid SQL child", basePriceCents: 0 } }))
  })

  test("only active sub-services of active parents are enrollable and offered in pickers", async () => {
    const child = await createChild()
    const childId = child.data.service.id
    await assert.rejects(db.$transaction((tx) => assertServiceEnrollableTx(tx, tenantId, parentId)), /SUB_SERVICE_REQUIRED/)
    await db.$transaction((tx) => assertServiceEnrollableTx(tx, tenantId, childId))
    const options = await request(`/api/services/${tenantId}/options`)
    assert.deepEqual(options.data.items.map((item: any) => item.id), [childId])
    const adminOptions = await request(`${settingsPath()}/options`)
    assert.deepEqual(adminOptions.data.items.map((item: any) => item.id), [childId])
    const status = await db.contactStatusConfig.create({ data: { tenantId, name: "Active", bgColor: "#fff", textColor: "#000" } })
    const contact = await db.contact.create({ data: { tenantId, firstName: "Test", lastName: "Contact", statusConfigId: status.id } })
    const enrollmentPath = `/api/services/${tenantId}/contact-services`
    const rejected = await request(enrollmentPath, "POST", { contactId: contact.id, serviceId: parentId })
    assert.equal(rejected.status, 400)
    assert.equal(rejected.data.error, "SUB_SERVICE_REQUIRED")
    const enrolled = await request(enrollmentPath, "POST", { contactId: contact.id, serviceId: childId })
    assert.equal(enrolled.status, 201)
    await request(`${settingsPath()}/${parentId}`, "PATCH", { isActive: false })
    assert.equal((await request(`/api/services/${tenantId}/options`)).data.items.length, 0)
    assert.equal((await request(`${settingsPath()}/options`)).data.items.length, 0)
    assert.equal((await request(enrollmentPath, "POST", { contactId: contact.id, serviceId: childId })).status, 400)
    assert.ok(await db.contactService.findUnique({ where: { id: enrolled.data.contactService.id } }))
  })

  test("rejects retyping/reparenting and deleting nonempty parent services", async () => {
    const child = await createChild()
    assert.equal((await request(`${settingsPath()}/${child.data.service.id}`, "PATCH", { kind: "GROUP" })).status, 400)
    assert.equal((await request(`${settingsPath()}/${child.data.service.id}`, "PATCH", { parentServiceId: null })).status, 400)
    const deletion = await request(`${settingsPath()}/${parentId}`, "DELETE")
    assert.equal(deletion.status, 409)
    assert.equal(deletion.data.error, "SERVICE_HAS_SUB_SERVICES")
    assert.equal(await db.service.count({ where: { tenantId } }), 2)
  })

  test("migration groups old services without changing IDs, names, prices, or enrollment links", async () => {
    const pool = new Pool({ connectionString: databaseUrl! })
    const client = await pool.connect()
    const schema = `hierarchy_migration_${randomUUID().replaceAll("-", "")}`
    try {
      await client.query("BEGIN")
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET LOCAL search_path TO "${schema}", public`)
      await client.query(`CREATE TABLE "Service" (
        "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL,
        "basePriceCents" INTEGER NOT NULL, "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL, "updatedAt" TIMESTAMP NOT NULL,
        UNIQUE ("tenantId", "id"), UNIQUE ("tenantId", "name")
      ); CREATE TABLE "ContactService" ("id" TEXT PRIMARY KEY, "serviceId" TEXT REFERENCES "Service"("id"));
      INSERT INTO "Service" ("id", "tenantId", "name", "basePriceCents", "createdAt", "updatedAt")
      VALUES ('old-service', 'old-tenant', 'Existing services', 12345, NOW(), NOW());
      INSERT INTO "ContactService" VALUES ('old-enrollment', 'old-service');`)
      await client.query(readFileSync(resolve(__dirname, "../../prisma/migrations/20261019200000_service_hierarchy/migration.sql"), "utf8"))
      const result = await client.query(`SELECT child.*, parent."name" AS "parentName"
        FROM "Service" child JOIN "Service" parent ON parent."id" = child."parentServiceId"
        WHERE child."id" = 'old-service'`)
      assert.equal(result.rows[0].name, "Existing services")
      assert.equal(result.rows[0].basePriceCents, 12345)
      assert.equal(result.rows[0].kind, "OFFERING")
      assert.equal(result.rows[0].parentName, "Existing services (2)")
      assert.equal((await client.query(`SELECT "serviceId" FROM "ContactService" WHERE "id" = 'old-enrollment'`)).rows[0].serviceId, "old-service")
    } finally {
      await client.query("ROLLBACK")
      client.release()
      await pool.end()
    }
  })
})
