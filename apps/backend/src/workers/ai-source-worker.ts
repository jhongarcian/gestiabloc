import "dotenv/config"
import { prisma } from "../lib/prisma.js"
import { startAiSourceWorker } from "../lib/ai-source-worker.js"
void (async () => {
  await prisma.$connect()
  const stop = startAiSourceWorker({ keepAlive: true })
  const shutdown = async () => {
    await stop()
    await prisma.$disconnect()
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())
})()
