import { patchSavedFollowUpTx } from "./service-saved-followups.js"
import { changeServiceStepDeadlineTx } from "./service-step-deadlines.js"
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
    app.use("/api/tasks", (require("../routes/tasks.routes.js") as typeof import("../routes/tasks.routes.js")).default)
    app.use("/api/services", services)
    app.use("/api/contacts", (require("../routes/contacts.routes.js") as typeof import("../routes/contacts.routes.js")).default)
    app.use("/api/appointments", (require("../routes/appointments.routes.js") as typeof import("../routes/appointments.routes.js")).default)
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
    // Existing service scenarios use the new financial contract by default; individual
    // billing tests supply explicit keys/revisions when exercising conflict behavior.
    if (method === "POST" && /\/contact-services$/.test(path) && body && typeof body === "object") {
      const payload = body as Record<string, unknown>
      const preview = await request(`/api/services/${tenantId}/billing-preview`, "POST", {
        serviceId: payload.serviceId, initialPaymentCents: payload.initialPaymentCents ?? 0,
        ...(payload.paymentTerms ? { paymentTerms: payload.paymentTerms } : {}),
        ...(payload.purchasedAt ? { purchasedAt: payload.purchasedAt } : {}),
      })
      body = { requestKey: randomUUID(), configurationVersion: preview.data.configurationVersion ?? "0".repeat(64), ...payload }
    }
    if (method !== "GET" && /\/contact-services\/[^/]+\/payments(?:\/[^/]+)?$/.test(path)) {
      const id = path.split("/contact-services/")[1].split("/")[0]
      const account = await db.contactService.findFirst({ where: { tenantId, id }, select: { financialRevision: true } })
      body = { requestKey: randomUUID(), expectedRevision: account?.financialRevision ?? 0,
        ...(method !== "POST" ? { reason: "Correcting the test receipt" } : {}), ...(body as Record<string, unknown> ?? {}) }
    }
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
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [{ title: "Review", completionDuration: 1, completionUnit: "DAYS" }] })
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
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [{ title: "Review", completionDuration: 1, completionUnit: "DAYS" }] })
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
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [{ title: "Review", completionDuration: 1, completionUnit: "DAYS" }] })
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
    assert.equal(invalid.status, 201, JSON.stringify(invalid.data))
    assert.equal(await db.contactService.count({ where: { tenantId } }), 3)
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
      await processTestClaimedEvent(db, { eventId: queued.automationEventId!, leaseToken })
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
    const childFinished = await db.automationRun.findUniqueOrThrow({ where: { id: chained.id } })
    assert.equal(childFinished.status, "SUCCEEDED", childFinished.failureMessage ?? undefined)
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
        await tx.automationExecutionLease.deleteMany({ where: { kind: "EVENT", jobId: claimed[0]!.id, leaseToken: claimed[0]!.leaseToken } })
        await tx.automationEvent.update({
          where: { id: claimed[0]!.id },
          data: { status: "QUEUED", leaseToken: null, leaseExpiresAt: null, updatedAt: events[0]!.updatedAt },
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
    assert.equal(await db.automationEvent.count({ where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" } }), 2)
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
      await processTestClaimedEvent(db, { eventId, leaseToken })
      await processTestClaimedEvent(db, { eventId, leaseToken })
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
    await reviewAndApplyConfiguration(enrollmentIds[0]!)
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
    assert.equal(await db.automationEvent.count({ where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" } }), 3)
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { tenantId, entryKey: "rolled-back" } }),
      0,
    )
    assert.equal(
      (await request(automationPath, "PATCH", { ...payload, isEnabled: false })).status,
      200,
    )
    await enroll()
    assert.equal(await db.automationEvent.count({ where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" } }), 3)
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
    assert.equal(await db.automationEvent.count({ where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" } }), 0)
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
    assert.equal(await db.automationEvent.count({ where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" } }), 0)
    // Even a corrupt enabled-but-empty draft must not queue work.
    await db.automationAction.deleteMany({ where: { tenantId, automationId } })
    assert.equal((await enroll()).status, 201)
    assert.equal(await db.automationEvent.count({ where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" } }), 0)
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
  async function processTestClaimedEvent(client: PrismaClient, params: { eventId: string; leaseToken: string }) {
    const event = await client.automationEvent.findUniqueOrThrow({ where: { id: params.eventId } })
    if (event.status === "PROCESSING" && event.leaseToken === params.leaseToken) await client.automationExecutionLease.upsert({
      where: { kind_jobId: { kind: "EVENT", jobId: event.id } },
      create: { kind: "EVENT", jobId: event.id, tenantId: event.tenantId, scopeKey: `${event.tenantId}:contact:${event.contactId ?? event.id}`, leaseToken: params.leaseToken, expiresAt: new Date(Date.now() + 120000) },
      update: { leaseToken: params.leaseToken, expiresAt: new Date(Date.now() + 120000) },
    })
    try { return await processClaimedAutomationEvent(client, { ...params, wakeWorkers: false }) }
    finally { await client.automationExecutionLease.deleteMany({ where: { kind: "EVENT", jobId: event.id, leaseToken: params.leaseToken } }) }
  }
  async function processCompletionEvent(eventId: string) {
    const leaseToken = randomUUID()
    await db.automationEvent.update({
      where: { id: eventId },
      data: { status: "PROCESSING", leaseToken },
    })
    await processTestClaimedEvent(db, { eventId, leaseToken })
    await processTestClaimedEvent(db, { eventId, leaseToken })
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
    await reviewAndApplyConfiguration(fixture.id)
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
    assert.equal((await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: second.occurrence.id } })).progressionStatus, "WAITING_AUTOMATION")
    // One enrollment executes serially, even when worker passes overlap.
    await resumeDueAutomationRuns(db)
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
    await reviewAndApplyConfiguration(fixture.id)
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
    await reviewAndApplyConfiguration(fixture.id)
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
    await reviewAndApplyConfiguration(enrollment.id)
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

  const deadlinePath = (id: string, occurrenceId: string) =>
    `/api/services/${tenantId}/contact-services/${id}/step-occurrences/${occurrenceId}/deadline`
  const deadlinePayload = (revision = 0, amount = 20) => ({
    requestId: randomUUID(),
    expectedDeadlineRevision: revision,
    schedule: { mode: "DURATION" as const, amount, unit: "DAYS" as const },
  })

  test("twenty-day deadlines affect only the selected entry, without changing configuration or queueing automations", async () => {
    const fixture = await completionFixture()
    const sameContact = await fixture.enroll()
    const otherContact = await createContact()
    const purchased = await request(`/api/services/${tenantId}/contact-services`, "POST", {
      serviceId: fixture.child.data.service.id,
      contactId: otherContact.id,
    })
    assert.equal(purchased.status, 201)
    const other = await db.serviceStepOccurrence.findFirstOrThrow({
      where: { contactServiceId: purchased.data.contactService.id, status: "ACTIVE" },
    })
    const eventCount = await db.automationEvent.count({ where: { tenantId } })
    const result = await request(
      deadlinePath(fixture.id, fixture.occurrence.id),
      "POST",
      deadlinePayload(),
    )
    assert.equal(result.status, 200, JSON.stringify(result.data))
    const changed = result.data.occurrence
    assert.equal(
      new Date(changed.dueAt).getTime() - fixture.occurrence.enteredAt.getTime(),
      20 * 86400000,
    )
    assert.equal(changed.defaultDueAt, fixture.occurrence.dueAt.toISOString())
    assert.deepEqual(changed.deadlineOverride, { mode: "DURATION", amount: 20, unit: "DAYS" })
    assert.equal(changed.deadlineChanges.length, 1)
    assert.equal(changed.deadlineChanges[0].actorName, "Hierarchy tester")
    assert.equal(
      (
        await db.serviceStepOccurrence.findUniqueOrThrow({
          where: { id: sameContact.occurrence.id },
        })
      ).dueAt.toISOString(),
      sameContact.occurrence.dueAt.toISOString(),
    )
    assert.equal(
      (
        await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: other.id } })
      ).dueAt.toISOString(),
      other.dueAt.toISOString(),
    )
    assert.equal(
      (await db.serviceStep.findUniqueOrThrow({ where: { id: fixture.source.id } }))
        .completionDuration,
      3,
    )
    assert.equal(
      await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }),
      1,
    )
    assert.equal(await db.automationEvent.count({ where: { tenantId } }), eventCount)
    const loaded = await request(`/api/services/${tenantId}/contact-services/${fixture.id}`)
    assert.equal(loaded.data.contactService.serviceSteps[0].occurrences[0].deadlineRevision, 1)
    assert.equal(
      loaded.data.contactService.serviceSteps[0].occurrences[0].deadlineChanges.length,
      1,
    )
  })

  test("fixed deadlines normalize offsets and restore the frozen default after parent configuration changes", async () => {
    const fixture = await completionFixture()
    const dateTime = new Date(fixture.occurrence.enteredAt.getTime() + 5 * 86400000)
      .toISOString()
      .replace("Z", "+00:00")
    const path = deadlinePath(fixture.id, fixture.occurrence.id)
    const changed = await request(path, "POST", {
      requestId: randomUUID(),
      expectedDeadlineRevision: 0,
      schedule: { mode: "FIXED_DATE", dateTime },
    })
    assert.equal(changed.status, 200)
    assert.equal(changed.data.occurrence.dueAt, new Date(dateTime).toISOString())
    const configured = (await request(`${settingsPath()}/${parentId}`)).data.service.steps
    await request(`${settingsPath()}/${parentId}`, "PATCH", {
      steps: configured.map((step: any) => ({
        id: step.id,
        title: step.title,
        completionDuration: 99,
        completionUnit: "DAYS",
      })),
    })
    const restored = await request(path, "POST", {
      requestId: randomUUID(),
      expectedDeadlineRevision: 1,
      schedule: { mode: "DEFAULT" },
    })
    assert.equal(restored.status, 200)
    assert.equal(restored.data.occurrence.dueAt, fixture.occurrence.dueAt.toISOString())
    assert.equal(restored.data.occurrence.deadlineOverride, null)
    assert.equal(restored.data.occurrence.deadlineRevision, 2)
    assert.equal(restored.data.occurrence.deadlineChanges.length, 2)
    const future = await fixture.enroll()
    assert.equal(
      future.occurrence.dueAt.getTime() - future.occurrence.enteredAt.getTime(),
      99 * 86400000,
    )
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [] })
    const archived = await request(path, "POST", deadlinePayload(2))
    assert.equal(archived.status, 200)
    assert.equal(
      archived.data.occurrence.defaultDueAt,
      fixture.occurrence.defaultDueAt.toISOString(),
    )
  })

  test("completion and revisits retain old deadline history and start later entries with their own default", async () => {
    const fixture = await completionFixture()
    const path = deadlinePath(fixture.id, fixture.occurrence.id)
    const payload = deadlinePayload()
    const changed = await request(path, "POST", payload)
    const completed = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    assert.equal(completed.status, 200)
    const next = await db.serviceStepOccurrence.findFirstOrThrow({
      where: { contactServiceId: fixture.id, status: "ACTIVE" },
    })
    assert.equal(next.dueAt.getTime() - next.enteredAt.getTime(), 3 * 86400000)
    assert.equal(next.defaultDueAt.toISOString(), next.dueAt.toISOString())
    const moved = await request(
      movementPath(fixture.id),
      "POST",
      movementPayload(next.id, fixture.occurrence.stepId),
    )
    assert.equal(moved.status, 200)
    const revisited = await db.serviceStepOccurrence.findUniqueOrThrow({
      where: { id: moved.data.movement.toOccurrenceId },
      include: { deadlineChanges: true },
    })
    assert.equal(revisited.occurrenceNumber, 2)
    assert.equal(revisited.deadlineOverride, null)
    assert.equal(revisited.deadlineRevision, 0)
    assert.equal(revisited.deadlineChanges.length, 0)
    assert.equal(revisited.dueAt.getTime() - revisited.enteredAt.getTime(), 3 * 86400000)
    assert.equal((await request(path, "POST", deadlinePayload(1, 40))).status, 409)
    assert.equal((await request(path, "POST", payload)).status, 200)
    const original = await db.serviceStepOccurrence.findUniqueOrThrow({
      where: { id: fixture.occurrence.id },
    })
    assert.equal(original.dueAt.toISOString(), changed.data.occurrence.dueAt)
    assert.equal(original.status, "COMPLETED")
  })

  const queuePath = () => `/api/services/${tenantId}/follow-ups`

  test("queue sorts effective deadlines across pages and reflects overrides and restores immediately", async () => {
    const fixture = await completionFixture()
    const entries = [{ id: fixture.id, occurrence: fixture.occurrence }]
    for (let index = 1; index < 12; index++) entries.push(await fixture.enroll())
    const now = Date.now()
    for (const [index, enrollment] of entries.entries()) {
      const dueAt = new Date(now + (index - 5) * 3600000)
      await db.serviceStepOccurrence.update({ where: { id: enrollment.occurrence.id }, data: {
        enteredAt: new Date(now - 2 * 86400000), dueAt, defaultDueAt: dueAt,
      } })
    }
    const first = await request(queuePath())
    assert.equal(first.status, 200, JSON.stringify(first.data))
    assert.equal(first.data.pagination.total, 12)
    assert.deepEqual(first.data.items.map((item: any) => item.id), entries.slice(0, 10).map(item => item.id))
    assert.equal(first.data.items[0].timing.status, "OVERDUE")
    assert.equal(first.data.items[0].queueState, "ACTIONABLE")
    assert.equal(first.data.summary.overdueEnrollments, 6)
    assert.equal(first.data.summary.dueSoon, 6)
    assert.equal((await request(`${queuePath()}?dueDatePreset=DUE_SOON`)).data.pagination.total, 6)
    assert.equal(first.data.items[0].progress.totalCount, 2)
    assert.equal(first.data.items[0].progress.completedCount, 0)
    assert.equal(first.data.items[0].parentService.id, parentId)
    assert.equal((await request(deadlinePath(fixture.id, fixture.occurrence.id), "POST", deadlinePayload())).status, 200)
    const changed = await request(queuePath())
    assert.equal(changed.data.items[0].id, entries[1]!.id)
    assert.equal(changed.data.summary.overdueEnrollments, 5)
    const lastPage = await request(`${queuePath()}?page=2`)
    assert.equal(lastPage.data.items[1].id, fixture.id)
    assert.equal(lastPage.data.items[1].timing.status, "ON_TRACK")
    assert.equal(lastPage.data.items[1].timing.timeframeMs, 20 * 86400000)
    assert.equal((await request(deadlinePath(fixture.id, fixture.occurrence.id), "POST", {
      requestId: randomUUID(), expectedDeadlineRevision: 1, schedule: { mode: "DEFAULT" },
    })).status, 200)
    assert.equal((await request(queuePath())).data.items[0].id, fixture.id)
    assert.equal((await request(`${queuePath()}?dueDatePreset=OVERDUE`)).data.pagination.total, 6)
    assert.equal((await request(`${queuePath()}?search=Medicare`)).data.pagination.total, 12)
    assert.equal((await request(`${queuePath()}?queueState=INVALID`)).status, 400)
    await db.contactService.update({ where: { id: fixture.id }, data: { status: "CANCELED" } })
    assert.equal((await request(queuePath())).data.pagination.total, 11)
    const foreign = await db.tenant.create({ data: { name: "Foreign queue", slug: randomUUID() } })
    try { assert.equal((await request(`/api/services/${foreign.id}/follow-ups`)).status, 403) }
    finally { await db.tenant.delete({ where: { id: foreign.id } }) }
  })

  test("queue separates completion waits and failed progression from actionable deadlines", async () => {
    const nodeKey = randomUUID()
    const fixture = await completionFixture([
      { nodeKey, type: "WAIT", waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" } }, noteAction(),
    ])
    const now = Date.now()
    await db.serviceStepOccurrence.update({ where: { id: fixture.occurrence.id }, data: {
      enteredAt: new Date(now - 10 * 86400000), dueAt: new Date(now - 86400000),
    } })
    assert.equal((await request(queuePath())).data.items[0].overdue, true)
    const completed = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    await processCompletionEvent(completed.data.occurrence.completionEventId)
    const run = await db.automationRun.findFirstOrThrow({ where: { tenantId, eventSource: "SERVICE_STEP_COMPLETED" } })
    const scheduled = await request(`${queuePath()}?queueState=SCHEDULED`)
    assert.equal(scheduled.data.pagination.total, 1)
    const row = scheduled.data.items[0]
    assert.equal(row.scheduledAt, run.resumeAt?.toISOString())
    assert.equal(row.currentStep.occurrenceId, fixture.occurrence.id)
    assert.equal(row.currentStep.effectiveDueAt, null)
    assert.equal(row.timing.status, "NONE")
    assert.equal(row.overdue, false)
    assert.equal(scheduled.data.summary.overdueEnrollments, 0)
    assert.equal((await request(`${queuePath()}?queueState=ACTIONABLE`)).data.pagination.total, 0)
    assert.equal((await request(`${queuePath()}?dueDatePreset=OVERDUE`)).data.pagination.total, 0)
    // An overdue resume time belongs to the automation worker, not an unentered step.
    await db.automationRun.update({ where: { id: run.id }, data: { resumeAt: new Date(now - 1000) } })
    assert.equal((await request(queuePath())).data.items[0].overdue, false)
    await exitAutomationWaitingRun(db, { tenantId, automationId: fixture.automation.id, runId: run.id,
      nodeKey, actorUserId: userId, actorDisplayName: "Tester" })
    const paused = await request(`${queuePath()}?queueState=NEEDS_ATTENTION`)
    assert.equal(paused.data.pagination.total, 1)
    assert.equal(paused.data.items[0].overdue, false)
    assert.equal(paused.data.items[0].scheduledAt, null)
    assert.ok(paused.data.items[0].queueMessage)
  })

  test("queue retains legacy follow-ups and does not mark future pending work overdue", async () => {
    const fixture = await completionFixture()
    const legacy = await fixture.enroll()
    const now = Date.now()
    await db.contactService.update({ where: { id: legacy.id }, data: { workflowKind: "LEGACY_TEMPLATE" } })
    const active = await db.contactServiceFollowUpStep.create({ data: {
      tenantId, contactServiceId: legacy.id, title: "Legacy review", status: "ACTIVE",
      availableAt: new Date(now - 4 * 3600000), dueAt: new Date(now - 3600000), assignedToUserId: userId,
    } })
    const pending = await db.contactServiceFollowUpStep.create({ data: {
      tenantId, contactServiceId: legacy.id, title: "Future review", status: "PENDING", sortOrder: 1,
      availableAt: new Date(now + 86400000), dueAt: new Date(now - 3600000),
    } })
    const mixed = (await request(queuePath())).data
    assert.equal(mixed.pagination.total, 2)
    assert.equal(mixed.items[0].id, legacy.id)
    assert.equal(mixed.items[0].overdue, true)
    assert.equal(mixed.items[0].currentStep.id, active.id)
    const owned = (await request(`${queuePath()}?assignedToUserId=${userId}`)).data
    assert.equal(owned.pagination.total, 1)
    const future = (await request(`${queuePath()}?status=PENDING&queueState=SCHEDULED`)).data
    assert.equal(future.pagination.total, 1)
    assert.equal(future.items[0].currentStep.id, pending.id)
    assert.equal(future.items[0].timing.status, "NONE")
    assert.equal(future.items[0].scheduledAt, pending.availableAt?.toISOString())
    assert.equal((await request(`${queuePath()}?status=PENDING&dueDatePreset=OVERDUE`)).data.pagination.total, 0)
    await db.contactServiceFollowUpStep.update({ where: { id: active.id }, data: { status: "COMPLETED" } })
    assert.equal((await request(`${queuePath()}?queueState=SCHEDULED`)).data.pagination.total, 1)
    // A migrated/unentered service step has no occurrence clock, regardless of its old template rows.
    await db.serviceStepOccurrence.deleteMany({ where: { contactServiceId: fixture.id } })
    const unentered = (await request(`${queuePath()}?queueState=NEEDS_ATTENTION`)).data.items[0]
    assert.equal(unentered.id, fixture.id)
    assert.equal(unentered.currentStep, null)
    assert.equal(unentered.overdue, false)
    assert.equal(unentered.timing.remainingMs, null)
  })

  test("queue movement selects fresh entries and finished unpaid work has no urgency", async () => {
    const fixture = await completionFixture()
    const original = fixture.occurrence
    await request(deadlinePath(fixture.id, original.id), "POST", deadlinePayload())
    const steps = await db.contactServiceStep.findMany({ where: { contactServiceId: fixture.id }, orderBy: { sortOrder: "asc" } })
    const moved = await request(movementPath(fixture.id), "POST", movementPayload(original.id, steps[1]!.id))
    assert.equal(moved.status, 200, JSON.stringify(moved.data))
    const forward = (await request(queuePath())).data.items[0]
    assert.equal(forward.currentStep.id, steps[1]!.id)
    assert.equal(forward.currentStep.occurrenceId, moved.data.movement.toOccurrenceId)
    assert.equal(forward.timing.timeframeMs, 3 * 86400000)
    const revisited = await request(movementPath(fixture.id), "POST", movementPayload(forward.currentStep.occurrenceId, steps[0]!.id))
    assert.equal(revisited.status, 200)
    const back = (await request(queuePath())).data.items[0]
    assert.notEqual(back.currentStep.occurrenceId, original.id)
    assert.equal(back.timing.timeframeMs, 3 * 86400000)
    assert.equal(back.timing.status, "ON_TRACK")
    await request(completePath(fixture.id, back.currentStep.occurrenceId), "POST")
    const next = (await request(queuePath())).data.items[0]
    await request(completePath(fixture.id, next.currentStep.occurrenceId), "POST")
    const finished = (await request(`${queuePath()}?queueState=FINISHED`)).data
    assert.equal(finished.pagination.total, 1)
    assert.equal(finished.items[0].status, "PENDING_PAYMENT")
    assert.equal(finished.items[0].timing.status, "NONE")
    assert.equal(finished.items[0].progress.completionPercentage, 100)
    assert.equal(finished.summary.servicesInProgress, 0)
    assert.equal((await request(`${queuePath()}?queueState=ACTIONABLE`)).data.pagination.total, 0)
  })

  test("deadline changes leave scoped automation waits intact and cannot reschedule completion waits", async () => {
    const wait = {
      nodeKey: randomUUID(),
      type: "WAIT",
      waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" },
    }
    const fixture = await completionFixture([wait, noteAction("Completion after wait")])
    const entry = await request(`/api/account-settings/${tenantId}/automations`, "POST", {
      name: "Entry wait",
      trigger: {
        type: "SERVICE_STEP_ENTERED",
        serviceStepId: fixture.source.id,
        serviceOfferingId: fixture.child.data.service.id,
      },
      isEnabled: true,
      conditions: [],
      actions: [{ ...wait, nodeKey: randomUUID() }, noteAction("Entry after wait")],
    })
    assert.equal(entry.status, 201)
    const enrollment = await fixture.enroll()
    const event = await db.automationEvent.findFirstOrThrow({
      where: {
        tenantId,
        triggerType: "SERVICE_STEP_ENTERED",
        serviceContext: { path: ["contactServiceId"], equals: enrollment.id },
      },
    })
    await processCompletionEvent(event.id)
    const run = await db.automationRun.findFirstOrThrow({
      where: { dispatch: { eventId: event.id } },
    })
    assert.equal(run.status, "WAITING")
    const path = deadlinePath(enrollment.id, enrollment.occurrence.id)
    assert.equal((await request(path, "POST", deadlinePayload())).status, 200)
    const untouched = await db.automationRun.findUniqueOrThrow({ where: { id: run.id } })
    assert.equal(untouched.resumeAt?.toISOString(), run.resumeAt?.toISOString())
    assert.equal(untouched.status, "WAITING")
    const completed = await request(completePath(enrollment.id, enrollment.occurrence.id), "POST")
    await processCompletionEvent(completed.data.occurrence.completionEventId)
    const completionRun = await db.automationRun.findFirstOrThrow({
      where: { dispatch: { eventId: completed.data.occurrence.completionEventId } },
    })
    assert.equal(
      (
        await request(path, "POST", {
          requestId: randomUUID(),
          expectedDeadlineRevision: 1,
          schedule: { mode: "DEFAULT" },
        })
      ).status,
      409,
    )
    assert.equal(
      (
        await db.automationRun.findUniqueOrThrow({ where: { id: completionRun.id } })
      ).resumeAt?.toISOString(),
      completionRun.resumeAt?.toISOString(),
    )
  })

  test("deadline revisions serialize concurrent edits and identical retries do not duplicate history", async () => {
    const fixture = await completionFixture()
    const path = deadlinePath(fixture.id, fixture.occurrence.id)
    const payload = deadlinePayload()
    assert.equal((await request(path, "POST", payload)).status, 200)
    const retry = await request(path, "POST", payload)
    assert.equal(retry.status, 200)
    assert.equal(retry.data.occurrence.deadlineChanges.length, 1)
    assert.equal(
      (await request(path, "POST", { ...payload, schedule: { mode: "DEFAULT" } })).status,
      409,
    )
    assert.equal((await request(path, "POST", deadlinePayload())).status, 409)
    const results = await Promise.all([
      request(path, "POST", deadlinePayload(1, 30)),
      request(path, "POST", deadlinePayload(1, 40)),
    ])
    assert.deepEqual(results.map((item) => item.status).sort(), [200, 409])
    const saved = results.find((item) => item.status === 200)!.data.occurrence
    const unchanged = await request(path, "POST", {
      requestId: randomUUID(),
      expectedDeadlineRevision: saved.deadlineRevision,
      schedule: saved.deadlineOverride,
    })
    assert.equal(unchanged.data.occurrence.deadlineRevision, 2)
    assert.equal(await db.serviceStepDeadlineChange.count({ where: { tenantId } }), 2)
    const restore = {
      requestId: randomUUID(),
      expectedDeadlineRevision: 2,
      schedule: { mode: "DEFAULT" },
    }
    assert.equal((await request(path, "POST", restore)).status, 200)
    assert.equal(
      (
        await request(path, "POST", {
          ...restore,
          requestId: randomUUID(),
          expectedDeadlineRevision: 3,
        })
      ).data.occurrence.deadlineRevision,
      3,
    )
  })

  test("deadline validation, permissions, isolation and rollback preserve the complete entry", async () => {
    const fixture = await completionFixture()
    const other = await fixture.enroll()
    const path = deadlinePath(fixture.id, fixture.occurrence.id)
    assert.equal(
      (await request(deadlinePath(other.id, fixture.occurrence.id), "POST", deadlinePayload()))
        .status,
      404,
    )
    assert.equal(
      (await request(deadlinePath(fixture.id, randomUUID()), "POST", deadlinePayload())).status,
      404,
    )
    for (const schedule of [
      { mode: "DURATION", amount: 0, unit: "DAYS" },
      { mode: "DURATION", amount: 3651, unit: "DAYS" },
      { mode: "FIXED_DATE", dateTime: fixture.occurrence.enteredAt.toISOString() },
    ])
      assert.equal((await request(path, "POST", { ...deadlinePayload(), schedule })).status, 400)
    await db.membership.update({
      where: { userId_tenantId: { tenantId, userId } },
      data: { role: "TENANT_USER", securityLevel: "LOW" },
    })
    assert.equal((await request(path, "POST", deadlinePayload())).status, 403)
    await db.membership.update({
      where: { userId_tenantId: { tenantId, userId } },
      data: { securityLevel: "MEDIUM" },
    })
    assert.equal((await request(path, "POST", deadlinePayload())).status, 200)
    await assert.rejects(
      db.$transaction(async (tx) => {
        await changeServiceStepDeadlineTx(tx, {
          tenantId,
          contactServiceId: fixture.id,
          occurrenceId: fixture.occurrence.id,
          actorUserId: userId,
          ...deadlinePayload(1, 30),
        })
        throw new Error("Rollback deadline")
      }),
      /Rollback deadline/,
    )
    assert.equal(
      (await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } }))
        .deadlineRevision,
      1,
    )
    assert.equal(await db.serviceStepDeadlineChange.count({ where: { tenantId } }), 1)
    await db.membership.update({
      where: { userId_tenantId: { tenantId, userId } },
      data: { status: "DISABLED" },
    })
    assert.equal((await request(path, "POST", deadlinePayload(1))).status, 403)
    await db.membership.update({
      where: { userId_tenantId: { tenantId, userId } },
      data: { status: "ACTIVE" },
    })
    await db.contactService.update({ where: { id: fixture.id }, data: { status: "CANCELED" } })
    assert.equal((await request(path, "POST", deadlinePayload(1))).status, 409)
  })

  test("a move holding the enrollment lock rejects a stale deadline edit without touching the destination", async () => {
    const fixture = await completionFixture()
    const destination = await db.contactServiceStep.findFirstOrThrow({
      where: { contactServiceId: fixture.id, id: { not: fixture.occurrence.stepId } },
    })
    const entered = deferred()
    const release = deferred()
    const moving = db.$transaction((tx) =>
      moveServiceStepTx(
        new Proxy(tx, {
          get(target, key) {
            if (key !== "contactServiceStep") return Reflect.get(target, key)
            return new Proxy(tx.contactServiceStep, {
              get(target, key) {
                if (key !== "findMany") return Reflect.get(target, key)
                return async (args: any) => {
                  entered.resolve()
                  await release.promise
                  return tx.contactServiceStep.findMany(args)
                }
              },
            })
          },
        }),
        {
          tenantId,
          contactServiceId: fixture.id,
          actorUserId: userId,
          ...movementPayload(fixture.occurrence.id, destination.id),
        },
      ),
    )
    await entered.promise
    const attempted = deferred()
    let finished = false
    const editing = db
      .$transaction((tx) =>
        changeServiceStepDeadlineTx(
          new Proxy(tx, {
            get(target, key) {
              if (key !== "$queryRaw") return Reflect.get(target, key)
              return (...args: any[]) => {
                attempted.resolve()
                return (tx.$queryRaw as any)(...args)
              }
            },
          }),
          {
            tenantId,
            contactServiceId: fixture.id,
            occurrenceId: fixture.occurrence.id,
            actorUserId: userId,
            ...deadlinePayload(),
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
    await attempted.promise
    assert.equal(finished, false)
    release.resolve()
    const moved = await moving
    assert.equal((await editing).code, "SERVICE_STEP_DEADLINE_CHANGED")
    assert.equal(await db.serviceStepDeadlineChange.count({ where: { tenantId } }), 0)
    const current = await db.serviceStepOccurrence.findUniqueOrThrow({
      where: { id: moved.toOccurrenceId! },
    })
    assert.equal(current.dueAt.toISOString(), current.defaultDueAt.toISOString())
    assert.equal(current.deadlineRevision, 0)
  })

  test("deadline migration freezes existing defaults without creating overrides or altering history", async () => {
    const pool = new Pool({ connectionString: databaseUrl! })
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const schema = `deadline_${randomUUID().replaceAll("-", "")}`
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET LOCAL search_path TO "${schema}"`)
      await client.query(
        'CREATE TABLE "ServiceStepOccurrence" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "contactServiceId" TEXT NOT NULL, "dueAt" TIMESTAMP(3) NOT NULL)',
      )
      await client.query('INSERT INTO "ServiceStepOccurrence" VALUES ($1,$2,$3,$4)', [
        "old-entry",
        "tenant",
        "enrollment",
        "2026-01-21T12:00:00.123Z",
      ])
      await client.query(
        readFileSync(
          resolve(
            __dirname,
            "../../prisma/migrations/20261021000000_service_step_deadlines/migration.sql",
          ),
          "utf8",
        ),
      )
      const row = (await client.query('SELECT * FROM "ServiceStepOccurrence"')).rows[0]
      assert.equal(row.defaultDueAt.getTime(), row.dueAt.getTime())
      assert.equal(row.deadlineOverride, null)
      assert.equal(row.deadlineRevision, 0)
      assert.equal(
        (await client.query('SELECT COUNT(*) FROM "ServiceStepDeadlineChange"')).rows[0].count,
        "0",
      )
    } finally {
      await client.query("ROLLBACK")
      client.release()
      await pool.end()
    }
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

  test("service actions save, pin, checkpoint, deduplicate and retain owners through revisits", async () => {
    const configuration = await configureParent()
    const fixture = await completionFixture()
    const action = (type: string, serviceConfig: unknown) => ({ nodeKey: randomUUID(), type, serviceConfig })
    const actions = [
      action("SET_SERVICE_STEP_OWNER", { assignedToUserId: userId }),
      action("SET_SERVICE_COORDINATOR", { assignedToUserId: userId }),
      action("SET_SERVICE_PROFESSIONAL", { professionalId: configuration.professionals[0].id }),
      action("SET_SERVICE_CHECKLIST_STATUS", { checklistItemId: configuration.checklistItems[0].id, status: "RECEIVED" }),
      action("SCHEDULE_SERVICE_STEP", { schedule: { mode: "DURATION", amount: 2, unit: "HOURS" } }),
      action("SCHEDULE_SERVICE_STEP", { schedule: { mode: "FIXED_DATE", dateTime: new Date(Date.now() + 86400000).toISOString() } }),
      action("SCHEDULE_SERVICE_STEP", { schedule: { mode: "DEFAULT" } }),
      action("SET_SERVICE_STATUS", { status: "IN_PROGRESS" }),
      noteAction("After service checkpoints"),
    ]
    const entry = fixture.source.automations.find((item: any) => item.triggerType === "SERVICE_STEP_ENTERED")
    const path = `/api/account-settings/${tenantId}/automations/${entry.id}`
    const payload = { name: "Service updates", trigger: { type: "SERVICE_STEP_ENTERED", serviceStepId: fixture.source.id, serviceOfferingId: fixture.child.data.service.id }, isEnabled: true, conditions: [], actions }
    const saved = await request(path, "PATCH", payload)
    assert.equal(saved.status, 200, JSON.stringify(saved.data))
    const reloaded = (await request(path)).data.automation.actions
    assert.deepEqual(reloaded.map((item: any) => item.serviceConfig), actions.map((item: any) => item.serviceConfig ?? null))
    const enrollment = await fixture.enroll()
    const event = await db.automationEvent.findFirstOrThrow({ where: { tenantId, triggerType: "SERVICE_STEP_ENTERED", serviceContext: { path: ["contactServiceId"], equals: enrollment.id } }, include: { dispatches: true } })
    assert.deepEqual((event.dispatches[0]!.actionSnapshot as any[])[0].serviceConfig, (actions[0] as any).serviceConfig)
    // A later edit cannot change the pinned work.
    assert.equal((await request(path, "PATCH", { ...payload, actions: [action("SET_SERVICE_STEP_OWNER", { assignedToUserId: null })] })).status, 200)
    await processCompletionEvent(event.id)
    let run = await db.automationRun.findFirstOrThrow({ where: { dispatchId: event.dispatches[0]!.id } })
    assert.equal(run.status, "QUEUED")
    assert.equal(run.cursorIndex, 1)
    assert.equal(await db.serviceAutomationActionResult.count({ where: { runId: run.id } }), 1)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "After service checkpoints" } }), 0)
    for (let pass = 0; pass < 80 && !["FAILED", "SUCCEEDED"].includes(run.status); pass++) {
      await new Promise(resolve => setTimeout(resolve, 15))
      await resumeDueAutomationRuns(db)
      run = await db.automationRun.findUniqueOrThrow({ where: { id: run.id } })
    }
    assert.equal(run.status, "SUCCEEDED", run.failureMessage ?? undefined)
    assert.equal(await db.serviceAutomationActionResult.count({ where: { runId: run.id } }), 8)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "After service checkpoints" } }), 1)
    const ownerStep = await db.contactServiceStep.findUniqueOrThrow({ where: { id: enrollment.occurrence.stepId } })
    assert.equal(ownerStep.assignedToUserId, userId)
    const updated = await db.contactService.findUniqueOrThrow({ where: { id: enrollment.id } })
    assert.equal(updated.followUpCoordinatorUserId, userId)
    assert.equal(updated.assignedProfessionalId, configuration.professionals[0].id)
    const checklist = await db.contactServiceChecklistItem.findFirstOrThrow({ where: { contactServiceId: enrollment.id } })
    assert.equal(checklist.status, "RECEIVED")
    assert.ok(checklist.completedAt)
    assert.equal(await db.contactServiceChecklistActivity.count({ where: { contactServiceId: enrollment.id } }), 1)
    const { executeServiceActionTx } = await import("./service-automation-actions.js")
    await db.$transaction(tx => executeServiceActionTx(tx, { tenantId, contactId: fixture.contact.id, runId: run.id, automationId: entry.id, automationName: "Service updates", actorUserId: userId, action: actions[3] as any }))
    assert.equal(await db.contactServiceChecklistActivity.count({ where: { contactServiceId: enrollment.id } }), 1)
    const automationAudit = await db.serviceFollowUpExecutionLog.findFirstOrThrow({ where: { contactServiceId: enrollment.id, eventType: "SET_SERVICE_STEP_OWNER" } })
    assert.equal(automationAudit.actorUserId, null)
    assert.equal((automationAudit.payload as any).automationSource.runId, run.id)
    assert.equal((await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: enrollment.occurrence.id } })).deadlineOverride, null)
    const queue = await request(`/api/services/${tenantId}/follow-ups?assignedToUserId=${userId}`)
    assert.ok(queue.data.items.some((item: any) => item.id === enrollment.id && item.currentStep.assignedToUserId === userId), JSON.stringify(queue.data))
    const second = await db.contactServiceStep.findFirstOrThrow({ where: { contactServiceId: enrollment.id, id: { not: ownerStep.id } } })
    const moved = await db.$transaction(tx => moveServiceStepTx(tx, { tenantId, contactServiceId: enrollment.id, actorUserId: userId, requestId: randomUUID(), expectedOccurrenceId: enrollment.occurrence.id, kind: "MOVE", targetStepId: second.id, reason: "Advance" }))
    await db.$transaction(tx => moveServiceStepTx(tx, { tenantId, contactServiceId: enrollment.id, actorUserId: userId, requestId: randomUUID(), expectedOccurrenceId: moved.toOccurrenceId!, kind: "MOVE", targetStepId: ownerStep.id, reason: "Revisit" }))
    assert.equal((await db.contactServiceStep.findUniqueOrThrow({ where: { id: ownerStep.id } })).assignedToUserId, userId)
    const ownerPath = `/api/services/${tenantId}/contact-services/${enrollment.id}/service-steps/${ownerStep.id}/owner`
    assert.equal((await request(ownerPath, "PATCH", { assignedToUserId: null })).status, 200)
    assert.equal((await db.contactServiceStep.findUniqueOrThrow({ where: { id: ownerStep.id } })).assignedToUserId, null)
    assert.equal((await request(ownerPath, "PATCH", { assignedToUserId: randomUUID() })).status, 400)
    assert.equal((await request(`/api/services/${tenantId}/contact-services/${enrollment.id}/follow-up-coordinator`, "PATCH", { assignedToUserId: null })).status, 200)
  })

  for (const terminalType of ["MOVE_SERVICE_STEP", "SKIP_SERVICE_STEP", "COMPLETE_SERVICE_STEP", "SET_SERVICE_STATUS"]) {
    test(`${terminalType} terminates its path and only affects the triggering enrollment`, async () => {
      const fixture = await completionFixture()
      const target = await db.contactServiceStep.findFirstOrThrow({ where: { contactServiceId: fixture.id, id: { not: fixture.occurrence.stepId } } })
      const serviceConfig = terminalType === "MOVE_SERVICE_STEP" ? { targetSourceStepId: target.sourceStepId, reason: "Automation move" } : terminalType === "SKIP_SERVICE_STEP" ? { reason: "Automation skip" } : terminalType === "SET_SERVICE_STATUS" ? { status: "CANCELED" } : {}
      const action = { nodeKey: randomUUID(), type: terminalType, serviceConfig }
      const entry = fixture.source.automations.find((item: any) => item.triggerType === "SERVICE_STEP_ENTERED")
      const path = `/api/account-settings/${tenantId}/automations/${entry.id}`
      const payload = { name: terminalType, trigger: { type: "SERVICE_STEP_ENTERED", serviceStepId: fixture.source.id, serviceOfferingId: fixture.child.data.service.id }, isEnabled: true, conditions: [], actions: [action] }
      assert.equal((await request(path, "PATCH", { ...payload, actions: [action, noteAction("Forbidden tail")] })).status, 400)
      assert.equal((await request(path, "PATCH", { ...payload, trigger: { type: "CONTACT_CREATED" } })).status, 400)
      assert.equal((await request(path, "PATCH", payload)).status, 200)
      const enrollment = await fixture.enroll()
      const event = await db.automationEvent.findFirstOrThrow({ where: { tenantId, triggerType: "SERVICE_STEP_ENTERED", serviceContext: { path: ["contactServiceId"], equals: enrollment.id } }, include: { dispatches: true } })
      // A corrupted/older snapshot still cannot execute an action after a terminal action.
      await db.automationDispatch.update({ where: { id: event.dispatches[0]!.id }, data: { actionSnapshot: [action, noteAction("Forbidden tail")] } })
      await processCompletionEvent(event.id)
      const run = await db.automationRun.findFirstOrThrow({ where: { dispatchId: event.dispatches[0]!.id } })
      assert.equal(run.status, terminalType === "COMPLETE_SERVICE_STEP" ? "SUCCEEDED" : "EXITED", run.failureMessage ?? undefined)
      assert.equal(await db.contactNote.count({ where: { tenantId, title: "Forbidden tail" } }), 0)
      assert.equal((await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } })).status, "ACTIVE")
      assert.equal(await db.serviceAutomationActionResult.count({ where: { runId: run.id } }), 1)
      assert.equal(await db.automationExecution.count({ where: { tenantId, automationName: terminalType } }), 1)
      if (terminalType === "COMPLETE_SERVICE_STEP") {
        const before = await db.automationEvent.count({ where: { tenantId, triggerType: "SERVICE_STEP_COMPLETED" } })
        assert.equal((await request(completePath(enrollment.id, enrollment.occurrence.id), "POST")).status, 200)
        assert.equal(await db.automationEvent.count({ where: { tenantId, triggerType: "SERVICE_STEP_COMPLETED" } }), before)
      }
    })
  }

  test("service mutations fail without saved context, reject missing snapshots and roll back fully", async () => {
    const configuration = await configureParent()
    const fixture = await completionFixture()
    const { mutateEnrolledServiceTx, executeServiceActionTx } = await import("./service-automation-actions.js")
    const mutation = (tx: Prisma.TransactionClient, action: any) => mutateEnrolledServiceTx(tx, { tenantId, contactServiceId: fixture.id, occurrenceId: fixture.occurrence.id, actor: { actorUserId: null, actorName: "Automation test" }, requestId: randomUUID(), action })
    await assert.rejects(db.$transaction(async tx => {
      await mutation(tx, { type: "SET_SERVICE_STEP_OWNER", serviceConfig: { assignedToUserId: userId } })
      await mutation(tx, { type: "SET_SERVICE_CHECKLIST_STATUS", serviceConfig: { checklistItemId: randomUUID(), status: "RECEIVED" } })
    }))
    assert.equal((await db.contactServiceStep.findUniqueOrThrow({ where: { id: fixture.occurrence.stepId } })).assignedToUserId, null)
    assert.equal(await db.serviceFollowUpExecutionLog.count({ where: { contactServiceId: fixture.id } }), 0)
    const missing = await db.automationRun.create({ data: { tenantId, contactId: fixture.contact.id, contactName: "Test", automationName: "Contextless bulk enrollment", attemptId: randomUUID(), eventSource: "MANUAL_ENROLLMENT", triggerType: "SERVICE_STEP_ENTERED", actionSnapshot: [] } })
    await assert.rejects(db.$transaction(tx => executeServiceActionTx(tx, { tenantId, contactId: fixture.contact.id, runId: missing.id, automationId: null, automationName: "Contextless", actorUserId: null, action: { nodeKey: randomUUID(), type: "COMPLETE_SERVICE_STEP", serviceConfig: {} } })))
    await db.serviceProfessional.update({ where: { id: configuration.professionals[0].id }, data: { archivedAt: new Date() } })
    await assert.rejects(db.$transaction(tx => mutation(tx, { type: "SET_SERVICE_PROFESSIONAL", serviceConfig: { professionalId: configuration.professionals[0].id } })))
    // Archived checklist entries remain usable on an existing enrollment.
    await db.serviceChecklistItem.update({ where: { id: configuration.checklistItems[0].id }, data: { archivedAt: new Date() } })
    await db.$transaction(tx => mutation(tx, { type: "SET_SERVICE_CHECKLIST_STATUS", serviceConfig: { checklistItemId: configuration.checklistItems[0].id, status: "RECEIVED" } }))
    const statusChange = await request(`/api/services/${tenantId}/contact-services/${fixture.id}`, "PATCH", { status: "COMPLETED" })
    assert.equal(statusChange.status, 409)
    assert.equal((await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).status, "IN_PROGRESS")
  })

  test("service checkpoints persist routing, values and logs, and expired workers cannot replay mutations", async () => {
    const fixture = await completionFixture()
    const { claimAutomationExecutionJobs, releaseAutomationExecutionLease } = await import("./automation-execution-budget.js")
    const context = await db.$transaction(tx => resolveAutomationServiceContextTx(tx, { tenantId, contactId: fixture.contact.id, contactServiceId: fixture.id, contactServiceStepId: fixture.occurrence.stepId, serviceStepOccurrenceId: fixture.occurrence.id }))
    const actions = [...Array.from({ length: 10 }, (_, i) => noteAction(`Checkpoint prefix ${i}`)), { nodeKey: randomUUID(), type: "SPLIT", splitConfig: { actionName: "One route", routes: [1, 2].map(index => ({ branchKey: randomUUID(), name: `Route ${index}`, percentage: 50, actions: [{ nodeKey: randomUUID(), type: "SET_SERVICE_STEP_OWNER", serviceConfig: { assignedToUserId: userId } }, noteAction("After crash")] })) } }]
    const run = await db.automationRun.create({ data: { tenantId, contactId: fixture.contact.id, contactName: "Checkpoint", automationName: "Recover checkpoints", attemptId: randomUUID(), eventSource: "SERVICE_STEP_ENTERED", triggerType: "SERVICE_STEP_ENTERED", serviceContext: context, variables: { retained_value: 42 }, actionSnapshot: actions, status: "QUEUED" } })
    const claim = (await claimAutomationExecutionJobs(db, "RUN")).find(item => item.id === run.id)!
    assert.ok(claim)
    assert.equal((await resumeAutomationRun(db, run.id, claim.leaseToken)).status, "QUEUED")
    await releaseAutomationExecutionLease(db, "RUN", run.id, claim.leaseToken)
    let current = await db.automationRun.findUniqueOrThrow({ where: { id: run.id } })
    assert.equal(current.cursorIndex, 10)
    assert.equal(await db.contactNote.count({ where: { tenantId } }), 10)
    const old = (await claimAutomationExecutionJobs(db, "RUN")).find(item => item.id === run.id)!
    await db.automationRun.update({ where: { id: run.id }, data: { leaseExpiresAt: new Date(0) } })
    await db.automationExecutionLease.update({ where: { kind_jobId: { kind: "RUN", jobId: run.id } }, data: { expiresAt: new Date(0) } })
    assert.equal((await resumeAutomationRun(db, run.id, old.leaseToken)).status, "NOT_CLAIMED")
    const recovered = (await claimAutomationExecutionJobs(db, "RUN")).find(item => item.id === run.id)!
    assert.ok(recovered)
    assert.notEqual(recovered.leaseToken, old.leaseToken)
    assert.equal((await resumeAutomationRun(db, run.id, old.leaseToken)).status, "NOT_CLAIMED")
    assert.equal((await resumeAutomationRun(db, run.id, recovered.leaseToken)).status, "QUEUED")
    await releaseAutomationExecutionLease(db, "RUN", run.id, recovered.leaseToken)
    current = await db.automationRun.findUniqueOrThrow({ where: { id: run.id } })
    const decisions = current.branchDecisions
    assert.equal(await db.serviceAutomationActionResult.count({ where: { runId: run.id } }), 1)
    await resumeDueAutomationRuns(db)
    current = await db.automationRun.findUniqueOrThrow({ where: { id: run.id } })
    assert.equal(current.status, "SUCCEEDED", current.failureMessage ?? undefined)
    assert.deepEqual(current.branchDecisions, decisions)
    assert.deepEqual(current.variables, { retained_value: 42 })
    assert.equal(await db.contactNote.count({ where: { tenantId } }), 11)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "After crash" } }), 1)
    assert.equal(await db.serviceFollowUpExecutionLog.count({ where: { contactServiceId: fixture.id, eventType: "SET_SERVICE_STEP_OWNER" } }), 1)
  })

  test("completion actions on completed triggers emit no duplicate event and queued checkpoints hold the gate", async () => {
    const fixture = await completionFixture()
    const actions = [{ nodeKey: randomUUID(), type: "SET_SERVICE_STEP_OWNER", serviceConfig: { assignedToUserId: userId } }, { nodeKey: randomUUID(), type: "COMPLETE_SERVICE_STEP", serviceConfig: {} }]
    assert.equal((await request(fixture.automationPath, "PATCH", { ...fixture.payload, isEnabled: true, actions })).status, 200)
    await reviewAndApplyConfiguration(fixture.id)
    const completed = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    const eventId = completed.data.occurrence.completionEventId
    await processCompletionEvent(eventId)
    assert.equal((await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } })).progressionStatus, "WAITING_AUTOMATION")
    await resumeDueAutomationRuns(db)
    assert.equal((await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } })).progressionStatus, "ADVANCED")
    assert.equal(await db.automationEvent.count({ where: { tenantId, triggerType: "SERVICE_STEP_COMPLETED" } }), 1)
    assert.equal(await db.serviceAutomationActionResult.count({ where: { tenantId } }), 2)
  })

  test("automated revisits carry their chain and stop repeated transitions", async () => {
    const fixture = await completionFixture()
    const steps = (await request(`${settingsPath()}/${parentId}`)).data.service.steps
    for (const [index, source] of steps.entries()) {
      const entry = source.automations.find((item: any) => item.triggerType === "SERVICE_STEP_ENTERED")
      const target = steps[index === 0 ? 1 : 0]
      const saved = await request(`/api/account-settings/${tenantId}/automations/${entry.id}`, "PATCH", { name: `Move from ${source.title}`, trigger: { type: "SERVICE_STEP_ENTERED", serviceStepId: source.id, serviceOfferingId: null }, isEnabled: true, conditions: [], actions: [{ nodeKey: randomUUID(), type: "MOVE_SERVICE_STEP", serviceConfig: { targetSourceStepId: target.id, reason: "Automatic routing" } }] })
      assert.equal(saved.status, 200, JSON.stringify(saved.data))
    }
    const enrollment = await fixture.enroll()
    for (let pass = 0; pass < 6; pass++) {
      const event = await db.automationEvent.findFirst({ where: { tenantId, status: "QUEUED", serviceContext: { path: ["contactServiceId"], equals: enrollment.id } }, orderBy: { createdAt: "asc" } })
      if (!event) break
      await processCompletionEvent(event.id)
    }
    const events = await db.automationEvent.findMany({ where: { tenantId, triggerType: "SERVICE_STEP_ENTERED" }, include: { dispatches: true } })
    assert.equal(new Set(events.map(event => event.chainId)).size, 1)
    assert.equal(events.length, 3)
    assert.ok(events.some(event => event.dispatches.some(dispatch => dispatch.decision === "SKIP_TRIGGER")))
    assert.equal(await db.serviceStepMovement.count({ where: { contactServiceId: enrollment.id } }), 2)
    assert.equal(await db.serviceStepOccurrence.count({ where: { contactServiceId: enrollment.id } }), 3)
  })

  test("initial events and continuations share atomic admission and rotate to waiting tenants", async () => {
    const { claimAutomationExecutionJobs, releaseAutomationExecutionLease } = await import("./automation-execution-budget.js")
    const extraTenants = await db.tenant.createManyAndReturn({ data: Array.from({ length: 4 }, () => ({ name: "Fair admission", slug: randomUUID() })), select: { id: true } })
    const ids = [tenantId, ...extraTenants.map(tenant => tenant.id)]
    try {
      for (const [index, id] of ids.entries()) {
        const rows = Array.from({ length: index === 0 ? 20 : 1 }, () => ({ tenantId: id, contactName: "Admission test", triggerType: "SERVICE_STEP_ENTERED" as const, updatedAt: new Date(index * 1000) }))
        await db.automationEvent.createMany({ data: rows })
        await db.automationRun.createMany({ data: rows.map(row => ({ ...row, automationName: "Continuation", attemptId: randomUUID(), eventSource: "SERVICE_STEP_ENTERED", status: "QUEUED", actionSnapshot: [] })) })
      }
      const passes = await Promise.all([claimAutomationExecutionJobs(db, "EVENT"), claimAutomationExecutionJobs(db, "RUN"), claimAutomationExecutionJobs(db, "EVENT"), claimAutomationExecutionJobs(db, "RUN")])
      const claims = passes.flat()
      assert.equal(claims.length, 4)
      const counts = await db.automationExecutionLease.groupBy({ by: ["tenantId"], _count: true })
      assert.equal(counts.reduce((sum, row) => sum + row._count, 0), 4)
      assert.ok(counts.every(row => row._count <= 2))
      assert.equal(new Set(claims.map(row => row.tenantId)).size, 4)
      const waitingTenant = ids.find(id => !claims.some(claim => claim.tenantId === id))!
      for (const lease of await db.automationExecutionLease.findMany({ where: { tenantId: { in: ids } } })) {
        if (lease.kind === "EVENT") await db.automationEvent.update({ where: { id: lease.jobId }, data: { status: "COMPLETED", leaseToken: null, leaseExpiresAt: null } })
        else await db.automationRun.update({ where: { id: lease.jobId }, data: { status: "SUCCEEDED", leaseToken: null, leaseExpiresAt: null } })
        await releaseAutomationExecutionLease(db, lease.kind as "EVENT" | "RUN", lease.jobId, lease.leaseToken)
      }
      const next = await claimAutomationExecutionJobs(db, "RUN")
      assert.ok(next.some(claim => claim.tenantId === waitingTenant), "Unserved tenants precede the large tenant's older backlog")
      assert.ok(next.filter(claim => claim.tenantId === tenantId).length <= 2)
    } finally {
      await db.automationExecutionLease.deleteMany({ where: { tenantId: { in: ids } } })
      await db.tenant.deleteMany({ where: { id: { in: extraTenants.map(tenant => tenant.id) } } })
    }
  })

  test("transient resumed failures use all three delays before only that run fails", async () => {
    const fixture = await completionFixture()
    const context = await db.$transaction(tx => resolveAutomationServiceContextTx(tx, { tenantId, contactId: fixture.contact.id, contactServiceId: fixture.id, contactServiceStepId: fixture.occurrence.stepId, serviceStepOccurrenceId: fixture.occurrence.id }))
    const run = await db.automationRun.create({ data: { tenantId, contactId: fixture.contact.id, contactName: "Retry", automationName: "Retry service action", attemptId: randomUUID(), eventSource: "SERVICE_STEP_ENTERED", triggerType: "SERVICE_STEP_ENTERED", serviceContext: context, actionSnapshot: [{ nodeKey: randomUUID(), type: "SET_SERVICE_STEP_OWNER", serviceConfig: { assignedToUserId: userId } }], status: "QUEUED" } })
    for (const [attempt, delay] of [5000, 30000, 120000, null].entries()) {
      const token = randomUUID()
      await db.automationRun.update({ where: { id: run.id }, data: { status: "RUNNING", leaseToken: token } })
      let fail = true
      const client = { automationRun: db.automationRun, tenant: db.tenant, $transaction: async (callback: any) => {
        if (fail) { fail = false; throw Object.assign(new Error("Serialization conflict"), { code: "P2034" }) }
        return db.$transaction(callback)
      } }
      const before = Date.now()
      const result = await resumeAutomationRun(client, run.id, token)
      const saved = await db.automationRun.findUniqueOrThrow({ where: { id: run.id } })
      assert.equal(result.status, delay === null ? "FAILED" : "QUEUED")
      if (delay !== null) {
        assert.equal(saved.retryCount, attempt + 1)
        assert.ok(saved.availableAt.getTime() >= before + delay)
        assert.ok(saved.availableAt.getTime() < Date.now() + delay + 1000)
      }
    }
    assert.equal(await db.serviceAutomationActionResult.count({ where: { runId: run.id } }), 0)
    assert.equal((await db.contactServiceStep.findUniqueOrThrow({ where: { id: fixture.occurrence.stepId } })).assignedToUserId, null)
    assert.equal((await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } })).status, "ACTIVE")
  })

  test("different workflows cannot repeat the same service transition in one chain", async () => {
    const fixture = await completionFixture()
    const { executeServiceActionTx } = await import("./service-automation-actions.js")
    const steps = await db.contactServiceStep.findMany({ where: { contactServiceId: fixture.id }, orderBy: { sortOrder: "asc" } })
    const chainId = randomUUID()
    const move = async (sourceIndex: number, targetIndex: number) => {
      const occurrence = await db.serviceStepOccurrence.findFirstOrThrow({ where: { contactServiceId: fixture.id, status: "ACTIVE" } })
      const context = await db.$transaction(tx => resolveAutomationServiceContextTx(tx, { tenantId, contactId: fixture.contact.id, contactServiceId: fixture.id, contactServiceStepId: steps[sourceIndex]!.id, serviceStepOccurrenceId: occurrence.id }))
      const run = await db.automationRun.create({ data: { tenantId, contactId: fixture.contact.id, contactName: "Loop check", automationName: randomUUID(), attemptId: randomUUID(), eventSource: "SERVICE_STEP_ENTERED", triggerType: "SERVICE_STEP_ENTERED", serviceContext: context, actionSnapshot: [], eventContext: { chainId } } })
      return db.$transaction(tx => executeServiceActionTx(tx, { tenantId, contactId: fixture.contact.id, runId: run.id, automationId: null, automationName: run.automationName, actorUserId: null, eventContext: { chainId }, action: { nodeKey: randomUUID(), type: "MOVE_SERVICE_STEP", serviceConfig: { targetSourceStepId: steps[targetIndex]!.sourceStepId, reason: "Routing" } } }))
    }
    await move(0, 1)
    await move(1, 0)
    await assert.rejects(move(0, 1), /SERVICE_AUTOMATION_TRANSITION_LOOP/)
    assert.equal(await db.serviceStepMovement.count({ where: { contactServiceId: fixture.id } }), 2)
    assert.equal(await db.serviceAutomationActionResult.count({ where: { contactServiceId: fixture.id } }), 2)
  })

  test("every service action saves and executes through a published branch with inherited configuration", async () => {
    const config = await configureParent()
    const fixture = await completionFixture()
    const steps = await db.contactServiceStep.findMany({ where: { contactServiceId: fixture.id }, orderBy: { sortOrder: "asc" } })
    const cases = [
      { type: "MOVE_SERVICE_STEP", serviceConfig: { targetSourceStepId: steps[1]!.sourceStepId, reason: "Branch move" } },
      { type: "COMPLETE_SERVICE_STEP", serviceConfig: {} },
      { type: "SKIP_SERVICE_STEP", serviceConfig: { reason: "Branch skip" } },
      { type: "SCHEDULE_SERVICE_STEP", serviceConfig: { schedule: { mode: "DURATION", amount: 3, unit: "HOURS" } } },
      { type: "SET_SERVICE_STEP_OWNER", serviceConfig: { assignedToUserId: userId } },
      { type: "SET_SERVICE_COORDINATOR", serviceConfig: { assignedToUserId: userId } },
      { type: "SET_SERVICE_PROFESSIONAL", serviceConfig: { professionalId: config.professionals[0].id } },
      { type: "SET_SERVICE_CHECKLIST_STATUS", serviceConfig: { checklistItemId: config.checklistItems[0].id, status: "RECEIVED" } },
      { type: "SET_SERVICE_STATUS", serviceConfig: { status: "CANCELED" } },
    ]
    const path = `/api/account-settings/${tenantId}/automations`
    for (const action of cases) {
      const actions = [{ nodeKey: randomUUID(), type: "SPLIT", splitConfig: { actionName: "Service branch", routes: [1, 2].map(index => ({ branchKey: randomUUID(), name: `Route ${index}`, percentage: 50, actions: [{ ...action, nodeKey: randomUUID() }] })) } }]
      const payload = { name: `Branch ${action.type}`, isEnabled: true, trigger: { type: "SERVICE_STEP_ENTERED", serviceStepId: fixture.source.id, serviceOfferingId: fixture.child.data.service.id }, conditions: [], actions }
      const created = await request(path, "POST", payload)
      assert.equal(created.status, 201, JSON.stringify(created.data))
      const reloaded = (await request(`${path}/${created.data.automation.id}`)).data.automation
      assert.deepEqual(reloaded.actions[0].splitConfig.routes[0].actions[0].serviceConfig, action.serviceConfig)
      const enrollment = await fixture.enroll()
      const event = await db.automationEvent.findFirstOrThrow({ where: { tenantId, triggerType: "SERVICE_STEP_ENTERED", serviceContext: { path: ["contactServiceId"], equals: enrollment.id } }, include: { dispatches: true } })
      assert.deepEqual((event.dispatches[0]!.actionSnapshot as any[])[0].splitConfig.routes[1].actions[0].serviceConfig, action.serviceConfig)
      await processCompletionEvent(event.id)
      const run = await db.automationRun.findFirstOrThrow({ where: { dispatchId: event.dispatches[0]!.id } })
      const exited = ["MOVE_SERVICE_STEP", "SKIP_SERVICE_STEP", "SET_SERVICE_STATUS"].includes(action.type)
      assert.equal(run.status, exited ? "EXITED" : "SUCCEEDED", `${action.type}: ${run.failureMessage}`)
      assert.equal(await db.serviceAutomationActionResult.count({ where: { runId: run.id } }), 1, action.type)
      assert.equal((await request(`${path}/${created.data.automation.id}`, "PATCH", { ...payload, isEnabled: false })).status, 200)
    }
  })

  async function reviewAndApplyConfiguration(id: string) {
    const path = `/api/services/${tenantId}/contact-services/${id}`
    const reviewed = await request(`${path}/configuration-preview`, "POST")
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data))
    assert.equal(reviewed.data.preview.canApply, true, JSON.stringify(reviewed.data.preview))
    const applied = await request(`${path}/configuration-apply`, "POST", { previewId: reviewed.data.preview.previewId })
    assert.equal(applied.status, 200, JSON.stringify(applied.data))
    return reviewed.data.preview
  }

  test("configuration review applies future changes while preserving entered work, IDs, billing, history and assignments", async () => {
    const parent = await configureParent()
    const fixture = await completionFixture()
    const path = `/api/services/${tenantId}/contact-services/${fixture.id}`
    const before = await db.contactService.findUniqueOrThrow({ where: { id: fixture.id }, include: { serviceSteps: { orderBy: { sortOrder: "asc" } }, checklistItems: true } })
    const first = before.serviceSteps[0]!, future = before.serviceSteps[1]!, item = before.checklistItems[0]!
    assert.equal((await request(`${path}/service-steps/${future.id}/owner`, "PATCH", { assignedToUserId: userId })).status, 200)
    assert.equal((await request(path, "PATCH", { assignedProfessionalId: parent.professionals[0].id })).status, 200)
    assert.equal((await request(`${path}/follow-up-coordinator`, "PATCH", { assignedToUserId: userId })).status, 200)
    assert.equal((await request(`${path}/checklist-items/${item.id}`, "PATCH", { status: "RECEIVED" })).status, 200)
    const deadline = await db.$transaction(tx => changeServiceStepDeadlineTx(tx, { tenantId, contactServiceId: fixture.id, occurrenceId: fixture.occurrence.id, actorUserId: userId, requestId: randomUUID(), expectedDeadlineRevision: 0, schedule: { mode: "DURATION", amount: 20, unit: "DAYS" } }))
    const savedItem = await db.contactServiceChecklistItem.findUniqueOrThrow({ where: { id: item.id } })
    const changed = await request(`${settingsPath()}/${parentId}`, "PATCH", {
      basePriceCents: 50000,
      steps: [{ id: first.sourceStepId, title: "Changed entered title", instructions: "Keep original" }, { id: future.sourceStepId, title: "Updated future", completionDuration: 6, completionUnit: "HOURS" }, { title: "Verify" }],
      checklistItems: [{ id: item.checklistItemId, label: "Changed completed checklist" }, { label: "New consent" }],
      professionals: [{ id: parent.professionals[0].id, kind: "EXTERNAL", externalProfessionalName: "Updated specialist" }, { kind: "EXTERNAL", externalProfessionalName: "Another specialist" }],
    })
    assert.equal(changed.status, 200, JSON.stringify(changed.data))
    const preview = await reviewAndApplyConfiguration(fixture.id)
    assert.ok(preview.differences.some((diff: any) => diff.section === "Steps" && diff.kind === "PRESERVE"))
    assert.ok(preview.differences.some((diff: any) => diff.section === "Billing" && diff.kind === "PRESERVE"))
    const after = await db.contactService.findUniqueOrThrow({ where: { id: fixture.id }, include: { serviceSteps: { orderBy: { sortOrder: "asc" } }, checklistItems: true } })
    assert.deepEqual(after.serviceSteps[0], first)
    assert.equal(after.serviceSteps[1]!.id, future.id)
    assert.equal(after.serviceSteps[1]!.title, "Updated future")
    assert.equal(after.serviceSteps[1]!.assignedToUserId, userId)
    assert.equal(after.serviceSteps.length, 3)
    assert.equal(after.totalPriceCents, before.totalPriceCents)
    assert.deepEqual(after.billingSnapshot, before.billingSnapshot)
    assert.equal(after.assignedProfessionalId, parent.professionals[0].id)
    assert.equal((after.assignedProfessionalSnapshot as any).externalProfessionalName, parent.professionals[0].externalProfessionalName)
    assert.equal(after.followUpCoordinatorUserId, userId)
    assert.deepEqual(await db.contactServiceChecklistItem.findUniqueOrThrow({ where: { id: item.id } }), savedItem)
    assert.equal(after.checklistItems.length, 2)
    const occurrence = await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } })
    assert.equal(occurrence.dueAt.getTime(), new Date(deadline.dueAt).getTime())
    assert.equal(occurrence.deadlineRevision, 1)
    const retry = await request(`${path}/configuration-apply`, "POST", { previewId: preview.previewId })
    assert.equal(retry.data.alreadyApplied, true)
    const history = await request(`${path}/configuration-history`)
    assert.equal(history.data.items.length, 1)
    assert.equal(history.data.items[0].appliedByName, "Hierarchy tester")
    assert.equal((await request(`${path}/configuration-preview`, "POST")).data.preview.hasChanges, false)
  })

  test("configuration previews reject stale configuration, enrollment changes, expired receipts and foreign enrollment IDs", async () => {
    const fixture = await completionFixture()
    const path = `/api/services/${tenantId}/contact-services/${fixture.id}`
    await request(fixture.automationPath, "PATCH", { ...fixture.payload, isEnabled: true, actions: [noteAction()] })
    const preview = (await request(`${path}/configuration-preview`, "POST")).data.preview
    await request(fixture.automationPath, "PATCH", { ...fixture.payload, isEnabled: true, actions: [noteAction("Changed")] })
    assert.equal((await request(`${path}/configuration-apply`, "POST", { previewId: preview.previewId })).data.error, "CONFIGURATION_PREVIEW_STALE")
    const second = (await request(`${path}/configuration-preview`, "POST")).data.preview
    await request(`${path}/service-steps/${fixture.occurrence.stepId}/owner`, "PATCH", { assignedToUserId: userId })
    assert.equal((await request(`${path}/configuration-apply`, "POST", { previewId: second.previewId })).data.error, "CONFIGURATION_PREVIEW_STALE")
    const third = (await request(`${path}/configuration-preview`, "POST")).data.preview
    await db.contactServiceConfigurationChange.update({ where: { id: third.previewId }, data: { expiresAt: new Date(0) } })
    assert.equal((await request(`${path}/configuration-apply`, "POST", { previewId: third.previewId })).data.error, "CONFIGURATION_PREVIEW_EXPIRED")
    const other = await fixture.enroll()
    assert.equal((await request(`/api/services/${tenantId}/contact-services/${other.id}/configuration-apply`, "POST", { previewId: preview.previewId })).status, 404)
    assert.equal((await request(`/api/services/${randomUUID()}/contact-services/${fixture.id}/configuration-preview`, "POST")).status, 403)
    assert.equal(await db.contactServiceConfigurationChange.count({ where: { contactServiceId: fixture.id, appliedAt: { not: null } } }), 0)
  })

  test("configuration propagation blocks entered-step replacement and preserves removed checklist history", async () => {
    await configureParent()
    const fixture = await completionFixture()
    const path = `/api/services/${tenantId}/contact-services/${fixture.id}`
    const saved = await db.contactService.findUniqueOrThrow({ where: { id: fixture.id }, include: { checklistItems: true } })
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [{ title: "Replacement" }], checklistItems: [] })
    const reviewed = (await request(`${path}/configuration-preview`, "POST")).data.preview
    assert.equal(reviewed.canApply, false)
    assert.match(reviewed.blockers.join(" "), /entered work/)
    assert.equal((await request(`${path}/configuration-apply`, "POST", { previewId: reviewed.previewId })).status, 409)
    assert.equal(await db.contactServiceChecklistItem.count({ where: { contactServiceId: fixture.id } }), saved.checklistItems.length)
    assert.deepEqual((await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).configurationSnapshot, saved.configurationSnapshot)
  })

  test("configuration applies roll back atomically and serialize simultaneous receipts", async () => {
    const fixture = await completionFixture()
    const path = `/api/services/${tenantId}/contact-services/${fixture.id}`
    const source = (await request(`${settingsPath()}/${parentId}`)).data.service.steps
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [...source.map((step: any) => ({ id: step.id, title: step.title })), { title: "Added" }] })
    const preview = (await request(`${path}/configuration-preview`, "POST")).data.preview
    const before = await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })
    const { applyServiceConfigurationTx } = await import("./service-configuration-review.js")
    await assert.rejects(db.$transaction(async tx => {
      await applyServiceConfigurationTx(tx, { tenantId, contactServiceId: fixture.id, previewId: preview.previewId, actorUserId: userId, actorName: "Tester" })
      throw new Error("Rollback complete application")
    }), /Rollback complete application/)
    assert.equal(await db.contactServiceStep.count({ where: { contactServiceId: fixture.id } }), 2)
    assert.deepEqual((await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).configurationSnapshot, before.configurationSnapshot)
    const competing = (await request(`${path}/configuration-preview`, "POST")).data.preview
    const results = await Promise.all([preview, competing].map(p => request(`${path}/configuration-apply`, "POST", { previewId: p.previewId })))
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409])
    assert.equal(await db.contactServiceStep.count({ where: { contactServiceId: fixture.id } }), 3)
  })

  test("saved automation definitions survive library edits and deletion until an explicit reviewed update", async () => {
    const fixture = await completionFixture([noteAction("Frozen completion")])
    const path = `/api/services/${tenantId}/contact-services/${fixture.id}`
    await request(fixture.automationPath, "PATCH", { ...fixture.payload, isEnabled: true, actions: [noteAction("Future completion")] })
    const completed = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    const eventId = completed.data.occurrence.completionEventId
    await request(fixture.automationPath, "DELETE")
    await processCompletionEvent(eventId)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Frozen completion" } }), 1)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Future completion" } }), 0)
    const first = await db.contactServiceStep.findFirstOrThrow({ where: { contactServiceId: fixture.id }, orderBy: { sortOrder: "asc" } })
    const current = await db.serviceStepOccurrence.findFirstOrThrow({ where: { contactServiceId: fixture.id, status: "ACTIVE" } })
    assert.equal((await request(movementPath(fixture.id), "POST", movementPayload(current.id, first.id))).status, 200)
    const revisit = await db.serviceStepOccurrence.findFirstOrThrow({ where: { contactServiceId: fixture.id, status: "ACTIVE" } })
    const again = await request(completePath(fixture.id, revisit.id), "POST")
    const deletedEvent = await db.automationEvent.findUniqueOrThrow({ where: { id: again.data.occurrence.completionEventId }, include: { dispatches: true } })
    assert.equal(deletedEvent.dispatches[0]!.automationId, null)
    assert.equal(deletedEvent.dispatches[0]!.automationSnapshotId, fixture.automation.id)
    await processCompletionEvent(deletedEvent.id)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Frozen completion" } }), 2)
    const history = await request(`${path}/configuration-history`)
    assert.deepEqual(history.data.items, [])
  })

  test("reviewed updates preserve waiting runs and their schedules while later entries use updated definitions", async () => {
    const fixture = await completionFixture([{ nodeKey: randomUUID(), type: "WAIT", waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" } }, noteAction("Original waiting actions")])
    const completed = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    await processCompletionEvent(completed.data.occurrence.completionEventId)
    const run = await db.automationRun.findFirstOrThrow({ where: { tenantId, status: "WAITING" } })
    const steps = (await request(`${settingsPath()}/${parentId}`)).data.service.steps
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [{ id: steps[0].id, title: steps[0].title }, { id: steps[1].id, title: "Updated after wait" }] })
    await request(fixture.automationPath, "PATCH", { ...fixture.payload, actions: [noteAction("Future actions")] })
    await reviewAndApplyConfiguration(fixture.id)
    assert.deepEqual(await db.automationRun.findUniqueOrThrow({ where: { id: run.id } }), run)
    assert.equal((await db.serviceStepOccurrence.findUniqueOrThrow({ where: { id: fixture.occurrence.id } })).progressionStatus, "WAITING_AUTOMATION")
    await db.automationRun.update({ where: { id: run.id }, data: { resumeAt: new Date(0) } })
    await resumeDueAutomationRuns(db)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Original waiting actions" } }), 1)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Future actions" } }), 0)
    const current = await db.serviceStepOccurrence.findFirstOrThrow({ where: { contactServiceId: fixture.id, status: "ACTIVE" }, include: { step: true } })
    assert.equal(current.step.title, "Updated after wait")
  })

  test("updates cannot remove owned future steps or targets pinned by unfinished workflows", async () => {
    const fixture = await completionFixture()
    const future = await db.contactServiceStep.findFirstOrThrow({ where: { contactServiceId: fixture.id, sortOrder: 20 } })
    await request(fixture.automationPath, "PATCH", { ...fixture.payload, isEnabled: true, actions: [{ nodeKey: randomUUID(), type: "WAIT", waitConfig: { mode: "DURATION", amount: 1, unit: "DAYS" } }, { nodeKey: randomUUID(), type: "MOVE_SERVICE_STEP", serviceConfig: { targetSourceStepId: future.sourceStepId, reason: "Move after wait" } }] })
    await reviewAndApplyConfiguration(fixture.id)
    const completed = await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    await processCompletionEvent(completed.data.occurrence.completionEventId)
    const path = `/api/services/${tenantId}/contact-services/${fixture.id}`
    await request(`${path}/service-steps/${future.id}/owner`, "PATCH", { assignedToUserId: userId })
    // Disable the live workflow: the old waiting definition still refers to the removed source ID.
    await request(fixture.automationPath, "PATCH", { ...fixture.payload, isEnabled: false, actions: [] })
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [{ id: fixture.source.id, title: fixture.source.title }] })
    const preview = (await request(`${path}/configuration-preview`, "POST")).data.preview
    assert.equal(preview.canApply, false)
    assert.match(preview.blockers.join(" "), /assigned owner/)
    assert.match(preview.blockers.join(" "), /unfinished workflow targets a step/)
    assert.equal((await request(`${path}/configuration-apply`, "POST", { previewId: preview.previewId })).status, 409)
    assert.equal((await db.contactServiceStep.findUniqueOrThrow({ where: { id: future.id } })).assignedToUserId, userId)
  })

  test("review selection is paginated, tenant scoped, admin only, and excludes completed and legacy work", async () => {
    const fixture = await completionFixture()
    const other = await fixture.enroll()
    await db.contactService.update({ where: { id: other.id }, data: { status: "COMPLETED" } })
    const path = `/api/services/${tenantId}/configuration-updates/${parentId}/enrollments`
    const list = await request(path)
    assert.equal(list.status, 200)
    assert.deepEqual(list.data.items.map((item: any) => item.id), [fixture.id])
    const scoped = await request(`/api/services/${tenantId}/configuration-updates/${fixture.child.data.service.id}/enrollments`)
    assert.deepEqual(scoped.data.items, list.data.items)
    assert.equal((await request(`/api/services/${tenantId}/contact-services/${other.id}/configuration-preview`, "POST")).data.preview.canApply, false)
    await db.membership.update({ where: { userId_tenantId: { tenantId, userId } }, data: { role: "TENANT_USER" } })
    for (const [url, method] of [[path, "GET"], [`/api/services/${tenantId}/contact-services/${fixture.id}/configuration-preview`, "POST"], [`/api/services/${tenantId}/contact-services/${fixture.id}/configuration-apply`, "POST"]]) {
      assert.equal((await request(url!, method!, method === "GET" ? undefined : { previewId: randomUUID() })).status, 403)
    }
  })

  test("selective propagation reorders and removes only unentered future steps without replaying events", async () => {
    await configureParent()
    const fixture = await completionFixture()
    const untouched = await fixture.enroll()
    const untouchedBefore = await db.contactService.findUniqueOrThrow({ where: { id: untouched.id }, include: { serviceSteps: { orderBy: { sortOrder: "asc" } }, checklistItems: true } })
    const configured = (await request(`${settingsPath()}/${parentId}`)).data.service.steps
    const added = (await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [...configured.map((step: any) => ({ id: step.id, title: step.title })), { title: "Verify" }] })).data.service.steps
    await reviewAndApplyConfiguration(fixture.id)
    const before = await db.contactServiceStep.findMany({ where: { contactServiceId: fixture.id }, orderBy: { sortOrder: "asc" } })
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [added[0], added[2], added[1]].map((step: any) => ({ id: step.id, title: step.title })), checklistItems: [] })
    const eventCount = await db.automationEvent.count({ where: { tenantId } })
    await reviewAndApplyConfiguration(fixture.id)
    const reordered = await db.contactServiceStep.findMany({ where: { contactServiceId: fixture.id }, orderBy: { sortOrder: "asc" } })
    assert.deepEqual(reordered.map(step => step.id), [before[0]!.id, before[2]!.id, before[1]!.id])
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [added[0], added[1]].map((step: any) => ({ id: step.id, title: step.title })) })
    await reviewAndApplyConfiguration(fixture.id)
    assert.deepEqual((await db.contactServiceStep.findMany({ where: { contactServiceId: fixture.id }, orderBy: { sortOrder: "asc" } })).map(step => step.id), [before[0]!.id, before[1]!.id])
    assert.equal(await db.contactServiceChecklistItem.count({ where: { contactServiceId: fixture.id } }), 1)
    assert.equal(await db.automationEvent.count({ where: { tenantId } }), eventCount)
    assert.deepEqual(await db.contactService.findUniqueOrThrow({ where: { id: untouched.id }, include: { serviceSteps: { orderBy: { sortOrder: "asc" } }, checklistItems: true } }), untouchedBefore)
  })

  test("finished unpaid work can adopt payment workflows without reopening steps or changing billing", async () => {
    const fixture = await completionFixture()
    await request(completePath(fixture.id, fixture.occurrence.id), "POST")
    const last = await db.serviceStepOccurrence.findFirstOrThrow({ where: { contactServiceId: fixture.id, status: "ACTIVE" } })
    await request(completePath(fixture.id, last.id), "POST")
    const before = await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })
    assert.equal(before.status, "PENDING_PAYMENT")
    await publishEnrollmentTrigger("SERVICE_PAYMENT_CHANGED", { changes: ["ADDED"], paymentState: "PAID" }, [noteAction("Paid after adoption")])
    await reviewAndApplyConfiguration(fixture.id)
    const configured = (await request(`${settingsPath()}/${parentId}`)).data.service.steps
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [...configured.map((step: any) => ({ id: step.id, title: step.title })), { title: "New work" }] })
    const path = `/api/services/${tenantId}/contact-services/${fixture.id}`
    const reviewed = (await request(`${path}/configuration-preview`, "POST")).data.preview
    assert.equal(reviewed.canApply, false)
    assert.match(reviewed.blockers.join(" "), /awaiting payment/)
    assert.equal((await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).status, "PENDING_PAYMENT")
    assert.equal(await db.serviceStepOccurrence.count({ where: { contactServiceId: fixture.id } }), 2)
    assert.deepEqual((await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).billingSnapshot, before.billingSnapshot)
  })

  test("service metadata changes appear in the review and purchased billing attribution stays frozen", async () => {
    const fixture = await completionFixture()
    const before = await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })
    await request(`${settingsPath()}/${fixture.child.data.service.id}`, "PATCH", { name: "Reviewed offering name", description: "Updated description", billingMode: "CUSTOM" })
    const preview = await reviewAndApplyConfiguration(fixture.id)
    assert.ok(preview.differences.some((item: any) => item.section === "Service" && item.after.service.name === "Reviewed offering name"))
    const after = await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })
    assert.equal((after.configurationSnapshot as any).service.name, "Reviewed offering name")
    assert.deepEqual((after.configurationSnapshot as any).inheritance.billing, (before.configurationSnapshot as any).inheritance.billing)
    assert.deepEqual(after.billingSnapshot, before.billingSnapshot)
    assert.equal(after.totalPriceCents, before.totalPriceCents)
  })

  async function publishEnrollmentTrigger(type: string, config: Record<string, unknown>, actions: unknown[] = [noteAction(type)], scope: string | null = null, conditions: unknown[] = []) {
    const payload = { name: `${type} ${randomUUID()}`, isEnabled: true, trigger: { type, serviceGroupId: parentId, serviceOfferingId: scope, serviceTriggerConfig: config }, conditions, actions }
    const saved = await request(`/api/account-settings/${tenantId}/automations`, "POST", payload)
    assert.equal(saved.status, 201, JSON.stringify(saved.data))
    const loaded = await request(`/api/account-settings/${tenantId}/automations/${saved.data.automation.id}`)
    assert.deepEqual(loaded.data.automation.trigger, payload.trigger)
    return { payload, automation: saved.data.automation }
  }
  const serviceEvents = (id: string, triggerType?: any) => db.automationEvent.findMany({ where: { tenantId, ...(triggerType ? { triggerType } : {}), serviceContext: { path: ["contactServiceId"], equals: id } }, orderBy: { createdAt: "asc" }, include: { dispatches: true } })

  test("enrollment triggers pin fully initialized records, initial payments, and future sub-services", async () => {
    await configureParent()
    const fixture = await completionFixture()
    const enrolled = await publishEnrollmentTrigger("SERVICE_ENROLLED", {})
    await publishEnrollmentTrigger("SERVICE_PAYMENT_CHANGED", { changes: ["ADDED"], paymentState: "PARTIAL" })
    await publishEnrollmentTrigger("SERVICE_STATUS_CHANGED", { previousStatus: null, status: null })
    await publishEnrollmentTrigger("SERVICE_CHECKLIST_STATUS_CHANGED", { checklistItemId: null, previousStatus: null, status: null })
    const future = (await createChild("Future offering")).data.service
    const created = await request(`/api/services/${tenantId}/contact-services`, "POST", { serviceId: future.id, contactId: fixture.contact.id, initialPaymentCents: 2000 })
    assert.equal(created.status, 201, JSON.stringify(created.data))
    const id = created.data.contactService.id
    const events = await serviceEvents(id)
    assert.deepEqual(events.map(event => event.triggerType).sort(), ["SERVICE_ENROLLED", "SERVICE_PAYMENT_CHANGED"])
    const initial = events.find(event => event.triggerType === "SERVICE_PAYMENT_CHANGED")!
    assert.equal((initial.serviceEventSnapshot as any).isInitialPayment, true)
    assert.equal((initial.serviceEventSnapshot as any).financials.paidCents, 2000)
    assert.equal((initial.serviceContext as any).serviceStepOccurrenceId, null)
    assert.equal(await db.contactServiceChecklistItem.count({ where: { contactServiceId: id } }), 1)
    const root = events.find(event => event.triggerType === "SERVICE_ENROLLED")!
    assert.equal(root.dispatches.length, 1)
    const changed = await request(`/api/account-settings/${tenantId}/automations/${enrolled.automation.id}`, "PATCH", { ...enrolled.payload, actions: [noteAction("Changed later")] })
    assert.equal(changed.status, 200)
    await processCompletionEvent(root.id)
    await processCompletionEvent(root.id)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "SERVICE_ENROLLED", contactId: fixture.contact.id } }), 1)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Changed later" } }), 0)
  })

  test("new service triggers allow empty drafts and enrollment actions while rejecting step actions on every path", async () => {
    const fixture = await completionFixture()
    const path = `/api/account-settings/${tenantId}/automations`
    const trigger = { type: "SERVICE_ENROLLED", serviceGroupId: parentId, serviceOfferingId: fixture.child.data.service.id, serviceTriggerConfig: {} }
    const empty = { name: "Empty enrollment workflow", trigger, isEnabled: false, actions: [], conditions: [] }
    const emptySaved = await request(path, "POST", empty)
    assert.equal(emptySaved.status, 201, JSON.stringify(emptySaved.data))
    assert.equal((await request(path, "POST", { ...empty, name: randomUUID(), isEnabled: true })).status, 400)
    for (const type of ["MOVE_SERVICE_STEP", "COMPLETE_SERVICE_STEP", "SKIP_SERVICE_STEP", "SCHEDULE_SERVICE_STEP", "SET_SERVICE_STEP_OWNER"]) {
      const action = type === "MOVE_SERVICE_STEP" ? { type, serviceConfig: { targetSourceStepId: fixture.source.id, reason: "Test" } } : type === "SKIP_SERVICE_STEP" ? { type, serviceConfig: { reason: "Test" } } : type === "SCHEDULE_SERVICE_STEP" ? { type, serviceConfig: { schedule: { mode: "DEFAULT" } } } : type === "SET_SERVICE_STEP_OWNER" ? { type, serviceConfig: { assignedToUserId: userId } } : { type, serviceConfig: {} }
      const saved = await request(path, "POST", { ...empty, name: randomUUID(), isEnabled: true, actions: [{ type: "SPLIT", splitConfig: { actionName: "Routes", routes: [{ branchKey: randomUUID(), name: "A", percentage: 50, actions: [action] }, { branchKey: randomUUID(), name: "B", percentage: 50, actions: [] }] } }] })
      assert.equal(saved.status, 400, type)
    }
    assert.equal((await request(path, "POST", { ...empty, name: randomUUID(), trigger: { ...trigger, serviceGroupId: randomUUID() }, actions: [noteAction()] })).status, 400)
    assert.equal((await request(path, "POST", { ...empty, name: randomUUID(), trigger: { ...trigger, serviceOfferingId: randomUUID() }, actions: [noteAction()] })).status, 400)
    const published = await publishEnrollmentTrigger("SERVICE_ENROLLED", {}, [{ nodeKey: randomUUID(), type: "SET_SERVICE_COORDINATOR", serviceConfig: { assignedToUserId: userId } }, noteAction("After checkpoint")])
    const enrollment = await fixture.enroll()
    const event = (await serviceEvents(enrollment.id, "SERVICE_ENROLLED"))[0]!
    await processCompletionEvent(event.id)
    const run = await db.automationRun.findFirstOrThrow({ where: { dispatchId: event.dispatches[0]!.id } })
    assert.equal(run.status, "QUEUED")
    assert.equal((await db.contactService.findUniqueOrThrow({ where: { id: enrollment.id } })).followUpCoordinatorUserId, userId)
    await db.$transaction(tx => moveServiceStepTx(tx, { tenantId, contactServiceId: enrollment.id, expectedOccurrenceId: enrollment.occurrence.id, requestId: randomUUID(), kind: "SKIP", reason: "Move while enrollment workflow is queued", actorUserId: userId }))
    assert.equal((await db.automationRun.findUniqueOrThrow({ where: { id: run.id } })).status, "QUEUED")
    await resumeDueAutomationRuns(db)
    assert.equal(await db.contactNote.count({ where: { tenantId, contactId: fixture.contact.id, title: "After checkpoint" } }), 1)
    assert.equal(await db.serviceAutomationActionResult.count({ where: { runId: run.id } }), 1)
    const catalog = await request(`/api/account-settings/${tenantId}/automations/catalog`)
    assert.equal(catalog.data.catalog.workflowAutomations.some((item: any) => item.id === published.automation.id), false)
  })

  test("payment events compare all saved details, retain deleted snapshots, and serialize competing charges", async () => {
    const fixture = await completionFixture()
    await db.contactService.update({ where: { id: fixture.id }, data: { allowPartialPayments: true } })
    const paymentPath = `/api/services/${tenantId}/contact-services/${fixture.id}/payments`
    const created = await request(paymentPath, "POST", { amountCents: 2000, paidAt: "2026-10-01T12:00:00.000Z", paymentMethod: "CASH", note: "First" })
    assert.equal(created.status, 201, JSON.stringify(created.data))
    let id = created.data.payment.id
    const before = await db.contactServicePayment.findUniqueOrThrow({ where: { id } })
    assert.equal((await request(`${paymentPath}/${id}`, "PATCH", { amountCents: 2000, paidAt: "2026-10-01T12:00:00.000Z", paymentMethod: "CASH", note: "  First  " })).status, 200)
    assert.equal((await db.contactServicePayment.findUniqueOrThrow({ where: { id } })).updatedAt.getTime(), before.updatedAt.getTime())
    for (const patch of [{ note: "Revised" }, { paymentMethod: "CARD" }, { paidAt: "2026-10-02T12:00:00.000Z" }, { amountCents: 3000 }]) {
      const corrected = await request(`${paymentPath}/${id}`, "PATCH", patch)
      assert.equal(corrected.status, 200, JSON.stringify(corrected.data))
      id = corrected.data.payment.id
    }
    const events = await serviceEvents(fixture.id, "SERVICE_PAYMENT_CHANGED")
    assert.equal(events.length, 5)
    assert.ok(events.every(event => event.status === "COMPLETED" && !event.dispatches.length))
    assert.equal((await request(`${paymentPath}/${id}`, "DELETE")).status, 200)
    const removed = (await serviceEvents(fixture.id, "SERVICE_PAYMENT_CHANGED")).at(-1)!
    assert.equal((removed.serviceEventSnapshot as any).previous.note, "Revised")
    assert.equal((removed.serviceEventSnapshot as any).previous.amountCents, 3000)
    assert.equal((removed.serviceEventSnapshot as any).next, null)
    const competing = await Promise.all([request(paymentPath, "POST", { amountCents: 7000 }), request(paymentPath, "POST", { amountCents: 7000 })])
    assert.equal(competing.filter(result => result.status === 201).length, 1)
    assert.ok(competing.some(result => result.status === 400 || result.status === 409))
    assert.equal((await db.contactServicePayment.aggregate({ where: { contactServiceId: fixture.id, voidedAt: null }, _sum: { amountCents: true } }))._sum.amountCents, 7000)
    const revisions = (await serviceEvents(fixture.id)).map(event => (event.serviceEventSnapshot as any)?.revision).filter(Boolean)
    assert.equal(new Set(revisions).size, revisions.length)
  })

  test("checklist triggers preserve archived source references and automation chain attribution", async () => {
    const config = await configureParent()
    const fixture = await completionFixture()
    const sourceId = config.checklistItems[0].id
    const trigger = await publishEnrollmentTrigger("SERVICE_CHECKLIST_STATUS_CHANGED", { checklistItemId: sourceId, previousStatus: null, status: "RECEIVED" }, [{ type: "SET_SERVICE_CHECKLIST_STATUS", nodeKey: randomUUID(), serviceConfig: { checklistItemId: sourceId, status: "MISSING" } }])
    const missing = await publishEnrollmentTrigger("SERVICE_CHECKLIST_STATUS_CHANGED", { checklistItemId: sourceId, previousStatus: "RECEIVED", status: "MISSING" }, [noteAction("Automation changed checklist")])
    await reviewAndApplyConfiguration(fixture.id)
    const item = await db.contactServiceChecklistItem.findFirstOrThrow({ where: { contactServiceId: fixture.id } })
    const path = `/api/services/${tenantId}/contact-services/${fixture.id}/checklist-items/${item.id}`
    assert.equal((await request(path, "PATCH", { status: "RECEIVED" })).status, 200)
    const original = (await serviceEvents(fixture.id, "SERVICE_CHECKLIST_STATUS_CHANGED"))[0]!
    await processCompletionEvent(original.id)
    const generated = (await serviceEvents(fixture.id, "SERVICE_CHECKLIST_STATUS_CHANGED"))[1]!
    assert.equal(generated.chainId, original.chainId)
    assert.equal(generated.sourceAutomationId, trigger.automation.id)
    assert.equal(generated.actorUserId, null)
    await processCompletionEvent(generated.id)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Automation changed checklist", contactId: fixture.contact.id } }), 1)
    assert.equal((await request(`${settingsPath()}/${parentId}`, "PATCH", { checklistItems: [] })).status, 200)
    assert.equal((await request(`/api/account-settings/${tenantId}/automations/${missing.automation.id}`, "PATCH", missing.payload)).status, 200)
    assert.equal((await request(path, "PATCH", { status: "RECEIVED" })).status, 200)
    const count = (await serviceEvents(fixture.id, "SERVICE_CHECKLIST_STATUS_CHANGED")).length
    assert.equal((await request(path, "PATCH", { status: "RECEIVED" })).status, 200)
    assert.equal((await serviceEvents(fixture.id, "SERVICE_CHECKLIST_STATUS_CHANGED")).length, count)
    assert.ok((await db.contactServiceChecklistItem.findUniqueOrThrow({ where: { id: item.id } })).completedAt)
  })

  test("status events follow finished-work payment rules and payment failure rolls back events", async () => {
    const fixture = await completionFixture()
    await publishEnrollmentTrigger("SERVICE_STATUS_CHANGED", { previousStatus: null, status: null })
    const paymentPath = `/api/services/${tenantId}/contact-services/${fixture.id}/payments`
    assert.equal((await request(completePath(fixture.id, fixture.occurrence.id), "POST")).status, 200)
    const last = await db.serviceStepOccurrence.findFirstOrThrow({ where: { contactServiceId: fixture.id, status: "ACTIVE" } })
    assert.equal((await request(completePath(fixture.id, last.id), "POST")).status, 200)
    assert.equal((await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).status, "PENDING_PAYMENT")
    const paid = await request(paymentPath, "POST", { amountCents: 10000 })
    assert.equal(paid.status, 201)
    assert.equal((await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).status, "COMPLETED")
    assert.equal((await request(`${paymentPath}/${paid.data.payment.id}`, "DELETE")).status, 200)
    assert.equal((await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).status, "PENDING_PAYMENT")
    assert.deepEqual((await serviceEvents(fixture.id, "SERVICE_STATUS_CHANGED")).map(event => (event.serviceEventSnapshot as any).next.status), ["PENDING_PAYMENT", "COMPLETED", "PENDING_PAYMENT"])
    const { mutateServicePaymentTx } = await import("./service-payment-mutations.js")
    const beforeCount = (await serviceEvents(fixture.id)).length
    await assert.rejects(db.$transaction(async tx => { await mutateServicePaymentTx(tx, { tenantId, contactServiceId: fixture.id, operation: "ADDED", actorUserId: userId, requestKey: randomUUID(), expectedRevision: (await tx.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).financialRevision, payload: { amountCents: 10000 } }); throw new Error("Rollback test") }))
    assert.equal((await serviceEvents(fixture.id)).length, beforeCount)
    assert.equal(await db.contactServicePayment.count({ where: { contactServiceId: fixture.id, voidedAt: null } }), 0)
    const other = await fixture.enroll()
    assert.equal((await request(`/api/services/${tenantId}/contact-services/${other.id}`, "PATCH", { status: "CANCELED" })).status, 200)
    assert.equal((await request(`/api/services/${tenantId}/contact-services/${other.id}/payments`, "POST", { amountCents: 10000 })).status, 201)
    assert.equal((await db.contactService.findUniqueOrThrow({ where: { id: other.id } })).status, "CANCELED")
    await db.contactService.update({ where: { id: other.id }, data: { workflowKind: "LEGACY_TEMPLATE" } })
    const count = (await serviceEvents(other.id)).length
    const payment = await db.contactServicePayment.findFirstOrThrow({ where: { contactServiceId: other.id } })
    assert.equal((await request(`/api/services/${tenantId}/contact-services/${other.id}/payments/${payment.id}`, "PATCH", { note: "Legacy edit" })).status, 200)
    assert.equal((await serviceEvents(other.id)).length, count)
  })

  test("new trigger filters pin contact fields, custom fields, and tags and scope enrollments exactly", async () => {
    const fixture = await completionFixture()
    const tag = await db.tenantTag.create({ data: { tenantId, name: "Qualified", bgColor: "#fff", textColor: "#000" } })
    const field = await db.contactCustomField.create({ data: { tenantId, key: "service_test", label: "Service test", fieldType: "TEXT", options: [] } })
    await db.contactTag.create({ data: { tenantId, contactId: fixture.contact.id, tagId: tag.id } })
    await db.contactCustomFieldValue.create({ data: { tenantId, contactId: fixture.contact.id, fieldId: field.id, value: "Eligible" } })
    const conditions = [{ source: "CONTACT_FIELD", fieldKey: "first_name", operator: "EQUALS", compareValue: "Inheritance" }, { source: "CONTACT_CUSTOM_FIELD", customFieldId: field.id, operator: "EQUALS", compareValue: "Eligible" }, { source: "CONTACT_TAGS", tagId: tag.id, operator: "EQUALS" }]
    const published = await publishEnrollmentTrigger("SERVICE_ENROLLED", {}, [noteAction("Captured service filter")], fixture.child.data.service.id, conditions)
    const entered = await fixture.enroll()
    const queued = (await serviceEvents(entered.id, "SERVICE_ENROLLED"))[0]!
    assert.equal(queued.dispatches.length, 1)
    await db.contact.update({ where: { id: fixture.contact.id }, data: { firstName: "Changed after event" } })
    await db.contactTag.deleteMany({ where: { contactId: fixture.contact.id } })
    await processCompletionEvent(queued.id)
    assert.equal(await db.contactNote.count({ where: { tenantId, title: "Captured service filter" } }), 1)
    const miss = await fixture.enroll()
    assert.equal((await serviceEvents(miss.id, "SERVICE_ENROLLED"))[0]!.dispatches.length, 0)
    const other = (await createChild("Other offering")).data.service
    const enrollment = await request(`/api/services/${tenantId}/contact-services`, "POST", { contactId: fixture.contact.id, serviceId: other.id })
    assert.equal((await serviceEvents(enrollment.data.contactService.id, "SERVICE_ENROLLED"))[0]!.dispatches.length, 0)
    assert.ok(published.automation.id)
  })

  test("derived completion keeps the initiating chain even when no completion workflow matches", async () => {
    const fixture = await completionFixture()
    assert.equal((await request(completePath(fixture.id, fixture.occurrence.id), "POST")).status, 200)
    const last = await db.serviceStepOccurrence.findFirstOrThrow({ where: { contactServiceId: fixture.id, status: "ACTIVE" } })
    const chainId = randomUUID(), automationId = randomUUID()
    const { completeServiceStepOccurrenceTx } = await import("./service-step-progression.js")
    await db.$transaction(tx => completeServiceStepOccurrenceTx(tx, { tenantId, contactServiceId: fixture.id, occurrenceId: last.id, actorUserId: null, automationChain: { chainId, sourceAutomationId: automationId, sourceAutomationName: "Automatic completion", sourceNodeKey: "complete", chainDepth: 3 } }))
    const event = (await serviceEvents(fixture.id, "SERVICE_STATUS_CHANGED"))[0]!
    assert.equal(event.chainId, chainId)
    assert.equal(event.chainDepth, 3)
    assert.equal(event.sourceAutomationId, automationId)
    assert.equal(event.actorUserId, null)
  })

  test("all enrollment trigger kinds execute published branches with four supported enrollment actions", async () => {
    const config = await configureParent()
    const fixture = await completionFixture()
    const cases = [
      { type: "SERVICE_ENROLLED", config: {}, action: { type: "SET_SERVICE_COORDINATOR", serviceConfig: { assignedToUserId: userId } } },
      { type: "SERVICE_PAYMENT_CHANGED", config: { changes: ["ADDED"], paymentState: null }, action: { type: "SET_SERVICE_PROFESSIONAL", serviceConfig: { professionalId: config.professionals[0].id } } },
      { type: "SERVICE_CHECKLIST_STATUS_CHANGED", config: { checklistItemId: null, previousStatus: null, status: "RECEIVED" }, action: { type: "SET_SERVICE_CHECKLIST_STATUS", serviceConfig: { checklistItemId: config.checklistItems[0].id, status: "MISSING" } } },
      { type: "SERVICE_STATUS_CHANGED", config: { previousStatus: null, status: "CANCELED" }, action: { type: "SET_SERVICE_STATUS", serviceConfig: { status: "CANCELED" } } },
    ]
    for (const entry of cases) {
      const branch = { type: "SPLIT", nodeKey: randomUUID(), splitConfig: { actionName: entry.type, routes: [1, 2].map(index => ({ name: `Route ${index}`, percentage: 50, actions: [{ ...entry.action, nodeKey: randomUUID() }] })) } }
      await publishEnrollmentTrigger(entry.type, entry.config, [branch])
      const enrolled = await fixture.enroll()
      if (entry.type === "SERVICE_PAYMENT_CHANGED") assert.equal((await request(`/api/services/${tenantId}/contact-services/${enrolled.id}/payments`, "POST", { amountCents: 10000 })).status, 201)
      if (entry.type === "SERVICE_CHECKLIST_STATUS_CHANGED") {
        const item = await db.contactServiceChecklistItem.findFirstOrThrow({ where: { contactServiceId: enrolled.id } })
        assert.equal((await request(`/api/services/${tenantId}/contact-services/${enrolled.id}/checklist-items/${item.id}`, "PATCH", { status: "RECEIVED" })).status, 200)
      }
      if (entry.type === "SERVICE_STATUS_CHANGED") assert.equal((await request(`/api/services/${tenantId}/contact-services/${enrolled.id}`, "PATCH", { status: "CANCELED" })).status, 200)
      const event = (await serviceEvents(enrolled.id, entry.type))[0]!
      await processCompletionEvent(event.id)
      const run = await db.automationRun.findFirstOrThrow({ where: { dispatchId: event.dispatches[0]!.id } })
      assert.equal(run.status, entry.type === "SERVICE_STATUS_CHANGED" ? "EXITED" : "SUCCEEDED", `${entry.type}: ${run.failureMessage}`)
      assert.equal(await db.serviceAutomationActionResult.count({ where: { runId: run.id } }), 1)
    }
  })

  test("public catalog exposes inherited steps and parent identity without requiring settings access", async () => {
    const configured = await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [{ title: "Review" }, { title: "Submit" }] })
    assert.equal(configured.status, 200)
    const child = (await createChild()).data.service
    const other = (await createChild("Part A")).data.service
    const workflow = configured.data.service.steps[0].automations[0]
    await db.automation.update({ where: { id: workflow.id }, data: { serviceOfferingId: other.id } })
    await db.membership.update({ where: { userId_tenantId: { tenantId, userId } }, data: { role: "TENANT_USER", securityLevel: "LOW" } })
    const catalog = await request(`/api/services/${tenantId}/catalog?serviceGroupId=${parentId}&serviceId=${child.id}&search=Medicare`)
    assert.equal(catalog.status, 200, JSON.stringify(catalog.data))
    assert.equal(catalog.data.pagination.total, 1)
    assert.equal(catalog.data.items[0].parentService.id, parentId)
    assert.equal(catalog.data.items[0].steps.length, 2)
    assert.equal(catalog.data.items[0].steps[0].id, configured.data.service.steps[0].id)
    assert.equal(catalog.data.items[0].steps[0].automations.some((item: any) => item.id === workflow.id), false)
    const detail = await request(`/api/services/${tenantId}/catalog/${child.id}`)
    assert.equal(detail.data.service.steps[0].automations.some((item: any) => item.id === workflow.id), false)
    const options = await request(`/api/services/${tenantId}/options`)
    assert.ok(options.data.items.every((item: any) => item.parentService.id === parentId))
    await db.service.update({ where: { id: parentId }, data: { isActive: false } })
    assert.equal((await request(`/api/services/${tenantId}/catalog`)).data.pagination.total, 0)
    const historical = await request(`/api/services/${tenantId}/options?includeInactive=true`)
    assert.equal(historical.data.items.length, 2)
    assert.equal(historical.data.items[0].parentService.isActive, false)
  })

  test("retired saved work preserves history, assignments and attribution with manual controls only", async () => {
    const child = (await createChild()).data.service
    const contact = await createContact()
    const completedAt = new Date("2026-10-01T12:00:00.000Z")
    const archive = { schemaVersion: 1, retiredAt: "2026-10-22T00:00:00.000Z", template: { id: "old-template", name: "Original workflow", draftDefinition: { private: true } }, version: { id: "old-version", versionNumber: 2, definition: { private: true } }, run: { id: "old-run", status: "WAITING", variables: { private: true } } }
    const enrollment = await db.contactService.create({ data: { tenantId, serviceId: child.id, contactId: contact.id, workflowKind: "LEGACY_TEMPLATE", totalPriceCents: 100, followUpTemplateId: "old-template", retiredWorkflowSnapshot: archive } })
    const saved = await db.contactServiceFollowUpStep.create({ data: { tenantId, contactServiceId: enrollment.id, runId: "old-run", title: "Already completed", status: "COMPLETED", completedAt, resolvedAt: completedAt, resolvedByUserId: userId, assignedToUserId: userId, sortOrder: 0 } })
    const current = await db.contactServiceFollowUpStep.create({ data: { tenantId, contactServiceId: enrollment.id, runId: "old-run", title: "Review remaining work", status: "ACTIVE", assignedToUserId: userId, sortOrder: 10 } })
    const next = await db.contactServiceFollowUpStep.create({ data: { tenantId, contactServiceId: enrollment.id, runId: "old-run", title: "Submit manually", sortOrder: 20 } })
    const path = `/api/services/${tenantId}/contact-services/${enrollment.id}`
    const detail = await request(path)
    assert.equal(detail.status, 200, JSON.stringify(detail.data))
    assert.equal(detail.data.contactService.retiredWorkflow.template.name, "Original workflow")
    assert.equal(detail.data.contactService.retiredWorkflow.hadUnfinishedWork, true)
    assert.doesNotMatch(JSON.stringify(detail.data), /draftDefinition|variables|private/)
    const register = await request(`/api/services/${tenantId}/contact-services?contactId=${contact.id}`)
    assert.equal(register.data.items[0].retiredWorkflow.template.name, "Original workflow")
    assert.equal((await request(`${path}/follow-up-steps/${saved.id}`, "DELETE")).status, 409)
    assert.equal((await request(`${path}/follow-up-steps/${saved.id}`, "PATCH", { assignedToUserId: null })).status, 409)
    const before = await db.contactServiceFollowUpStep.findUniqueOrThrow({ where: { id: current.id } })
    const invalid = await request(`${path}/follow-up-steps/${current.id}`, "PATCH", { title: "Must roll back", assignedToUserId: randomUUID() })
    assert.equal(invalid.data.error, "INVALID_ASSIGNEE")
    assert.equal((await db.contactServiceFollowUpStep.findUniqueOrThrow({ where: { id: current.id } })).title, before.title)
    const other = await db.contactService.create({ data: { tenantId, serviceId: child.id, contactId: contact.id, totalPriceCents: 0 } })
    assert.equal((await request(`/api/services/${tenantId}/contact-services/${other.id}/follow-up-steps/${current.id}`, "PATCH", { status: "COMPLETED" })).status, 404)
    assert.equal((await request(`${path}/follow-up-steps/${current.id}`, "PATCH", { title: "Updated saved instructions", note: "Reviewed manually" })).status, 200)
    const note = await request(`/api/contacts/${tenantId}/${contact.id}/notes`, "POST", { contactServiceId: enrollment.id, contactServiceFollowUpStepId: current.id, title: "History retained", body: "Reviewed", attachmentFileIds: [] })
    assert.equal(note.status, 201, JSON.stringify(note.data))
    const storedNote = await db.contactNote.findFirstOrThrow({ where: { tenantId, title: "History retained" } })
    assert.equal((storedNote.retiredWorkflowSnapshot as any).template.name, "Original workflow")
    assert.doesNotMatch(JSON.stringify(storedNote.retiredWorkflowSnapshot), /definition|variables/i)
    const task = await request(`/api/tasks/${tenantId}`, "POST", { name: "Retained manual task", contactId: contact.id, contactServiceId: enrollment.id, contactServiceFollowUpStepId: current.id, startedAt: new Date().toISOString() })
    assert.equal(task.status, 201, JSON.stringify(task.data))
    const storedTask = await db.task.findFirstOrThrow({ where: { tenantId, name: "Retained manual task" } })
    assert.equal((storedTask.retiredWorkflowSnapshot as any).template.name, "Original workflow")
    assert.doesNotMatch(JSON.stringify(storedTask.retiredWorkflowSnapshot), /definition|variables/i)
    const results = await Promise.all([request(`${path}/follow-up-steps/${current.id}`, "PATCH", { status: "COMPLETED" }), request(`${path}/follow-up-steps/${current.id}`, "PATCH", { status: "COMPLETED" })])
    assert.ok(results.every(result => result.status === 200), JSON.stringify(results))
    assert.equal(await db.serviceFollowUpExecutionLog.count({ where: { tenantId, stepId: current.id, eventType: "SAVED_FOLLOW_UP_UPDATED", payload: { path: ["status"], equals: "COMPLETED" } } }), 1)
    const completed = await db.contactServiceFollowUpStep.findUniqueOrThrow({ where: { id: current.id } })
    assert.equal(completed.assignedToUserId, userId)
    assert.equal(completed.resolvedByUserId, userId)
    assert.equal((await db.contactServiceFollowUpStep.findUniqueOrThrow({ where: { id: next.id } })).status, "ACTIVE")
    assert.equal((await request(`${path}/follow-up-steps/${next.id}`, "PATCH", { status: "COMPLETED" })).status, 200)
    assert.equal((await db.contactService.findUniqueOrThrow({ where: { id: enrollment.id } })).status, "PENDING_PAYMENT")
    const original = await db.contactServiceFollowUpStep.findUniqueOrThrow({ where: { id: saved.id } })
    assert.equal(original.completedAt?.getTime(), completedAt.getTime())
    assert.equal(original.assignedToUserId, userId)
    assert.equal(await db.automationEvent.count({ where: { tenantId } }), 0)
    for (const [url, method] of [[`${settingsPath()}/${child.id}/follow-up-templates`, "GET"], [`${path}/follow-up-run/continue-now`, "POST"]]) {
      assert.equal((await fetch(`${base}${url}`, { method, headers: { Cookie: `sid=${token}` } })).status, 404)
    }
    assert.equal((await request(`${settingsPath()}/${child.id}`, "PATCH", { followUpTemplateSteps: [] })).status, 400)
    assert.equal((await request(`/api/services/${tenantId}/contact-services`, "POST", { contactId: contact.id, serviceId: child.id, followUpTemplateId: "old-template" })).status, 400)
    assert.equal((await request(`/api/services/${tenantId}/contact-services`, "POST", { contactId: contact.id, serviceId: child.id })).data.error, "SERVICE_STEPS_REQUIRED")
    await db.contactService.delete({ where: { id: enrollment.id } })
    const editedTask = await request(`/api/tasks/${tenantId}/${storedTask.id}`, "PATCH", { name: "Reviewed retained task" })
    assert.equal(editedTask.status, 200, JSON.stringify(editedTask.data))
    const orphan = await db.task.findUniqueOrThrow({ where: { id: storedTask.id } })
    assert.equal(orphan.contactServiceId, null)
    assert.equal(orphan.followUpTemplateId, "old-template")
    assert.equal((orphan.retiredWorkflowSnapshot as any).template.name, "Original workflow")
    assert.equal((await db.contactNote.findUniqueOrThrow({ where: { id: storedNote.id } })).contactServiceId, null)
  })

  test("saved manual scheduling, reopening and failed transactions preserve state and complete audit values", async () => {
    const child = (await createChild()).data.service
    const contact = await createContact()
    const enrollment = await db.contactService.create({ data: { tenantId, serviceId: child.id, contactId: contact.id, totalPriceCents: 0, workflowKind: "LEGACY_TEMPLATE" } })
    const oldDate = new Date(Date.now() + 86400000)
    const laterDate = new Date(oldDate.getTime() + 86400000)
    const current = await db.contactServiceFollowUpStep.create({ data: { tenantId, contactServiceId: enrollment.id, title: "Current", status: "ACTIVE", dueAt: oldDate, availableAt: new Date(), assignedToUserId: userId, overdueNotifiedAt: new Date(), overdueNotifiedDueAt: oldDate, sortOrder: 0 } })
    const next = await db.contactServiceFollowUpStep.create({ data: { tenantId, contactServiceId: enrollment.id, title: "Next", dueAt: laterDate, availableAt: oldDate, sortOrder: 10 } })
    const path = `/api/services/${tenantId}/contact-services/${enrollment.id}/follow-up-steps`
    const postponeTo = new Date(oldDate.getTime() + 3600000).toISOString()
    const postponed = await request(`${path}/${current.id}`, "PATCH", { status: "POSTPONED", postponeTo })
    assert.equal(postponed.status, 200, JSON.stringify(postponed.data))
    assert.equal(postponed.data.followUpStep.dueAt, postponeTo)
    assert.equal(postponed.data.followUpStep.overdueNotifiedAt, null)
    const shifted = await db.contactServiceFollowUpStep.findUniqueOrThrow({ where: { id: next.id } })
    assert.equal(shifted.dueAt?.getTime(), laterDate.getTime() + 3600000)
    assert.equal(shifted.availableAt?.getTime(), oldDate.getTime() + 3600000)
    assert.equal((await request(`${path}/${next.id}`, "PATCH", { status: "COMPLETED" })).status, 409)
    assert.equal((await request(`${path}/${current.id}`, "PATCH", { nextFollowUpAt: postponeTo })).status, 400)
    const input = { tenantId, contactServiceId: enrollment.id, stepId: current.id, actorUserId: userId }
    const logCount = await db.serviceFollowUpExecutionLog.count({ where: { tenantId } })
    await assert.rejects(db.$transaction(async tx => { await patchSavedFollowUpTx(tx, { ...input, patch: { title: "Must roll back" } }); throw Error("forced failure") }), /forced failure/)
    assert.equal((await db.contactServiceFollowUpStep.findUniqueOrThrow({ where: { id: current.id } })).title, "Current")
    assert.equal(await db.serviceFollowUpExecutionLog.count({ where: { tenantId } }), logCount)
    assert.equal((await request(`${path}/${current.id}`, "PATCH", { status: "COMPLETED" })).status, 200)
    const completed = await db.contactServiceFollowUpStep.findUniqueOrThrow({ where: { id: current.id } })
    assert.ok(completed.completedAt)
    const unchanged = await request(`${path}/${current.id}`, "PATCH", { title: "Current" })
    assert.equal(unchanged.data.followUpStep.assignedTo.id, userId)
    assert.equal((await db.contactServiceFollowUpStep.findUniqueOrThrow({ where: { id: current.id } })).updatedAt.getTime(), completed.updatedAt.getTime())
    assert.equal((await request(`${path}/${current.id}`, "PATCH", { action: "REOPEN" })).status, 200)
    const reopened = await db.contactServiceFollowUpStep.findUniqueOrThrow({ where: { id: current.id } })
    assert.equal(reopened.status, "ACTIVE")
    assert.equal(reopened.resolvedAt, null)
    assert.equal(reopened.completedAt, null)
    assert.equal(reopened.assignedToUserId, userId)
    const activity = await db.serviceFollowUpExecutionLog.findFirstOrThrow({ where: { tenantId, stepId: current.id, payload: { path: ["previousStatus"], equals: "COMPLETED" } } })
    assert.equal((activity.payload as any).before.completedAt, completed.completedAt?.toISOString())
    assert.equal((activity.payload as any).before.resolvedByUserId, userId)
    assert.equal((activity.payload as any).after.completedAt, null)
    assert.equal((await db.contactService.findUniqueOrThrow({ where: { id: enrollment.id } })).status, "IN_PROGRESS")
  })

  test("explicit step enrollment rejects missing configuration and initializes saved work without templates", async () => {
    const child = (await createChild()).data.service
    const readiness = await request(`${settingsPath()}/${child.id}`)
    assert.equal(readiness.data.service.configStatus.followUpsComplete, false)
    const contact = await createContact()
    const body = { serviceId: child.id, contactId: contact.id, workflowKind: "SERVICE_STEPS" }
    const rejected = await request(`/api/services/${tenantId}/contact-services`, "POST", body)
    assert.equal(rejected.status, 400)
    assert.equal(rejected.data.error, "SERVICE_STEPS_REQUIRED")
    assert.equal(await db.contactService.count({ where: { tenantId } }), 0)
    const configured = await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [{ title: "Review", instructions: "Saved instructions" }, { title: "Submit" }] })
    assert.equal(configured.status, 200)
    const enrolled = await request(`/api/services/${tenantId}/contact-services`, "POST", { ...body, followUpAssignedToUserId: userId })
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data))
    const id = enrolled.data.contactService.id
    const saved = await db.contactService.findUniqueOrThrow({ where: { id }, include: { serviceSteps: true, followUpSteps: true } })
    assert.equal(saved.workflowKind, "SERVICE_STEPS")
    assert.equal(saved.followUpTemplateId, null)
    assert.equal(saved.followUpCoordinatorUserId, userId)
    assert.equal(saved.serviceSteps.length, 2)
    assert.equal(saved.followUpSteps.length, 0)
    const list = await request(`/api/services/${tenantId}/contact-services?contactId=${contact.id}`)
    assert.equal(list.data.items[0].stepProgress.total, 2)
    assert.equal(list.data.items[0].service.parentService.id, parentId)
    assert.ok(list.data.items[0].nextFollowUp.at)
    assert.equal(list.data.items[0].followUpRun, undefined)
    const contacts = await request(`/api/contacts/${tenantId}`)
    assert.deepEqual(contacts.data.items[0].activeFollowUpServices, [{ id: child.id, name: "Medicare / Medicare Advantage" }])
    const appointmentMeta = await request(`/api/appointments/${tenantId}/meta`)
    assert.equal(appointmentMeta.status, 200, JSON.stringify(appointmentMeta.data))
    assert.equal(appointmentMeta.data.filters.services[0].parentService.id, parentId)
    const invalidAppointment = await request(`/api/appointments/${tenantId}`, "POST", {
      contactId: contact.id, serviceId: parentId, assignedToUserId: userId,
      startAt: "2026-11-02T15:00:00Z", endAt: "2026-11-02T15:30:00Z",
    })
    assert.equal(invalidAppointment.status, 404)
    assert.equal(invalidAppointment.data.error, "SERVICE_NOT_FOUND")
  })

  test("enrollment survives a database wait beyond five seconds and commits one complete account", async () => {
    const child = (await createChild()).data.service
    await request(`${settingsPath()}/${parentId}`, "PATCH", {
      basePriceCents: 100000,
      steps: [{ title: "Review" }, { title: "Submit" }],
      paymentSettings: { schemaVersion: 1, enabledTypes: ["SINGLE_PAYMENT", "INSTALLMENTS"], defaultType: "INSTALLMENTS", suggestedDepositCents: 20000, installmentCount: 4, installmentFrequency: "MONTHLY" },
    })
    const contact = await createContact()
    const paymentTerms = { type: "INSTALLMENTS", firstDueDate: "2027-01-31" }
    const preview = await request(`/api/services/${tenantId}/billing-preview`, "POST", { serviceId: child.id, paymentTerms, initialPaymentCents: 20000 })
    assert.equal(preview.status, 200)
    const body = { serviceId: child.id, contactId: contact.id, initialPaymentCents: 20000, paymentTerms, requestKey: randomUUID(), configurationVersion: preview.data.configurationVersion }
    const pool = new Pool({ connectionString: databaseUrl! })
    const blocker = await pool.connect()
    let enrolled: Awaited<ReturnType<typeof request>>
    try {
      await blocker.query("BEGIN")
      await blocker.query('SELECT id FROM "Service" WHERE "tenantId"=$1 AND id=$2 FOR UPDATE', [tenantId, parentId])
      const pending = request(`/api/services/${tenantId}/contact-services`, "POST", body)
      let blocked = false
      for (let attempt = 0; attempt < 50; attempt++) {
        const result = await blocker.query("SELECT EXISTS (SELECT 1 FROM pg_locks waiting JOIN pg_locks held ON waiting.transactionid = held.transactionid WHERE NOT waiting.granted AND held.granted AND held.pid = pg_backend_pid() AND held.locktype = 'transactionid') AS blocked")
        if (result.rows[0].blocked) { blocked = true; break }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      // Wait only after PostgreSQL confirms that enrollment is inside its
      // transaction waiting for this hierarchy lock. The old 5s limit expires.
      if (blocked) await blocker.query("SELECT pg_sleep(5.1)")
      await blocker.query("COMMIT")
      enrolled = await pending
      assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data))
      assert.ok(blocked, "Enrollment must use the hierarchy lock")
    } finally {
      await blocker.query("ROLLBACK")
      blocker.release()
      await pool.end()
    }
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data))
    const id = enrolled.data.contactService.id
    const account = await db.contactService.findUniqueOrThrow({ where: { id }, include: { payments: true, paymentDues: true, serviceSteps: { include: { occurrences: true } }, financialChanges: true } })
    assert.equal(account.status, "IN_PROGRESS")
    assert.equal(account.totalPriceCents, preview.data.totalPriceCents)
    assert.equal(account.paidCents, 20000)
    assert.equal(account.payments.length, 1)
    assert.equal(account.paymentDues.length, 5)
    assert.equal(account.serviceSteps.length, 2)
    assert.equal(account.serviceSteps.flatMap(step => step.occurrences).length, 1)
    assert.equal(account.financialChanges.length, 1)
    const events = await db.automationEvent.findMany({ where: { tenantId } })
    assert.deepEqual(events.map(event => event.triggerType).sort(), ["SERVICE_ENROLLED", "SERVICE_PAYMENT_CHANGED"])
    assert.ok(events.every(event => (event.serviceEventSnapshot as any).financials.paidCents === 20000))
    const retry = await request(`/api/services/${tenantId}/contact-services`, "POST", body)
    assert.equal(retry.status, 201)
    assert.equal(retry.data.contactService.id, id)
    assert.equal(await db.contactService.count({ where: { tenantId } }), 1)
    assert.equal(await db.automationEvent.count({ where: { tenantId } }), events.length)
  })

  test("parent and offering filters scope catalog totals, transactions, enrollments and the follow-up queue", async () => {
    const fixture = await completionFixture()
    const second = (await createChild("Part B")).data.service
    const secondEnrollment = await request(`/api/services/${tenantId}/contact-services`, "POST", { serviceId: second.id, contactId: fixture.contact.id, workflowKind: "SERVICE_STEPS" })
    assert.equal(secondEnrollment.status, 201)
    const foreignGroup = await db.service.create({ data: { tenantId, name: "Other service", kind: "GROUP", basePriceCents: 0 } })
    const another = await request(settingsPath(), "POST", { name: "Other offering", kind: "OFFERING", parentServiceId: foreignGroup.id, basePriceCents: 5000 })
    assert.equal(another.status, 201)
    assert.equal((await request(`${settingsPath()}/${foreignGroup.id}`, "PATCH", { steps: [{ title: "Other work" }] })).status, 200)
    assert.equal((await request(`/api/services/${tenantId}/contact-services`, "POST", { serviceId: another.data.service.id, contactId: fixture.contact.id, workflowKind: "SERVICE_STEPS" })).status, 201)
    for (const endpoint of ["transactions", "enrollments", "follow-ups"]) {
      const scoped = await request(`/api/services/${tenantId}/${endpoint}?serviceGroupId=${parentId}`)
      assert.equal(scoped.status, 200, JSON.stringify(scoped.data))
      assert.equal(scoped.data.pagination.total, 2, endpoint)
      const exact = await request(`/api/services/${tenantId}/${endpoint}?serviceGroupId=${parentId}&serviceId=${fixture.child.data.service.id}`)
      assert.equal(exact.data.pagination.total, 1, endpoint)
      if (endpoint === "enrollments") assert.equal(exact.data.items[0].workflowKind, "SERVICE_STEPS")
      const mismatch = await request(`/api/services/${tenantId}/${endpoint}?serviceGroupId=${foreignGroup.id}&serviceId=${fixture.child.data.service.id}`)
      assert.equal(mismatch.data.pagination.total, 0, endpoint)
      if (endpoint === "transactions") assert.equal(scoped.data.summary.totalsByCurrency[0].grossSalesCents, 20000)
    }
    const summary = await request(`/api/services/${tenantId}/catalog-summary?serviceGroupId=${parentId}`)
    assert.equal(summary.data.summary.servicesSold, 2)
    assert.equal(summary.data.summary.grossSalesCents, 20000)
    assert.equal(summary.data.summary.activeFollowUpServices, 2)
    const empty = await request(`/api/services/${tenantId}/catalog-summary?serviceGroupId=${randomUUID()}`)
    assert.equal(empty.data.summary.grossSalesCents, 0)
    assert.equal(empty.data.summary.activeFollowUpServices, 0)
    await db.service.update({ where: { id: fixture.child.data.service.id }, data: { isActive: false } })
    assert.equal((await request(`/api/services/${tenantId}/transactions?serviceId=${fixture.child.data.service.id}`)).data.pagination.total, 1)
    assert.equal((await request(`/api/services/${tenantId}/catalog?serviceId=${fixture.child.data.service.id}`)).data.pagination.total, 0)
  })

  test("contact progress and report work counts follow completion and movement while retaining saved history", async () => {
    const fixture = await completionFixture()
    assert.equal((await request(completePath(fixture.id, fixture.occurrence.id), "POST")).status, 200)
    const list = await request(`/api/services/${tenantId}/contact-services?contactId=${fixture.contact.id}`)
    const item = list.data.items[0]
    assert.equal(item.stepProgress.completed, 1)
    assert.equal(item.stepProgress.percentage, 50)
    assert.equal(item.serviceSteps[0].title, "Review")
    assert.equal(item.nextFollowUp.stepId, item.serviceSteps[1].id)
    assert.equal((await request(`/api/services/${tenantId}/catalog/${fixture.child.data.service.id}/summary`)).data.summary.activeFollowUpServices, 1)
    await request(`${settingsPath()}/${parentId}`, "PATCH", { steps: [{ id: fixture.source.id, title: "Changed future label" }] })
    const history = await request(`/api/services/${tenantId}/contact-services?contactId=${fixture.contact.id}`)
    assert.equal(history.data.items[0].serviceSteps[0].title, "Review")
    assert.equal(history.data.items[0].stepProgress.percentage, 50)
    const activity = new Date(Date.now() + 60000)
    await db.serviceStepOccurrence.update({ where: { id: fixture.occurrence.id }, data: { advancedAt: activity } })
    const register = await request(`/api/services/${tenantId}/enrollments?serviceId=${fixture.child.data.service.id}`)
    assert.equal(register.data.items[0].lastActivityAt, activity.toISOString())
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

  async function billingFixture(initialPaymentCents = 20000) {
    const fixture = await completionFixture()
    const paymentSettings = { schemaVersion: 1, enabledTypes: ["SINGLE_PAYMENT", "INSTALLMENTS", "FLEXIBLE"], defaultType: "INSTALLMENTS", suggestedDepositCents: 20000, installmentCount: 4, installmentFrequency: "MONTHLY" }
    const configured = await request(`${settingsPath()}/${parentId}`, "PATCH", { basePriceCents: 100000, paymentSettings })
    assert.equal(configured.status, 200, JSON.stringify(configured.data))
    const body = { contactId: fixture.contact.id, serviceId: fixture.child.data.service.id, initialPaymentCents, initialPaymentMethod: "CASH", paymentTerms: { type: "INSTALLMENTS", installmentCount: 4, firstDueDate: "2027-01-31" } }
    const created = await request(`/api/services/${tenantId}/contact-services`, "POST", body)
    assert.equal(created.status, 201, JSON.stringify(created.data))
    const id = created.data.contactService.id as string
    const path = `/api/services/${tenantId}/contact-services/${id}`
    return { ...fixture, id, path, body, paymentSettings, billing: async () => (await request(`${path}/billing`)).data }
  }

  test("billing saves an inherited account and split receipts settle one installment", async () => {
    const fixture = await billingFixture()
    const before = await fixture.billing()
    assert.equal(before.summary.paidCents, 20000)
    assert.deepEqual(before.summary.schedule.map((due: any) => due.amountCents), [20000, 20000, 20000, 20000, 20000])
    assert.deepEqual(before.summary.schedule.slice(1).map((due: any) => due.dueDate), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"])
    for (const amountCents of [7500, 12500]) assert.equal((await request(`${fixture.path}/payments`, "POST", { amountCents })).status, 201)
    const after = await fixture.billing()
    assert.equal(after.summary.paidCents, 40000)
    assert.equal(after.summary.remainingCents, 60000)
    assert.equal(after.summary.nextDueDate, "2027-02-28")
    assert.deepEqual(after.summary.schedule.map((due: any) => due.dueDate), before.summary.schedule.map((due: any) => due.dueDate))
    assert.equal((await db.contactService.findUniqueOrThrow({ where: { id: fixture.id } })).paidCents, 40000)
  })

  test("billing idempotency returns the original receipt and rejects conflicting reuse", async () => {
    const fixture = await billingFixture(0)
    const command = { requestKey: randomUUID(), expectedRevision: 1, amountCents: 7500 }
    const responses = await Promise.all([request(`${fixture.path}/payments`, "POST", command), request(`${fixture.path}/payments`, "POST", command)])
    assert.deepEqual(responses.map(response => response.status), [201, 201])
    assert.equal(responses[0].data.payment.id, responses[1].data.payment.id)
    assert.equal((await fixture.billing()).summary.paidCents, 7500)
    assert.equal(await db.contactServiceFinancialChange.count({ where: { tenantId, contactServiceId: fixture.id, kind: "PAYMENT_ADDED" } }), 1)
    const reused = await request(`${fixture.path}/payments`, "POST", { ...command, amountCents: 5000 })
    assert.equal(reused.status, 409)
    assert.equal(reused.data.error, "IDEMPOTENCY_KEY_REUSED")
  })

  test("billing rejects stale concurrent writes before a second receipt can be recorded", async () => {
    const fixture = await billingFixture(0)
    const writes = await Promise.all([1, 2].map(() => request(`${fixture.path}/payments`, "POST", { requestKey: randomUUID(), expectedRevision: 1, amountCents: 60000 })))
    assert.deepEqual(writes.map(response => response.status).sort(), [201, 409])
    assert.equal((await fixture.billing()).summary.remainingCents, 40000)
    const overpaid = await request(`${fixture.path}/payments`, "POST", { amountCents: 40001 })
    assert.equal(overpaid.status, 400)
    assert.equal(overpaid.data.error, "PAYMENT_EXCEEDS_SERVICE_TOTAL")
  })

  test("billing corrects receipts predating a revision without changing the original total", async () => {
    const fixture = await billingFixture()
    const receipt = await request(`${fixture.path}/payments`, "POST", { amountCents: 15000, paymentMethod: "CASH", note: "Original receipt" })
    const original = await db.contactServicePayment.findUniqueOrThrow({ where: { id: receipt.data.payment.id } })
    const revised = await request(`${fixture.path}/billing-plan`, "PATCH", { requestKey: randomUUID(), expectedRevision: 2, reason: "Customer needs more time", paymentTerms: { type: "INSTALLMENTS", installmentCount: 2, firstDueDate: "2027-06-15" } })
    assert.equal(revised.status, 200, JSON.stringify(revised.data))
    assert.deepEqual(revised.data.summary.schedule.map((due: any) => due.amountCents), [20000, 15000, 32500, 32500])
    const correction = await request(`${fixture.path}/payments/${original.id}`, "PATCH", { amountCents: 5000, reason: "Receipt amount was entered incorrectly" })
    assert.equal(correction.status, 200, JSON.stringify(correction.data))
    assert.notEqual(correction.data.payment.id, original.id)
    assert.equal(correction.data.payment.replacesPaymentId, original.id)
    const preserved = await db.contactServicePayment.findUniqueOrThrow({ where: { id: original.id } })
    assert.equal(preserved.amountCents, 15000)
    assert.equal(preserved.note, "Original receipt")
    assert.ok(preserved.voidedAt)
    const after = await fixture.billing()
    assert.equal(after.summary.totalPriceCents, 100000)
    assert.equal(after.summary.paidCents, 25000)
    assert.equal(after.summary.remainingCents, 75000)
    assert.deepEqual(after.summary.schedule.map((due: any) => due.remainingCents), [0, 10000, 32500, 32500])
    assert.equal(after.changes.find((change: any) => change.kind === "PLAN_REVISED").previous.schedule.length, 5)
    assert.ok(after.payments.some((payment: any) => payment.id === original.id && payment.voidedAt))
  })

  test("billing voids mistaken entries with a reason, preserves receipts, and prevents deleting their account", async () => {
    const fixture = await billingFixture(0)
    const receipt = await request(`${fixture.path}/payments`, "POST", { amountCents: 10000 })
    const command = { requestKey: randomUUID(), expectedRevision: 2, reason: "Duplicate paper receipt" }
    const first = await request(`${fixture.path}/payments/${receipt.data.payment.id}`, "DELETE", command)
    const retry = await request(`${fixture.path}/payments/${receipt.data.payment.id}`, "DELETE", command)
    assert.equal(first.status, 200)
    assert.deepEqual(first.data, retry.data)
    const after = await fixture.billing()
    assert.equal(after.summary.paidCents, 0)
    assert.equal(after.payments.length, 1)
    assert.ok(after.payments[0].voidedAt)
    assert.equal(after.changes.filter((change: any) => change.kind === "PAYMENT_REMOVED").length, 1)
    assert.equal((await request(fixture.path, "DELETE")).status, 409)
  })

  test("billing enforces payment and revision permissions and tenant isolation", async () => {
    const fixture = await billingFixture(0)
    await db.membership.update({ where: { userId_tenantId: { userId, tenantId } }, data: { role: "TENANT_USER", securityLevel: "MEDIUM" } })
    assert.equal((await request(`${fixture.path}/payments`, "POST", { amountCents: 1 })).status, 201)
    assert.equal((await request(`${fixture.path}/billing-plan`, "PATCH", { requestKey: randomUUID(), expectedRevision: 2, reason: "Change terms", paymentTerms: { type: "FLEXIBLE" } })).status, 403)
    await db.membership.update({ where: { userId_tenantId: { userId, tenantId } }, data: { securityLevel: "LOW" } })
    assert.equal((await fixture.billing()).permissions.canRecord, false)
    assert.equal((await request(`${fixture.path}/payments`, "POST", { amountCents: 1 })).status, 403)
    await db.membership.update({ where: { userId_tenantId: { userId, tenantId } }, data: { role: "TENANT_ADMIN" } })
    assert.equal((await fixture.billing()).permissions.canRecord, true)
    const foreign = await db.tenant.create({ data: { name: "Other agency", slug: randomUUID() } })
    try {
      assert.equal((await request(`/api/services/${foreign.id}/contact-services/${fixture.id}/billing`)).status, 403)
      await db.membership.create({ data: { tenantId: foreign.id, userId, role: "TENANT_ADMIN" } })
      assert.equal((await request(`/api/services/${foreign.id}/contact-services/${fixture.id}/billing`)).status, 404)
    } finally { await db.tenant.delete({ where: { id: foreign.id } }) }
  })

  test("billing preserves legacy balances until an admin confirms a schedule", async () => {
    const fixture = await billingFixture()
    await db.contactServicePaymentDue.deleteMany({ where: { tenantId, contactServiceId: fixture.id } })
    await db.contactService.update({ where: { id: fixture.id }, data: { paymentType: null, paymentPlan: Prisma.DbNull } })
    const before = await fixture.billing()
    assert.equal(before.summary.scheduleNeedsReview, true)
    assert.equal(before.summary.nextDueDate, null)
    assert.equal(before.summary.overdueCents, 0)
    assert.equal((await request(`${fixture.path}/payments`, "POST", { amountCents: 100 })).status, 201)
    const reviewed = await request(`${fixture.path}/billing-plan`, "PATCH", { requestKey: randomUUID(), expectedRevision: 2, reason: "Confirmed the customer's arrangement", paymentTerms: { type: "FLEXIBLE" } })
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data))
    assert.equal(reviewed.data.summary.scheduleNeedsReview, false)
    assert.equal(reviewed.data.summary.paidCents, 20100)
    assert.equal(reviewed.data.summary.remainingCents, 79900)
    assert.equal(reviewed.data.summary.nextDueDate, null)
  })

  test("billing enrollment retries create one account and stale previews cannot change the agreed price", async () => {
    const fixture = await billingFixture(0)
    const preview = await request(`/api/services/${tenantId}/billing-preview`, "POST", { serviceId: fixture.body.serviceId, initialPaymentCents: 0 })
    const body = { contactId: fixture.body.contactId, serviceId: fixture.body.serviceId, initialPaymentCents: 0, configurationVersion: preview.data.configurationVersion, requestKey: randomUUID() }
    const results = await Promise.all([request(`/api/services/${tenantId}/contact-services`, "POST", body), request(`/api/services/${tenantId}/contact-services`, "POST", body)])
    assert.equal(results[0].status, 201)
    assert.equal(results[1].status, 201)
    assert.equal(results[0].data.contactService.id, results[1].data.contactService.id)
    await request(`${settingsPath()}/${parentId}`, "PATCH", { basePriceCents: 120000 })
    const stale = await request(`/api/services/${tenantId}/contact-services`, "POST", { ...body, requestKey: randomUUID() })
    assert.equal(stale.status, 409)
    assert.equal(stale.data.error, "BILLING_CONFIGURATION_CHANGED")
    assert.equal((await fixture.billing()).summary.totalPriceCents, 100000)
  })

  test("billing register filters use real obligations, account balances, and review state", async () => {
    const fixture = await billingFixture(0)
    const before = await fixture.billing()
    const due = await request(`${fixture.path}/billing-plan`, "PATCH", { requestKey: randomUUID(), expectedRevision: 1, reason: "Confirmed due date", paymentTerms: { type: "SINGLE_PAYMENT", firstDueDate: before.summary.today } })
    assert.equal(due.status, 200)
    const matching = async (filter: string) => (await request(`/api/services/${tenantId}/transactions?paymentFilter=${filter}`)).data.items.some((item: any) => item.id === fixture.id)
    assert.equal(await matching("DUE_TODAY"), true)
    assert.equal(await matching("BALANCE_DUE"), true)
    assert.equal(await matching("OVERDUE"), false)
    assert.equal((await request(`${fixture.path}/payments`, "POST", { amountCents: 100000 })).status, 201)
    assert.equal(await matching("PAID"), true)
    assert.equal(await matching("DUE_TODAY"), false)
    const original = await request(`${fixture.path}/billing`)
    assert.equal(original.data.summary.workState, "IN_PROGRESS")
    assert.equal(original.data.summary.paymentState, "PAID")
  })

})
