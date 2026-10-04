import assert from "node:assert/strict"
import { test } from "node:test"

import { groupAutomations, parseLibraryLocation, serializeLibraryLocation, validFolderId } from "./automation-library"

test("grid is the default and a folder drill-in survives URL serialization", () => {
  assert.deepEqual(parseLibraryLocation(new URLSearchParams()), { view: "grid", folderId: null, openIds: [] })
  const input = new URLSearchParams("view=grid&folder=folder-a")
  assert.equal(serializeLibraryLocation(parseLibraryLocation(input)), "view=grid&folder=folder-a")
})

test("list view keeps multiple expanded folders without duplicates", () => {
  const location = parseLibraryLocation(new URLSearchParams("view=list&open=a&open=b&open=a&folder=ignored"))
  assert.deepEqual(location.openIds, ["a", "b"])
  assert.equal(serializeLibraryLocation(location), "view=list&open=a&open=b")
})

test("unknown folders fall back to the root and grouping stays folder-scoped", () => {
  assert.equal(validFolderId("missing", ["known"]), null)
  assert.equal(validFolderId("known", ["known"]), "known")
  const items = [
    { id: "second", folderId: null, librarySortOrder: 20, createdAt: "2" },
    { id: "child", folderId: "known", librarySortOrder: 10, createdAt: "1" },
    { id: "first", folderId: null, librarySortOrder: 10, createdAt: "1" },
  ]
  const groups = groupAutomations(items)
  assert.deepEqual(groups.get(null)?.map((item) => item.id), ["first", "second"])
  assert.deepEqual(groups.get("known")?.map((item) => item.id), ["child"])
})
