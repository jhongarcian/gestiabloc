import { z } from "zod"

const NOTE_TITLE_MAX_LENGTH = 160
const NOTE_BODY_MAX_LENGTH = 5000

const stripHtmlTags = (value: string) => value.replace(/<[^>]*>/g, " ")
const removeUnsafeControls = (value: string) =>
  value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")

export const sanitizeNoteTitle = (value: string) =>
  removeUnsafeControls(stripHtmlTags(value)).replace(/\s+/g, " ").trim()

export const sanitizeNoteBody = (value: string) =>
  removeUnsafeControls(stripHtmlTags(value))
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .trim()

export const NoteTitleInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(NOTE_TITLE_MAX_LENGTH)
  .transform(sanitizeNoteTitle)
  .pipe(z.string().min(1).max(NOTE_TITLE_MAX_LENGTH))

export const NoteBodyInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(NOTE_BODY_MAX_LENGTH)
  .transform(sanitizeNoteBody)
  .pipe(z.string().min(1).max(NOTE_BODY_MAX_LENGTH))

export const NoteTextInputSchema = z.object({
  title: NoteTitleInputSchema,
  body: NoteBodyInputSchema,
})
