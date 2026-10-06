import "dotenv/config"

process.env.CONTACT_IMPORT_WORKER = "true"

async function main() {
  const { prisma } = await import("../lib/prisma.js")
  const { cleanContactImportArtifacts, runContactImportWorkerOnce } = await import("../lib/contact-import-worker.js")
  await prisma.$connect()
  let busy = false
  let lastCleanup = 0
  const poll = async () => {
    if (busy) return
    busy = true
    try {
      await runContactImportWorkerOnce()
      if (Date.now() - lastCleanup > 60 * 60 * 1000) {
        await cleanContactImportArtifacts()
        lastCleanup = Date.now()
      }
    } catch (error) {
      console.error("Contact import worker poll failed:", error)
    } finally {
      busy = false
    }
  }
  await poll()
  const interval = setInterval(() => void poll(), 3000)
  const shutdown = async () => {
    clearInterval(interval)
    await prisma.$disconnect()
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())
}

void main().catch((error) => {
  console.error("Contact import worker failed to start:", error)
  process.exit(1)
})
