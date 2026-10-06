import { randomUUID } from "node:crypto"
import { Router } from "express"
import { isSupportedCountry } from "libphonenumber-js"
import { z } from "zod"

import { Prisma } from "../generated/prisma/index.js"
import { ContactImportCsvError, IMPORT_MAX_BYTES, openImportCsv, parseCsv } from "../lib/contact-import-csv.js"
import { IMPORT_CONTACT_FIELDS, suggestImportMappings } from "../lib/contact-import-fields.js"
import { createSignedDownload, createSignedUpload, getPrivateStorageBucket } from "../lib/private-storage.js"
import { prisma } from "../lib/prisma.js"
import { enforceSameOrigin } from "../lib/security.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js"

const router = Router()
const db = prisma as any
const admin = [requireAuth, requireTenantAdmin({ tenantIdLookups: [{ source: "params", key: "tenantId" }] })] as const
const paths = z.object({ tenantId: z.string().uuid(), importId: z.string().uuid().optional() })
const createSchema = z.object({ fileName: z.string().trim().min(1).max(200), fileSize: z.number().int().min(1).max(IMPORT_MAX_BYTES) }).strict()
const fieldKeys = IMPORT_CONTACT_FIELDS.map(([key]) => key) as [typeof IMPORT_CONTACT_FIELDS[number][0], ...Array<typeof IMPORT_CONTACT_FIELDS[number][0]>]
const mappingSchema = z.object({
  sourceIndex: z.number().int().min(0).max(199),
  sourceHeader: z.string().max(200),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("CONTACT_FIELD"), key: z.enum(fieldKeys) }).strict(),
    z.object({ kind: z.literal("CUSTOM_FIELD"), fieldId: z.string().uuid() }).strict(),
    z.object({ kind: z.literal("IGNORE") }).strict(),
  ]),
}).strict()
const queueSchema = z.object({
  mappings: z.array(mappingSchema).min(1).max(200),
  settings: z.object({
    dateFormat: z.enum(["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"]),
    phoneCountry: z.string().length(2).refine(isSupportedCountry, "Unsupported phone country code"),
    multiSelectSeparator: z.string().min(1).max(4),
    defaultStatusConfigId: z.string().uuid(),
  }).strict(),
}).strict()

function enabled(res: { status: (code: number) => { json: (body: unknown) => unknown } }) {
  if (process.env.CONTACT_IMPORTS_ENABLED?.toLowerCase() === "false") {
    res.status(503).json({ error: "CONTACT_IMPORTS_DISABLED" })
    return false
  }
  return true
}

async function getCatalog(tenantId: string) {
  const [customFields, statuses, leadSources] = await Promise.all([
    db.contactCustomField.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, key: true, label: true, fieldType: true, isEncrypted: true, isSensitive: true, isRequired: true, options: true },
    }),
    db.contactStatusConfig.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true } }),
    db.contactLeadSourceConfig.findMany({ where: { tenantId }, select: { name: true } }),
  ])
  return {
    customFields: customFields.map((field: any) => ({ ...field, options: Array.isArray(field.options) ? field.options : [] })),
    statuses,
    leadSources,
  }
}

function present(job: any) {
  return {
    id: job.id, fileName: job.fileName, status: job.status, phase: job.phase,
    totalRows: job.totalRows, processedRows: job.processedRows, createdRows: job.createdRows,
    duplicateRows: job.duplicateRows, invalidRows: job.invalidRows,
    lastError: job.lastError, hasReport: Boolean(job.reportKey),
    createdAt: job.createdAt, startedAt: job.startedAt, completedAt: job.completedAt,
  }
}

