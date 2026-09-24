import { type Response, Router } from "express"
import { z } from "zod"

import { kickAutomationProcessQueue } from "../lib/automation-process-worker.js"
import {
  AUTOMATION_PROCESS_BATCH_SIZE,
  getAutomationProcessBatchCount,
} from "../lib/automation-process-batches.js"
import { prisma } from "../lib/prisma.js"
import { enforceSameOrigin } from "../lib/security.js"
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js"

const router = Router()
const prismaWithProcesses = prisma as any

const TenantPathSchema = z.object({
  tenantId: z.string().trim().min(1),
})

const ProcessPathSchema = TenantPathSchema.extend({
  processId: z.string().trim().min(1),
})

const CreateProcessSchema = z.object({
  automationId: z.string().trim().min(1),
  processName: z.string().trim().min(1).max(120),
  expectedContactCount: z.number().int().min(1).max(2_000_000_000),
}).strict()

const UploadBatchSchema = z.object({
  batchNumber: z.number().int().min(1),
  contactIds: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(AUTOMATION_PROCESS_BATCH_SIZE),
}).strict()

const ListProcessesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(
    (value) => value === 10 || value === 25 || value === 50,
    { message: "pageSize must be 10, 25, or 50" },
  ).default(25),
})

const ProcessDetailQuerySchema = z.object({
  failedPage: z.coerce.number().int().min(1).default(1),
  failedPageSize: z.coerce.number().int().min(1).max(100).default(25),
})

async function requireActiveMembership(
  req: AuthedRequest,
  res: Response,
  tenantId: string,
) {
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: req.user.id, tenantId } },
    select: { role: true, status: true, securityLevel: true },
  })

  if (!membership || membership.status !== "ACTIVE") {
    res.status(403).json({ error: "FORBIDDEN" })
    return null
  }

  return membership
}

function serializeProcess(process: any) {
  return {
    id: process.id,
    processName: process.processName,
    automationId: process.automationId,
    automationName: process.automationName,
    status: process.status,
    requestedByName: process.requestedByName,
    expectedContacts: process.expectedContacts,
    totalContacts: process.totalContacts,
    processedContacts: process.processedContacts,
    succeededContacts: process.succeededContacts,
    failedContacts: process.failedContacts,
    totalBatches: process.totalBatches,
    completedBatches: process.completedBatches,
    startedAt: process.startedAt,
    completedAt: process.completedAt,
    lastError: process.lastError,
    createdAt: process.createdAt,
    updatedAt: process.updatedAt,
  }
}

router.post("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const payload = CreateProcessSchema.parse(req.body)
    enforceSameOrigin(req)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const automation = await prismaWithProcesses.automation.findFirst({
      where: { id: payload.automationId, tenantId, isEnabled: true },
      select: {
        id: true,
        name: true,
        triggerType: true,
        actions: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            nodeKey: true,
            type: true,
            customFieldId: true,
            statusConfigId: true,
            assignedUserId: true,
            tagId: true,
            value: true,
            waitConfig: true,
            noteTitle: true,
            noteBody: true,
            taskConfig: true,
          },
        },
      },
    })

    if (!automation) {
      return res.status(404).json({ error: "AUTOMATION_NOT_FOUND" })
    }
    const process = await prismaWithProcesses.automationProcess.create({
      data: {
        tenantId,
        automationId: automation.id,
        automationName: automation.name,
        triggerType: automation.triggerType,
        actionSnapshot: automation.actions,
        processName: payload.processName,
        requestedByUserId: authed.user.id,
        requestedByName: authed.user.name?.trim() || authed.user.email,
        expectedContacts: payload.expectedContactCount,
      },
    })

    return res.status(201).json({ ok: true, process: serializeProcess(process) })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId/:processId/batches", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, processId } = ProcessPathSchema.parse(req.params)
    const payload = UploadBatchSchema.parse(req.body)
    enforceSameOrigin(req)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const contactIds = [...new Set(payload.contactIds)]
    if (contactIds.length !== payload.contactIds.length) {
      return res.status(400).json({
        error: "DUPLICATE_CONTACTS_IN_BATCH",
        message: "A contact can only appear once in each batch.",
      })
    }

    const existingBatch = await prismaWithProcesses.automationProcessBatch.findUnique({
      where: { processId_batchNumber: { processId, batchNumber: payload.batchNumber } },
      select: { id: true, contactCount: true },
    })
    if (existingBatch) {
      if (existingBatch.contactCount !== contactIds.length) {
        return res.status(409).json({ error: "BATCH_ALREADY_UPLOADED" })
      }
      return res.json({ ok: true, batch: existingBatch })
    }

    const process = await prismaWithProcesses.automationProcess.findFirst({
      where: { id: processId, tenantId },
    })
    if (!process) return res.status(404).json({ error: "PROCESS_NOT_FOUND" })
    if (process.requestedByUserId !== authed.user.id) {
      return res.status(403).json({ error: "FORBIDDEN" })
    }
    if (process.status !== "PREPARING") {
      return res.status(409).json({ error: "PROCESS_ALREADY_STARTED" })
    }
    if (payload.batchNumber !== process.totalBatches + 1) {
      return res.status(409).json({
        error: "BATCH_OUT_OF_ORDER",
        message: "Contact batches must be uploaded in order.",
      })
    }
    if (process.totalContacts + contactIds.length > process.expectedContacts) {
      return res.status(400).json({ error: "TOO_MANY_CONTACTS" })
    }

    const [duplicates, contacts] = await Promise.all([
      prismaWithProcesses.automationProcessContact.findMany({
        where: { processId, contactId: { in: contactIds } },
        select: { contactId: true },
      }),
      prismaWithProcesses.contact.findMany({
        where: { tenantId, id: { in: contactIds } },
        select: { id: true, firstName: true, middleName: true, lastName: true },
      }),
    ])

    if (duplicates.length > 0) {
      return res.status(409).json({
        error: "CONTACT_ALREADY_ADDED",
        message: "One or more contacts were already uploaded to this process.",
      })
    }
    if (contacts.length !== contactIds.length) {
      return res.status(404).json({
        error: "CONTACT_NOT_FOUND",
        message: "One or more selected contacts are no longer available.",
      })
    }

    const contactsById = new Map(contacts.map((contact: any) => [contact.id, contact]))
    const batch = await prismaWithProcesses.$transaction(async (transaction: any) => {
      const created = await transaction.automationProcessBatch.create({
        data: {
          tenantId,
          processId,
          batchNumber: payload.batchNumber,
          contactCount: contactIds.length,
          contacts: {
            create: contactIds.map((contactId) => {
              const contact = contactsById.get(contactId) as any
              return {
                tenantId,
                processId,
                contactId,
                contactName: [contact.firstName, contact.middleName, contact.lastName]
                  .filter(Boolean)
                  .join(" "),
              }
            }),
          },
        },
        select: { id: true, batchNumber: true, contactCount: true },
      })

      await transaction.automationProcess.update({
        where: { id: processId },
        data: {
          totalContacts: { increment: contactIds.length },
          totalBatches: { increment: 1 },
        },
      })

      return created
    })

    return res.status(201).json({ ok: true, batch })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId/:processId/start", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, processId } = ProcessPathSchema.parse(req.params)
    enforceSameOrigin(req)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const process = await prismaWithProcesses.automationProcess.findFirst({
      where: { id: processId, tenantId },
    })
    if (!process) return res.status(404).json({ error: "PROCESS_NOT_FOUND" })
    if (process.requestedByUserId !== authed.user.id) {
      return res.status(403).json({ error: "FORBIDDEN" })
    }
    if (process.status !== "PREPARING") {
      return res.json({ ok: true, process: serializeProcess(process) })
    }
    if (
      process.totalContacts !== process.expectedContacts ||
      process.totalBatches !== getAutomationProcessBatchCount(process.expectedContacts)
    ) {
      return res.status(409).json({
        error: "UPLOAD_INCOMPLETE",
        message: `Uploaded ${process.totalContacts} of ${process.expectedContacts} contacts.`,
      })
    }

    const updated = await prismaWithProcesses.automationProcess.update({
      where: { id: processId },
      data: { status: "QUEUED" },
    })
    kickAutomationProcessQueue()

    return res.json({ ok: true, process: serializeProcess(updated) })
  } catch (error) {
    return next(error)
  }
})

