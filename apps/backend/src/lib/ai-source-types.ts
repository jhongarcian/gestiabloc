import { z } from "zod"
import ipaddr from "ipaddr.js"

export const AI_FILE_MAX_BYTES = 10 * 1024 * 1024
export const AI_WEB_MAX_BYTES = 2 * 1024 * 1024
export const AI_TEXT_MAX_CHARS = 500_000
export const AI_SOURCE_LIMIT = 100
export class AiSourceError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
export function publicIp(address: string) {
  try {
    const parsed = ipaddr.process(address)
    if (parsed.range() !== "unicast") return false
    if (parsed instanceof ipaddr.IPv4)
      return !parsed.match(ipaddr.IPv4.parse("198.18.0.0"), 15)
    return (
      parsed.match(ipaddr.IPv6.parse("2000::"), 3) &&
      ![
        ["2001:2::", 48],
        ["2001:20::", 28],
        ["3fff::", 20],
      ].some(([range, prefix]) =>
        parsed.match(ipaddr.IPv6.parse(String(range)), Number(prefix)),
      )
    )
  } catch {
    return false
  }
}
export function sourceUrl(input: string) {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new AiSourceError(
      400,
      "INVALID_SOURCE_URL",
      "Enter a valid public HTTP or HTTPS URL.",
    )
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port)) ||
    (!host.includes(".") && !host.includes(":")) ||
    /(^|\.)(localhost|local|internal|home|lan|invalid)$/.test(host) ||
    (ipaddr.isValid(host) && !publicIp(host))
  )
    throw new AiSourceError(
      400,
      "INVALID_SOURCE_URL",
      "Use a public HTTP or HTTPS address without credentials or a custom port.",
    )
  url.hash = ""
  return url.href
}
export const AiSourceLinkSchema = z
  .object({
    requestId: z.uuid(),
    label: z.string().trim().max(200),
    url: z.string().trim().max(2048).transform(sourceUrl),
  })
  .strict()
export const AiSourceRevisionSchema = z
  .object({ revision: z.number().int().min(1).max(2147483646) })
  .strict()
export const AiSourceEditSchema = AiSourceRevisionSchema.extend({
  label: z.string().trim().min(1).max(200),
  url: z.string().trim().max(2048).transform(sourceUrl).optional(),
}).strict()
export const AI_FILE_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
} as const
export function decodeUploadFilename(filename: string) {
  if ([...filename].some((character) => character.charCodeAt(0) > 255))
    return filename
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(filename, "latin1"),
    )
  } catch {
    return filename
  }
}
export function validateAiFile(filename: string, bytes: Buffer) {
  if (!bytes.length || bytes.length > AI_FILE_MAX_BYTES)
    throw new AiSourceError(
      400,
      "INVALID_FILE_SIZE",
      "Choose a non-empty file up to 10 MB.",
    )
  if (!filename || filename.length > 200 || /[\x00-\x1f/\\]/.test(filename))
    throw new AiSourceError(
      400,
      "INVALID_FILENAME",
      "Choose a filename up to 200 characters without path separators.",
    )
  const extension = filename
    .split(".")
    .pop()
    ?.toLowerCase() as keyof typeof AI_FILE_TYPES
  if (!Object.hasOwn(AI_FILE_TYPES, extension))
    throw new AiSourceError(
      400,
      "UNSUPPORTED_FILE",
      "Choose a PDF, DOCX, or UTF-8 TXT file.",
    )
  if (
    extension === "pdf" &&
    !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))
  )
    throw new AiSourceError(400, "INVALID_PDF", "This file is not a valid PDF.")
  if (
    extension === "docx" &&
    bytes.subarray(0, 4).toString("hex") !== "504b0304"
  )
    throw new AiSourceError(
      400,
      "INVALID_DOCX",
      "This file is not a valid DOCX document.",
    )
  if (extension === "txt") {
    try {
      if (
        new TextDecoder("utf-8", { fatal: true }).decode(bytes).includes("\0")
      )
        throw Error()
    } catch {
      throw new AiSourceError(
        400,
        "INVALID_TEXT",
        "Choose a UTF-8 text file without binary content.",
      )
    }
  }
  return AI_FILE_TYPES[extension]
}
export function aiStorageKey(
  tenantId: string,
  serviceId: string,
  sourceId: string,
  filename: string,
) {
  return `tenants/${tenantId}/ai/skills/${serviceId}/sources/${sourceId}/${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`
}
export function assertAiStorageKey(source: {
  tenantId: string
  serviceId: string
  id: string
  storageKey: string | null
}) {
  if (
    !source.storageKey?.startsWith(
      `tenants/${source.tenantId}/ai/skills/${source.serviceId}/sources/${source.id}/`,
    ) ||
    source.storageKey.split("/").some((part) => part === ".." || part === ".")
  )
    throw new AiSourceError(
      500,
      "INVALID_STORAGE_PATH",
      "The saved file location needs review.",
    )
  return source.storageKey
}
