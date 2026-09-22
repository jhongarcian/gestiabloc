import { AutomationActionInputSchema, applyAutomationActions, getAutomationRuntimeCatalog } from "./opportunity-automations.js"
import { prisma } from "./prisma.js"

const MAX_BATCHES_PER_RUN = 4
const MAX_BATCH_ATTEMPTS = 3
const STALE_BATCH_MS = 10 * 60 * 1000
const STALE_PREPARATION_MS = 60 * 60 * 1000

let workerRunning = false
let workerRequested = false

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string"
      ? error.code
      : "AUTOMATION_EXECUTION_FAILED"
    return { code, message: error.message.slice(0, 500) }
  }

  return {
    code: "AUTOMATION_EXECUTION_FAILED",
    message: "The automation action could not be completed.",
  }
}

async function recoverInterruptedWork() {
  const now = Date.now()

  await Promise.all([
    prisma.automationProcessBatch.updateMany({
      where: {
        status: "PROCESSING",
        lockedAt: { lt: new Date(now - STALE_BATCH_MS) },
      },
      data: {
        status: "PENDING",
        lockedAt: null,
        errorMessage: "Recovered after an interrupted worker.",
      },
    }),
    prisma.automationProcess.updateMany({
      where: {
        status: "PREPARING",
        createdAt: { lt: new Date(now - STALE_PREPARATION_MS) },
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        lastError: "The contact list was not fully uploaded within one hour.",
      },
    }),
  ])
}

async function claimNextBatch() {
  const candidate = await prisma.automationProcessBatch.findFirst({
    where: {
      status: "PENDING",
      process: { status: { in: ["QUEUED", "RUNNING"] } },
    },
    orderBy: [{ createdAt: "asc" }, { batchNumber: "asc" }],
    select: { id: true },
  })

  if (!candidate) return null

  const claimed = await prisma.automationProcessBatch.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: {
      status: "PROCESSING",
      lockedAt: new Date(),
      startedAt: new Date(),
      attemptCount: { increment: 1 },
      errorMessage: null,
    },
  })
  if (claimed.count !== 1) return null

  return prisma.automationProcessBatch.findUnique({
    where: { id: candidate.id },
    include: {
      process: true,
      contacts: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
      },
    },
  })
}

async function refreshProcessTotals(processId: string) {
  const [process, succeededContacts, failedContacts, completedBatches] = await Promise.all([
    prisma.automationProcess.findUnique({ where: { id: processId } }),
    prisma.automationProcessContact.count({ where: { processId, status: "SUCCEEDED" } }),
    prisma.automationProcessContact.count({ where: { processId, status: "FAILED" } }),
    prisma.automationProcessBatch.count({
      where: {
        processId,
        status: { in: ["COMPLETED", "COMPLETED_WITH_ERRORS"] },
      },
    }),
  ])

  if (!process) return

  const processedContacts = succeededContacts + failedContacts
  const isComplete =
    processedContacts >= process.totalContacts &&
    completedBatches >= process.totalBatches

  await prisma.automationProcess.update({
    where: { id: processId },
    data: {
      processedContacts,
      succeededContacts,
      failedContacts,
      completedBatches,
      ...(isComplete
        ? {
            status: failedContacts > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
            completedAt: new Date(),
          }
        : {}),
    },
  })
}

