export type AiSource = {
  id: string
  requestId: string
  kind: "FILE" | "LINK"
  label: string
  url: string | null
  finalUrl: string | null
  filename: string | null
  contentType: string | null
  size: number | null
  status:
    | "UPLOADING"
    | "QUEUED"
    | "PROCESSING"
    | "READY"
    | "FAILED"
    | "OCR_REQUIRED"
    | "DELETING"
  progress: number
  revision: number
  lastError: string | null
  characterCount: number
  chunkCount: number
  canDownload: boolean
  canRetry: boolean
  createdAt: string
  updatedAt: string
}
export type AiSourceText = {
  chunks: Array<{ ordinal: number; page: number | null; content: string }>
  hasMore: boolean
}
export const SOURCE_STATUS: Record<AiSource["status"], string> = {
  UPLOADING: "Uploading",
  QUEUED: "Queued",
  PROCESSING: "Reading source",
  READY: "Ready",
  FAILED: "Could not process",
  OCR_REQUIRED: "OCR needed",
  DELETING: "Removing",
}
export const sourcePending = (source: AiSource) =>
  ["UPLOADING", "QUEUED", "PROCESSING"].includes(source.status)
export function sourceUrlError(value: string) {
  try {
    const url = new URL(value.trim())
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      (!url.port || ["80", "443"].includes(url.port))
    )
      return ""
  } catch {}
  return "Enter a public HTTP or HTTPS URL without credentials or a custom port."
}
export function sourceFileError(file: Pick<File, "name" | "size">) {
  if (!/\.(pdf|docx|txt)$/i.test(file.name))
    return "Choose a PDF, DOCX, or UTF-8 TXT file."
  if (!file.size || file.size > 10 * 1024 * 1024)
    return "Choose a non-empty file up to 10 MB."
  return ""
}
export function fileSize(size: number) {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`
}
