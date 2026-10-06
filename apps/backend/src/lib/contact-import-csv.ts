import { createSignedDownload } from "./private-storage.js"

export const IMPORT_MAX_BYTES = 500 * 1024 * 1024
export const IMPORT_MAX_ROWS = 500_000
export const IMPORT_MAX_COLUMNS = 200
export const IMPORT_MAX_CELL_LENGTH = 64 * 1024

export class ContactImportCsvError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export async function openImportCsv(path: string) {
  const url = await createSignedDownload({ path, expiresInSeconds: 3600 })
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new ContactImportCsvError("SOURCE_UNAVAILABLE", "The uploaded CSV file is unavailable.")
  }
  const declaredSize = Number(response.headers.get("content-length"))
  if (declaredSize > IMPORT_MAX_BYTES) {
    await response.body.cancel()
    throw new ContactImportCsvError("FILE_TOO_LARGE", "CSV files must be 500 MB or smaller.")
  }
  return response.body
}

/** A bounded RFC 4180 reader: quoted commas, line breaks and escaped quotes are supported. */
export async function* parseCsv(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string[]> {
  const reader = stream.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let bytes = 0
  let row: string[] = []
  let field = ""
  let state: "START" | "PLAIN" | "QUOTED" | "AFTER_QUOTE" = "START"
  let skipLf = false
  let firstChar = true

  function append(char: string) {
    field += char
    if (field.length > IMPORT_MAX_CELL_LENGTH) {
      throw new ContactImportCsvError("CELL_TOO_LONG", "A CSV cell exceeds 64 KB.")
    }
  }

  function pushField() {
    row.push(field)
    if (row.length > IMPORT_MAX_COLUMNS) {
      throw new ContactImportCsvError("TOO_MANY_COLUMNS", "CSV files may have at most 200 columns.")
    }
    field = ""
    state = "START"
  }

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > IMPORT_MAX_BYTES) {
        throw new ContactImportCsvError("FILE_TOO_LARGE", "CSV files must be 500 MB or smaller.")
      }
      let text: string
      try {
        text = decoder.decode(chunk.value, { stream: true })
      } catch {
        throw new ContactImportCsvError("INVALID_ENCODING", "The CSV must use UTF-8 encoding.")
      }
      for (const char of text) {
        if (firstChar) {
          firstChar = false
          if (char === "\uFEFF") continue
        }
        if (skipLf) {
          skipLf = false
          if (char === "\n") continue
        }
        if (state === "QUOTED") {
          if (char === '"') state = "AFTER_QUOTE"
          else append(char)
          continue
        }
        if (state === "AFTER_QUOTE") {
          if (char === '"') {
            append('"')
            state = "QUOTED"
            continue
          }
          if (char !== "," && char !== "\n" && char !== "\r") {
            throw new ContactImportCsvError("MALFORMED_CSV", "Unexpected text after a quoted CSV cell.")
          }
        }
        if (char === ",") {
          pushField()
        } else if (char === "\n" || char === "\r") {
          pushField()
          const complete = row
          row = []
          if (char === "\r") skipLf = true
          if (complete.some((cell) => cell.length > 0)) yield complete
        } else if (char === '"' && state === "START") {
          state = "QUOTED"
        } else if (char === '"') {
          throw new ContactImportCsvError("MALFORMED_CSV", "Unexpected quote in an unquoted CSV cell.")
        } else {
          append(char)
          state = "PLAIN"
        }
      }
    }
    try {
      decoder.decode()
    } catch {
      throw new ContactImportCsvError("INVALID_ENCODING", "The CSV must use UTF-8 encoding.")
    }
    if (state === "QUOTED") {
      throw new ContactImportCsvError("MALFORMED_CSV", "The CSV ends inside a quoted cell.")
    }
    if (row.length > 0 || field.length > 0 || state === "AFTER_QUOTE") {
      pushField()
      if (row.some((cell) => cell.length > 0)) yield row
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export function csvCell(value: string) {
  // Spreadsheet programs treat these prefixes as formulas even when quoted.
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}
