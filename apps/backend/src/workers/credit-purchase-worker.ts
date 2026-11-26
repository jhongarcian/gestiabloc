import "dotenv/config"
import { setTimeout } from "node:timers/promises"
import { prisma } from "../lib/prisma.js"
import { StripeCreditGateway } from "../lib/stripe-credit-gateway.js"
import { reconcileCreditPurchase } from "../lib/ai-credit-purchases.js"
async function main() {
  // Fulfill existing paid orders and detect reversals even when new purchases
  // are disabled. This worker never creates a Checkout session or a charge.
  if (!process.env.STRIPE_SECRET_KEY) return
  const gateway = new StripeCreditGateway(process.env.STRIPE_SECRET_KEY), controller = new AbortController()
  process.once("SIGINT", () => controller.abort()); process.once("SIGTERM", () => controller.abort())
  do {
    const now = Date.now(), purchases = await prisma.aiCreditPurchase.findMany({ where: { OR: [
      { status: "PENDING", OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now - 5 * 60000) } }] },
      { status: "PAID", OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now - 24 * 3600000) } }] },
    ] }, orderBy: { checkedAt: { sort: "asc", nulls: "first" } }, take: 25, select: { id: true } })
    for (const purchase of purchases) {
      if (controller.signal.aborted) break
      try { await reconcileCreditPurchase(prisma, gateway, purchase.id) }
      catch {
        // Back off failures so one bad purchase cannot starve the whole queue.
        await prisma.aiCreditPurchase.updateMany({ where: { id: purchase.id }, data: { checkedAt: new Date() } })
        console.error("Credit purchase reconciliation failed; operator review or a later retry is required.")
        if (process.argv.includes("--once")) process.exitCode = 1
      }
    }
    if (process.argv.includes("--once") || controller.signal.aborted) break
    try { await setTimeout(60000, undefined, { signal: controller.signal }) } catch { break }
  } while (!controller.signal.aborted)
}
main().catch(() => { console.error("Credit purchase worker could not start."); process.exitCode = 1 }).finally(() => prisma.$disconnect())
