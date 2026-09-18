import { z } from "zod"

export const SERVICE_FOLLOW_UP_SEARCH_MAX_LENGTH = 200
export const SERVICE_FOLLOW_UP_SORTS = [
  "UPDATED_DESC",
  "STARTED_DESC",
  "CONTACT_ASC",
  "SERVICE_ASC",
] as const

export type ServiceFollowUpSort = (typeof SERVICE_FOLLOW_UP_SORTS)[number]
export const ServiceFollowUpSortSchema = z.enum(SERVICE_FOLLOW_UP_SORTS)

const HTML_TAGS = /<[^>]*>/g
const INVISIBLE_OR_CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu

export function sanitizeServiceFollowUpSearch(value: string) {
  return value
    .normalize("NFKC")
    .replace(HTML_TAGS, " ")
    .replace(INVISIBLE_OR_CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SERVICE_FOLLOW_UP_SEARCH_MAX_LENGTH)
}
