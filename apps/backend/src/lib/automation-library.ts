import { z } from "zod"

export const FolderNameSchema = z.string().trim().min(1, "Enter a folder name").max(80, "Use 80 characters or fewer")

export function normalizeFolderName(name: string) {
  return name.trim().toLocaleLowerCase("en-US")
}

export function isExactIdOrder(proposed: string[], current: string[]) {
  return proposed.length === current.length &&
    new Set(proposed).size === proposed.length &&
    proposed.every((id) => current.includes(id))
}

export function nextLibraryOrder(orders: number[]) {
  return Math.max(0, ...orders) + 10
}

export function planFolderDeletion(rootLastOrder: number, contained: Array<{ id: string; librarySortOrder: number; sortOrder: number }>) {
  return [...contained]
    .sort((a, b) => a.librarySortOrder - b.librarySortOrder)
    .map((item, index) => ({ id: item.id, folderId: null, librarySortOrder: rootLastOrder + (index + 1) * 10, sortOrder: item.sortOrder }))
}
