import { randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { once } from "node:events"

import { ContactImportCsvError, IMPORT_MAX_ROWS, csvCell, openImportCsv, parseCsv } from "./contact-import-csv.js"
import { prepareImportRow, type ImportCatalog, type ImportMapping, type ImportSettings } from "./contact-import-fields.js"
import { encryptCustomFieldValue } from "./contact-custom-field-encryption.js"
import { deletePrivateObject, uploadPrivateObject } from "./private-storage.js"
import { prisma } from "./prisma.js"

const db = prisma as any
const BATCH_SIZE = 250
const LEASE_MS = 120_000
const MAX_ATTEMPTS = 3
const RETENTION_DAY_MS = 86_400_000

type ClaimedJob = { id: string; leaseToken: string }
type CsvRow = { rowNumber: number; cells: string[] }
type Issue = { rowNumber: number; code: string; message: string }

async function claim(): Promise<ClaimedJob | null> {
  const token = randomUUID()
  const rows = await prisma.$queryRawUnsafe<ClaimedJob[]>(`
    WITH candidate AS (
      SELECT id FROM "ContactImport"
      WHERE status = 'QUEUED' AND "availableAt" <= NOW()
      ORDER BY "availableAt", "createdAt"
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "ContactImport" job
    SET status = 'PROCESSING', "leaseToken" = $1,
        "leaseExpiresAt" = NOW() + INTERVAL '120 seconds',
        "attemptCount" = job."attemptCount" + 1,
        "startedAt" = COALESCE(job."startedAt", NOW()), "updatedAt" = NOW()
    FROM candidate WHERE job.id = candidate.id
    RETURNING job.id, job."leaseToken"
  `, token)
  return rows[0] ?? null
}

async function recover() {
  await db.contactImport.updateMany({
    where: { status: "PROCESSING", leaseExpiresAt: { lt: new Date() } },
    data: { status: "QUEUED", leaseToken: null, leaseExpiresAt: null, availableAt: new Date() },
  })
  await db.contactImport.updateMany({
    where: { status: "CANCEL_REQUESTED", leaseExpiresAt: { lt: new Date() } },
    data: { status: "CANCELED", leaseToken: null, leaseExpiresAt: null, completedAt: new Date() },
  })
}

async function assertActive(jobId: string, token: string) {
  const job = await db.contactImport.findUnique({ where: { id: jobId }, select: { status: true, leaseToken: true } })
  if (!job || job.leaseToken !== token) throw new Error("IMPORT_LEASE_LOST")
  return job.status === "PROCESSING"
}

async function setPhase(jobId: string, token: string, phase: string, extra: Record<string, unknown> = {}) {
  const result = await db.contactImport.updateMany({
    where: { id: jobId, leaseToken: token, status: "PROCESSING" },
    data: { phase, ...extra },
  })
  if (result.count !== 1) throw new Error("IMPORT_LEASE_LOST")
}

async function getCatalog(tenantId: string): Promise<ImportCatalog> {
  const [customFields, statuses, leadSources] = await Promise.all([
    db.contactCustomField.findMany({ where: { tenantId, isActive: true }, select: {
      id: true, key: true, label: true, fieldType: true, isEncrypted: true, isSensitive: true, isRequired: true, options: true,
    } }),
    db.contactStatusConfig.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
    db.contactLeadSourceConfig.findMany({ where: { tenantId }, select: { name: true } }),
  ])
  return {
    customFields: customFields.map((field: any) => ({ ...field, options: Array.isArray(field.options) ? field.options : [] })),
    statuses, leadSources,
  }
}

async function validateSource(job: any, token: string) {
  const headers = job.headers as string[]
  let rowNumber = -1
  for await (const cells of parseCsv(await openImportCsv(job.sourceKey))) {
    rowNumber += 1
    if (rowNumber === 0) {
      if (JSON.stringify(cells) !== JSON.stringify(headers)) {
        throw new ContactImportCsvError("HEADERS_CHANGED", "The CSV headers changed after preview.")
      }
      continue
    }
    if (rowNumber > IMPORT_MAX_ROWS) {
      throw new ContactImportCsvError("TOO_MANY_ROWS", "CSV files may contain at most 500,000 rows.")
    }
    if (rowNumber % 10_000 === 0 && !(await assertActive(job.id, token))) return false
  }
  if (rowNumber < 1) throw new ContactImportCsvError("NO_CONTACTS", "The CSV has no contact rows.")
  await setPhase(job.id, token, "IMPORTING", { totalRows: rowNumber })
  job.totalRows = rowNumber
  return true
}

async function findExistingContacts(tenantId: string, prepared: Array<{ email: string | null; phone: string | null }>) {
  const emails = [...new Set(prepared.flatMap((row) => row.email ? [row.email] : []))]
  const phones = [...new Set(prepared.flatMap((row) => row.phone ? [row.phone] : []))]
  if (!emails.length && !phones.length) return []
  return prisma.$queryRawUnsafe<Array<{ id: string; email: string | null; phone: string | null }>>(
    `SELECT id, email, phone FROM "Contact" WHERE "tenantId" = $1
     AND (lower(email) = ANY($2::text[]) OR phone = ANY($3::text[]))`,
    tenantId, emails, phones,
  )
}

async function commitBatch(job: any, token: string, rows: CsvRow[], catalog: ImportCatalog) {
  const mappings = job.mappings as ImportMapping[]
  const settings = job.settings as ImportSettings
  const issues: Issue[] = []
  const candidates: Array<{ rowNumber: number; cells: string[]; row: ReturnType<typeof prepareImportRow> & { ok: true } }> = []
  for (const item of rows) {
    if (item.cells.length !== (job.headers as string[]).length) {
      issues.push({ rowNumber: item.rowNumber, code: "COLUMN_COUNT", message: "Row has a different number of columns from the header." })
      continue
    }
    const result = prepareImportRow(item.cells, mappings, settings, catalog)
    if (!result.ok) {
      issues.push({ rowNumber: item.rowNumber, code: result.code, message: result.message })
      continue
    }
    candidates.push({ rowNumber: item.rowNumber, cells: item.cells, row: result })
  }

  const existing = await findExistingContacts(job.tenantId, candidates.map((item) => item.row.row))
  const seenEmail = new Set(existing.flatMap((item) => item.email ? [item.email.toLowerCase()] : []))
  const seenPhone = new Set(existing.flatMap((item) => item.phone ? [item.phone] : []))
  const contacts: Array<Record<string, unknown>> = []
  const customValues: Array<Record<string, unknown>> = []
  for (const item of candidates) {
    const { email, phone, contact, customValues: values } = item.row.row
    if ((email && seenEmail.has(email)) || (phone && seenPhone.has(phone))) {
      issues.push({ rowNumber: item.rowNumber, code: "DUPLICATE_CONTACT", message: "Email or phone already belongs to a contact." })
      continue
    }
    if (email) seenEmail.add(email)
    if (phone) seenPhone.add(phone)
    const contactId = randomUUID()
    contacts.push({ id: contactId, tenantId: job.tenantId, ...contact })
    for (const value of values) {
      customValues.push({
        id: randomUUID(), tenantId: job.tenantId, contactId, fieldId: value.fieldId,
        ...(value.isEncrypted ? { value: null, ...encryptCustomFieldValue(value.value) } : { value: value.value }),
      })
    }
  }

  await prisma.$transaction(async (tx) => {
    const t = tx as any
    const acquired = await t.contactImport.updateMany({
      where: { id: job.id, leaseToken: token, status: "PROCESSING", lastCommittedRow: rows[0].rowNumber - 1 },
      data: {
        lastCommittedRow: rows[rows.length - 1].rowNumber,
        processedRows: { increment: rows.length },
        createdRows: { increment: contacts.length },
        duplicateRows: { increment: issues.filter((issue) => issue.code === "DUPLICATE_CONTACT").length },
        invalidRows: { increment: issues.filter((issue) => issue.code !== "DUPLICATE_CONTACT").length },
      },
    })
    if (acquired.count !== 1) throw new Error("IMPORT_LEASE_LOST")
    if (contacts.length) await t.contact.createMany({ data: contacts })
    for (let offset = 0; offset < customValues.length; offset += 500) {
      await t.contactCustomFieldValue.createMany({ data: customValues.slice(offset, offset + 500) })
    }
    for (let offset = 0; offset < issues.length; offset += 500) {
      await t.contactImportIssue.createMany({ data: issues.slice(offset, offset + 500).map((issue) => ({
        id: randomUUID(), tenantId: job.tenantId, importId: job.id, ...issue,
      })) })
    }
  }, { timeout: 30_000 })
}

async function importSource(job: any, token: string) {
  const catalog = await getCatalog(job.tenantId)
  if (!catalog.statuses.some((status) => status.id === (job.settings as ImportSettings).defaultStatusConfigId)) {
    throw new ContactImportCsvError("STATUS_REMOVED", "The default contact status is no longer active.")
  }
  const mappedFieldIds = (job.mappings as ImportMapping[]).flatMap((mapping) => mapping.target.kind === "CUSTOM_FIELD" ? [mapping.target.fieldId] : [])
  const maxBatchRows = Math.max(10, Math.min(BATCH_SIZE, Math.floor(2500 / (mappedFieldIds.length + 1))))
  if (mappedFieldIds.some((id) => !catalog.customFields.some((field) => field.id === id))) {
    throw new ContactImportCsvError("FIELD_REMOVED", "A mapped custom field is no longer active.")
  }
  let rowNumber = -1
  let batch: CsvRow[] = []
  let batchBytes = 0
  for await (const cells of parseCsv(await openImportCsv(job.sourceKey))) {
    rowNumber += 1
    if (rowNumber === 0) {
      if (JSON.stringify(cells) !== JSON.stringify(job.headers)) throw new ContactImportCsvError("HEADERS_CHANGED", "The CSV headers changed after preview.")
      continue
    }
    if (rowNumber <= job.lastCommittedRow) continue
    batch.push({ rowNumber, cells })
    batchBytes += cells.reduce((total, cell) => total + Buffer.byteLength(cell, "utf8"), 0)
    if (batch.length < maxBatchRows && batchBytes < 1024 * 1024) continue
    if (!(await assertActive(job.id, token))) return false
    await commitBatch(job, token, batch, catalog)
    job.lastCommittedRow = rowNumber
    batch = []
    batchBytes = 0
  }
  if (batch.length) {
    if (!(await assertActive(job.id, token))) return false
    await commitBatch(job, token, batch, catalog)
    job.lastCommittedRow = batch[batch.length - 1].rowNumber
  }
  if (job.lastCommittedRow !== job.totalRows) throw new ContactImportCsvError("SOURCE_CHANGED", "The CSV changed during processing.")
  await setPhase(job.id, token, "REPORTING")
  return true
}

async function writeReport(job: any) {
  const folder = await mkdtemp(join(tmpdir(), "gestiabloc-contact-import-"))
  const path = join(folder, "issues.csv")
  const output = createWriteStream(path, { encoding: "utf8" })
  try {
    const headers = job.headers as string[]
    output.write([...headers, "Import row", "Result", "Reason"].map(csvCell).join(",") + "\r\n")
    let cursor = 0
    let issues: Issue[] = []
    let issueIndex = 0
    async function nextIssue(): Promise<Issue | null> {
      if (issueIndex < issues.length) return issues[issueIndex++]
      issues = await db.contactImportIssue.findMany({
        where: { importId: job.id, rowNumber: { gt: cursor } },
        orderBy: { rowNumber: "asc" }, take: 1000,
        select: { rowNumber: true, code: true, message: true },
      })
      issueIndex = 0
      if (!issues.length) return null
      cursor = issues[issues.length - 1].rowNumber
      return issues[issueIndex++]
    }
    let issue = await nextIssue()
    let rowNumber = -1
    for await (const cells of parseCsv(await openImportCsv(job.sourceKey))) {
      rowNumber += 1
      if (!issue) break
      if (rowNumber < issue.rowNumber) continue
      if (rowNumber !== issue.rowNumber) throw new ContactImportCsvError("SOURCE_CHANGED", "The CSV changed before the issue report was created.")
      const line = [...headers.map((_, index) => cells[index] ?? ""), String(issue.rowNumber + 1), issue.code, issue.message]
        .map(csvCell).join(",") + "\r\n"
      if (!output.write(line)) await once(output, "drain")
      issue = await nextIssue()
    }
    if (issue) throw new ContactImportCsvError("SOURCE_CHANGED", "The CSV changed before the issue report was created.")
    output.end()
    await once(output, "finish")
    const reportKey = `tenants/${job.tenantId}/contact-imports/${job.id}/issues.csv`
    await uploadPrivateObject({ path: reportKey, body: createReadStream(path), contentType: "text/csv" })
    return reportKey
  } finally {
    output.destroy()
    await rm(folder, { recursive: true, force: true })
  }
}

async function finishCanceled(jobId: string, token: string) {
  const job = await db.contactImport.findFirst({ where: { id: jobId, leaseToken: token, status: "CANCEL_REQUESTED" } })
  if (!job) return
  let reportKey = job.reportKey
  if (!reportKey && job.invalidRows + job.duplicateRows > 0) {
    try {
      reportKey = await writeReport(job)
    } catch (error) {
      console.error(JSON.stringify({ metric: "contact_import_cancel_report_error", importId: jobId, error: String(error) }))
    }
  }
  await db.contactImport.updateMany({ where: { id: jobId, leaseToken: token, status: "CANCEL_REQUESTED" }, data: {
    status: "CANCELED", reportKey, leaseToken: null, leaseExpiresAt: null, completedAt: new Date(),
  } })
}

async function processJob(claimed: ClaimedJob) {
  const heartbeat = setInterval(() => {
    void db.contactImport.updateMany({ where: { id: claimed.id, leaseToken: claimed.leaseToken, status: { in: ["PROCESSING", "CANCEL_REQUESTED"] } }, data: {
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
    } }).catch(() => undefined)
  }, 30_000)
  heartbeat.unref?.()
  try {
    const job = await db.contactImport.findUnique({ where: { id: claimed.id } })
    if (!job) return
    if (job.phase === "VALIDATING" || job.totalRows === 0) {
      if (!(await validateSource(job, claimed.leaseToken))) return
      job.phase = "IMPORTING"
    }
    if (job.phase === "IMPORTING") {
      if (!(await importSource(job, claimed.leaseToken))) return
      job.phase = "REPORTING"
    }
    if (!(await assertActive(job.id, claimed.leaseToken))) return
    const updated = await db.contactImport.findUnique({ where: { id: job.id } })
    const issueCount = updated.invalidRows + updated.duplicateRows
    const reportKey = issueCount ? await writeReport(updated) : null
    await db.contactImport.updateMany({ where: { id: job.id, leaseToken: claimed.leaseToken, status: "PROCESSING" }, data: {
      status: issueCount ? "COMPLETED_WITH_ISSUES" : "COMPLETED", reportKey,
      leaseToken: null, leaseExpiresAt: null, completedAt: new Date(), lastError: null,
    } })
    console.info(JSON.stringify({ metric: "contact_import_completed", importId: job.id, tenantId: job.tenantId, created: updated.createdRows, issues: issueCount }))
  } catch (error) {
    const job = await db.contactImport.findUnique({ where: { id: claimed.id }, select: { attemptCount: true, status: true } }).catch(() => null)
    if (job?.status === "CANCEL_REQUESTED") return
    const permanent = error instanceof ContactImportCsvError || (job?.attemptCount ?? MAX_ATTEMPTS) >= MAX_ATTEMPTS
    const message = error instanceof ContactImportCsvError ? error.message : "The import worker could not complete this job."
    await db.contactImport.updateMany({ where: { id: claimed.id, leaseToken: claimed.leaseToken, status: "PROCESSING" }, data: {
      status: permanent ? "FAILED" : "QUEUED", lastError: message.slice(0, 500),
      availableAt: new Date(Date.now() + 5000 * 2 ** Math.max(0, (job?.attemptCount ?? 1) - 1)),
      leaseToken: null, leaseExpiresAt: null, ...(permanent ? { completedAt: new Date() } : {}),
    } })
    console.error(JSON.stringify({ metric: "contact_import_error", importId: claimed.id, permanent, code: error instanceof ContactImportCsvError ? error.code : "WORKER_ERROR" }))
  } finally {
    try {
      await finishCanceled(claimed.id, claimed.leaseToken)
    } finally {
      clearInterval(heartbeat)
    }
  }
}

export async function runContactImportWorkerOnce() {
  await recover()
  const claimed = await Promise.all([claim(), claim()])
  await Promise.all(claimed.filter((item): item is ClaimedJob => Boolean(item)).map(processJob))
}

export async function cleanContactImportArtifacts() {
  const now = Date.now()
  await db.contactImport.updateMany({ where: { status: "DRAFT", createdAt: { lt: new Date(now - RETENTION_DAY_MS) } }, data: {
    status: "CANCELED", completedAt: new Date(),
  } })
  const missingReports = await db.contactImport.findMany({ where: {
    status: "CANCELED", reportKey: null, sourceDeletedAt: null,
    OR: [{ invalidRows: { gt: 0 } }, { duplicateRows: { gt: 0 } }],
  }, take: 10 })
  for (const job of missingReports) {
    try {
      const reportKey = await writeReport(job)
      await db.contactImport.updateMany({ where: { id: job.id, status: "CANCELED", reportKey: null }, data: { reportKey } })
    } catch (error) {
      console.error(JSON.stringify({ metric: "contact_import_report_retry_error", importId: job.id, error: String(error) }))
    }
  }
  const oldSources = await db.contactImport.findMany({ where: {
    status: { in: ["CANCELED", "COMPLETED", "COMPLETED_WITH_ISSUES", "FAILED"] },
    completedAt: { lt: new Date(now - 7 * RETENTION_DAY_MS) }, sourceDeletedAt: null,
  }, take: 100 })
  for (const job of oldSources) {
    await deletePrivateObject({ path: job.sourceKey })
    await db.contactImport.update({ where: { id: job.id }, data: { sourceDeletedAt: new Date() } })
  }
  const oldIssues = await db.contactImport.findMany({ where: {
    status: { in: ["CANCELED", "COMPLETED", "COMPLETED_WITH_ISSUES", "FAILED"] },
    completedAt: { lt: new Date(now - 30 * RETENTION_DAY_MS) }, issuesDeletedAt: null,
  }, take: 100 })
  for (const job of oldIssues) {
    if (job.reportKey) await deletePrivateObject({ path: job.reportKey })
    await db.contactImportIssue.deleteMany({ where: { importId: job.id } })
    await db.contactImport.update({ where: { id: job.id }, data: { reportKey: null, issuesDeletedAt: new Date() } })
  }
}
