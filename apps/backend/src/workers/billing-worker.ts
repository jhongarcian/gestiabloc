import "dotenv/config"
import { setTimeout } from "node:timers/promises"
import { prisma } from "../lib/prisma.js"
import { getBillingConfiguration } from "../lib/billing-config.js"
import { reconcileSubscription } from "../lib/subscription-billing.js"
import { StripeBillingGateway } from "../lib/stripe-billing-gateway.js"
async function main() {
  if (!getBillingConfiguration().enabled) return
  const gateway = new StripeBillingGateway(process.env.STRIPE_SECRET_KEY!), controller = new AbortController()
  process.once("SIGINT", () => controller.abort()); process.once("SIGTERM", () => controller.abort())
  do {
    const subscriptions = await prisma.tenantSubscription.findMany({ where: { AND: [
      { OR: [{ stripeSubscriptionId: { not: null } }, { pendingCheckoutId: { not: null } }] },
      { OR: [{ billingSyncedAt: null }, { billingSyncedAt: { lt: new Date(Date.now() - 5 * 60000) } }] },
    ] }, orderBy: { billingSyncedAt: { sort: "asc", nulls: "first" } }, take: 25, select: { tenantId: true } })
    for (const sub of subscriptions) {
      if (controller.signal.aborted) break
      try { await reconcileSubscription(prisma, gateway, sub.tenantId) }
      catch { console.error("Subscription reconciliation failed; retrying on a later pass."); if (process.argv.includes("--once")) process.exitCode = 1 }
    }
    if (process.argv.includes("--once") || controller.signal.aborted) break
    try { await setTimeout(60000, undefined, { signal: controller.signal }) } catch { break }
  } while (!controller.signal.aborted)
}
main().catch(() => { console.error("Billing reconciliation could not start."); process.exitCode = 1 }).finally(() => prisma.$disconnect())