router.post("/:tenantId", ...admin, async (req, res, next) => {
  try {
    if (!enabled(res)) return
    enforceSameOrigin(req)
    const { tenantId } = paths.parse(req.params)
    const input = createSchema.parse(req.body)
    if (!input.fileName.toLowerCase().endsWith(".csv")) return res.status(400).json({ error: "CSV_REQUIRED" })
    const id = randomUUID()
    const sourceKey = `tenants/${tenantId}/contact-imports/${id}/source.csv`
    const target = await createSignedUpload({ path: sourceKey })
    const job = await db.contactImport.create({ data: {
      id, tenantId, requestedByUserId: (req as AuthedRequest).user.id,
      sourceKey, fileName: input.fileName, fileSize: input.fileSize,
    } })
    return res.status(201).json({ ok: true, import: present(job), upload: { ...target, fileId: id, bucket: getPrivateStorageBucket() } })
  } catch (error) { next(error) }
})

router.post("/:tenantId/:importId/preview", ...admin, async (req, res, next) => {
  try {
    if (!enabled(res)) return
    enforceSameOrigin(req)
    const { tenantId, importId } = paths.parse(req.params)
    const job = await db.contactImport.findFirst({ where: { id: importId, tenantId, requestedByUserId: (req as AuthedRequest).user.id, status: "DRAFT" } })
    if (!job) return res.status(404).json({ error: "IMPORT_NOT_FOUND" })
    const rows: string[][] = []
    for await (const row of parseCsv(await openImportCsv(job.sourceKey))) {
      rows.push(rows.length === 0 ? row : row.map((cell) => cell.slice(0, 200)))
      if (rows.length >= 51) break
    }
    const headers = rows.shift()
    if (!headers?.length || headers.some((header) => !header.trim() || header.length > 200)) return res.status(400).json({ error: "INVALID_HEADERS" })
    if (new Set(headers.map((header) => header.trim().toLowerCase())).size !== headers.length) {
      return res.status(400).json({ error: "DUPLICATE_HEADERS" })
    }
    const catalog = await getCatalog(tenantId)
    await db.contactImport.update({ where: { id: importId }, data: { headers } })
    return res.json({
      ok: true, headers, sampleRows: rows, contactFields: IMPORT_CONTACT_FIELDS.map(([key, label]) => ({ key, label })),
      catalog, mappings: suggestImportMappings(headers, catalog.customFields),
      defaultStatusConfigId: catalog.statuses.find((item: any) => item.name.toLowerCase() === "active")?.id ?? catalog.statuses[0]?.id ?? null,
    })
  } catch (error) {
    if (error instanceof ContactImportCsvError) return res.status(400).json({ error: error.code, message: error.message })
    next(error)
  }
})

router.post("/:tenantId/:importId/queue", ...admin, async (req, res, next) => {
  try {
    if (!enabled(res)) return
    enforceSameOrigin(req)
    const { tenantId, importId } = paths.parse(req.params)
    const input = queueSchema.parse(req.body)
    const job = await db.contactImport.findFirst({ where: { id: importId, tenantId, requestedByUserId: (req as AuthedRequest).user.id } })
    if (!job) return res.status(404).json({ error: "IMPORT_NOT_FOUND" })
    if (job.status !== "DRAFT") return res.json({ ok: true, import: present(job) })
    const headers = Array.isArray(job.headers) ? job.headers : null
    if (!headers || input.mappings.length !== headers.length) return res.status(400).json({ error: "PREVIEW_REQUIRED" })
    const used = new Set<string>()
    for (const mapping of input.mappings) {
      if (mapping.sourceIndex >= headers.length || headers[mapping.sourceIndex] !== mapping.sourceHeader) return res.status(400).json({ error: "INVALID_MAPPING" })
      const sourceId = `index:${mapping.sourceIndex}`
      const targetId = mapping.target.kind === "CONTACT_FIELD" ? `standard:${mapping.target.key}`
        : mapping.target.kind === "CUSTOM_FIELD" ? `custom:${mapping.target.fieldId}` : null
      if (used.has(sourceId) || (targetId && used.has(targetId))) return res.status(400).json({ error: "DUPLICATE_MAPPING" })
      used.add(sourceId)
      if (targetId) used.add(targetId)
    }
    if (!["firstName", "lastName"].every((key) => input.mappings.some((mapping) => mapping.target.kind === "CONTACT_FIELD" && mapping.target.key === key))) {
      return res.status(400).json({ error: "NAME_MAPPING_REQUIRED" })
    }
    const catalog = await getCatalog(tenantId)
    if (!catalog.statuses.some((item: any) => item.id === input.settings.defaultStatusConfigId)) return res.status(400).json({ error: "INVALID_STATUS" })
    const mappedCustomIds = input.mappings.flatMap((mapping) => mapping.target.kind === "CUSTOM_FIELD" ? [mapping.target.fieldId] : [])
    if (mappedCustomIds.some((id) => !catalog.customFields.some((field: any) => field.id === id))) {
      return res.status(400).json({ error: "INVALID_CUSTOM_FIELD" })
    }
    const active = await db.contactImport.findFirst({ where: { tenantId, status: { in: ["QUEUED", "PROCESSING", "CANCEL_REQUESTED"] } }, select: { id: true } })
    if (active) return res.status(409).json({ error: "IMPORT_ALREADY_ACTIVE" })
    const claimed = await db.contactImport.updateMany({ where: { id: importId, tenantId, status: "DRAFT" }, data: {
      status: "QUEUED", phase: "VALIDATING", mappings: input.mappings, settings: input.settings,
    } })
    if (!claimed.count) return res.status(409).json({ error: "IMPORT_NOT_DRAFT" })
    const queued = await db.contactImport.findUnique({ where: { id: importId } })
    return res.json({ ok: true, import: present(queued) })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ error: "IMPORT_ALREADY_ACTIVE" })
    }
    next(error)
  }
})