router.post("/:tenantId/:processId/fail", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, processId } = ProcessPathSchema.parse(req.params)
    enforceSameOrigin(req)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const result = await prismaWithProcesses.automationProcess.updateMany({
      where: {
        id: processId,
        tenantId,
        requestedByUserId: authed.user.id,
        status: "PREPARING",
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        lastError: "The contact list could not be fully uploaded.",
      },
    })

    if (result.count === 0) return res.status(409).json({ error: "PROCESS_NOT_PREPARING" })
    return res.json({ ok: true })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId } = TenantPathSchema.parse(req.params)
    const { page, pageSize } = ListProcessesQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const where = { tenantId }
    const [total, items] = await prismaWithProcesses.$transaction([
      prismaWithProcesses.automationProcess.count({ where }),
      prismaWithProcesses.automationProcess.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return res.json({
      ok: true,
      items: items.map(serializeProcess),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    return next(error)
  }
})

router.get("/:tenantId/:processId", requireAuth, async (req, res, next) => {
  try {
    const authed = req as AuthedRequest
    const { tenantId, processId } = ProcessPathSchema.parse(req.params)
    const { failedPage, failedPageSize } = ProcessDetailQuerySchema.parse(req.query)

    const membership = await requireActiveMembership(authed, res, tenantId)
    if (!membership) return

    const process = await prismaWithProcesses.automationProcess.findFirst({
      where: { id: processId, tenantId },
      include: {
        batches: {
          orderBy: { batchNumber: "asc" },
          take: 100,
          select: {
            id: true,
            batchNumber: true,
            status: true,
            contactCount: true,
            succeededContacts: true,
            failedContacts: true,
            attemptCount: true,
            startedAt: true,
            completedAt: true,
            errorMessage: true,
          },
        },
      },
    })
    if (!process) return res.status(404).json({ error: "PROCESS_NOT_FOUND" })

    const failedContacts = await prismaWithProcesses.automationProcessContact.findMany({
      where: { processId, status: "FAILED" },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      skip: (failedPage - 1) * failedPageSize,
      take: failedPageSize,
      select: {
        id: true,
        contactId: true,
        contactName: true,
        errorCode: true,
        errorMessage: true,
        completedAt: true,
      },
    })

    return res.json({
      ok: true,
      process: {
        ...serializeProcess(process),
        batches: process.batches,
        visibleBatchLimit: 100,
      },
      failedContacts,
      failedPagination: {
        page: failedPage,
        pageSize: failedPageSize,
        total: process.failedContacts,
        totalPages: Math.max(1, Math.ceil(process.failedContacts / failedPageSize)),
      },
    })
  } catch (error) {
    return next(error)
  }
})

export default router
