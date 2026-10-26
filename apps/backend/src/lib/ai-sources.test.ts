import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import {
  AiSourceError,
  AI_FILE_MAX_BYTES,
  aiStorageKey,
  assertAiStorageKey,
  publicIp,
  sourceUrl,
  validateAiFile,
  decodeUploadFilename,
  AiSourceLinkSchema,
} from "./ai-source-types.js"
import { resolvePublicHost, webpageText } from "./ai-source-web.js"
import { chunkSourceText, extractAiFile } from "./ai-source-extraction.js"
import { aiSourcePdf } from "./ai-source-fixtures.js"
import { aiSourceSearchQuery } from "./ai-source-retrieval.js"

test("source destinations reject private, reserved, mapped, encoded and credential-bearing addresses", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.2",
    "172.16.4.3",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "198.18.1.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2001:20::1",
    "3fff::1",
  ])
    assert.equal(publicIp(address), false, address)
  assert.equal(publicIp("8.8.8.8"), true)
  assert.equal(publicIp("2606:4700:4700::1111"), true)
  for (const url of [
    "file:///etc/passwd",
    "ftp://example.com",
    "https://user:pass@example.com",
    "http://localhost",
    "http://service.local",
    "http://127.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://[::ffff:127.0.0.1]",
    "https://example.com:8443",
  ])
    assert.throws(() => sourceUrl(url), AiSourceError, url)
  assert.equal(
    sourceUrl("https://example.com/page#part"),
    "https://example.com/page",
  )
  await assert.rejects(
    resolvePublicHost("public.example", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]),
    AiSourceError,
  )
  assert.deepEqual(
    await resolvePublicHost("public.example", async () => [
      { address: "8.8.8.8", family: 4 },
    ]),
    { address: "8.8.8.8", family: 4 },
  )
})
test("file validation checks actual bytes and all storage keys stay inside the tenant AI folder", () => {
  assert.equal(
    decodeUploadFilename(Buffer.from("preparación.docx").toString("latin1")),
    "preparación.docx",
  )
  assert.equal(decodeUploadFilename("preparación.docx"), "preparación.docx")
  assert.equal(decodeUploadFilename("資料.docx"), "資料.docx")
  assert.equal(
    validateAiFile("note.TXT", Buffer.from("Readable text")),
    "text/plain",
  )
  for (const [name, bytes] of [
    ["payload.pdf", Buffer.from("not a PDF")],
    ["payload.docx", Buffer.from("not a zip")],
    ["payload.txt", Buffer.from([0xff, 0, 4])],
    ["payload.exe", Buffer.from("test")],
    ["../note.txt", Buffer.from("test")],
    ["huge.txt", Buffer.alloc(AI_FILE_MAX_BYTES + 1)],
  ] as const)
    assert.throws(() => validateAiFile(name, bytes), AiSourceError)
  const key = aiStorageKey("tenant-a", "skill", "source", "résumé.pdf")
  assert.match(key, /^tenants\/tenant-a\/ai\/skills\/skill\/sources\/source\//)
  assert.equal(
    assertAiStorageKey({
      tenantId: "tenant-a",
      serviceId: "skill",
      id: "source",
      storageKey: key,
    }),
    key,
  )
  assert.throws(
    () =>
      assertAiStorageKey({
        tenantId: "tenant-b",
        serviceId: "skill",
        id: "source",
        storageKey: key,
      }),
    AiSourceError,
  )
  assert.equal(
    AiSourceLinkSchema.safeParse({
      requestId: "11111111-1111-4111-8111-111111111111",
      label: "Name",
      url: "https://example.com",
      tenantId: "foreign",
    }).success,
    false,
  )
})
test("document workers extract PDF, DOCX and TXT and mark image-only/blank PDFs as requiring OCR", async () => {
  const pdf = await extractAiFile("guide.pdf", aiSourcePdf())
  assert.match(pdf[0].text, /P-42/)
  assert.equal(pdf[0].page, 1)
  const docx = await extractAiFile(
    "guide.docx",
    await readFile(join(__dirname, "__fixtures__/ai-source.docx")),
  )
  assert.match(docx[0].text, /D-42/)
  const oversizedArchive = Buffer.from(
    await readFile(join(__dirname, "__fixtures__/ai-source.docx")),
  )
  for (let offset = 0; offset + 46 < oversizedArchive.length; offset++) {
    if (oversizedArchive.readUInt32LE(offset) !== 0x02014b50) continue
    const nameLength = oversizedArchive.readUInt16LE(offset + 28)
    if (
      oversizedArchive
        .subarray(offset + 46, offset + 46 + nameLength)
        .toString() === "word/document.xml"
    ) {
      oversizedArchive.writeUInt32LE(21 * 1024 * 1024, offset + 24)
      break
    }
  }
  await assert.rejects(
    extractAiFile("oversized.docx", oversizedArchive),
    (error) => error instanceof AiSourceError && error.code === "INVALID_DOCX",
  )
  assert.match(
    (await extractAiFile("guide.txt", Buffer.from("Cedar desk T-42.")))[0].text,
    /T-42/,
  )
  await assert.rejects(
    extractAiFile("scan.pdf", aiSourcePdf(null)),
    (error) => error instanceof AiSourceError && error.code === "OCR_REQUIRED",
  )
  await assert.rejects(
    extractAiFile("bad.docx", Buffer.from("PK\x03\x04broken")),
    AiSourceError,
  )
})
test("bounded chunks retain readable text, page references and overlapping context", () => {
  const input = "Preparation information Cedar desk. ".repeat(200)
  const { chunks, characterCount } = chunkSourceText([{ text: input, page: 7 }])
  assert.equal(characterCount, input.trim().length)
  assert.ok(chunks.length > 1)
  assert.ok(
    chunks.every((chunk) => chunk.content.length <= 1600 && chunk.page === 7),
  )
  for (let index = 1; index < chunks.length; index++)
    assert.ok(
      chunks[index - 1].content.includes(chunks[index].content.slice(0, 100)),
    )
  assert.throws(
    () => chunkSourceText([{ text: "x".repeat(500001), page: null }]),
    AiSourceError,
  )
  assert.throws(
    () => chunkSourceText([{ text: "  ", page: null }]),
    AiSourceError,
  )
  const html = webpageText(
    '<html><head><script>fetch("secret")</script><style>.hidden{}</style></head><body><nav>Menu</nav><main><h1>Cedar intake</h1><p>Code W-42</p></main><img src="https://private.example"/><footer>Boilerplate</footer></body></html>',
  )
  assert.match(html, /Code W-42/)
  assert.doesNotMatch(html, /secret|Menu|Boilerplate|private/)
  assert.equal(
    aiSourceSearchQuery({
      question: "¿Cuál es el código de admisión?",
      history: [],
    }),
    "codigo OR admision",
  )
})
