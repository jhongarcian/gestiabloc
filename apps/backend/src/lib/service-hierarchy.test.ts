import { reconcileServiceStepEnrollmentTx } from "./service-step-progression.js"
import { moveServiceStepTx } from "./service-step-movement.js"
import { changeServiceStepCompletionWaitTx } from "./service-step-waits.js"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Server } from "node:http"
import { after, afterEach, before, beforeEach, describe, test } from "node:test"
import express from "express"
import cookieParser from "cookie-parser"
import { Pool } from "pg"
import { Prisma, PrismaClient } from "../generated/prisma/index.js"
import {
  resolveAutomationServiceContextTx,
  AutomationServiceContextError,
} from "./automation-service-context.js"
import {
  queueContactNoteAddedAutomationEvent,
  processClaimedAutomationEvent,
  getAutomationEventStatus,
} from "./automation-event-queue.js"
import {
  executeAutomationSegmentTx,
  parseActionSnapshot,
  getAutomationRuntimeCatalog,
  resumeDueAutomationRuns,
  resumeAutomationRun,
} from "./opportunity-automations.js"
import { getAutomationWaitingRuns, exitAutomationWaitingRun } from "./automation-waiting-runs.js"
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
    app.use(
      "/api/account-settings",
      (
        require("../routes/automations.routes.js") as typeof import("../routes/automations.routes.js")
      ).default,
    )
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

  test("automation service context stays isolated through dispatch, waits, restart, chaining, logs, and removal", async () => {
    await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [{ title: "Review", completionDuration: 2, completionUnit: "DAYS" }],
    })
    const child = await createChild()
    const contact = await createContact()
    const path = `/api/services/${tenantId}/contact-services`
    const enrollmentIds: string[] = []
    for (let i = 0; i < 2; i++) {
      const response = await request(path, "POST", {
        contactId: contact.id,
        serviceId: child.data.service.id,
      })
      assert.equal(response.status, 201, JSON.stringify(response.data))
      enrollmentIds.push(response.data.contactService.id)
    }
    const contexts = await Promise.all(
      enrollmentIds.map(async (contactServiceId) => {
        const step = await db.contactServiceStep.findFirstOrThrow({
          where: { tenantId, contactServiceId },
        })
        const occurrence = await db.serviceStepOccurrence.findFirstOrThrow({
          where: { tenantId, contactServiceId },
        })
        return resolveAutomationServiceContextTx(db, {
          tenantId,
          contactId: contact.id,
          contactServiceId,
          contactServiceStepId: step.id,
          serviceStepOccurrenceId: occurrence.id,
        })
      }),
    )
    const waitKey = randomUUID()
    const chainedWaitKey = randomUUID()
    const target = await db.automation.create({
      data: {
        tenantId,
        name: "Chained context",
        triggerType: "CONTACT_CREATED",
        isEnabled: true,
        actions: {
          create: [
            {
              tenantId,
              nodeKey: chainedWaitKey,
              type: "WAIT",
              waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" },
            },
          ],
        },
      },
    })
    const automation = await db.automation.create({
      data: {
        tenantId,
        name: "Enrollment context",
        triggerType: "CONTACT_NOTE_ADDED",
        isEnabled: true,
        actions: {
          create: [
            {
              tenantId,
              nodeKey: waitKey,
              type: "WAIT",
              waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" },
              sortOrder: 10,
            },
            {
              tenantId,
              nodeKey: randomUUID(),
              type: "ADD_TO_WORKFLOW",
              addToWorkflowConfig: {
                actionName: "Continue",
                targetAutomationId: target.id,
                targetAutomationNameSnapshot: target.name,
              },
              sortOrder: 20,
            },
          ],
        },
      },
    })
    const queue = (serviceContext: (typeof contexts)[number], causationKey = randomUUID()) =>
      db.$transaction((tx) =>
        queueContactNoteAddedAutomationEvent(tx, {
          tenantId,
          contactId: contact.id,
          actorUserId: userId,
          serviceContext,
          causationKey,
        }),
      )
    const causationKey = randomUUID()
    const first = await queue(contexts[0]!, causationKey)
    assert.equal(
      (await queue(contexts[0]!, causationKey)).automationEventId,
      first.automationEventId,
    )
    await assert.rejects(queue(contexts[1]!, causationKey), AutomationServiceContextError)
    await assert.rejects(
      queue({ ...contexts[0]!, serviceStepOccurrenceId: contexts[1]!.serviceStepOccurrenceId }),
      AutomationServiceContextError,
    )
    // Archiving live configuration cannot change the saved step identifiers carried by a run.
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [] })
    const second = await queue(contexts[1]!)
    for (const queued of [first, second]) {
      const leaseToken = randomUUID()
      await db.automationEvent.update({
        where: { id: queued.automationEventId! },
        data: { status: "PROCESSING", leaseToken },
      })
      await processClaimedAutomationEvent(db, { eventId: queued.automationEventId!, leaseToken })
    }
    const runs = await db.automationRun.findMany({
      where: { tenantId, automationId: automation.id },
      orderBy: { createdAt: "asc" },
    })
    assert.equal(runs.length, 2)
    assert.deepEqual(
      runs.map((run) => run.serviceContext),
      contexts,
    )
    assert.ok(runs.every((run) => run.status === "WAITING"))
    const waiting = await getAutomationWaitingRuns(db, {
      tenantId,
      automationId: automation.id,
      nodeKey: waitKey,
      page: 1,
    })
    assert.deepEqual(
      new Set(waiting.items.map((row: any) => row.serviceContext.contactServiceId)),
      new Set(enrollmentIds),
    )
    const status = await getAutomationEventStatus(db, tenantId, first.automationEventId!)
    assert.ok(status)
    assert.deepEqual(status.serviceContext, contexts[0])
    const logs = await request(
      `/api/account-settings/${tenantId}/automations/${automation.id}/execution-logs`,
    )
    assert.equal(logs.status, 200)
    assert.equal(logs.data.items.length, 4)
    for (const row of logs.data.items) {
      assert.deepEqual(
        row.serviceContext,
        contexts[runs.findIndex((run) => run.attemptId === row.attemptId)],
      )
    }

    const filtered = await request(
      `/api/account-settings/${tenantId}/automations/${automation.id}/execution-logs?contactServiceId=${enrollmentIds[0]}&serviceStepOccurrenceId=${contexts[0]!.serviceStepOccurrenceId}`,
    )
    assert.equal(filtered.status, 200)
    assert.equal(filtered.data.items.length, 2)
    assert.ok(
      filtered.data.items.every(
        (row: any) => row.serviceContext.contactServiceId === enrollmentIds[0],
      ),
    )
    const mismatched = await request(
      `/api/account-settings/${tenantId}/automations/${automation.id}/execution-logs?contactServiceId=${enrollmentIds[0]}&serviceStepOccurrenceId=${contexts[1]!.serviceStepOccurrenceId}`,
    )
    assert.equal(mismatched.data.items.length, 0)
    const unknown = await request(
      `/api/account-settings/${tenantId}/automations/${automation.id}/execution-logs?contactServiceId=${randomUUID()}`,
    )
    assert.equal(unknown.data.items.length, 0)

    // Reload from storage as a fresh execution segment; the contact's other enrollment is not consulted.
    const resumed = await db.automationRun.update({
      where: { id: runs[0]!.id },
      data: { status: "RUNNING" },
    })
    const result = await db.$transaction(async (tx) => {
      const segment = await executeAutomationSegmentTx(tx, {
        run: resumed,
        actions: parseActionSnapshot(resumed.actionSnapshot),
        catalog: await getAutomationRuntimeCatalog(tx, tenantId),
        startIndex: resumed.cursorIndex,
      })
      await tx.automationNodeExecution.createMany({
        data: segment.logs.map((row) => ({ ...row, branchPath: row.branchPath ?? Prisma.DbNull })),
      })
      return segment
    })
    assert.equal(result.status, "SUCCEEDED")
    const chained = await db.automationRun.findFirstOrThrow({
      where: { tenantId, automationId: target.id },
    })
    assert.deepEqual(chained.serviceContext, contexts[0])
    // The actual worker reloads the queued child, waits, then resumes its pinned enrollment context.
    await resumeDueAutomationRuns(db)
    const childWaiting = await db.automationRun.findUniqueOrThrow({ where: { id: chained.id } })
    assert.equal(childWaiting.status, "WAITING")
    assert.deepEqual(childWaiting.serviceContext, contexts[0])
    await db.automationRun.update({
      where: { id: chained.id },
      data: { resumeAt: new Date(Date.now() - 1000) },
    })
    await resumeDueAutomationRuns(db)
    assert.equal(
      (await db.automationRun.findUniqueOrThrow({ where: { id: chained.id } })).status,
      "SUCCEEDED",
    )
    const childLogs = await db.automationNodeExecution.findMany({
      where: { tenantId, attemptId: chained.attemptId },
    })
    assert.ok(childLogs.length >= 2)
    for (const row of childLogs) assert.deepEqual(row.serviceContext, contexts[0])

    await exitAutomationWaitingRun(db, {
      tenantId,
      automationId: automation.id,
      nodeKey: waitKey,
      runId: runs[1]!.id,
      actorUserId: userId,
      actorDisplayName: "Tester",
    })
    const summary = await db.automationExecution.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    })
    assert.equal(summary.length, 3)
    assert.deepEqual(
      summary.map((row) => row.serviceContext),
      [contexts[0], contexts[0], contexts[1]],
    )
    const exitedLogs = await db.automationNodeExecution.findMany({
      where: { tenantId, attemptId: runs[1]!.attemptId },
    })
    for (const row of exitedLogs) assert.deepEqual(row.serviceContext, contexts[1])
  })

  test("invalid service context rolls back a queued event and fails resumed work before actions", async () => {
    const child = await createChild()
    const contact = await createContact()
    const enrollment = await db.contactService.create({
      data: {
        tenantId,
        contactId: contact.id,
        serviceId: child.data.service.id,
        totalPriceCents: 0,
      },
    })
    const context = await resolveAutomationServiceContextTx(db, {
      tenantId,
      contactId: contact.id,
      contactServiceId: enrollment.id,
    })
    const automation = await db.automation.create({
      data: {
        tenantId,
        name: "Context safety",
        triggerType: "CONTACT_NOTE_ADDED",
        isEnabled: true,
        actions: {
          create: [
            {
              tenantId,
              nodeKey: randomUUID(),
              type: "ADD_CONTACT_NOTE",
              noteTitle: "Must not run",
              noteBody: "Invalid context",
            },
          ],
        },
      },
    })
    const before = await db.automationEvent.count({ where: { tenantId } })
    await assert.rejects(
      db.$transaction((tx) =>
        queueContactNoteAddedAutomationEvent(tx, {
          tenantId,
          contactId: contact.id,
          actorUserId: userId,
          serviceContext: { ...context, contactServiceId: randomUUID() },
        }),
      ),
      AutomationServiceContextError,
    )
    assert.equal(await db.automationEvent.count({ where: { tenantId } }), before)
    const pinned = await db.automationAction.findMany({
      where: { tenantId, automationId: automation.id },
    })
    const { automationActionSnapshot } = await import("./opportunity-automations.js")
    const run = await db.automationRun.create({
      data: {
        tenantId,
        contactId: contact.id,
        contactName: "Tester",
        automationId: automation.id,
        automationName: automation.name,
        actorUserId: userId,
        attemptId: randomUUID(),
        eventSource: "AUTOMATION_ACTION",
        triggerType: "CONTACT_NOTE_ADDED",
        actionSnapshot: pinned.map(automationActionSnapshot) as any,
        status: "QUEUED",
        serviceContext: { ...context, serviceId: randomUUID() },
      },
    })
    await resumeDueAutomationRuns(db)
    const failed = await db.automationRun.findUniqueOrThrow({ where: { id: run.id } })
    assert.equal(failed.status, "FAILED")
    assert.equal(failed.failureCode, "INVALID_SERVICE_CONTEXT")
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Must not run" } }), 0)
    const failure = await db.automationNodeExecution.findFirstOrThrow({
      where: { tenantId, attemptId: run.attemptId },
    })
    assert.deepEqual(failure.serviceContext, run.serviceContext)
  })

  test("every service step owns one disabled entry draft and preserves its identity through saves", async () => {
    const initial = await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [{ title: "Review" }, { title: "Submit" }],
    })
    assert.equal(initial.status, 200)
    const steps = initial.data.service.steps
    assert.equal(steps.length, 2)
    for (const step of steps) {
      assert.equal(step.automations.length, 2)
      assert.equal(step.automations[0].isEnabled, false)
      assert.equal(step.automations[0]._count.actions, 0)
    }
    const first = steps[0]
    const automationPath = `/api/account-settings/${tenantId}/automations/${first.automations[0].id}`
    const loaded = await request(automationPath)
    assert.equal(loaded.data.automation.trigger.type, "SERVICE_STEP_ENTERED")
    assert.equal(loaded.data.automation.trigger.serviceStepId, first.id)
    assert.equal(loaded.data.automation.serviceStep.serviceId, parentId)
    const payload = {
      name: "Review entry",
      trigger: loaded.data.automation.trigger,
      conditions: [],
      actions: [],
      isEnabled: false,
    }
    assert.equal((await request(automationPath, "PATCH", payload)).status, 200)
    assert.equal(
      (await request(automationPath, "PATCH", { ...payload, isEnabled: true })).status,
      400,
    )
    assert.equal(
      (await request(`/api/account-settings/${tenantId}/automations`, "POST", payload)).status,
      400,
    )
    const saved = await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [...steps]
        .reverse()
        .map((step: any) => ({ id: step.id, title: `${step.title} edited` })),
    })
    assert.deepEqual(
      saved.data.service.steps.map((step: any) => step.automations[0].id),
      [...steps].reverse().map((step: any) => step.automations[0].id),
    )
    assert.equal(
      await db.automation.count({ where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" } }),
      2,
    )
    const child = await createChild()
    assert.deepEqual(
      child.data.service.steps.map((step: any) => step.automations[0].id),
      saved.data.service.steps.map((step: any) => step.automations[0].id),
    )
    const customized = await request(`${settingsPath()}/${child.data.service.id}`, "PATCH", {
      stepsMode: "CUSTOM",
    })
    const customIds = customized.data.service.steps.map((step: any) => step.automations[0].id)
    assert.ok(
      customIds.every((id: string) => !steps.some((step: any) => step.automations[0].id === id)),
    )
    assert.ok(customized.data.service.steps.every((step: any) => !step.automations[0].isEnabled))
    const created = await request(settingsPath(), "POST", {
      kind: "GROUP",
      name: "New parent",
      basePriceCents: 0,
      steps: [{ title: "Intake" }, { title: "Intake" }],
    })
    assert.equal(created.status, 201, JSON.stringify(created.data))
    assert.equal(created.data.service.steps[0].automations.length, 2)
    const names = created.data.service.steps.map((step: any) => step.automations[0].name)
    assert.equal(new Set(names).size, 2)
    assert.ok(names.every((name: string) => /^Step entered: Intake(?: \(\d+\))?$/.test(name)))
  })

  test("step entry queues one pinned workflow per occurrence, including inherited enrollments and revisits", async () => {
    const configured = await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [{ title: "Review" }],
    })
    const source = configured.data.service.steps[0]
    const automationId = source.automations[0].id
    const automationPath = `/api/account-settings/${tenantId}/automations/${automationId}`
    const payload = {
      name: "Review entry",
      isEnabled: true,
      trigger: { type: "SERVICE_STEP_ENTERED", serviceStepId: source.id },
      conditions: [],
      actions: [
        {
          nodeKey: randomUUID(),
          type: "ADD_CONTACT_NOTE",
          noteTitle: "Entry action",
          noteBody: "Pinned original instructions",
        },
      ],
    }
    const published = await request(automationPath, "PATCH", payload)
    assert.equal(published.status, 200, JSON.stringify(published.data))
    const child = await createChild()
    const contact = await createContact()
    const enroll = async () => {
      const response = await request(`/api/services/${tenantId}/contact-services`, "POST", {
        serviceId: child.data.service.id,
        contactId: contact.id,
      })
      assert.equal(response.status, 201, JSON.stringify(response.data))
      return response.data.contactService.id as string
    }
    const enrollmentIds = [await enroll(), await enroll()]
    let events = await db.automationEvent.findMany({
      where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" },
      include: { dispatches: true },
      orderBy: { createdAt: "asc" },
    })
    assert.equal(events.length, 2)
    assert.deepEqual(
      events.map((event) => (event.serviceContext as any).contactServiceId),
      enrollmentIds,
    )
    assert.ok(
      events.every((event) => (event.serviceContext as any).serviceId === child.data.service.id),
    )
    const { claimAutomationEvents } = await import("./automation-event-worker.js")
    // Raw queue timestamps are UTC even when the database session uses a local time zone.
    for (const timezone of ["America/Chicago", "UTC"]) {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('TimeZone', ${timezone}, true)`
        const claimed = await claimAutomationEvents(tx)
        assert.equal(claimed.length, 1)
        assert.equal(claimed[0]!.id, events[0]!.id)
        await tx.automationEvent.update({
          where: { id: claimed[0]!.id },
          data: { status: "QUEUED", leaseToken: null, leaseExpiresAt: null },
        })
      })
    }
    const occurrence = await db.serviceStepOccurrence.findFirstOrThrow({
      where: { tenantId, contactServiceId: enrollmentIds[0] },
    })
    await Promise.all(
      [1, 2].map(() =>
        db.$transaction((tx) =>
          createServiceStepOccurrenceTx(tx, {
            tenantId,
            contactServiceId: enrollmentIds[0]!,
            stepId: occurrence.stepId,
            entryKey: "enrollment",
            enteredAt: new Date(),
          }),
        ),
      ),
    )
    assert.equal(await db.automationEvent.count({ where: { tenantId } }), 2)
    // Workflow edits after queueing do not alter pinned actions; step edits do not create events.
    assert.equal(
      (
        await request(automationPath, "PATCH", {
          ...payload,
          actions: [{ ...payload.actions[0], noteBody: "Future instructions" }],
        })
      ).status,
      200,
    )
    await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [{ id: source.id, title: "Review updated" }],
    })
    const process = async (eventId: string) => {
      const leaseToken = randomUUID()
      await db.automationEvent.update({
        where: { id: eventId },
        data: { status: "PROCESSING", leaseToken },
      })
      await processClaimedAutomationEvent(db, { eventId, leaseToken })
      await processClaimedAutomationEvent(db, { eventId, leaseToken })
    }
    for (const event of events) await process(event.id)
    const notes = await db.contactNote.findMany({
      where: { tenantId, contactId: contact.id, title: "Entry action" },
    })
    assert.equal(notes.length, 2)
    assert.ok(notes.every((note) => note.body === "Pinned original instructions"))
    const logs = await db.automationNodeExecution.findMany({ where: { tenantId, automationId } })
    assert.equal(logs.length, 4)
    assert.ok(logs.every((log) => (log.serviceContext as any).serviceStepId === source.id))
    await db.$transaction(async (tx) => {
      await tx.serviceStepOccurrence.update({
        where: { id: occurrence.id },
        data: { status: "COMPLETED", resolvedAt: new Date() },
      })
      await createServiceStepOccurrenceTx(tx, {
        tenantId,
        contactServiceId: enrollmentIds[0]!,
        stepId: occurrence.stepId,
        entryKey: "revisit",
        enteredAt: new Date(),
      })
    })
    events = await db.automationEvent.findMany({
      where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" },
      include: { dispatches: true },
      orderBy: { createdAt: "asc" },
    })
    assert.equal(events.length, 3)
    assert.notEqual((events[2]!.serviceContext as any).serviceStepOccurrenceId, occurrence.id)
    await process(events[2]!.id)
    assert.equal(
      await db.contactNote.count({ where: { tenantId, body: "Future instructions" } }),
      1,
    )

    await assert.rejects(
      db.$transaction(async (tx) => {
        await tx.serviceStepOccurrence.updateMany({
          where: { tenantId, contactServiceId: enrollmentIds[0] },
          data: { status: "COMPLETED", resolvedAt: new Date() },
        })
        await createServiceStepOccurrenceTx(tx, {
          tenantId,
          contactServiceId: enrollmentIds[0]!,
          stepId: occurrence.stepId,
          entryKey: "rolled-back",
          enteredAt: new Date(),
        })
        throw new Error("Roll back entry and event")
      }),
      /Roll back entry/,
    )
    assert.equal(await db.automationEvent.count({ where: { tenantId } }), 3)
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { tenantId, entryKey: "rolled-back" } }),
      0,
    )
    assert.equal(
      (await request(automationPath, "PATCH", { ...payload, isEnabled: false })).status,
      200,
    )
    await enroll()
    assert.equal(await db.automationEvent.count({ where: { tenantId } }), 3)
  })

  test("step entry filters match at entry and disabled or empty workflows create no dispatch", async () => {
    const saved = await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [{ title: "Review" }],
    })
    const source = saved.data.service.steps[0]
    const automationId = source.automations[0].id
    const child = await createChild()
    const contact = await createContact()
    const enroll = () =>
      request(`/api/services/${tenantId}/contact-services`, "POST", {
        serviceId: child.data.service.id,
        contactId: contact.id,
      })
    assert.equal((await enroll()).status, 201)
    assert.equal(await db.automationEvent.count({ where: { tenantId } }), 0)
    const payload = {
      name: "Filtered entry",
      isEnabled: true,
      trigger: { type: "SERVICE_STEP_ENTERED", serviceStepId: source.id },
      conditions: [
        {
          source: "CONTACT_FIELD",
          fieldKey: "first_name",
          operator: "EQUALS",
          compareValue: "Other",
        },
      ],
      actions: [
        {
          nodeKey: randomUUID(),
          type: "WAIT",
          waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" },
        },
      ],
    }
    const updated = await request(
      `/api/account-settings/${tenantId}/automations/${automationId}`,
      "PATCH",
      payload,
    )
    assert.equal(updated.status, 200, JSON.stringify(updated.data))
    assert.equal((await enroll()).status, 201)
    assert.equal(await db.automationEvent.count({ where: { tenantId } }), 0)
    // Even a corrupt enabled-but-empty draft must not queue work.
    await db.automationAction.deleteMany({ where: { tenantId, automationId } })
    assert.equal((await enroll()).status, 201)
    assert.equal(await db.automationEvent.count({ where: { tenantId } }), 0)
  })

  async function completionFixture(actions?: unknown[], conditions: unknown[] = []) {
    const configured = await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [{ title: "Review" }, { title: "Submit" }],
      basePriceCents: 10000,
    })
    assert.equal(configured.status, 200, JSON.stringify(configured.data))
    const source = configured.data.service.steps[0]
    const automation = source.automations.find(
      (item: any) => item.triggerType === "SERVICE_STEP_COMPLETED",
    )
    const automationPath = `/api/account-settings/${tenantId}/automations/${automation.id}`
    const payload = {
      name: "Review completion",
      trigger: {
        type: "SERVICE_STEP_COMPLETED",
        serviceStepId: source.id,
        serviceOfferingId: null,
      },
      isEnabled: Boolean(actions?.length),
      actions: actions ?? [],
      conditions,
    }
    assert.equal((await request(automationPath, "PATCH", payload)).status, 200)
    const child = await createChild()
    const contact = await createContact()
    const enroll = async () => {
      const response = await request(`/api/services/${tenantId}/contact-services`, "POST", {
        serviceId: child.data.service.id,
        contactId: contact.id,
      })
      assert.equal(response.status, 201, JSON.stringify(response.data))
      const id = response.data.contactService.id as string
      const occurrence = await db.serviceStepOccurrence.findFirstOrThrow({
        where: { tenantId, contactServiceId: id, status: "ACTIVE" },
      })
      return { id, occurrence }
    }
    return {
      source,
      automation,
      automationPath,
      payload,
      child,
      contact,
      enroll,
      ...(await enroll()),
    }
  }
  const completePath = (id: string, occurrenceId: string) =>
    `/api/services/${tenantId}/contact-services/${id}/step-occurrences/${occurrenceId}/complete`
  const noteAction = (title = "Completion action") => ({
    nodeKey: randomUUID(),
    type: "ADD_CONTACT_NOTE",
    noteTitle: title,
    noteBody: "Saved completion instructions",
  })
  async function processCompletionEvent(eventId: string) {
    const leaseToken = randomUUID()
    await db.automationEvent.update({
      where: { id: eventId },
      data: { status: "PROCESSING", leaseToken },
    })
    await processClaimedAutomationEvent(db, { eventId, leaseToken })
    await processClaimedAutomationEvent(db, { eventId, leaseToken })
  }

  test("automation catalog offers active services, sub-services, and their effective steps", async () => {
    const fixture = await completionFixture()
    const custom = await createChild("Part B")
    await request(`${settingsPath()}/${custom.data.service.id}`, "PATCH", { stepsMode: "CUSTOM" })
    const customized = await request(`${settingsPath()}/${custom.data.service.id}`, "PATCH", {
      steps: [{ title: "Part B review" }],
    })
    assert.equal(customized.status, 200, JSON.stringify(customized.data))
    const inactive = await createChild("Inactive")
    await request(`${settingsPath()}/${inactive.data.service.id}`, "PATCH", { isActive: false })
    const catalog = await request(`/api/account-settings/${tenantId}/automations/catalog`)
    assert.equal(catalog.status, 200)
    const group = catalog.data.catalog.serviceStepServices.find((item: any) => item.id === parentId)
    assert.equal(group.subServices.length, 2)
    assert.equal(
      group.subServices.find((item: any) => item.id === fixture.child.data.service.id).steps[0].id,
      fixture.source.id,
    )
    assert.equal(
      group.subServices.find((item: any) => item.id === custom.data.service.id).steps[0].title,
      "Part B review",
    )
  })

  test("general automation API supports multiple scoped entry triggers, retargeting, deletion, and pinned work", async () => {
    const fixture = await completionFixture()
    const other = await createChild("Part A")
    const path = `/api/account-settings/${tenantId}/automations`
    const trigger = {
      type: "SERVICE_STEP_ENTERED",
      serviceStepId: fixture.source.id,
      serviceOfferingId: fixture.child.data.service.id,
    }
    const created = []
    for (const name of ["First entry", "Second entry"]) {
      const response = await request(path, "POST", {
        name,
        trigger,
        isEnabled: true,
        conditions: [],
        actions: [noteAction(name)],
      })
      assert.equal(response.status, 201, JSON.stringify(response.data))
      created.push(response.data.automation)
    }
    const enrollment = await fixture.enroll()
    const event = await db.automationEvent.findFirstOrThrow({
      where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" },
      orderBy: { createdAt: "desc" },
      include: { dispatches: true },
    })
    assert.equal(event.dispatches.length, 2)
    assert.equal((event.serviceContext as any).contactServiceId, enrollment.id)
    assert.equal(
      (
        await request(`${path}/${created[0].id}`, "PATCH", {
          name: created[0].name,
          trigger: {
            ...trigger,
            serviceOfferingId: other.data.service.id,
            type: "SERVICE_STEP_COMPLETED",
          },
          isEnabled: true,
          conditions: [],
          actions: [noteAction("Changed instructions")],
        })
      ).status,
      200,
    )
    assert.equal((await request(`${path}/${created[1].id}`, "DELETE")).status, 200)
    await processCompletionEvent(event.id)
    assert.equal(
      await db.contactNote.count({
        where: { tenantId, title: { in: ["First entry", "Second entry"] } },
      }),
      2,
    )
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "Changed instructions" } }),
      0,
    )
    await fixture.enroll()
    assert.equal(
      await db.automationEvent.count({ where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" } }),
      1,
    )
  })

  test("step trigger selection rejects invalid scopes and retains the saved configuration on errors", async () => {
    const fixture = await completionFixture()
    const path = `/api/account-settings/${tenantId}/automations`
    const payload = {
      name: "Scoped validation",
      isEnabled: true,
      conditions: [],
      actions: [noteAction()],
      trigger: {
        type: "SERVICE_STEP_ENTERED",
        serviceStepId: fixture.source.id,
        serviceOfferingId: fixture.child.data.service.id,
      },
    }
    const created = await request(path, "POST", payload)
    assert.equal(created.status, 201)
    for (const trigger of [
      { ...payload.trigger, serviceOfferingId: parentId },
      { ...payload.trigger, serviceOfferingId: randomUUID() },
      { ...payload.trigger, serviceStepId: randomUUID() },
      { ...payload.trigger, serviceOfferingId: null },
    ]) {
      const response = await request(`${path}/${created.data.automation.id}`, "PATCH", {
        ...payload,
        name: "Invalid edit",
        trigger,
      })
      assert.equal(response.status, 400, JSON.stringify(response.data))
    }
    const foreign = await db.tenant.create({ data: { name: "Other agency", slug: randomUUID() } })
    try {
      const group = await db.service.create({
        data: { tenantId: foreign.id, name: "Other service", kind: "GROUP", basePriceCents: 0 },
      })
      const offering = await db.service.create({
        data: {
          tenantId: foreign.id,
          name: "Other offering",
          kind: "OFFERING",
          parentServiceId: group.id,
          basePriceCents: 0,
        },
      })
      const response = await request(path, "POST", {
        ...payload,
        name: "Foreign scope",
        trigger: { ...payload.trigger, serviceOfferingId: offering.id },
      })
      assert.equal(response.status, 400)
    } finally {
      await db.tenant.delete({ where: { id: foreign.id } })
    }
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [] })
    assert.equal((await request(path, "POST", { ...payload, name: "Archived step" })).status, 400)
    const saved = await request(`${path}/${created.data.automation.id}`)
    assert.equal(saved.data.automation.name, payload.name)
    assert.deepEqual(saved.data.automation.trigger, payload.trigger)
  })

  test("step filters use contact fields, custom fields and tags independently for every matching workflow", async () => {
    const fixture = await completionFixture()
    const other = await createChild("Part A")
    const field = await db.contactCustomField.create({
      data: { tenantId, key: "source", label: "Source", fieldType: "TEXT" },
    })
    const tag = await db.tenantTag.create({
      data: { tenantId, name: "Qualified", bgColor: "#ffffff", textColor: "#000000" },
    })
    await db.contactCustomFieldValue.create({
      data: { tenantId, contactId: fixture.contact.id, fieldId: field.id, value: "Referral" },
    })
    await db.contactTag.create({ data: { tenantId, contactId: fixture.contact.id, tagId: tag.id } })
    const conditions = [
      {
        source: "CONTACT_FIELD",
        fieldKey: "first_name",
        operator: "EQUALS",
        compareValue: fixture.contact.firstName,
      },
      {
        source: "CONTACT_CUSTOM_FIELD",
        customFieldId: field.id,
        operator: "EQUALS",
        compareValue: "Referral",
      },
      { source: "CONTACT_TAGS", tagId: tag.id, operator: "EQUALS" },
    ]
    for (const [index, serviceOfferingId] of [
      fixture.child.data.service.id,
      fixture.child.data.service.id,
      other.data.service.id,
    ].entries()) {
      const created = await request(`/api/account-settings/${tenantId}/automations`, "POST", {
        name: `Filtered ${index}`,
        isEnabled: true,
        trigger: {
          type: "SERVICE_STEP_ENTERED",
          serviceStepId: fixture.source.id,
          serviceOfferingId,
        },
        conditions,
        actions: [noteAction(`Filtered ${index}`)],
      })
      assert.equal(created.status, 201, JSON.stringify(created.data))
    }
    await fixture.enroll()
    const event = await db.automationEvent.findFirstOrThrow({
      where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" },
      include: { dispatches: true },
    })
    assert.equal(event.dispatches.length, 2)
    await db.contactTag.deleteMany({ where: { tenantId } })
    await fixture.enroll()
    assert.equal(
      await db.automationEvent.count({ where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" } }),
      1,
    )
    await processCompletionEvent(event.id)
    assert.equal(
      await db.contactNote.count({
        where: { tenantId, title: { in: ["Filtered 0", "Filtered 1"] } },
      }),
      2,
    )
  })

  test("every completion workflow must finish and every waiting workflow can be controlled separately", async () => {
    const fixture = await completionFixture([noteAction("Legacy completion")])
    for (const name of ["Wait A", "Wait B"]) {
      const response = await request(`/api/account-settings/${tenantId}/automations`, "POST", {
        name,
        trigger: {
          type: "SERVICE_STEP_COMPLETED",
          serviceStepId: fixture.source.id,
          serviceOfferingId: fixture.child.data.service.id,
        },
        isEnabled: true,
        conditions: [],
        actions: [
          {
            nodeKey: randomUUID(),
            type: "WAIT",
            waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" },
          },
          noteAction(`${name} finished`),
        ],
      })
      assert.equal(response.status, 201, JSON.stringify(response.data))
    }
    const completed = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    await processCompletionEvent(completed.data.occurrence.completionEventId)
    const path = `/api/services/${tenantId}/contact-services/${fixture.id}/step-occurrences/${fixture.occurrence.id}/completion-wait`
    const response = await request(path)
    assert.equal(response.data.waits.length, 2)
    assert.deepEqual(response.data.waits.map((wait: any) => wait.automationName).sort(), [
      "Wait A",
      "Wait B",
    ])
    const release = async (wait: any) => {
      await db.$transaction((tx) =>
        changeServiceStepCompletionWaitTx(tx, {
          tenantId,
          contactServiceId: fixture.id,
          occurrenceId: fixture.occurrence.id,
          actorUserId: userId,
          change: {
            type: "CONTINUE",
            runId: wait.runId,
            waitingNodeExecutionId: wait.waitingNodeExecutionId,
            expectedResumeAt: wait.resumeAt,
          },
        }),
      )
      await resumeDueAutomationRuns(db)
    }
    await release(response.data.waits[0])
    assert.equal(
      (await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } }))
        .progressionStatus,
      "WAITING_AUTOMATION",
    )
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      1,
    )
    await release(response.data.waits[1])
    assert.equal(
      (await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } }))
        .progressionStatus,
      "ADVANCED",
    )
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      2,
    )
    assert.equal(await db.contactNote.count({ where: { tenantId } }), 3)
    const second = await fixture.enroll()
    const completedAgain = await request(completePath(second.id, second.occurrence.id), "POST")
    const secondEventId = completedAgain.data.occurrence.completionEventId
    await processCompletionEvent(secondEventId)
    await db.automationRun.updateMany({
      where: { tenantId, dispatch: { eventId: secondEventId }, status: "WAITING" },
      data: { resumeAt: new Date(Date.now() - 60000) },
    })
    await Promise.all([resumeDueAutomationRuns(db), resumeDueAutomationRuns(db)])
    assert.equal(
      (await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: second.occurrence.id } }))
        .progressionStatus,
      "ADVANCED",
    )
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: second.id } }),
      2,
    )
    assert.equal(await db.contactNote.count({ where: { tenantId } }), 6)
  })

  test("one failed completion workflow pauses progression even after another succeeds", async () => {
    const fixture = await completionFixture([noteAction("Successful completion")])
    const created = await request(`/api/account-settings/${tenantId}/automations`, "POST", {
      name: "Failed completion",
      trigger: {
        type: "SERVICE_STEP_COMPLETED",
        serviceStepId: fixture.source.id,
        serviceOfferingId: fixture.child.data.service.id,
      },
      isEnabled: true,
      conditions: [],
      actions: [noteAction("Never saved")],
    })
    assert.equal(created.status, 201)
    const completed = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    const eventId = completed.data.occurrence.completionEventId
    await db.automationDispatch.updateMany({
      where: { eventId, automationId: created.data.automation.id },
      data: {
        actionSnapshot: [
          {
            nodeKey: randomUUID(),
            type: "ADD_TO_WORKFLOW",
            addToWorkflowConfig: {
              actionName: "Missing workflow",
              targetAutomationId: randomUUID(),
              targetAutomationNameSnapshot: "Deleted target",
            },
          },
        ],
      },
    })
    await processCompletionEvent(eventId)
    assert.equal(
      (await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } }))
        .progressionStatus,
      "PAUSED",
    )
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      1,
    )
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "Successful completion" } }),
      1,
    )
  })
  test("completion drafts retain their binding, actions and identity through configuration saves", async () => {
    const fixture = await completionFixture()
    const loaded = await request(fixture.automationPath)
    assert.deepEqual(loaded.data.automation.trigger, fixture.payload.trigger)
    assert.equal(
      (await request(fixture.automationPath, "PATCH", { ...fixture.payload, isEnabled: true }))
        .status,
      400,
    )
    assert.equal(
      (await request(`/api/account-settings/${tenantId}/automations`, "POST", fixture.payload))
        .status,
      400,
    )
    const published = { ...fixture.payload, isEnabled: true, actions: [noteAction()] }
    assert.equal((await request(fixture.automationPath, "PATCH", published)).status, 200)
    await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [{ id: fixture.source.id, title: "Edited review" }],
    })
    assert.equal((await request(fixture.automationPath)).data.automation.actions.length, 1)
    assert.equal(
      await db.automation.count({
        where: {
          tenantId,
          serviceStepId: fixture.source.id,
          triggerType: "SERVICE_STEP_COMPLETED",
        },
      }),
      1,
    )
  })

  test("concurrent completions advance once using saved order, then finish pending payment", async () => {
    const fixture = await completionFixture()
    const snap = await db.contactServiceStep.findMany({
      where: { contactServiceId: fixture.id },
      orderBy: { sortOrder: "asc" },
    })
    // Subsequent edits/archival must not change this enrollment's progression order.
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [{ title: "Future step" }] })
    const path = completePath(fixture.id, fixture.occurrence.id)
    const responses = await Promise.all([
      request(path, "POST"),
      request(path, "POST"),
      request(path, "POST"),
    ])
    assert.ok(
      responses.every((response) => response.status === 200),
      JSON.stringify(responses),
    )
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      2,
    )
    assert.equal(responses[0]!.data.occurrence.progressionStatus, "ADVANCED")
    const next = await db.serviceStepOccurrence.findFirstOrThrow({
      where: { contactServiceId: fixture.id, status: "ACTIVE" },
    })
    assert.equal(next.stepId, snap[1]!.id)
    assert.equal(next.dueAt.getTime() - next.enteredAt.getTime(), 3 * 86400000)
    assert.equal(
      (await request(completePath(fixture.id, next.id), "POST")).data.occurrence.progressionStatus,
      "FINISHED",
    )
    assert.equal(
      (await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).status,
      "PENDING_PAYMENT",
    )
    assert.equal((await request(path, "POST")).status, 200)
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      2,
    )
    const payment = await request(
      `/api/services/${tenantId}/contact-services/${fixture.id}/payments`,
      "POST",
      { amountCents: 10000, paymentMethod: "CASH" },
    )
    assert.equal(payment.status, 201, JSON.stringify(payment.data))
    assert.equal(
      (await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).status,
      "COMPLETED",
    )
  })

  test("completion executes pinned actions before entering the next step and queues its entry once", async () => {
    const fixture = await completionFixture([noteAction()])
    const second = await db.contactServiceStep.findFirstOrThrow({
      where: { contactServiceId: fixture.id, sortOrder: 20 },
    })
    const entry = await db.automation.findFirstOrThrow({
      where: { tenantId, serviceStepId: second.sourceStepId, triggerType: "SERVICE_STEP_ENTERED" },
    })
    await request(`/api/account-settings/${tenantId}/automations/${entry.id}`, "PATCH", {
      name: "Next entry",
      isEnabled: true,
      trigger: { type: "SERVICE_STEP_ENTERED", serviceStepId: second.sourceStepId },
      conditions: [],
      actions: [noteAction("Next entry action")],
    })
    const response = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    assert.equal(response.data.occurrence.progressionStatus, "WAITING_AUTOMATION")
    const eventId = response.data.occurrence.completionEventId
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      1,
    )
    await request(fixture.automationPath, "PATCH", {
      ...fixture.payload,
      actions: [noteAction("Changed instructions")],
    })
    await processCompletionEvent(eventId)
    const completed = await db.serviceStepOccurrence.findUniqueOrThrow({
      where: { id: fixture.occurrence.id },
    })
    assert.equal(completed.progressionStatus, "ADVANCED")
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Completion action" } }), 1)
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "Changed instructions" } }),
      0,
    )
    const nextEvent = await db.automationEvent.findFirstOrThrow({
      where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" },
    })
    assert.equal((nextEvent.serviceContext as any).contactServiceId, fixture.id)
    await processCompletionEvent(nextEvent.id)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Next entry action" } }), 1)
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      2,
    )
  })

  test("completion waits gate progression until the final action succeeds, including worker retries", async () => {
    const fixture = await completionFixture([
      noteAction("Before wait"),
      {
        nodeKey: randomUUID(),
        type: "WAIT",
        waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" },
      },
      noteAction("After wait"),
    ])
    const response = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    await processCompletionEvent(response.data.occurrence.completionEventId)
    let run = await db.automationRun.findFirstOrThrow({
      where: { tenantId, eventSource: "SERVICE_STEP_COMPLETED" },
    })
    assert.equal(run.status, "WAITING")
    assert.equal(
      (await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } }))
        .progressionStatus,
      "WAITING_AUTOMATION",
    )
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "After wait" } }), 0)
    await db.automationRun.update({
      where: { id: run.id },
      data: { resumeAt: new Date(Date.now() - 60000) },
    })
    await Promise.all([resumeDueAutomationRuns(db), resumeDueAutomationRuns(db)])
    run = await db.automationRun.findUniqueOrThrow({ where: { id: run.id } })
    assert.equal(run.status, "SUCCEEDED")
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Before wait" } }), 1)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "After wait" } }), 1)
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      2,
    )
  })

  test("completion failures roll back actions and visibly pause the exact enrollment", async () => {
    const fixture = await completionFixture([noteAction()])
    const other = await fixture.enroll()
    const response = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    const eventId = response.data.occurrence.completionEventId
    // Corrupt a pinned action to simulate a target disappearing after completion was queued.
    const dispatch = await db.automationDispatch.findFirstOrThrow({ where: { eventId } })
    await db.automationDispatch.update({
      where: { id: dispatch.id },
      data: {
        actionSnapshot: [
          ...(dispatch.actionSnapshot as any[]),
          {
            nodeKey: randomUUID(),
            type: "ADD_TO_WORKFLOW",
            addToWorkflowConfig: {
              actionName: "Missing workflow",
              targetAutomationId: randomUUID(),
              targetAutomationNameSnapshot: "Deleted target",
            },
          },
        ],
      },
    })
    await processCompletionEvent(eventId)
    const paused = await db.serviceStepOccurrence.findUniqueOrThrow({
      where: { id: fixture.occurrence.id },
    })
    assert.equal(paused.progressionStatus, "PAUSED")
    assert.ok(paused.progressionMessage)
    assert.equal(paused.status, "COMPLETED")
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Completion action" } }), 0)
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      1,
    )
    assert.equal(
      (await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: other.occurrence.id } }))
        .status,
      "ACTIVE",
    )
    assert.equal(
      (await request(completePath(fixture.id, fixture.occurrence.id), "POST")).data.occurrence
        .progressionStatus,
      "PAUSED",
    )
    assert.equal(
      await db.automationEvent.count({
        where: { tenantId, triggerType: "SERVICE_STEP_COMPLETED" },
      }),
      1,
    )
    const workspace = await request(
      `/api/services/${tenantId}/contact-services/${fixture.id}/overview`,
    )
    assert.equal(workspace.status, 200)
    assert.equal(
      workspace.data.contactService.serviceSteps[0].occurrences[0].progressionStatus,
      "PAUSED",
    )
  })

  test("stopping a waiting completion workflow pauses instead of advancing", async () => {
    const nodeKey = randomUUID()
    const fixture = await completionFixture([
      { nodeKey, type: "WAIT", waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" } },
      noteAction(),
    ])
    const response = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    await processCompletionEvent(response.data.occurrence.completionEventId)
    const run = await db.automationRun.findFirstOrThrow({
      where: { tenantId, eventSource: "SERVICE_STEP_COMPLETED" },
    })
    await exitAutomationWaitingRun(db, {
      tenantId,
      automationId: fixture.automation.id,
      runId: run.id,
      nodeKey,
      actorUserId: userId,
      actorDisplayName: "Tester",
    })
    await resumeDueAutomationRuns(db)
    assert.equal(
      (await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } }))
        .progressionStatus,
      "PAUSED",
    )
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      1,
    )
    assert.equal(await db.contactNote.count({ where: { tenantId } }), 0)
  })

  test("foreign occurrences, low permission, inactive steps and rolled back completions cannot advance", async () => {
    const fixture = await completionFixture([noteAction()])
    const other = await fixture.enroll()
    assert.equal((await request(completePath(fixture.id, other.occurrence.id), "POST")).status, 404)
    assert.equal(
      (
        await request(
          `/api/services/${randomUUID()}/contact-services/${fixture.id}/step-occurrences/${fixture.occurrence.id}/complete`,
          "POST",
        )
      ).status,
      403,
    )
    await db.membership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: { role: "TENANT_USER", securityLevel: "LOW" },
    })
    assert.equal(
      (await request(completePath(fixture.id, fixture.occurrence.id), "POST")).status,
      403,
    )
    await db.membership.update({
      where: { userId_tenantId: { userId, tenantId } },
      data: { role: "TENANT_ADMIN", securityLevel: "MAX" },
    })
    const { completeServiceStepOccurrenceTx } = await import("./service-step-progression.js")
    await assert.rejects(
      db.$transaction(async (tx) => {
        await completeServiceStepOccurrenceTx(tx, {
          tenantId,
          contactServiceId: fixture.id,
          occurrenceId: fixture.occurrence.id,
          actorUserId: userId,
        })
        throw new Error("Rollback completion")
      }),
      /Rollback completion/,
    )
    assert.equal(
      await db.automationEvent.count({
        where: { tenantId, triggerType: "SERVICE_STEP_COMPLETED" },
      }),
      0,
    )
    assert.equal(
      (await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } }))
        .status,
      "ACTIVE",
    )
    await db.serviceStepOccurrence.update({
      where: { id: fixture.occurrence.id },
      data: { status: "CANCELED" },
    })
    assert.equal(
      (await request(completePath(fixture.id, fixture.occurrence.id), "POST")).status,
      409,
    )
  })

  test("filtered and corrupt empty completion workflows advance immediately without executing actions", async () => {
    const fixture = await completionFixture(
      [noteAction()],
      [
        {
          source: "CONTACT_FIELD",
          fieldKey: "first_name",
          operator: "EQUALS",
          compareValue: "Other",
        },
      ],
    )
    const response = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    assert.equal(response.data.occurrence.progressionStatus, "ADVANCED")
    assert.equal(response.data.occurrence.completionEventId, null)
    assert.equal(await db.contactNote.count({ where: { tenantId } }), 0)
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      2,
    )
    await db.automationAction.deleteMany({
      where: { tenantId, automationId: fixture.automation.id },
    })
    const other = await fixture.enroll()
    const empty = await request(completePath(other.id, other.occurrence.id), "POST")
    assert.equal(empty.data.occurrence.progressionStatus, "ADVANCED")
    assert.equal(empty.data.occurrence.completionEventId, null)
  })

  test("failure after a resumed wait pauses progression while retaining prior committed actions", async () => {
    const fixture = await completionFixture([
      noteAction("Committed before wait"),
      {
        nodeKey: randomUUID(),
        type: "WAIT",
        waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" },
      },
      noteAction("After wait"),
    ])
    const response = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    await processCompletionEvent(response.data.occurrence.completionEventId)
    const run = await db.automationRun.findFirstOrThrow({
      where: { tenantId, eventSource: "SERVICE_STEP_COMPLETED" },
    })
    const actions = run.actionSnapshot as any[]
    actions[2] = {
      nodeKey: actions[2].nodeKey,
      type: "ADD_TO_WORKFLOW",
      addToWorkflowConfig: {
        actionName: "Missing",
        targetAutomationId: randomUUID(),
        targetAutomationNameSnapshot: "Missing",
      },
    }
    await db.automationRun.update({
      where: { id: run.id },
      data: { actionSnapshot: actions, resumeAt: new Date(Date.now() - 60000) },
    })
    await resumeDueAutomationRuns(db)
    assert.equal(
      (await db.automationRun.findUniqueOrThrow({ where: { id: run.id } })).status,
      "FAILED",
    )
    assert.equal(
      (await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } }))
        .progressionStatus,
      "PAUSED",
    )
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "Committed before wait" } }),
      1,
    )
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      1,
    )
  })

  test("branched completion workflows advance after their selected actions and finish a paid enrollment", async () => {
    const fixture = await completionFixture([
      {
        nodeKey: randomUUID(),
        type: "IF_ELSE",
        ifElseConfig: {
          actionName: "Choose completion path",
          branches: [
            {
              branchKey: randomUUID(),
              name: "Other",
              isDefault: false,
              matchMode: "ALL",
              conditions: [
                {
                  source: "CONTACT_FIELD",
                  fieldKey: "first_name",
                  operator: "EQUALS",
                  compareValue: "Other",
                },
              ],
              actions: [noteAction("Unselected branch")],
            },
            {
              branchKey: randomUUID(),
              name: "Default",
              isDefault: true,
              matchMode: "ALL",
              conditions: [],
              actions: [noteAction("Selected branch")],
            },
          ],
        },
      },
    ])
    const payment = await request(
      `/api/services/${tenantId}/contact-services/${fixture.id}/payments`,
      "POST",
      { amountCents: 10000, paymentMethod: "CASH" },
    )
    assert.equal(payment.status, 201, JSON.stringify(payment.data))
    const response = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    await processCompletionEvent(response.data.occurrence.completionEventId)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Selected branch" } }), 1)
    const active = await db.serviceStepOccurrence.findFirstOrThrow({
      where: { contactServiceId: fixture.id, status: "ACTIVE" },
    })
    await request(completePath(fixture.id, active.id), "POST")
    const enrollment = await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })
    assert.equal(enrollment.status, "COMPLETED")
    assert.ok(enrollment.completedAt)
  })

  test("a canceled enrollment cannot be advanced by a late completion worker", async () => {
    const fixture = await completionFixture([noteAction()])
    const response = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    await db.contactService.update({
      where: { id: fixture.id },
      data: { status: "CANCELED", canceledAt: new Date() },
    })
    await processCompletionEvent(response.data.occurrence.completionEventId)
    assert.equal(
      (await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } }))
        .progressionStatus,
      "PAUSED",
    )
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      1,
    )
    assert.equal(
      (await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).status,
      "CANCELED",
    )
  })

  async function waitingFixture(fixed = false, extraActions: unknown[] = []) {
    const nodeKey = randomUUID()
    const fixture = await completionFixture([
      noteAction("Before completion wait"),
      {
        nodeKey,
        type: "WAIT",
        waitConfig: fixed
          ? {
              mode: "FIXED_DATE",
              dateTime: new Date(Date.now() + 86400000).toISOString(),
              timing: "ON",
              pastBehavior: "CONTINUE",
            }
          : { mode: "DURATION", amount: 1, unit: "DAYS" },
      },
      noteAction("After completion wait"),
      ...extraActions,
    ])
    const response = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    await processCompletionEvent(response.data.occurrence.completionEventId)
    const waitPath = `${completePath(fixture.id, fixture.occurrence.id).replace(/\/complete$/, "")}/completion-wait`
    const loaded = await request(waitPath)
    assert.equal(loaded.status, 200, JSON.stringify(loaded.data))
    assert.ok(loaded.data.wait)
    const target = {
      runId: loaded.data.wait.runId,
      waitingNodeExecutionId: loaded.data.wait.waitingNodeExecutionId,
      expectedResumeAt: loaded.data.wait.resumeAt,
    }
    const change = (type: "CONTINUE" | "RESCHEDULE", schedule?: any, overrideTarget = target) =>
      db.$transaction((tx) =>
        changeServiceStepCompletionWaitTx(tx, {
          tenantId,
          contactServiceId: fixture.id,
          occurrenceId: fixture.occurrence.id,
          actorUserId: userId,
          change:
            type === "CONTINUE"
              ? { type, ...overrideTarget }
              : { type, ...overrideTarget, schedule },
        }),
      )
    return { ...fixture, nodeKey, waitPath, target, change }
  }
  function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }

  test("completion wait rescheduling affects one enrollment and keeps pinned workflow actions intact", async () => {
    const fixture = await waitingFixture()
    const other = await fixture.enroll()
    const otherCompleted = await request(completePath(other.id, other.occurrence.id), "POST")
    await processCompletionEvent(otherCompleted.data.occurrence.completionEventId)
    const before = await db.automationRun.findUniqueOrThrow({ where: { id: fixture.target.runId } })
    const scheduled = await request(`${fixture.waitPath}/reschedule`, "POST", {
      ...fixture.target,
      schedule: { mode: "DURATION", amount: 20, unit: "DAYS" },
    })
    assert.equal(scheduled.status, 200, JSON.stringify(scheduled.data))
    const changed = await db.automationRun.findUniqueOrThrow({
      where: { id: fixture.target.runId },
    })
    assert.equal(changed.status, "WAITING")
    assert.ok(changed.resumeAt!.getTime() >= Date.now() + 20 * 86400000 - 2000)
    assert.deepEqual(changed.actionSnapshot, before.actionSnapshot)
    assert.equal(changed.cursorIndex, before.cursorIndex)
    const untouched = await db.automationRun.findFirstOrThrow({
      where: { tenantId, id: { not: changed.id }, eventSource: "SERVICE_STEP_COMPLETED" },
    })
    assert.ok(untouched.resumeAt!.getTime() < changed.resumeAt!.getTime() - 18 * 86400000)
    const audit = await db.automationNodeExecution.findFirstOrThrow({
      where: { tenantId, reasonCode: "WAIT_RESCHEDULED" },
    })
    assert.equal(audit.actorUserId, userId)
    assert.equal((audit.serviceContext as any).contactServiceId, fixture.id)
    assert.match(audit.details!, new RegExp(before.resumeAt!.toISOString().replaceAll(".", "\\.")))
    assert.equal(
      (
        await request(`${fixture.waitPath}/reschedule`, "POST", {
          ...fixture.target,
          schedule: { mode: "DURATION", amount: 2, unit: "HOURS" },
        })
      ).status,
      409,
    )
    assert.equal(
      await db.automationNodeExecution.count({
        where: { tenantId, reasonCode: "WAIT_RESCHEDULED" },
      }),
      1,
    )
  })

  test("fixed-date waits can be rescheduled with an explicit offset and bypassed without duplicate actions", async () => {
    const fixture = await waitingFixture(true)
    const future = new Date(Date.now() + 2 * 86400000).toISOString()
    const scheduled = await request(`${fixture.waitPath}/reschedule`, "POST", {
      ...fixture.target,
      schedule: { mode: "FIXED_DATE", dateTime: future.replace("Z", "+00:00") },
    })
    assert.equal(scheduled.status, 200, JSON.stringify(scheduled.data))
    const target = { ...fixture.target, expectedResumeAt: scheduled.data.wait.resumeAt }
    await fixture.change("CONTINUE", undefined, target)
    await assert.rejects(
      fixture.change("CONTINUE", undefined, target),
      (error: any) => error.code === "COMPLETION_WAIT_CHANGED",
    )
    await Promise.all([resumeDueAutomationRuns(db), resumeDueAutomationRuns(db)])
    await resumeDueAutomationRuns(db)
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "Before completion wait" } }),
      1,
    )
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "After completion wait" } }),
      1,
    )
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      2,
    )
    assert.equal(
      await db.automationNodeExecution.count({
        where: { tenantId, reasonCode: "WAIT_CONTINUE_REQUESTED" },
      }),
      1,
    )
  })

  test("Continue now API wakes the worker and returns the exact wait being released", async () => {
    const fixture = await waitingFixture()
    const response = await request(`${fixture.waitPath}/continue`, "POST", fixture.target)
    assert.equal(response.status, 200, JSON.stringify(response.data))
    assert.equal(response.data.wait.waitingNodeExecutionId, fixture.target.waitingNodeExecutionId)
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const run = await db.automationRun.findUniqueOrThrow({ where: { id: fixture.target.runId } })
      if (run.status === "SUCCEEDED") break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(
      (await db.automationRun.findUniqueOrThrow({ where: { id: fixture.target.runId } })).status,
      "SUCCEEDED",
    )
    assert.equal(
      (await request(`${fixture.waitPath}/continue`, "POST", fixture.target)).status,
      409,
    )
    assert.equal((await request(fixture.waitPath)).data.wait, null)
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "After completion wait" } }),
      1,
    )
  })

  test("rescheduling revokes an unstarted worker claim and the stale worker cannot execute", async () => {
    const fixture = await waitingFixture()
    const oldLease = randomUUID()
    await db.automationRun.update({
      where: { id: fixture.target.runId },
      data: {
        status: "RUNNING",
        leaseToken: oldLease,
        leaseExpiresAt: new Date(Date.now() + 60000),
      },
    })
    await fixture.change("RESCHEDULE", { mode: "DURATION", amount: 5, unit: "HOURS" })
    const stale = await resumeAutomationRun(db, fixture.target.runId, oldLease)
    assert.equal(stale.status, "NOT_CLAIMED")
    await resumeDueAutomationRuns(db)
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "After completion wait" } }),
      0,
    )
    assert.equal(
      (await db.automationRun.findUniqueOrThrow({ where: { id: fixture.target.runId } })).status,
      "WAITING",
    )
    const target = {
      ...fixture.target,
      expectedResumeAt: (await request(fixture.waitPath)).data.wait.resumeAt,
    }
    await fixture.change("CONTINUE", undefined, target)
    await resumeDueAutomationRuns(db)
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "After completion wait" } }),
      1,
    )
  })

  test("an executing worker holds the wait lock and stale staff edits cannot overwrite its result", async () => {
    const fixture = await waitingFixture()
    const leaseToken = randomUUID()
    await db.automationRun.update({
      where: { id: fixture.target.runId },
      data: { status: "RUNNING", leaseToken, leaseExpiresAt: new Date(Date.now() + 60000) },
    })
    const entered = deferred()
    const release = deferred()
    const workerClient = new Proxy(db, {
      get(target, key) {
        if (key !== "$transaction") return Reflect.get(target, key)
        return (handler: any) =>
          db.$transaction((tx) =>
            handler(
              new Proxy(tx, {
                get(target, key) {
                  if (key !== "contact") return Reflect.get(target, key)
                  return new Proxy(tx.contact, {
                    get(target, key) {
                      if (key !== "findFirst") return Reflect.get(target, key)
                      return async (args: any) => {
                        entered.resolve()
                        await release.promise
                        return tx.contact.findFirst(args)
                      }
                    },
                  })
                },
              }),
            ),
          )
      },
    })
    const worker = resumeAutomationRun(workerClient, fixture.target.runId, leaseToken)
    await entered.promise
    const editAttempt = deferred()
    let finished = false
    const edit = db
      .$transaction((tx) =>
        changeServiceStepCompletionWaitTx(
          new Proxy(tx, {
            get(target, key) {
              if (key !== "$queryRaw") return Reflect.get(target, key)
              return (...args: any[]) => {
                editAttempt.resolve()
                return (tx.$queryRaw as any)(...args)
              }
            },
          }),
          {
            tenantId,
            contactServiceId: fixture.id,
            occurrenceId: fixture.occurrence.id,
            actorUserId: userId,
            change: {
              type: "RESCHEDULE",
              ...fixture.target,
              schedule: { mode: "DURATION", amount: 3, unit: "DAYS" },
            },
          },
        ),
      )
      .then(
        (value) => {
          finished = true
          return value
        },
        (error) => {
          finished = true
          return error
        },
      )
    await editAttempt.promise
    assert.equal(finished, false)
    const moving = request(
      movementPath(fixture.id),
      "POST",
      movementPayload(fixture.occurrence.id, fixture.occurrence.stepId),
    )
    release.resolve()
    assert.equal((await worker).status, "SUCCEEDED")
    assert.equal((await edit).code, "COMPLETION_WAIT_CHANGED")
    assert.equal((await moving).status, 409)
    assert.equal(await db.serviceStepMovement.count({ where: { tenantId } }), 0)
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "After completion wait" } }),
      1,
    )
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      2,
    )
    assert.equal(
      await db.automationNodeExecution.count({
        where: { tenantId, reasonCode: "WAIT_RESCHEDULED" },
      }),
      0,
    )
  })

  const movementPath = (id: string) =>
    `/api/services/${tenantId}/contact-services/${id}/step-movements`
  const movementPayload = (occurrenceId: string, targetStepId?: string) => ({
    requestId: randomUUID(),
    expectedOccurrenceId: occurrenceId,
    kind: targetStepId ? ("MOVE" as const) : ("SKIP" as const),
    ...(targetStepId ? { targetStepId } : {}),
    reason: "Customer requested this change",
  })

  test("forward movement records bypassed steps, revisits preserve history, and destination entries run once", async () => {
    const fixture = await completionFixture()
    const configured = (await request(`${settingsPath()}/${parentId}`)).data.service
    await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: [
        ...configured.steps.map((step: any) => ({ id: step.id, title: step.title })),
        { title: "Verify" },
      ],
    })
    const enrollment = await fixture.enroll()
    const steps = await db.contactServiceStep.findMany({
      where: { contactServiceId: enrollment.id },
      orderBy: { sortOrder: "asc" },
    })
    for (const step of [steps[0]!, steps[2]!]) {
      const response = await request(`/api/account-settings/${tenantId}/automations`, "POST", {
        name: `${step.title} entry`,
        isEnabled: true,
        trigger: {
          type: "SERVICE_STEP_ENTERED",
          serviceStepId: step.sourceStepId,
          serviceOfferingId: fixture.child.data.service.id,
        },
        conditions: [],
        actions: [noteAction(`${step.title} entered`)],
      })
      assert.equal(response.status, 201, JSON.stringify(response.data))
    }
    const payload = movementPayload(enrollment.occurrence.id, steps[2]!.id)
    const moved = await request(movementPath(enrollment.id), "POST", payload)
    assert.equal(moved.status, 200, JSON.stringify(moved.data))
    assert.deepEqual(moved.data.movement.skippedStepIds, [steps[0]!.id, steps[1]!.id])
    assert.deepEqual(
      (await request(movementPath(enrollment.id), "POST", payload)).data.movement,
      moved.data.movement,
    )
    const destination = await db.serviceStepOccurrence.findUniqueOrThrow({
      where: { id: moved.data.movement.toOccurrenceId },
    })
    assert.equal(destination.status, "ACTIVE")
    assert.equal(destination.dueAt.getTime() - destination.enteredAt.getTime(), 3 * 86400000)
    assert.equal(await db.serviceStepOccurrence.count({ where: { stepId: steps[1]!.id } }), 0)
    const firstEvent = await db.automationEvent.findFirstOrThrow({
      where: {
        tenantId,
        serviceContext: { path: ["serviceStepOccurrenceId"], equals: destination.id },
      },
    })
    await processCompletionEvent(firstEvent.id)
    const returned = await request(
      movementPath(enrollment.id),
      "POST",
      movementPayload(destination.id, steps[0]!.id),
    )
    assert.equal(returned.status, 200, JSON.stringify(returned.data))
    const revisited = await db.serviceStepOccurrence.findUniqueOrThrow({
      where: { id: returned.data.movement.toOccurrenceId },
    })
    assert.equal(revisited.occurrenceNumber, 2)
    assert.equal(
      (
        await db.serviceStepOccurrence.findUniqueOrThrow({
          where: { id: enrollment.occurrence.id },
        })
      ).status,
      "SKIPPED",
    )
    assert.equal(
      (await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: destination.id } })).status,
      "CANCELED",
    )
    const secondEvent = await db.automationEvent.findFirstOrThrow({
      where: {
        tenantId,
        serviceContext: { path: ["serviceStepOccurrenceId"], equals: revisited.id },
      },
    })
    await processCompletionEvent(secondEvent.id)
    assert.equal(
      await db.contactNote.count({
        where: { tenantId, title: { in: ["Verify entered", "Review entered"] } },
      }),
      2,
    )
    assert.equal(
      await db.serviceStepOccurrence.count({
        where: { contactServiceId: enrollment.id, status: "ACTIVE" },
      }),
      1,
    )
    const loaded = await request(`/api/services/${tenantId}/contact-services/${enrollment.id}`)
    assert.equal(loaded.data.contactService.stepMovements.length, 2)
    assert.equal(loaded.data.contactService.stepMovements[0].actorName, "Hierarchy tester")
  })

  test("skip bypasses completion workflows, final skip retains payment requirements, and pending work can be revisited", async () => {
    const fixture = await completionFixture([noteAction("Do not complete on skip")])
    const first = await request(
      movementPath(fixture.id),
      "POST",
      movementPayload(fixture.occurrence.id),
    )
    assert.equal(first.status, 200, JSON.stringify(first.data))
    assert.equal(
      await db.automationEvent.count({
        where: { tenantId, triggerType: "SERVICE_STEP_COMPLETED" },
      }),
      0,
    )
    const last = await request(
      movementPath(fixture.id),
      "POST",
      movementPayload(first.data.movement.toOccurrenceId),
    )
    assert.equal(last.status, 200)
    assert.equal(last.data.movement.toOccurrenceId, null)
    assert.equal(
      (await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).status,
      "PENDING_PAYMENT",
    )
    const returned = await request(
      movementPath(fixture.id),
      "POST",
      movementPayload(first.data.movement.toOccurrenceId, fixture.occurrence.stepId),
    )
    assert.equal(returned.status, 200, JSON.stringify(returned.data))
    assert.equal(
      (await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).status,
      "IN_PROGRESS",
    )
    await db.contactServicePayment.create({
      data: { tenantId, contactServiceId: fixture.id, amountCents: 10000, paidAt: new Date() },
    })
    await db.$transaction((tx) => reconcileServiceStepEnrollmentTx(tx, tenantId, fixture.id))
    assert.equal(
      (await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).status,
      "IN_PROGRESS",
    )
    const skippedAgain = await request(
      movementPath(fixture.id),
      "POST",
      movementPayload(returned.data.movement.toOccurrenceId),
    )
    const finished = await request(
      movementPath(fixture.id),
      "POST",
      movementPayload(skippedAgain.data.movement.toOccurrenceId),
    )
    assert.equal(finished.status, 200)
    assert.equal(
      (await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).status,
      "COMPLETED",
    )
  })

  test("movement cancels queued completion work before dispatch and stale completions cannot advance", async () => {
    const fixture = await completionFixture([noteAction("Obsolete completion")])
    const steps = await db.contactServiceStep.findMany({
      where: { contactServiceId: fixture.id },
      orderBy: { sortOrder: "asc" },
    })
    const completed = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    const eventId = completed.data.occurrence.completionEventId
    const moved = await request(
      movementPath(fixture.id),
      "POST",
      movementPayload(fixture.occurrence.id, steps[1]!.id),
    )
    assert.equal(moved.status, 200, JSON.stringify(moved.data))
    assert.equal(
      (await db.automationEvent.findUniqueOrThrow({ where: { id: eventId } })).status,
      "CANCELED",
    )
    await processCompletionEvent(eventId)
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "Obsolete completion" } }),
      0,
    )
    const original = await db.serviceStepOccurrence.findUniqueOrThrow({
      where: { id: fixture.occurrence.id },
    })
    assert.equal(original.status, "COMPLETED")
    assert.equal(original.progressionStatus, "SUPERSEDED")
    assert.ok(original.resolvedAt)
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      2,
    )
  })

  test("movement revokes claimed waits and stops only obsolete work for this enrollment", async () => {
    const fixture = await waitingFixture()
    const other = await fixture.enroll()
    const otherCompletion = await request(completePath(other.id, other.occurrence.id), "POST")
    await processCompletionEvent(otherCompletion.data.occurrence.completionEventId)
    const originalRun = await db.automationRun.findUniqueOrThrow({
      where: { id: fixture.target.runId },
    })
    const makeChild = (scoped: boolean) =>
      db.automationRun.create({
        data: {
          tenantId,
          automationId: originalRun.automationId,
          automationName: "Related workflow",
          contactId: fixture.contact.id,
          contactName: "Tester",
          actorUserId: userId,
          attemptId: randomUUID(),
          eventSource: "AUTOMATION_ACTION",
          triggerType: "CONTACT_NOTE_ADDED",
          actionSnapshot: originalRun.actionSnapshot as any,
          ...(scoped ? { serviceContext: originalRun.serviceContext as any } : {}),
          status: "WAITING",
          resumeAt: new Date(Date.now() + 86400000),
        },
      })
    const childRun = await makeChild(true)
    const ordinaryRun = await makeChild(false)
    const oldLease = randomUUID()
    await db.automationRun.update({
      where: { id: fixture.target.runId },
      data: {
        status: "RUNNING",
        leaseToken: oldLease,
        leaseExpiresAt: new Date(Date.now() + 60000),
      },
    })
    const moved = await request(
      movementPath(fixture.id),
      "POST",
      movementPayload(fixture.occurrence.id, fixture.occurrence.stepId),
    )
    assert.equal(moved.status, 200, JSON.stringify(moved.data))
    assert.equal(
      (await resumeAutomationRun(db, fixture.target.runId, oldLease)).status,
      "NOT_CLAIMED",
    )
    const exited = await db.automationRun.findUniqueOrThrow({ where: { id: fixture.target.runId } })
    assert.equal(exited.status, "EXITED")
    assert.equal(exited.exitReasonCode, "SERVICE_STEP_MOVED")
    assert.equal(
      (await db.automationRun.findUniqueOrThrow({ where: { id: childRun.id } })).status,
      "EXITED",
    )
    assert.equal(
      (await db.automationRun.findUniqueOrThrow({ where: { id: ordinaryRun.id } })).status,
      "WAITING",
    )
    assert.equal(exited.leaseToken, null)
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "After completion wait" } }),
      0,
    )
    assert.equal((await request(fixture.waitPath)).data.waits.length, 0)
    assert.equal(
      (await request(`${fixture.waitPath}/continue`, "POST", fixture.target)).status,
      409,
    )
    const untouched = await db.automationRun.findFirstOrThrow({
      where: { tenantId, serviceContext: { path: ["contactServiceId"], equals: other.id } },
    })
    assert.equal(untouched.status, "WAITING")
    assert.equal(
      (
        await db.serviceStepOccurrence.findUniqueOrThrow({
          where: { id: moved.data.movement.toOccurrenceId },
        })
      ).occurrenceNumber,
      2,
    )
  })

  test("movement rolls back history, cancellations and destination events together", async () => {
    const fixture = await waitingFixture()
    const payload = movementPayload(fixture.occurrence.id, fixture.occurrence.stepId)
    await assert.rejects(
      db.$transaction(async (tx) => {
        await moveServiceStepTx(tx, {
          ...payload,
          tenantId,
          contactServiceId: fixture.id,
          actorUserId: userId,
        })
        throw new Error("Rollback movement")
      }),
      /Rollback movement/,
    )
    assert.equal(await db.serviceStepMovement.count({ where: { tenantId } }), 0)
    assert.equal(
      (await db.automationRun.findUniqueOrThrow({ where: { id: fixture.target.runId } })).status,
      "WAITING",
    )
    assert.equal(
      (await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } }))
        .supersededAt,
      null,
    )
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      1,
    )
  })

  test("movement rejects stale or foreign selections, invalid reasons, low permissions and inactive enrollments", async () => {
    const fixture = await completionFixture()
    const other = await fixture.enroll()
    const target = await db.contactServiceStep.findFirstOrThrow({
      where: { contactServiceId: fixture.id, id: { not: fixture.occurrence.stepId } },
    })
    const foreignTarget = await db.contactServiceStep.findFirstOrThrow({
      where: { contactServiceId: other.id },
    })
    const payload = movementPayload(fixture.occurrence.id, target.id)
    for (const changed of [
      { reason: " " },
      { targetStepId: randomUUID() },
      { targetStepId: foreignTarget.id },
    ])
      assert.equal(
        (await request(movementPath(fixture.id), "POST", { ...payload, ...changed })).status,
        400,
      )
    assert.equal((await request(movementPath(other.id), "POST", payload)).status, 409)
    await db.membership.update({
      where: { userId_tenantId: { tenantId, userId } },
      data: { role: "TENANT_USER", securityLevel: "LOW" },
    })
    assert.equal((await request(movementPath(fixture.id), "POST", payload)).status, 403)
    await db.membership.update({
      where: { userId_tenantId: { tenantId, userId } },
      data: { role: "TENANT_ADMIN", securityLevel: "MAX" },
    })
    const [one, two] = await Promise.all([
      request(movementPath(fixture.id), "POST", payload),
      request(movementPath(fixture.id), "POST", { ...payload, requestId: randomUUID() }),
    ])
    assert.deepEqual([one.status, two.status].sort(), [200, 409])
    const winner = one.status === 200 ? one : two
    assert.equal(
      (
        await request(movementPath(fixture.id), "POST", {
          ...payload,
          expectedOccurrenceId: winner.data.movement.toOccurrenceId,
          reason: "Reused key",
        })
      ).status,
      409,
    )
    await db.contactService.update({ where: { id: fixture.id }, data: { status: "CANCELED" } })
    assert.equal(
      (
        await request(
          movementPath(fixture.id),
          "POST",
          movementPayload(winner.data.movement.toOccurrenceId, fixture.occurrence.stepId),
        )
      ).status,
      409,
    )
    assert.equal(
      await db.serviceStepMovement.count({ where: { tenantId, contactServiceId: fixture.id } }),
      1,
    )
  })
  test("old wait controls cannot bypass a later wait in the same completion run", async () => {
    const fixture = await waitingFixture(false, [
      {
        nodeKey: randomUUID(),
        type: "WAIT",
        waitConfig: { mode: "DURATION", amount: 2, unit: "DAYS" },
      },
      noteAction("After second completion wait"),
    ])
    await fixture.change("CONTINUE")
    await resumeDueAutomationRuns(db)
    const next = (await request(fixture.waitPath)).data.wait
    assert.ok(next)
    assert.notEqual(next.waitingNodeExecutionId, fixture.target.waitingNodeExecutionId)
    await assert.rejects(
      fixture.change("CONTINUE"),
      (error: any) => error.code === "COMPLETION_WAIT_CHANGED",
    )
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "After second completion wait" } }),
      0,
    )
    await fixture.change("CONTINUE", undefined, {
      runId: next.runId,
      waitingNodeExecutionId: next.waitingNodeExecutionId,
      expectedResumeAt: next.resumeAt,
    })
    await resumeDueAutomationRuns(db)
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "After completion wait" } }),
      1,
    )
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "After second completion wait" } }),
      1,
    )
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      2,
    )
  })

  test("wait changes validate permissions, exact context and future schedules and roll back atomically", async () => {
    const fixture = await waitingFixture()
    const other = await fixture.enroll()
    const foreignPath = `${fixture.waitPath.replace(fixture.id, other.id).replace(fixture.occurrence.id, other.occurrence.id)}/reschedule`
    const payload = { ...fixture.target, schedule: { mode: "DURATION", amount: 1, unit: "DAYS" } }
    assert.equal((await request(foreignPath, "POST", payload)).status, 409)
    assert.equal(
      (await request(`${fixture.waitPath}/reschedule`, "POST", { ...payload, runId: randomUUID() }))
        .status,
      404,
    )
    assert.equal(
      (
        await request(`${fixture.waitPath}/reschedule`, "POST", {
          ...payload,
          schedule: { mode: "DURATION", amount: 0, unit: "DAYS" },
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await request(`${fixture.waitPath}/reschedule`, "POST", {
          ...payload,
          schedule: { mode: "FIXED_DATE", dateTime: new Date(Date.now() - 60000).toISOString() },
        })
      ).status,
      400,
    )
    await db.membership.update({
      where: { userId_tenantId: { tenantId, userId } },
      data: { role: "TENANT_USER", securityLevel: "LOW" },
    })
    assert.equal((await request(fixture.waitPath)).status, 200)
    assert.equal(
      (await request(`${fixture.waitPath}/continue`, "POST", fixture.target)).status,
      403,
    )
    assert.equal((await request(`${fixture.waitPath}/reschedule`, "POST", payload)).status, 403)
    await db.membership.update({
      where: { userId_tenantId: { tenantId, userId } },
      data: { role: "TENANT_ADMIN", securityLevel: "MAX" },
    })
    await assert.rejects(
      db.$transaction(async (tx) => {
        await changeServiceStepCompletionWaitTx(tx, {
          tenantId,
          contactServiceId: fixture.id,
          occurrenceId: fixture.occurrence.id,
          actorUserId: userId,
          change: {
            type: "RESCHEDULE",
            ...fixture.target,
            schedule: { mode: "DURATION", amount: 2, unit: "DAYS" },
          },
        })
        throw new Error("Rollback wait change")
      }),
      /Rollback wait change/,
    )
    assert.equal(
      (await request(fixture.waitPath)).data.wait.resumeAt,
      fixture.target.expectedResumeAt,
    )
    assert.equal(
      await db.automationNodeExecution.count({
        where: { tenantId, reasonCode: "WAIT_RESCHEDULED" },
      }),
      0,
    )
    await db.contactService.update({ where: { id: fixture.id }, data: { status: "CANCELED" } })
    assert.equal(
      (await request(`${fixture.waitPath}/continue`, "POST", fixture.target)).status,
      409,
    )
  })

  test("a stale failed worker cannot overwrite wait logs after its claim was revoked", async () => {
    const fixture = await waitingFixture()
    const leaseToken = randomUUID()
    await db.automationRun.update({
      where: { id: fixture.target.runId },
      data: { status: "RUNNING", leaseToken, leaseExpiresAt: new Date(Date.now() + 60000) },
    })
    const reporting = deferred()
    const release = deferred()
    const workerClient = new Proxy(db, {
      get(target, key) {
        if (key === "automationRun")
          return new Proxy(db.automationRun, {
            get(target, key) {
              if (key !== "findFirst") return Reflect.get(target, key)
              return async (args: any) => {
                const run = await db.automationRun.findFirst(args)
                reporting.resolve()
                await release.promise
                return run
              }
            },
          })
        if (key !== "$transaction") return Reflect.get(target, key)
        return (handler: any) =>
          db.$transaction((tx) =>
            handler(
              new Proxy(tx, {
                get(target, key) {
                  if (key !== "contact") return Reflect.get(target, key)
                  return new Proxy(tx.contact, {
                    get(target, key) {
                      if (key !== "findFirst") return Reflect.get(target, key)
                      return async () => {
                        throw new Error("Transient worker failure")
                      }
                    },
                  })
                },
              }),
            ),
          )
      },
    })
    const worker = resumeAutomationRun(workerClient, fixture.target.runId, leaseToken)
    await reporting.promise
    await fixture.change("RESCHEDULE", { mode: "DURATION", amount: 2, unit: "HOURS" })
    release.resolve()
    await worker
    const run = await db.automationRun.findUniqueOrThrow({ where: { id: fixture.target.runId } })
    assert.equal(run.status, "WAITING")
    assert.equal(run.failureCode, null)
    assert.equal(
      (
        await db.automationNodeExecution.findUniqueOrThrow({
          where: { id: fixture.target.waitingNodeExecutionId },
        })
      ).status,
      "WAITING",
    )
    assert.equal(await db.automationExecution.count({ where: { tenantId, status: "FAILED" } }), 0)
  })

  test("wait controls resume a selected branch without replaying routing or previous actions", async () => {
    const nodeKey = randomUUID()
    const fixture = await completionFixture([
      {
        nodeKey: randomUUID(),
        type: "IF_ELSE",
        ifElseConfig: {
          actionName: "Route completion",
          branches: [
            {
              branchKey: randomUUID(),
              name: "Other",
              isDefault: false,
              matchMode: "ALL",
              conditions: [
                {
                  source: "CONTACT_FIELD",
                  fieldKey: "first_name",
                  operator: "EQUALS",
                  compareValue: "Other",
                },
              ],
              actions: [noteAction("Unselected path")],
            },
            {
              branchKey: randomUUID(),
              name: "Default",
              isDefault: true,
              matchMode: "ALL",
              conditions: [],
              actions: [
                noteAction("Before branch wait"),
                {
                  nodeKey,
                  type: "WAIT",
                  waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" },
                },
                noteAction("After branch wait"),
              ],
            },
          ],
        },
      },
    ])
    const response = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    await processCompletionEvent(response.data.occurrence.completionEventId)
    const run = await db.automationRun.findFirstOrThrow({
      where: { tenantId, eventSource: "SERVICE_STEP_COMPLETED" },
    })
    const decisions = run.branchDecisions
    await db.$transaction((tx) =>
      changeServiceStepCompletionWaitTx(tx, {
        tenantId,
        contactServiceId: fixture.id,
        occurrenceId: fixture.occurrence.id,
        actorUserId: userId,
        change: {
          type: "CONTINUE",
          runId: run.id,
          waitingNodeExecutionId: run.waitingNodeExecutionId!,
          expectedResumeAt: run.resumeAt!.toISOString(),
        },
      }),
    )
    await resumeDueAutomationRuns(db)
    assert.deepEqual(
      (await db.automationRun.findUniqueOrThrow({ where: { id: run.id } })).branchDecisions,
      decisions,
    )
    assert.equal(
      await db.contactNote.count({ where: { tenantId, title: "Before branch wait" } }),
      1,
    )
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "After branch wait" } }), 1)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Unselected path" } }), 0)
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      2,
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
