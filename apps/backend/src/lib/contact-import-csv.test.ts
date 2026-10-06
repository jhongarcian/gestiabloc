import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { ContactImportCsvError, csvCell, parseCsv } from "./contact-import-csv.js"

function stream(chunks: string[]) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function rows(chunks: string[]) {
  const parsed: string[][] = []
  for await (const row of parseCsv(stream(chunks))) parsed.push(row)
  return parsed
}

describe("contact import CSV reader", () => {
  it("reads BOM, quoted commas, escaped quotes, CRLF, and multiline cells across chunks", async () => {
    assert.deepEqual(await rows(["\uFEFFfirst,last,note\r", "\nAda,Lovelace,\"hello, ", "\"\"world\"\"\nagain\"\r\n"]), [
      ["first", "last", "note"], ["Ada", "Lovelace", 'hello, "world"\nagain'],
    ])
  })

  it("rejects malformed CSV and oversized cells", async () => {
    await assert.rejects(() => rows(['a,"unterminated']), (error: unknown) => error instanceof ContactImportCsvError && error.code === "MALFORMED_CSV")
    await assert.rejects(() => rows(["x".repeat(65_537)]), (error: unknown) => error instanceof ContactImportCsvError && error.code === "CELL_TOO_LONG")
  })

  it("makes spreadsheet formula prefixes inert in reports", () => {
    assert.equal(csvCell('=HYPERLINK("evil")'), '"\'=HYPERLINK(""evil"")"')
    assert.equal(csvCell("Normal"), '"Normal"')
  })
})
