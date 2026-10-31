import "dotenv/config"
import { setTimeout } from "node:timers/promises"
import { prisma } from "../lib/prisma.js"
import { maintainAiCredits } from "../lib/ai-credit-maintenance.js"

async function main() {
  const controller = new AbortController()
  process.once("SIGTERM", () => controller.abort())
  process.once("SIGINT", () => controller.abort())
  const interval = Number(process.env.AI_CREDIT_MAINTENANCE_INTERVAL_MS ?? 60000)
  if (!Number.isInteger(interval) || interval < 1000 || interval > 60000) throw new Error("Invalid maintenance interval")
  do {
    try { console.info("AI credit maintenance", await maintainAiCredits(prisma)) }
    catch {
      console.error("AI credit maintenance failed; verify database availability and migrations.")
      if (process.argv.includes("--once")) process.exitCode = 1
    }
    if (process.argv.includes("--once") || controller.signal.aborted) break
    try { await setTimeout(interval, undefined, { signal: controller.signal }) } catch { break }
  } while (!controller.signal.aborted)
}
main().catch(() => { console.error("AI credit maintenance could not start."); process.exitCode = 1 }).finally(() => prisma.$disconnect())
