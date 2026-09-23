import { enrollAutomationProcessContact } from "./automation-process-enrollment.js"
import { prisma } from "./prisma.js"

const MAX_BATCHES_PER_RUN = 4
const MAX_BATCH_ATTEMPTS = 3
const STALE_BATCH_MS = 10 * 60 * 1000
const STALE_PREPARATION_MS = 60 * 60 * 1000

let workerRunning = false
let workerRequested = false

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
  const details = error instanceof Error
    ? { message: error.message.slice(0, 500) }
    : { message: "The automation enrollment batch could not be completed." }

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
  await prisma.automationProcess.updateMany({
    where: { id: batch.processId, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: new Date() },
  })

  for (const item of batch.contacts) {
    await enrollAutomationProcessContact(prisma, batch, item)
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
