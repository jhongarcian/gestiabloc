import assert from "node:assert/strict"
import test from "node:test"

import {
  ContactServiceNotesQuerySchema,
  canManageContactServiceNote,
  compareContactServiceNotes,
  getContactServiceNotesPage,
  resolveContactServiceNoteAttachmentChanges,
  resolveContactServiceNoteKind,
} from "./contact-service-notes.js"

test("allows service-note management for the creator or a tenant admin", () => {
  assert.equal(
    canManageContactServiceNote({ role: "TENANT_USER" }, "author-1", "author-1"),
    true,
  )
  assert.equal(
    canManageContactServiceNote({ role: "TENANT_ADMIN" }, "author-1", "admin-1"),
    true,
  )
  assert.equal(
    canManageContactServiceNote({ role: "TENANT_USER" }, "author-1", "user-2"),
    false,
  )
})

test("replaces old service-note attachments only in the final note update", () => {
  assert.deepEqual(
    resolveContactServiceNoteAttachmentChanges(
      ["old-1", "old-2"],
      ["new-1", "new-2", "new-1"],
    ),
    {
      fileIdsToRemove: ["old-1", "old-2"],
      fileIdsToAdd: ["new-1", "new-2"],
    },
  )
  assert.deepEqual(
    resolveContactServiceNoteAttachmentChanges(["keep"], ["keep"]),
    { fileIdsToRemove: [], fileIdsToAdd: [] },
  )
})

const notes = [
  {
    id: "service",
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-03T12:00:00.000Z",
  },
  {
    id: "follow-up",
    createdAt: "2026-01-04T12:00:00.000Z",
    updatedAt: "2026-01-04T12:00:00.000Z",
  },
  {
    id: "contact",
    createdAt: "2026-01-02T12:00:00.000Z",
    updatedAt: "2026-01-02T12:00:00.000Z",
  },
]

test("validates and defaults service note queries", () => {
  assert.deepEqual(ContactServiceNotesQuerySchema.parse({}), {
    page: 1,
    pageSize: 10,
    q: "",
    sort: "updated_desc",
  })
  assert.equal(ContactServiceNotesQuerySchema.parse({ page: "2", pageSize: "25" }).page, 2)
  assert.throws(() => ContactServiceNotesQuerySchema.parse({ pageSize: "20" }))
  assert.throws(() => ContactServiceNotesQuerySchema.parse({ q: "x".repeat(161) }))
  assert.throws(() => ContactServiceNotesQuerySchema.parse({ sort: "title" }))
})

test("sorts merged note sources using each supported order", () => {
  assert.deepEqual(
    [...notes]
      .sort((left, right) => compareContactServiceNotes(left, right, "updated_desc"))
      .map((note) => note.id),
    ["follow-up", "service", "contact"],
  )
  assert.deepEqual(
    [...notes]
      .sort((left, right) => compareContactServiceNotes(left, right, "created_desc"))
      .map((note) => note.id),
    ["follow-up", "contact", "service"],
  )
  assert.deepEqual(
    [...notes]
      .sort((left, right) => compareContactServiceNotes(left, right, "updated_asc"))
      .map((note) => note.id),
    ["contact", "service", "follow-up"],
  )
})

test("clamps out-of-range pages and calculates the merged candidate window", () => {
  assert.deepEqual(getContactServiceNotesPage(9, 10, 24), {
    page: 3,
    pageSize: 10,
    total: 24,
    totalPages: 3,
    offset: 20,
    candidateTake: 30,
  })
  assert.equal(getContactServiceNotesPage(4, 10, 0).page, 1)
})

test("classifies all three note sources", () => {
  assert.equal(resolveContactServiceNoteKind({ isServiceNote: true }), "SERVICE_NOTE")
  assert.equal(
    resolveContactServiceNoteKind({ isServiceNote: false, hasFollowUpTemplate: true }),
    "FOLLOW_UP_NOTE",
  )
  assert.equal(
    resolveContactServiceNoteKind({ isServiceNote: false, hasFollowUpStep: true }),
    "FOLLOW_UP_NOTE",
  )
  assert.equal(
    resolveContactServiceNoteKind({ isServiceNote: false }),
    "LINKED_CONTACT_NOTE",
  )
})
