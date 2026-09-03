import { z } from "zod"

export const contactServiceNoteSortValues = [
  "updated_desc",
  "created_desc",
  "updated_asc",
] as const

export type ContactServiceNoteSort = (typeof contactServiceNoteSortValues)[number]
export type ContactServiceNoteKind =
  | "SERVICE_NOTE"
  | "FOLLOW_UP_NOTE"
  | "LINKED_CONTACT_NOTE"

export const ContactServiceNotesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => [10, 25, 50].includes(value), {
      message: "pageSize must be 10, 25, or 50",
    })
    .default(10),
  q: z.string().trim().max(160).default(""),
  sort: z.enum(contactServiceNoteSortValues).default("updated_desc"),
})

type SortableContactServiceNote = {
  id: string
  createdAt: Date | string
  updatedAt: Date | string
}

const timestamp = (value: Date | string) => new Date(value).getTime()

export const compareContactServiceNotes = (
  left: SortableContactServiceNote,
  right: SortableContactServiceNote,
  sort: ContactServiceNoteSort,
) => {
  const primary =
    sort === "created_desc"
      ? timestamp(right.createdAt) - timestamp(left.createdAt)
      : sort === "updated_asc"
        ? timestamp(left.updatedAt) - timestamp(right.updatedAt)
        : timestamp(right.updatedAt) - timestamp(left.updatedAt)

  if (primary !== 0) return primary

  const createdTieBreak = timestamp(right.createdAt) - timestamp(left.createdAt)
  if (createdTieBreak !== 0) return createdTieBreak

  return left.id.localeCompare(right.id)
}

export const getContactServiceNotesPage = (
  requestedPage: number,
  pageSize: number,
  total: number,
) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, requestedPage), totalPages)

  return {
    page,
    pageSize,
    total,
    totalPages,
    offset: (page - 1) * pageSize,
    candidateTake: page * pageSize,
  }
}

export const resolveContactServiceNoteKind = (input: {
  isServiceNote: boolean
  hasFollowUpTemplate?: boolean
  hasFollowUpStep?: boolean
}): ContactServiceNoteKind => {
  if (input.isServiceNote) return "SERVICE_NOTE"
  if (input.hasFollowUpTemplate || input.hasFollowUpStep) return "FOLLOW_UP_NOTE"
  return "LINKED_CONTACT_NOTE"
}
