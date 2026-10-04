import assert from "node:assert/strict"
import { test } from "node:test"

import { FolderNameSchema, isExactIdOrder, nextLibraryOrder, normalizeFolderName, planFolderDeletion } from "./automation-library.js"

test("folder names are trimmed, required, bounded, and case-insensitively normalized", () => {
  assert.equal(FolderNameSchema.parse("  Claims  "), "Claims")
  assert.equal(normalizeFolderName("  CLAIMS  "), normalizeFolderName("claims"))
  assert.equal(FolderNameSchema.safeParse("   ").success, false)
  assert.equal(FolderNameSchema.safeParse("a".repeat(81)).success, false)
})

test("reordering requires the exact IDs from one tenant or container", () => {
  assert.equal(isExactIdOrder(["b", "a"], ["a", "b"]), true)
  assert.equal(isExactIdOrder(["a", "a"], ["a", "b"]), false)
  assert.equal(isExactIdOrder(["a", "foreign"], ["a", "b"]), false)
  assert.equal(isExactIdOrder(["a"], ["a", "b"]), false)
  assert.equal(isExactIdOrder([], []), true)
})

test("moving to a destination appends after its current library order", () => {
  assert.equal(nextLibraryOrder([]), 10)
  assert.equal(nextLibraryOrder([30, 10, 20]), 40)
})

test("deleting a non-empty folder appends its items to root without changing execution priority", () => {
  const moved = planFolderDeletion(20, [
    { id: "later", librarySortOrder: 30, sortOrder: 10 },
    { id: "earlier", librarySortOrder: 10, sortOrder: 90 },
  ])
  assert.deepEqual(moved, [
    { id: "earlier", folderId: null, librarySortOrder: 30, sortOrder: 90 },
    { id: "later", folderId: null, librarySortOrder: 40, sortOrder: 10 },
  ])
})
