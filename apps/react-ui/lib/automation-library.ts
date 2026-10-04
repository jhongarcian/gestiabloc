export type LibraryView = "grid" | "list"

export type LibraryLocation = {
  view: LibraryView
  folderId: string | null
  openIds: string[]
}

export function parseLibraryLocation(params: URLSearchParams): LibraryLocation {
  return {
    view: params.get("view") === "list" ? "list" : "grid",
    folderId: params.get("folder") || null,
    openIds: [...new Set(params.getAll("open").filter(Boolean))],
  }
}

export function serializeLibraryLocation(location: LibraryLocation) {
  const params = new URLSearchParams()
  params.set("view", location.view)
  if (location.view === "grid" && location.folderId) params.set("folder", location.folderId)
  if (location.view === "list") location.openIds.forEach((id) => params.append("open", id))
  return params.toString()
}

export function validFolderId(folderId: string | null, folderIds: string[]) {
  return folderId && folderIds.includes(folderId) ? folderId : null
}

export function groupAutomations<T extends { folderId: string | null; librarySortOrder: number; createdAt: string }>(items: T[]) {
  const groups = new Map<string | null, T[]>()
  for (const item of items) groups.set(item.folderId, [...(groups.get(item.folderId) ?? []), item])
  for (const group of groups.values()) group.sort((a, b) => a.librarySortOrder - b.librarySortOrder || a.createdAt.localeCompare(b.createdAt))
  return groups
}
