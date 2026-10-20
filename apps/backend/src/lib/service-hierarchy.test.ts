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
import { ServiceStepInputSchema, createServiceStepOccurrenceTx } from "./service-steps.js"
import { ServiceHierarchyInputSchema, assertServiceEnrollableTx } from "./service-hierarchy.js"

test("hierarchy input accepts groups and child offerings but rejects a third level shape", () => {
  assert.equal(ServiceHierarchyInputSchema.parse({}).kind, "GROUP")
  assert.equal(
    ServiceHierarchyInputSchema.safeParse({ kind: "GROUP", parentServiceId: randomUUID() }).success,
    false,
  )
  assert.equal(ServiceHierarchyInputSchema.safeParse({ kind: "OFFERING" }).success, false)
  assert.equal(
    ServiceHierarchyInputSchema.parse({ kind: "OFFERING", parentServiceId: randomUUID() }).kind,
    "OFFERING",
  )
})

test("service step timeframes accept minutes, hours, and days and reject invalid durations", () => {
  for (const completionUnit of ["MINUTES", "HOURS", "DAYS"])
    assert.equal(
      ServiceStepInputSchema.safeParse({ title: "Review", completionDuration: 2, completionUnit })
        .success,
      true,
    )
  for (const completionDuration of [0, -1, 1.5, 6000000])
    assert.equal(
      ServiceStepInputSchema.safeParse({ title: "Review", completionDuration }).success,
      false,
    )
  assert.equal(
    ServiceStepInputSchema.safeParse({
      title: "Review",
      completionDuration: 3651,
      completionUnit: "DAYS",
    }).success,
    false,
  )
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
    const settings = (
      require("../routes/account-settings.routes.js") as typeof import("../routes/account-settings.routes.js")
    ).default
    const services = (
      require("../routes/services.routes.js") as typeof import("../routes/services.routes.js")
    ).default
    const { prisma } = require("./prisma.js") as typeof import("./prisma.js")
    db = prisma
    const app = express()
    app.use(express.json(), cookieParser())
    app.use("/api/account-settings", settings)
    app.use("/api/services", services)
    app.use(
      (
        error: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(400).json({ error: error instanceof Error ? error.message : "INVALID_REQUEST" })
      },
    )
    server = await new Promise<Server>((done) => {
      const started = app.listen(0, "127.0.0.1", () => done(started))
    })
    const address = server.address()
    assert.ok(address && typeof address !== "string")
    base = `http://127.0.0.1:${address.port}`
    const user = await db.user.create({
      data: { name: "Hierarchy tester", email: `${randomUUID()}@example.test` },
    })
    userId = user.id
    await db.session.create({
      data: {
        userId,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 3600000),
      },
    })
  })
  after(async () => {
    if (server)
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      )
    if (userId) await db.user.delete({ where: { id: userId } })
    await db?.$disconnect()
  })
  beforeEach(async () => {
    const tenant = await db.tenant.create({ data: { name: "Hierarchy test", slug: randomUUID() } })
    tenantId = tenant.id
    await db.membership.create({
      data: { tenantId, userId, role: "TENANT_ADMIN", securityLevel: "MAX" },
    })
    const parent = await db.service.create({
      data: { tenantId, kind: "GROUP", name: "Medicare", basePriceCents: 0 },
    })
    parentId = parent.id
  })
  afterEach(async () => {
    await db.tenant.delete({ where: { id: tenantId } })
  })

  async function request(path: string, method = "GET", body?: unknown) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Cookie: `sid=${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, data: (await response.json()) as any }
  }
  const settingsPath = () => `/api/account-settings/${tenantId}/services`
  const createChild = (name = "Medicare Advantage") =>
    request(settingsPath(), "POST", {
      kind: "OFFERING",
      parentServiceId: parentId,
      name,
      basePriceCents: 10000,
    })

  test("creates offerings and exposes their parent and the parent's child count", async () => {
    const child = await createChild()
    assert.equal(child.status, 201)
    assert.equal(child.data.service.parentService.id, parentId)
    const parent = await request(`${settingsPath()}/${parentId}`)
    assert.equal(parent.data.service.kind, "GROUP")
    assert.equal(parent.data.service.subServiceCount, 1)
    const groups = await request(`${settingsPath()}?kind=GROUP&search=Advantage`)
    assert.deepEqual(
      groups.data.items.map((item: any) => item.id),
      [parentId],
    )
    const children = await request(`${settingsPath()}?kind=OFFERING&parentServiceId=${parentId}`)
    assert.deepEqual(
      children.data.items.map((item: any) => item.id),
      [child.data.service.id],
    )
  })

  test("rejects missing parents, nested parents, child-as-parent, and cross-tenant parents", async () => {
    assert.equal(
      (
        await request(settingsPath(), "POST", {
          kind: "OFFERING",
          name: "Missing",
          basePriceCents: 0,
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await request(settingsPath(), "POST", {
          kind: "GROUP",
          parentServiceId: parentId,
          name: "Nested",
          basePriceCents: 0,
        })
      ).status,
      400,
    )
    const child = await createChild()
    const third = await request(settingsPath(), "POST", {
      kind: "OFFERING",
      parentServiceId: child.data.service.id,
      name: "Third level",
      basePriceCents: 0,
    })
    assert.equal(third.status, 400)
    assert.equal(third.data.error, "INVALID_PARENT_SERVICE")
    const other = await db.tenant.create({ data: { name: "Other tenant", slug: randomUUID() } })
    try {
      const foreign = await db.service.create({
        data: { tenantId: other.id, name: "Other group", basePriceCents: 0 },
      })
      const result = await request(settingsPath(), "POST", {
        kind: "OFFERING",
        parentServiceId: foreign.id,
        name: "Cross tenant",
        basePriceCents: 0,
      })
      assert.equal(result.status, 400)
      assert.equal(result.data.error, "INVALID_PARENT_SERVICE")
    } finally {
      await db.tenant.delete({ where: { id: other.id } })
    }
    await assert.rejects(
      db.service.create({
        data: {
          tenantId,
          kind: "OFFERING",
          parentServiceId: child.data.service.id,
          name: "Invalid SQL child",
          basePriceCents: 0,
        },
      }),
    )
  })

  test("only active sub-services of active parents are enrollable and offered in pickers", async () => {
    const child = await createChild()
    const childId = child.data.service.id
    await assert.rejects(
      db.$transaction((tx) => assertServiceEnrollableTx(tx, tenantId, parentId)),
      /SUB_SERVICE_REQUIRED/,
    )
    await db.$transaction((tx) => assertServiceEnrollableTx(tx, tenantId, childId))
    const options = await request(`/api/services/${tenantId}/options`)
    assert.deepEqual(
      options.data.items.map((item: any) => item.id),
      [childId],
    )
    const adminOptions = await request(`${settingsPath()}/options`)
    assert.deepEqual(
      adminOptions.data.items.map((item: any) => item.id),
      [childId],
    )
    const status = await db.contactStatusConfig.create({
      data: { tenantId, name: "Active", bgColor: "#fff", textColor: "#000" },
    })
    const contact = await db.contact.create({
      data: { tenantId, firstName: "Test", lastName: "Contact", statusConfigId: status.id },
    })
    const enrollmentPath = `/api/services/${tenantId}/contact-services`
    const rejected = await request(enrollmentPath, "POST", {
      contactId: contact.id,
      serviceId: parentId,
    })
    assert.equal(rejected.status, 400)
    assert.equal(rejected.data.error, "SUB_SERVICE_REQUIRED")
    const enrolled = await request(enrollmentPath, "POST", {
      contactId: contact.id,
      serviceId: childId,
    })
    assert.equal(enrolled.status, 201)
    await request(`${settingsPath()}/${parentId}`, "PATCH", { isActive: false })
    assert.equal((await request(`/api/services/${tenantId}/options`)).data.items.length, 0)
    assert.equal((await request(`${settingsPath()}/options`)).data.items.length, 0)
    assert.equal(
      (await request(enrollmentPath, "POST", { contactId: contact.id, serviceId: childId })).status,
      400,
    )
    assert.ok(
      await db.contactService.findUnique({ where: { id: enrolled.data.contactService.id } }),
    )
  })

  test("rejects retyping/reparenting and deleting nonempty parent services", async () => {
    const child = await createChild()
    assert.equal(
      (await request(`${settingsPath()}/${child.data.service.id}`, "PATCH", { kind: "GROUP" }))
        .status,
      400,
    )
    assert.equal(
      (
        await request(`${settingsPath()}/${child.data.service.id}`, "PATCH", {
          parentServiceId: null,
        })
      ).status,
      400,
    )
    const deletion = await request(`${settingsPath()}/${parentId}`, "DELETE")
    assert.equal(deletion.status, 409)
    assert.equal(deletion.data.error, "SERVICE_HAS_SUB_SERVICES")
    assert.equal(await db.service.count({ where: { tenantId } }), 2)
  })

  async function configureParent() {
    const saved = await request(`${settingsPath()}/${parentId}`, "PATCH", {
      basePriceCents: 12000,
      currency: "USD",
      isTaxExempt: false,
      allowPartialPayments: true,
      minimumPartialPaymentCents: 2000,
      installmentCount: 4,
      installmentFrequency: "MONTHLY",
      checklistItems: [{ label: "Consent", description: "Signed form", isRequired: true }],
      professionals: [{ kind: "EXTERNAL", externalProfessionalName: "Parent specialist" }],
    })
    assert.equal(saved.status, 200, JSON.stringify(saved.data))
    return saved.data.service
  }
  async function createContact() {
    const status = await db.contactStatusConfig.create({
      data: { tenantId, name: randomUUID(), bgColor: "#fff", textColor: "#000" },
    })
    return db.contact.create({
      data: { tenantId, firstName: "Inheritance", lastName: "Tester", statusConfigId: status.id },
    })
  }

  test("billing inherits the whole section, customizes by copying, and restores current parent terms", async () => {
    await configureParent()
    const child = (await createChild()).data.service
    assert.equal(child.billingMode, "INHERIT")
    assert.equal(child.basePriceCents, 12000)
    assert.equal(child.installmentFrequency, "MONTHLY")
    const custom = await request(`${settingsPath()}/${child.id}`, "PATCH", {
      billingMode: "CUSTOM",
    })
    assert.equal(custom.status, 200)
    assert.equal(custom.data.service.minimumPartialPaymentCents, 2000)
    assert.equal(
      (await request(`${settingsPath()}/${child.id}`, "PATCH", { basePriceCents: 15000 })).status,
      200,
    )
    assert.equal(
      (
        await request(`${settingsPath()}/${parentId}`, "PATCH", {
          basePriceCents: 22000,
          minimumPartialPaymentCents: 5000,
        })
      ).status,
      200,
    )
    let detail = await request(`${settingsPath()}/${child.id}`)
    assert.equal(detail.data.service.basePriceCents, 15000)
    assert.equal(detail.data.service.minimumPartialPaymentCents, 2000)
    const restored = await request(`${settingsPath()}/${child.id}`, "PATCH", {
      billingMode: "INHERIT",
    })
    assert.equal(restored.data.service.basePriceCents, 22000)
    assert.equal(restored.data.service.minimumPartialPaymentCents, 5000)
    const invalid = await request(`${settingsPath()}/${child.id}`, "PATCH", {
      name: "Should roll back",
      basePriceCents: 3,
    })
    assert.equal(invalid.data.error, "INHERITED_SECTION_READ_ONLY")
    assert.equal((await db.service.findUniqueOrThrow({ where: { id: child.id } })).name, child.name)
    assert.equal(
      (await request(`${settingsPath()}/${parentId}`, "PATCH", { billingMode: "INHERIT" })).data
        .error,
      "PARENT_SECTION_CANNOT_INHERIT",
    )
    assert.equal(
      (
        await request(`${settingsPath()}/${child.id}`, "PATCH", {
          billingMode: "CUSTOM",
          currency: "EUR",
        })
      ).data.error,
      "SECTION_MODE_CHANGE_WITH_VALUES",
    )
    const invalidDeposit = await request(`${settingsPath()}/${parentId}`, "PATCH", {
      basePriceCents: 10,
    })
    assert.equal(invalidDeposit.data.error, "MINIMUM_PARTIAL_EXCEEDS_TOTAL_PRICE")
    assert.equal(
      (await db.service.findUniqueOrThrow({ where: { id: parentId } })).basePriceCents,
      22000,
    )
  })

  test("checklist and professional sections inherit independently and restore without losing enrollment records", async () => {
    const parent = await configureParent()
    const child = (await createChild()).data.service
    const sibling = (await createChild("Medicare Part A")).data.service
    const contact = await createContact()
    const path = `/api/services/${tenantId}/contact-services`
    const enrolled = await request(path, "POST", {
      contactId: contact.id,
      serviceId: child.id,
      assignedProfessionalId: parent.professionals[0].id,
    })
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data))
    const enrollmentId = enrolled.data.contactService.id
    const enrolledItem = await db.contactServiceChecklistItem.findFirstOrThrow({
      where: { contactServiceId: enrollmentId },
    })
    await db.contactServiceChecklistItem.update({
      where: { id: enrolledItem.id },
      data: { status: "RECEIVED", completedAt: new Date() },
    })
    const rejectedCopy = await request(`${settingsPath()}/${child.id}`, "PATCH", {
      checklistMode: "CUSTOM",
      professionalsMode: "CUSTOM",
      professionals: [],
    })
    assert.equal(rejectedCopy.data.error, "SECTION_MODE_CHANGE_WITH_VALUES")
    assert.equal(
      await db.serviceChecklistItem.count({ where: { tenantId, serviceId: child.id } }),
      0,
    )
    assert.equal(
      (await db.service.findUniqueOrThrow({ where: { id: child.id } })).checklistMode,
      "INHERIT",
    )
    const checklistCopy = await request(`${settingsPath()}/${child.id}`, "PATCH", {
      checklistMode: "CUSTOM",
    })
    const localItem = checklistCopy.data.service.checklistItems[0]
    assert.notEqual(localItem.id, parent.checklistItems[0].id)
    assert.equal(localItem.description, "Signed form")
    assert.equal(
      (
        await request(`${settingsPath()}/${child.id}`, "PATCH", {
          checklistItems: [{ ...localItem, label: "Own consent" }],
        })
      ).status,
      200,
    )
    const professionalCopy = await request(`${settingsPath()}/${child.id}`, "PATCH", {
      professionalsMode: "CUSTOM",
    })
    const localProfessional = professionalCopy.data.service.professionals[0]
    assert.notEqual(localProfessional.id, parent.professionals[0].id)
    const changedParent = await request(`${settingsPath()}/${parentId}`, "PATCH", {
      checklistItems: [{ label: "New parent requirement" }],
      professionals: [{ kind: "EXTERNAL", externalProfessionalName: "New parent specialist" }],
    })
    const inheritedSibling = (await request(`${settingsPath()}/${sibling.id}`)).data.service
    assert.equal(inheritedSibling.checklistItems[0].label, "New parent requirement")
    assert.equal(
      inheritedSibling.professionals[0].externalProfessionalName,
      "New parent specialist",
    )
    const own = (await request(`${settingsPath()}/${child.id}`)).data.service
    assert.equal(own.checklistItems[0].label, "Own consent")
    assert.equal(own.professionals[0].externalProfessionalName, "Parent specialist")
    // Original archived parent assignment may remain, but cannot be assigned elsewhere.
    assert.equal(
      (
        await request(`${path}/${enrollmentId}`, "PATCH", {
          assignedProfessionalId: parent.professionals[0].id,
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await request(path, "POST", {
          contactId: contact.id,
          serviceId: sibling.id,
          assignedProfessionalId: parent.professionals[0].id,
        })
      ).data.error,
      "INVALID_ASSIGNED_SERVICE_PROFESSIONAL",
    )
    assert.equal(
      (
        await request(`${path}/${enrollmentId}`, "PATCH", {
          assignedProfessionalId: localProfessional.id,
        })
      ).status,
      400,
    )
    const localEnrollment = await request(path, "POST", {
      contactId: contact.id,
      serviceId: child.id,
      assignedProfessionalId: localProfessional.id,
    })
    assert.equal(localEnrollment.status, 201)
    const localEnrollmentId = localEnrollment.data.contactService.id
    const restore = await request(`${settingsPath()}/${child.id}`, "PATCH", {
      checklistMode: "INHERIT",
      professionalsMode: "INHERIT",
    })
    assert.equal(restore.status, 200)
    assert.equal(
      restore.data.service.checklistItems[0].id,
      changedParent.data.service.checklistItems[0].id,
    )
    assert.ok(
      (await db.serviceProfessional.findUniqueOrThrow({ where: { id: localProfessional.id } }))
        .archivedAt,
    )
    assert.ok(
      (await db.serviceChecklistItem.findUniqueOrThrow({ where: { id: localItem.id } })).archivedAt,
    )
    const history = await db.contactServiceChecklistItem.findUniqueOrThrow({
      where: { id: enrolledItem.id },
    })
    assert.equal(history.status, "RECEIVED")
    assert.ok(history.completedAt)
    assert.equal(
      (await db.contactService.findUniqueOrThrow({ where: { id: localEnrollmentId } }))
        .assignedProfessionalId,
      localProfessional.id,
    )
    assert.equal(
      (
        await request(`${path}/${localEnrollmentId}`, "PATCH", {
          assignedProfessionalId: localProfessional.id,
        })
      ).status,
      200,
    )
    const catalog = await request(`/api/services/${tenantId}/catalog/${child.id}`)
    assert.equal(
      catalog.data.service.professionals[0].id,
      changedParent.data.service.professionals[0].id,
    )
    const options = await request(`${settingsPath()}/options`)
    assert.equal(options.data.items.find((item: any) => item.id === child.id).checklistCount, 1)
    assert.equal(
      (await request(`${settingsPath()}/${child.id}`, "PATCH", { checklistItems: [] })).data.error,
      "INHERITED_SECTION_READ_ONLY",
    )
    // Parent IDs cannot be submitted as owned IDs after customization.
    await request(`${settingsPath()}/${child.id}`, "PATCH", { checklistMode: "CUSTOM" })
    assert.equal(
      (
        await request(`${settingsPath()}/${child.id}`, "PATCH", {
          checklistItems: [changedParent.data.service.checklistItems[0]],
        })
      ).data.error,
      "INVALID_CHECKLIST_ITEM_ID",
    )
  })

  test("enrollment snapshots inherited billing for later payment validation and purchase displays", async () => {
    await configureParent()
    await db.tenant.update({
      where: { id: tenantId },
      data: { taxEnabled: true, defaultTaxRateBps: 1000, taxLabel: "Sales tax" },
    })
    const child = (await createChild()).data.service
    const contact = await createContact()
    const path = `/api/services/${tenantId}/contact-services`
    const old = await request(path, "POST", {
      contactId: contact.id,
      serviceId: child.id,
      initialPaymentCents: 2000,
    })
    assert.equal(old.status, 201, JSON.stringify(old.data))
    const oldId = old.data.contactService.id
    const stored = await db.contactService.findUniqueOrThrow({ where: { id: oldId } })
    assert.equal(stored.totalPriceCents, 13200)
    assert.equal((stored.billingSnapshot as any).installmentCount, 4)
    await request(`${settingsPath()}/${parentId}`, "PATCH", {
      basePriceCents: 30000,
      minimumPartialPaymentCents: 9000,
      installmentCount: 6,
      installmentFrequency: "WEEKLY",
    })
    await db.tenant.update({
      where: { id: tenantId },
      data: { taxEnabled: false, defaultTaxRateBps: 0 },
    })
    const fresh = await request(path, "POST", {
      contactId: contact.id,
      serviceId: child.id,
      initialPaymentCents: 9000,
    })
    assert.equal(fresh.status, 201, JSON.stringify(fresh.data))
    assert.equal(
      (await db.contactService.findUniqueOrThrow({ where: { id: fresh.data.contactService.id } }))
        .totalPriceCents,
      30000,
    )
    assert.equal(
      (await request(`${path}/${oldId}/payments`, "POST", { amountCents: 2000 })).status,
      201,
    )
    const overview = await request(`${path}/${oldId}/overview`)
    assert.equal(overview.status, 200, JSON.stringify(overview.data))
    assert.equal(overview.data.contactService.totalPriceCents, 13200)
    assert.equal(overview.data.contactService.service.basePriceCents, 12000)
    assert.equal(overview.data.contactService.service.minimumPartialPaymentCents, 2000)
    assert.equal(overview.data.contactService.service.installmentFrequency, "MONTHLY")
    assert.equal(overview.data.contactService.tenantBilling.defaultTaxRatePercent, 10)
    const invalid = await request(path, "POST", {
      contactId: contact.id,
      serviceId: child.id,
      initialPaymentCents: 2000,
    })
    assert.equal(invalid.data.error, "PAYMENT_BELOW_MINIMUM")
    assert.equal(await db.contactService.count({ where: { tenantId } }), 2)
  })

  test("service-owned steps save by stable ID, archive removals, inherit, copy, and restore", async () => {
    const parent = await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [
        {
          title: "Review documents",
          instructions: "Read each document.",
          completionDuration: 10,
          completionUnit: "MINUTES",
        },
        {
          title: "Submit",
          instructions: "Submit the application.",
          completionDuration: 2,
          completionUnit: "HOURS",
        },
      ],
    })
    assert.equal(parent.status, 200, JSON.stringify(parent.data))
    const original = parent.data.service.steps
    const child = (await createChild()).data.service
    assert.equal(child.stepsMode, "INHERIT")
    assert.deepEqual(
      child.steps.map((step: any) => step.id),
      original.map((step: any) => step.id),
    )
    const denied = await request(`${settingsPath()}/${child.id}`, "PATCH", {
      name: "Should roll back",
      steps: [],
    })
    assert.equal(denied.data.error, "INHERITED_SECTION_READ_ONLY")
    assert.equal((await db.service.findUniqueOrThrow({ where: { id: child.id } })).name, child.name)
    const reordered = await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [original[1], { ...original[0], title: "Review updated" }],
    })
    assert.deepEqual(
      reordered.data.service.steps.map((step: any) => step.id),
      [original[1].id, original[0].id],
    )
    const duplicate = await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [original[0], original[0]],
      description: "Should roll back",
    })
    assert.equal(duplicate.data.error, "DUPLICATE_SERVICE_STEP_ID")
    assert.equal(
      (await db.service.findUniqueOrThrow({ where: { id: parentId } })).description,
      null,
    )
    const copy = await request(`${settingsPath()}/${child.id}`, "PATCH", { stepsMode: "CUSTOM" })
    assert.notEqual(copy.data.service.steps[0].id, original[1].id)
    assert.equal(copy.data.service.steps[0].completionUnit, "HOURS")
    const foreign = await request(`${settingsPath()}/${child.id}`, "PATCH", { steps: original })
    assert.equal(foreign.data.error, "INVALID_SERVICE_STEP_ID")
    const changed = await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [{ ...original[0], title: "Parent changed" }],
    })
    assert.equal(changed.status, 200)
    assert.ok(
      (await db.serviceStep.findUniqueOrThrow({ where: { id: original[1].id } })).archivedAt,
    )
    assert.equal(
      (await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [original[1]] })).data
        .error,
      "INVALID_SERVICE_STEP_ID",
    )
    assert.equal((await request(`${settingsPath()}/${child.id}`)).data.service.steps.length, 2)
    const restored = await request(`${settingsPath()}/${child.id}`, "PATCH", {
      stepsMode: "INHERIT",
    })
    assert.equal(restored.data.service.steps[0].title, "Parent changed")
    assert.equal(
      await db.serviceStep.count({ where: { tenantId, serviceId: child.id, archivedAt: null } }),
      0,
    )
    assert.equal(
      (await request(`${settingsPath()}/${parentId}`, "PATCH", { stepsMode: "INHERIT" })).data
        .error,
      "PARENT_SECTION_CANNOT_INHERIT",
    )
  })

  test("enrollment freezes step definitions, checklist details, and professional attribution through later edits", async () => {
    const parent = await configureParent()
    const saved = await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [
        {
          title: "Review",
          instructions: "Original instructions",
          completionDuration: 2,
          completionUnit: "HOURS",
        },
        { title: "Submit", instructions: null, completionDuration: 3, completionUnit: "DAYS" },
      ],
    })
    const child = (await createChild()).data.service
    const contact = await createContact()
    const path = `/api/services/${tenantId}/contact-services`
    const startedAt = "2026-10-20T10:00:00.000Z"
    const beforeEnrollmentAt = Date.now()
    const enrollment = await request(path, "POST", {
      serviceId: child.id,
      contactId: contact.id,
      startedAt,
      assignedProfessionalId: parent.professionals[0].id,
    })
    assert.equal(enrollment.status, 201, JSON.stringify(enrollment.data))
    const enrollmentId = enrollment.data.contactService.id
    const before = await request(`${path}/${enrollmentId}/overview`)
    assert.equal(before.status, 200, JSON.stringify(before.data))
    const setup = before.data.contactService
    assert.equal(setup.workflowKind, "SERVICE_STEPS")
    assert.equal(setup.status, "IN_PROGRESS")
    assert.equal(setup.serviceSteps.length, 2)
    const entered = new Date(setup.serviceSteps[0].occurrences[0].enteredAt).getTime()
    assert.ok(entered >= beforeEnrollmentAt && entered <= Date.now())
    assert.equal(
      new Date(setup.serviceSteps[0].occurrences[0].dueAt).getTime() - entered,
      2 * 60 * 60 * 1000,
    )
    assert.equal(setup.serviceSteps[1].occurrences.length, 0)
    assert.equal(
      await db.contactServiceFollowUpStep.count({ where: { contactServiceId: enrollmentId } }),
      0,
    )
    await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [
        { ...saved.data.service.steps[1], title: "Parent second first", completionDuration: 10 },
        { ...saved.data.service.steps[0], instructions: "Changed instructions" },
      ],
      checklistItems: [
        {
          ...parent.checklistItems[0],
          label: "Renamed requirement",
          description: null,
          isRequired: false,
        },
        { label: "New requirement" },
      ],
      professionals: [
        {
          ...parent.professionals[0],
          externalProfessionalName: "Renamed specialist",
          externalContact: "Changed contact",
        },
      ],
    })
    for (const suffix of ["/overview", "", "/transaction", "/follow-up"]) {
      const view = await request(`${path}/${enrollmentId}${suffix}`)
      assert.equal(view.status, 200, JSON.stringify(view.data))
      assert.equal(
        view.data.contactService.assignedProfessional.externalProfessionalName,
        "Parent specialist",
      )
      assert.equal(view.data.contactService.serviceSteps[0].instructions, "Original instructions")
      assert.equal(
        view.data.contactService.serviceSteps[0].occurrences[0].id,
        setup.serviceSteps[0].occurrences[0].id,
      )
      if (suffix === "/overview") {
        assert.equal(view.data.contactService.checklistSummary.items.length, 1)
        assert.equal(view.data.contactService.checklistSummary.items[0].label, "Consent")
        assert.equal(view.data.contactService.checklistSummary.items[0].description, "Signed form")
        assert.equal(view.data.contactService.checklistSummary.items[0].isRequired, true)
      }
    }
    const item = setup.checklistSummary.items[0]
    const status = await request(`${path}/${enrollmentId}/checklist-items/${item.id}`, "PATCH", {
      status: "RECEIVED",
    })
    assert.equal(status.status, 200)
    assert.equal(status.data.checklistItem.label, "Consent")
    assert.equal(status.data.activity.label, "Consent")
    const listed = await request(`${path}?contactId=${contact.id}`)
    assert.equal(listed.status, 200)
    assert.equal(
      await db.contactServiceChecklistItem.count({ where: { contactServiceId: enrollmentId } }),
      1,
    )
    const fresh = await request(path, "POST", { serviceId: child.id, contactId: contact.id })
    const latest = await request(`${path}/${fresh.data.contactService.id}/overview`)
    assert.equal(latest.data.contactService.serviceSteps[0].title, "Parent second first")
    assert.equal(latest.data.contactService.checklistSummary.items.length, 2)
    const legacyAdd = await request(`${path}/${enrollmentId}/follow-up-steps`, "POST", {
      title: "Legacy step",
    })
    assert.equal(legacyAdd.status, 409)
    const snapshotBefore = await db.contactService.findUniqueOrThrow({
      where: { id: enrollmentId },
      select: { configurationSnapshot: true },
    })
    await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [],
      checklistItems: [],
      professionals: [],
    })
    assert.deepEqual(
      (
        await db.contactService.findUniqueOrThrow({
          where: { id: enrollmentId },
          select: { configurationSnapshot: true },
        })
      ).configurationSnapshot,
      snapshotBefore.configurationSnapshot,
    )
    assert.equal(
      (await request(`${path}/${enrollmentId}/overview`)).data.contactService.serviceSteps.length,
      2,
    )
  })

  test("step entry is isolated, idempotent, serialized, and retains history on a revisit", async () => {
    await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [{ title: "Review", completionDuration: 30, completionUnit: "MINUTES" }],
    })
    const child = (await createChild()).data.service
    const contact = await createContact()
    const path = `/api/services/${tenantId}/contact-services`
    const enrolled = await request(path, "POST", {
      serviceId: child.id,
      contactId: contact.id,
      startedAt: "2026-10-20T10:00:00.000Z",
    })
    const enrollmentId = enrolled.data.contactService.id
    const definition = await db.contactServiceStep.findFirstOrThrow({
      where: { contactServiceId: enrollmentId },
    })
    const first = await db.serviceStepOccurrence.findFirstOrThrow({
      where: { contactServiceId: enrollmentId },
    })
    assert.equal(first.dueAt.getTime() - first.enteredAt.getTime(), 30 * 60 * 1000)
    const duplicate = await db.$transaction((tx) =>
      createServiceStepOccurrenceTx(tx, {
        tenantId,
        contactServiceId: enrollmentId,
        stepId: definition.id,
        entryKey: "enrollment",
        enteredAt: new Date(),
      }),
    )
    assert.equal(duplicate.id, first.id)
    await assert.rejects(
      db.$transaction((tx) =>
        createServiceStepOccurrenceTx(tx, {
          tenantId,
          contactServiceId: enrollmentId,
          stepId: definition.id,
          entryKey: "blocked",
          enteredAt: new Date(),
        }),
      ),
      /CURRENT_SERVICE_STEP_UNRESOLVED/,
    )
    await db.serviceStepOccurrence.update({
      where: { id: first.id },
      data: {
        status: "COMPLETED",
        resolvedAt: new Date(first.enteredAt.getTime() + 60 * 60 * 1000),
        resolutionReason: "Reviewed",
      },
    })
    const attempts = await Promise.allSettled(
      ["revisit-a", "revisit-b"].map((entryKey) =>
        db.$transaction((tx) =>
          createServiceStepOccurrenceTx(tx, {
            tenantId,
            contactServiceId: enrollmentId,
            stepId: definition.id,
            entryKey,
            enteredAt: new Date(first.enteredAt.getTime() + 26 * 60 * 60 * 1000),
          }),
        ),
      ),
    )
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1)
    const history = await db.serviceStepOccurrence.findMany({
      where: { stepId: definition.id },
      orderBy: { occurrenceNumber: "asc" },
    })
    assert.equal(history.length, 2)
    assert.equal(history[0].status, "COMPLETED")
    assert.equal(history[0].resolutionReason, "Reviewed")
    assert.equal(history[1].occurrenceNumber, 2)
    assert.equal(history[1].dueAt.getTime(), first.enteredAt.getTime() + (26 * 60 + 30) * 60 * 1000)
    const other = await request(path, "POST", { serviceId: child.id, contactId: contact.id })
    await assert.rejects(
      db.$transaction((tx) =>
        createServiceStepOccurrenceTx(tx, {
          tenantId,
          contactServiceId: other.data.contactService.id,
          stepId: definition.id,
          entryKey: "foreign-step",
          enteredAt: new Date(),
        }),
      ),
      /INVALID_ENROLLED_SERVICE_STEP/,
    )
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
      await client.query(
        readFileSync(
          resolve(
            __dirname,
            "../../prisma/migrations/20261019200000_service_hierarchy/migration.sql",
          ),
          "utf8",
        ),
      )
      const result = await client.query(`SELECT child.*, parent."name" AS "parentName"
        FROM "Service" child JOIN "Service" parent ON parent."id" = child."parentServiceId"
        WHERE child."id" = 'old-service'`)
      assert.equal(result.rows[0].name, "Existing services")
      assert.equal(result.rows[0].basePriceCents, 12345)
      assert.equal(result.rows[0].kind, "OFFERING")
      assert.equal(result.rows[0].parentName, "Existing services (2)")
      assert.equal(
        (
          await client.query(
            `SELECT "serviceId" FROM "ContactService" WHERE "id" = 'old-enrollment'`,
          )
        ).rows[0].serviceId,
        "old-service",
      )
    } finally {
      await client.query("ROLLBACK")
      client.release()
      await pool.end()
    }
  })
})