router.get("/:tenantId", ...admin, async (req, res, next) => {
  try {
    const { tenantId } = paths.parse(req.params)
    const page = z.coerce.number().int().min(1).default(1).parse(req.query.page)
    const items = await db.contactImport.findMany({ where: { tenantId, status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 25, take: 25 })
    return res.json({ ok: true, items: items.map(present), page })
  } catch (error) { next(error) }
})

router.get("/:tenantId/:importId", ...admin, async (req, res, next) => {
  try {
    const { tenantId, importId } = paths.parse(req.params)
    const job = await db.contactImport.findFirst({ where: { id: importId, tenantId } })
    if (!job) return res.status(404).json({ error: "IMPORT_NOT_FOUND" })
    return res.json({ ok: true, import: present(job) })
  } catch (error) { next(error) }
})

router.post("/:tenantId/:importId/cancel", ...admin, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const { tenantId, importId } = paths.parse(req.params)
    const now = new Date()
    const canceled = await db.contactImport.updateMany({ where: { id: importId, tenantId, status: { in: ["DRAFT", "QUEUED"] } }, data: {
      status: "CANCELED", cancelRequestedAt: now, completedAt: now,
    } })
    if (!canceled.count) {
      await db.contactImport.updateMany({ where: { id: importId, tenantId, status: "PROCESSING" }, data: {
        status: "CANCEL_REQUESTED", cancelRequestedAt: now,
      } })
    }
    const job = await db.contactImport.findFirst({ where: { id: importId, tenantId } })
    if (!job) return res.status(404).json({ error: "IMPORT_NOT_FOUND" })
    if (!["CANCELED", "CANCEL_REQUESTED"].includes(job.status)) return res.status(409).json({ error: "IMPORT_FINISHED" })
    return res.json({ ok: true, import: present(job) })
  } catch (error) { next(error) }
})

router.post("/:tenantId/:importId/report-url", ...admin, async (req, res, next) => {
  try {
    enforceSameOrigin(req)
    const { tenantId, importId } = paths.parse(req.params)
    const job = await db.contactImport.findFirst({ where: { id: importId, tenantId }, select: { reportKey: true } })
    if (!job?.reportKey) return res.status(404).json({ error: "REPORT_NOT_FOUND" })
    return res.json({ ok: true, url: await createSignedDownload({ path: job.reportKey, expiresInSeconds: 60 }) })
  } catch (error) { next(error) }
})

export default router
