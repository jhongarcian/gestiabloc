import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, afterEach, before, beforeEach, describe, test } from "node:test"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../generated/prisma/index.js"
import {
  saveServiceCollectionsTx, ServiceChecklistItemUpdateSchema,
  ServiceProfessionalUpdateSchema,
} from "./service-configuration-collections.js"
import { resolveServiceProfessionalChange } from "./contact-service-professional.js"

test("collection update inputs distinguish persisted IDs from new drafts", () => {
  const id = randomUUID()
  assert.equal(ServiceChecklistItemUpdateSchema.parse({ id, label: "Proof" }).id, id)
  assert.equal(ServiceChecklistItemUpdateSchema.parse({ label: "New" }).id, undefined)
  assert.equal(ServiceChecklistItemUpdateSchema.parse({ label: "New", description: "  " }).description, null)
  assert.equal(ServiceProfessionalUpdateSchema.parse({ id, kind: "EXTERNAL" }).id, id)
  assert.equal(ServiceProfessionalUpdateSchema.safeParse({ id: "draft-123", kind: "EXTERNAL" }).success, false)
})

// Run against a disposable database with the normal migrations applied:
// SERVICE_CONFIGURATION_TEST_DATABASE_URL=... node --import tsx --test src/lib/service-configuration-collections.test.ts
const databaseUrl = process.env.SERVICE_CONFIGURATION_TEST_DATABASE_URL
describe("service collection persistence in PostgreSQL", { skip: !databaseUrl }, () => {
  let db: PrismaClient
  let tenantId: string
  let serviceId: string
  let checklistId: string
  let professionalId: string
  let enrollmentId: string
  let enrolledItemId: string
  let userIds: string[]
  const completedAt = new Date("2026-10-01T12:00:00Z")

  before(() => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) })
  })
  after(async () => { await db?.$disconnect() })
  beforeEach(async () => {
    const tenant = await db.tenant.create({ data: { name: "Service save test", slug: `service-save-${randomUUID()}` } })
    tenantId = tenant.id
    const users = await Promise.all([0, 1].map(() => db.user.create({
      data: { name: "Test professional", email: `${randomUUID()}@example.test` },
    })))
    userIds = users.map((user) => user.id)
    const status = await db.contactStatusConfig.create({
      data: { tenantId, name: "Active", bgColor: "#ffffff", textColor: "#000000" },
    })
    const contact = await db.contact.create({
      data: { tenantId, firstName: "Test", lastName: "Contact", statusConfigId: status.id },
    })
    const service = await db.service.create({
      data: {
        tenantId, name: "Medicare Advantage", basePriceCents: 10000,
        checklistItems: { create: { tenantId, label: "Proof of address" } },
        professionals: { create: { tenantId, kind: "INTERNAL_USER", userId: userIds[0] } },
      }, include: { checklistItems: true, professionals: true },
    })
    serviceId = service.id
    checklistId = service.checklistItems[0]!.id
    professionalId = service.professionals[0]!.id
    const enrollment = await db.contactService.create({
      data: {
        tenantId, contactId: contact.id, serviceId, totalPriceCents: 10000,
        assignedProfessionalId: professionalId,
        checklistItems: { create: { tenantId, checklistItemId: checklistId, status: "RECEIVED", completedAt } },
      }, include: { checklistItems: true },
    })
    enrollmentId = enrollment.id
    enrolledItemId = enrollment.checklistItems[0]!.id
    await db.contactServiceChecklistActivity.create({
      data: {
        tenantId, contactServiceId: enrollmentId, contactServiceChecklistItemId: enrolledItemId,
        itemLabel: "Proof of address", previousStatus: "NOT_RECEIVED", status: "RECEIVED",
      },
    })
  })
  afterEach(async () => {
    await db.tenant.delete({ where: { id: tenantId } })
    await db.user.deleteMany({ where: { id: { in: userIds } } })
  })

  const save = (payload: Parameters<typeof saveServiceCollectionsTx>[3]) =>
    db.$transaction((tx) => saveServiceCollectionsTx(tx, tenantId, serviceId, payload))

  async function assertEnrollmentPreserved() {
    const enrollment = await db.contactService.findUniqueOrThrow({ where: { id: enrollmentId } })
    assert.equal(enrollment.assignedProfessionalId, professionalId)
    const item = await db.contactServiceChecklistItem.findUniqueOrThrow({ where: { id: enrolledItemId } })
    assert.equal(item.checklistItemId, checklistId)
    assert.equal(item.status, "RECEIVED")
    assert.equal(item.completedAt?.toISOString(), completedAt.toISOString())
    assert.equal(await db.contactServiceChecklistActivity.count({
      where: { contactServiceChecklistItemId: enrolledItemId },
    }), 1)
  }

  test("edits, reordering, and repeated saves preserve IDs and enrolled history", async () => {
    for (const sortOrder of [20, 10, 30]) {
      await save({
        checklistItems: [{ id: checklistId, label: "Updated proof", isRequired: false, sortOrder }],
        professionals: [{ id: professionalId, kind: "INTERNAL_USER", userId: userIds[0], notes: "Updated", sortOrder }],
      })
      await assertEnrollmentPreserved()
      assert.equal(await db.serviceChecklistItem.count({ where: { serviceId } }), 1)
      assert.equal(await db.serviceProfessional.count({ where: { serviceId } }), 1)
      assert.equal((await db.serviceChecklistItem.findUniqueOrThrow({ where: { id: checklistId } })).sortOrder, sortOrder)
    }
  })

  test("removal archives definitions while enrolled checklist items remain usable", async () => {
    await save({ checklistItems: [], professionals: [] })
    await assertEnrollmentPreserved()
    assert.ok((await db.serviceChecklistItem.findUniqueOrThrow({ where: { id: checklistId } })).archivedAt)
    assert.ok((await db.serviceProfessional.findUniqueOrThrow({ where: { id: professionalId } })).archivedAt)
    assert.equal(await db.serviceChecklistItem.count({ where: { serviceId, archivedAt: null } }), 0)
    assert.equal(await db.serviceProfessional.count({ where: { serviceId, archivedAt: null } }), 0)
    await db.contactServiceChecklistItem.update({ where: { id: enrolledItemId }, data: { status: "MISSING", completedAt: null } })
    assert.equal((await db.contactServiceChecklistItem.findUniqueOrThrow({ where: { id: enrolledItemId } })).status, "MISSING")
    assert.deepEqual(resolveServiceProfessionalChange({
      assignedProfessionalId: professionalId, previousProfessional: { id: professionalId }, professionals: [],
    }), { valid: true, activity: null })
    assert.equal(resolveServiceProfessionalChange({
      assignedProfessionalId: professionalId, previousProfessional: null, professionals: [],
    }).valid, false)
  })

  test("changing the internal user creates a replacement without reassigning enrollments", async () => {
    await save({ professionals: [{ id: professionalId, kind: "INTERNAL_USER", userId: userIds[1] }] })
    await assertEnrollmentPreserved()
    const original = await db.serviceProfessional.findUniqueOrThrow({ where: { id: professionalId } })
    assert.equal(original.userId, userIds[0])
    assert.ok(original.archivedAt)
    const replacement = await db.serviceProfessional.findFirstOrThrow({ where: { serviceId, archivedAt: null } })
    assert.notEqual(replacement.id, professionalId)
    assert.equal(replacement.userId, userIds[1])
  })

  test("switching kind creates a replacement; external metadata edits preserve its ID", async () => {
    await save({ professionals: [{ id: professionalId, kind: "EXTERNAL", externalProfessionalName: "Alex" }] })
    await assertEnrollmentPreserved()
    const replacement = await db.serviceProfessional.findFirstOrThrow({ where: { serviceId, archivedAt: null } })
    await save({ professionals: [{ id: replacement.id, kind: "EXTERNAL", externalProfessionalName: "Alex Smith", notes: "Updated" }] })
    assert.equal(await db.serviceProfessional.count({ where: { serviceId } }), 2)
    assert.equal((await db.serviceProfessional.findUniqueOrThrow({ where: { id: replacement.id } })).externalProfessionalName, "Alex Smith")
  })

  test("new items get IDs that can be used in later saves", async () => {
    await save({
      checklistItems: [{ id: checklistId, label: "Proof", isRequired: true }, { label: "ID card", isRequired: true }],
    })
    const created = await db.serviceChecklistItem.findFirstOrThrow({ where: { serviceId, label: "ID card" } })
    assert.ok(created.id)
    await save({ checklistItems: [{ id: checklistId, label: "Proof", isRequired: true },
      { id: created.id, label: "Updated ID card", isRequired: true }] })
    assert.equal(await db.serviceChecklistItem.count({ where: { serviceId } }), 2)
    assert.equal((await db.serviceChecklistItem.findUniqueOrThrow({ where: { id: created.id } })).label, "Updated ID card")
  })

  test("invalid, foreign, duplicate, and archived IDs reject the full save", async () => {
    const foreignService = await db.service.create({
      data: { tenantId, name: "Other service", basePriceCents: 0,
        checklistItems: { create: { tenantId, label: "Other proof" } },
        professionals: { create: { tenantId, kind: "EXTERNAL", externalProfessionalName: "Other person" } } },
      include: { checklistItems: true, professionals: true },
    })
    const invalidChecklistIds = [randomUUID(), foreignService.checklistItems[0]!.id]
    for (const id of invalidChecklistIds) {
      await assert.rejects(save({ checklistItems: [{ id, label: "Invalid", isRequired: true }] }), /INVALID_CHECKLIST_ITEM_ID/)
    }
    const item = { id: checklistId, label: "Proof", isRequired: true }
    await assert.rejects(save({ checklistItems: [item, item] }), /DUPLICATE_CHECKLIST_ITEM_ID/)
    const person = { id: professionalId, kind: "INTERNAL_USER" as const, userId: userIds[0] }
    await assert.rejects(save({ professionals: [person, person] }), /DUPLICATE_SERVICE_PROFESSIONAL_ID/)
    for (const id of [randomUUID(), foreignService.professionals[0]!.id]) {
      await assert.rejects(save({ checklistItems: [], professionals: [{ id, kind: "EXTERNAL", externalProfessionalName: "Invalid" }] }), /INVALID_SERVICE_PROFESSIONAL_ID/)
      assert.equal((await db.serviceChecklistItem.findUniqueOrThrow({ where: { id: checklistId } })).archivedAt, null)
    }
    await assert.rejects(db.$transaction((tx) => saveServiceCollectionsTx(tx, randomUUID(), serviceId, { checklistItems: [] })), /SERVICE_NOT_FOUND/)
    await save({ checklistItems: [], professionals: [] })
    await assert.rejects(save({ checklistItems: [item] }), /INVALID_CHECKLIST_ITEM_ID/)
    await assert.rejects(save({ professionals: [person] }), /INVALID_SERVICE_PROFESSIONAL_ID/)
    await assertEnrollmentPreserved()
  })

  test("a failure after collection changes rolls the complete transaction back", async () => {
    await assert.rejects(db.$transaction(async (tx) => {
      await saveServiceCollectionsTx(tx, tenantId, serviceId, { checklistItems: [], professionals: [] })
      throw new Error("Simulated later service-update failure")
    }), /Simulated/)
    assert.equal((await db.serviceChecklistItem.findUniqueOrThrow({ where: { id: checklistId } })).archivedAt, null)
    assert.equal((await db.serviceProfessional.findUniqueOrThrow({ where: { id: professionalId } })).archivedAt, null)
    await assertEnrollmentPreserved()
  })

  test("records from another tenant cannot be submitted to either collection", async () => {
    const otherTenant = await db.tenant.create({ data: { name: "Other tenant", slug: randomUUID() } })
    try {
      const other = await db.service.create({
        data: {
          tenantId: otherTenant.id, name: "Other offering", basePriceCents: 0,
          checklistItems: { create: { tenantId: otherTenant.id, label: "Other requirement" } },
          professionals: { create: { tenantId: otherTenant.id, kind: "EXTERNAL", externalProfessionalName: "Other person" } },
        }, include: { checklistItems: true, professionals: true },
      })
      await assert.rejects(save({ checklistItems: [{
        id: other.checklistItems[0]!.id, label: "Invalid", isRequired: true,
      }] }), /INVALID_CHECKLIST_ITEM_ID/)
      await assert.rejects(save({ professionals: [{
        id: other.professionals[0]!.id, kind: "EXTERNAL", externalProfessionalName: "Invalid",
      }] }), /INVALID_SERVICE_PROFESSIONAL_ID/)
      await assertEnrollmentPreserved()
    } finally {
      await db.tenant.delete({ where: { id: otherTenant.id } })
    }
  })

  test("concurrent saves lock the same service until the first transaction completes", async () => {
    let release!: () => void
    let locked!: () => void
    const hold = new Promise<void>((resolve) => { release = resolve })
    const ready = new Promise<void>((resolve) => { locked = resolve })
    const first = db.$transaction(async (tx) => {
      await saveServiceCollectionsTx(tx, tenantId, serviceId, {
        checklistItems: [{ id: checklistId, label: "First save", isRequired: true }],
      })
      locked()
      await hold
    })
    try {
      await ready
      await assert.rejects(db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`
        await saveServiceCollectionsTx(tx, tenantId, serviceId, { professionals: [] })
      }), /lock timeout/)
    } finally {
      release()
      await first
    }
    await save({ professionals: [] })
    assert.equal((await db.serviceChecklistItem.findUniqueOrThrow({ where: { id: checklistId } })).label, "First save")
    await assertEnrollmentPreserved()
  })
})
