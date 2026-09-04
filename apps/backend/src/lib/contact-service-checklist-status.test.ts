import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

import {
  buildContactServiceChecklistActivityData,
  CONTACT_SERVICE_CHECKLIST_STATUSES,
  hasExactlyOneChecklistStatusInput,
  resolveContactServiceChecklistStatus,
  resolveContactServiceChecklistTransition,
} from "./contact-service-checklist-status.js"

test("resolves every explicit checklist status", () => {
  for (const status of CONTACT_SERVICE_CHECKLIST_STATUSES) {
    assert.equal(resolveContactServiceChecklistStatus({ status }), status)
  }
})

test("maps the deprecated completed boolean", () => {
  assert.equal(resolveContactServiceChecklistStatus({ completed: true }), "RECEIVED")
  assert.equal(resolveContactServiceChecklistStatus({ completed: false }), "NOT_RECEIVED")
})

test("requires exactly one modern or deprecated status field", () => {
  assert.equal(hasExactlyOneChecklistStatusInput({ status: "INFORMED" }), true)
  assert.equal(hasExactlyOneChecklistStatusInput({ completed: false }), true)
  assert.equal(hasExactlyOneChecklistStatusInput({}), false)
  assert.equal(
    hasExactlyOneChecklistStatusInput({ status: "RECEIVED", completed: true }),
    false,
  )
})

test("entering received sets completedAt", () => {
  const now = new Date("2026-08-30T12:00:00.000Z")
  const result = resolveContactServiceChecklistTransition({
    currentStatus: "MISSING",
    currentCompletedAt: null,
    nextStatus: "RECEIVED",
    now,
  })

  assert.equal(result.changed, true)
  assert.equal(result.completedAt, now)
})

test("entering received replaces a stale non-received timestamp", () => {
  const now = new Date("2026-08-30T12:00:00.000Z")
  const result = resolveContactServiceChecklistTransition({
    currentStatus: "INFORMED",
    currentCompletedAt: new Date("2026-08-29T12:00:00.000Z"),
    nextStatus: "RECEIVED",
    now,
  })

  assert.equal(result.completedAt, now)
})

test("re-selecting received is idempotent and preserves completedAt", () => {
  const completedAt = new Date("2026-08-29T12:00:00.000Z")
  const result = resolveContactServiceChecklistTransition({
    currentStatus: "RECEIVED",
    currentCompletedAt: completedAt,
    nextStatus: "RECEIVED",
    now: new Date("2026-08-30T12:00:00.000Z"),
  })

  assert.equal(result.changed, false)
  assert.equal(result.completedAt, completedAt)
})

test("every non-received status clears completedAt", () => {
  const completedAt = new Date("2026-08-29T12:00:00.000Z")

  for (const nextStatus of ["NOT_RECEIVED", "INFORMED", "MISSING"] as const) {
    const result = resolveContactServiceChecklistTransition({
      currentStatus: "RECEIVED",
      currentCompletedAt: completedAt,
      nextStatus,
      now: new Date("2026-08-30T12:00:00.000Z"),
    })

    assert.equal(result.changed, true)
    assert.equal(result.completedAt, null)
  }
})

test("activity data snapshots the actor and transition", () => {
  const data = buildContactServiceChecklistActivityData({
    tenantId: "tenant-1",
    contactServiceId: "service-1",
    contactServiceChecklistItemId: "item-1",
    itemLabel: "Proof of address",
    previousStatus: "MISSING",
    status: "RECEIVED",
    actorUserId: "user-1",
  })

  assert.deepEqual(data, {
    tenantId: "tenant-1",
    contactServiceId: "service-1",
    contactServiceChecklistItemId: "item-1",
    itemLabel: "Proof of address",
    previousStatus: "MISSING",
    status: "RECEIVED",
    actorUserId: "user-1",
  })
})

test("migration backfills received statuses and a durable activity event", () => {
  const migration = readFileSync(
    resolve(
      __dirname,
      "../../prisma/migrations/20260830120000_contact_service_checklist_status/migration.sql",
    ),
    "utf8",
  )

  assert.match(
    migration,
    /SET "status" = 'RECEIVED'\s+WHERE "completedAt" IS NOT NULL/,
  )
  assert.match(migration, /INSERT INTO "ContactServiceChecklistActivity"/)
  assert.match(migration, /'NOT_RECEIVED'::"ContactServiceChecklistStatus"/)
  assert.match(migration, /'RECEIVED'::"ContactServiceChecklistStatus"/)
  assert.match(migration, /checklist_entry\."completedAt"/)
})