async function processContact(batch: any, item: any, actions: any[], catalog: any) {
  const process = batch.process

  try {
    await prisma.$transaction(async (transaction) => {
      const contact = await transaction.contact.findFirst({
        where: { tenantId: process.tenantId, id: item.contactId },
        select: { id: true },
      })
      if (!contact) throw new Error("This contact is no longer available.")

      await applyAutomationActions(transaction, {
        automation: {
          id: process.automationId ?? process.id,
          name: process.automationName,
          actions,
        },
        tenantId: process.tenantId,
        contactId: item.contactId,
        catalog,
      })

      await transaction.automationExecution.create({
        data: {
          tenantId: process.tenantId,
          automationId: process.automationId,
          automationName: process.automationName,
          triggerType: process.triggerType,
          status: "SUCCEEDED",
          contactId: item.contactId,
          actorUserId: process.requestedByUserId,
          processId: process.id,
          processName: process.processName,
          actionCount: actions.length,
        },
      })

      await transaction.automationProcessContact.update({
        where: { id: item.id },
        data: { status: "SUCCEEDED", startedAt: new Date(), completedAt: new Date() },
      })
    })
  } catch (error) {
    const details = errorDetails(error)

    await prisma.$transaction([
      prisma.automationProcessContact.update({
        where: { id: item.id },
        data: {
          status: "FAILED",
          errorCode: details.code,
          errorMessage: details.message,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      }),
      prisma.automationExecution.create({
        data: {
          tenantId: process.tenantId,
          automationId: process.automationId,
          automationName: process.automationName,
          triggerType: process.triggerType,
          status: "FAILED",
          contactId: item.contactId,
          actorUserId: process.requestedByUserId,
          processId: process.id,
          processName: process.processName,
          actionCount: actions.length,
          errorCode: details.code,
          errorMessage: details.message,
        },
      }),
    ])
  }
}

async function completeBatch(batch: any) {
  const [succeededContacts, failedContacts] = await Promise.all([
    prisma.automationProcessContact.count({ where: { batchId: batch.id, status: "SUCCEEDED" } }),
    prisma.automationProcessContact.count({ where: { batchId: batch.id, status: "FAILED" } }),
  ])

  await prisma.automationProcessBatch.update({
    where: { id: batch.id },
    data: {
      status: failedContacts > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
      succeededContacts,
      failedContacts,
      lockedAt: null,
      completedAt: new Date(),
    },
  })
  await refreshProcessTotals(batch.processId)
}

async function failOrRetryBatch(batch: any, error: unknown) {
  const details = errorDetails(error)

  if (batch.attemptCount < MAX_BATCH_ATTEMPTS) {
    await prisma.automationProcessBatch.update({
      where: { id: batch.id },
      data: { status: "PENDING", lockedAt: null, errorMessage: details.message },
    })
    return
  }

  const pending = await prisma.automationProcessContact.findMany({
    where: { batchId: batch.id, status: "PENDING" },
    select: { id: true },
  })
  if (pending.length > 0) {
    await prisma.automationProcessContact.updateMany({
      where: { id: { in: pending.map((item) => item.id) } },
      data: {
        status: "FAILED",
        errorCode: "BATCH_FAILED",
        errorMessage: details.message,
        completedAt: new Date(),
      },
    })
  }

  await prisma.automationProcess.update({
    where: { id: batch.processId },
    data: { lastError: details.message },
  })
  await completeBatch(batch)
}

async function runClaimedBatch(batch: any) {
  const actions = AutomationActionInputSchema.array().min(1).max(20).parse(batch.process.actionSnapshot)

  await prisma.automationProcess.updateMany({
    where: { id: batch.processId, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: new Date() },
  })

  const catalog = await getAutomationRuntimeCatalog(prisma, batch.tenantId)
  for (const item of batch.contacts) {
    await processContact(batch, item, actions, catalog)
  }

  await completeBatch(batch)
}

export async function runAutomationProcessQueue() {
  if (workerRunning) {
    workerRequested = true
    return
  }

  workerRunning = true
  try {
    await recoverInterruptedWork()

    for (let index = 0; index < MAX_BATCHES_PER_RUN; index += 1) {
      const batch = await claimNextBatch()
      if (!batch) break

      try {
        await runClaimedBatch(batch)
      } catch (error) {
        console.error(`Automation process batch ${batch.id} failed:`, error)
        await failOrRetryBatch(batch, error)
      }
    }
  } finally {
    workerRunning = false
    if (workerRequested) {
      workerRequested = false
      queueMicrotask(() => void runAutomationProcessQueue())
    }
  }
}

export function kickAutomationProcessQueue() {
  queueMicrotask(() => void runAutomationProcessQueue().catch((error) => {
    console.error("Failed to run automation process queue:", error)
  }))
}
