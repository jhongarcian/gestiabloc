import type { Request, Response } from "express"
import { prisma } from "../lib/prisma.js"
import { subscriptionAccess } from "../lib/subscription-billing.js"

// Called after session authentication. Billing recovery and onboarding remain
// reachable while CRM access is blocked. Existing route membership checks still run.
export async function allowBillingAccess(req: Request, res: Response, actorId: string) {
  if (process.env.BILLING_ENABLED !== "true") return true
  const path = req.originalUrl.split("?")[0] ?? ""
  if (/^\/api\/(billing|auth|onboarding)(\/|$)/.test(path) || (req.method === "GET" && /^\/api\/account-settings\/[^/]+\/subscription\/?$/.test(path))) return true
  const tenantIds = [...new Set([req.params.tenantId, req.body?.tenantId, req.query.tenantId].filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map(id => id.trim()))]
  if (tenantIds.length > 1) { res.status(400).json({ error: "TENANT_SCOPE_CONFLICT" }); return false }
  let tenantId = tenantIds[0] ?? ""
  if (!tenantId && req.params.fileId) tenantId = (await prisma.file.findUnique({ where: { id: String(req.params.fileId) }, select: { tenantId: true } }))?.tenantId ?? ""
  if (!tenantId) return true // tenant-independent routes retain their own authorization
  return allowTenantBillingAccess(tenantId, res, actorId, req)
}
export async function allowTenantBillingAccess(tenantId: string, res: Response, actorId: string, req?: Request) {
  if (process.env.BILLING_ENABLED !== "true") return true
  const membership = await prisma.membership.findUnique({ where: { userId_tenantId: { userId: actorId, tenantId } }, select: { status: true } })
  if (membership?.status !== "ACTIVE") { res.status(403).json({ error: "TENANT_ACCESS_DENIED" }); return false }
  const subscription = await prisma.tenantSubscription.findUnique({ where: { tenantId }, select: { status: true, paidThrough: true, graceEndsAt: true } })
  if (!subscriptionAccess(subscription).crmAllowed) {
    res.setHeader("Cache-Control", "no-store")
    res.status(402).json({ error: "BILLING_REQUIRED" })
    return false
  }
  const generatesAi = req?.method === "POST" && (/\/ai\/test-chat\/messages\/?$/.test(req.path) || (/\/fit-scan\/assistant\/?$/.test(req.path) && Boolean(req.body?.question)))
  if (generatesAi && !subscriptionAccess(subscription).aiAllowed) {
    res.status(402).json({ error: "BILLING_REQUIRED" })
    return false
  }
  return true
}
