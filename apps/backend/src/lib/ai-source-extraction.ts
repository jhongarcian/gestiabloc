import { Worker } from "node:worker_threads"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fromBuffer } from "yauzl"
import {
  AI_TEXT_MAX_CHARS,
  AiSourceError,
  validateAiFile,
} from "./ai-source-types.js"

export type ExtractedPage = { text: string; page: number | null }
export function cleanSourceText(text: string) {
  return text
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
export function chunkSourceText(pages: ExtractedPage[]) {
  const chunks: Array<{
    ordinal: number
    page: number | null
    content: string
    searchText: string
  }> = []
  let characters = 0
  for (const page of pages) {
    const text = cleanSourceText(page.text)
    characters += text.length
    if (characters > AI_TEXT_MAX_CHARS)
      throw new AiSourceError(
        400,
        "TEXT_TOO_LARGE",
        "This source contains too much text. Split it into smaller documents.",
      )
    let start = 0
    while (start < text.length) {
      let end = Math.min(text.length, start + 1600)
      if (end < text.length) {
        const boundary = text.lastIndexOf(" ", end)
        if (boundary > start + 1000) end = boundary
      }
      const content = text.slice(start, end).trim()
      if (content)
        chunks.push({
          ordinal: chunks.length,
          page: page.page,
          content,
          searchText: content
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase(),
        })
      if (end === text.length) break
      start = end - 150
    }
  }
  if (!chunks.length)
    throw new AiSourceError(
      400,
      "NO_SOURCE_TEXT",
      "No readable text was found in this source.",
    )
  return { chunks, characterCount: characters }
}
async function validateDocxZip(bytes: Buffer) {
  await new Promise<void>((resolve, reject) =>
    fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) {
          reject(
            new AiSourceError(
              400,
              "INVALID_DOCX",
              "The DOCX archive could not be read.",
            ),
          )
          return
        }
        let entries = 0,
          expanded = 0,
          hasDocument = false
        const fail = () => {
          zip.close()
          reject(
            new AiSourceError(
              400,
              "INVALID_DOCX",
              "The DOCX archive is invalid or expands beyond the supported size.",
            ),
          )
        }
        zip.on("error", fail)
        zip.on("end", () => (hasDocument ? resolve() : fail()))
        zip.on("entry", (entry) => {
          entries++
          if (
            entries > 1500 ||
            entry.uncompressedSize > 20 * 1024 * 1024 ||
            entry.generalPurposeBitFlag & 1 ||
            ![0, 8].includes(entry.compressionMethod) ||
            entry.fileName.split("/").includes("..")
          ) {
            fail()
            return
          }
          if (entry.fileName === "word/document.xml") hasDocument = true
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              fail()
              return
            }
            stream.on("data", (part) => {
              expanded += part.length
              if (expanded > 40 * 1024 * 1024) {
                stream.destroy()
                fail()
              }
            })
            stream.on("error", fail)
            stream.on("end", () => zip.readEntry())
          })
        })
        zip.readEntry()
      },
    ),
  )
}
// Invoked in an isolated worker with a time and memory limit, never with a URL/path from a document.
export async function extractFileText(
  filename: string,
  bytes: Buffer,
): Promise<ExtractedPage[]> {
  const type = validateAiFile(filename, bytes)
  if (type === "text/plain")
    return [
      {
        text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        page: null,
      },
    ]
  if (type.includes("wordprocessingml")) {
    await validateDocxZip(bytes)
    const { extractRawText } = await import("mammoth")
    const result = await extractRawText({ buffer: bytes })
    return [{ text: result.value, page: null }]
  }
  const { PDFParse } = await import("pdf-parse")
  const parser = new PDFParse({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  })
  try {
    const info = await parser.getInfo()
    if (info.total > 100)
      throw new AiSourceError(
        400,
        "PDF_TOO_LONG",
        "PDFs can contain up to 100 pages. Split this document into smaller files.",
      )
    const result = await parser.getText({ pageJoiner: "" })
    const pages = result.pages.map((page) => ({
      text: page.text,
      page: page.num,
    }))
    // A blank or image-only page cannot be silently presented as completely indexed knowledge.
    if (!pages.length || pages.some((page) => !page.text.trim()))
      throw new AiSourceError(
        400,
        "OCR_REQUIRED",
        "This PDF contains pages without readable text. Add a searchable text layer with OCR and upload it again.",
      )
    return pages
  } catch (error) {
    if (error instanceof AiSourceError) throw error
    throw new AiSourceError(
      400,
      "INVALID_PDF",
      "The PDF could not be read. Use an unlocked, searchable PDF.",
    )
  } finally {
    await parser.destroy()
  }
}
export async function extractAiFile(
  filename: string,
  bytes: Buffer,
): Promise<ExtractedPage[]> {
  const js = join(__dirname, "ai-source-extract-worker.js")
  const ts = join(__dirname, "ai-source-extract-worker.ts")
  const target = existsSync(js) ? js : ts
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `if (require('node:worker_threads').workerData.target.endsWith('.ts')) require('tsx/cjs'); require(require('node:worker_threads').workerData.target);`,
      {
        eval: true,
        workerData: { target, filename, bytes },
        resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 8 },
      },
    )
    let completed = false
    const timer = setTimeout(() => {
      completed = true
      void worker.terminate()
      reject(
        new AiSourceError(
          400,
          "EXTRACTION_TIMEOUT",
          "The document took too long to read. Try a smaller file.",
        ),
      )
    }, 25_000)
    const finish = () => {
      clearTimeout(timer)
      completed = true
      void worker.terminate()
    }
    worker.once("message", (result) => {
      finish()
      if (result.error)
        reject(
          new AiSourceError(
            400,
            result.code ?? "EXTRACTION_FAILED",
            result.error,
          ),
        )
      else resolve(result.pages)
    })
    worker.once("error", () => {
      finish()
      reject(
        new AiSourceError(
          400,
          "EXTRACTION_FAILED",
          "The document could not be read safely. Try a smaller or re-exported file.",
        ),
      )
    })
    worker.once("exit", () => {
      if (!completed) {
        finish()
        reject(
          new AiSourceError(
            400,
            "EXTRACTION_FAILED",
            "The document could not be read.",
          ),
        )
      }
    })
  })
}
