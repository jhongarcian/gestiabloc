import type { RequestHandler } from "express"
import type { SecurityLevel } from "../generated/prisma/index.js"
import { prisma } from "../lib/prisma.js"
import type { AuthedRequest } from "./requireAuth.js"

type TenantIdSource = "body" | "params" | "query"

type TenantIdLookup = {
  source: TenantIdSource
  key: string
}

type RequireTenantSecurityLevelOptions = {
  minimumLevel: SecurityLevel
  tenantIdLookups?: TenantIdLookup[]
}

const DEFAULT_TENANT_ID_LOOKUPS: TenantIdLookup[] = [
  { source: "body", key: "tenantId" },
  { source: "params", key: "tenantId" },
  { source: "query", key: "tenantId" },
]

const SECURITY_LEVEL_WEIGHT: Record<SecurityLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  MAX: 3,
}

function getTenantId(
  req: Parameters<RequestHandler>[0],
  lookups: TenantIdLookup[],
) {
  for (const lookup of lookups) {
    const bucket = req[lookup.source] as Record<string, unknown> | undefined
    const raw = bucket?.[lookup.key]
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw
    }
  }
  return null
}

export function requireTenantSecurityLevel(
  options: RequireTenantSecurityLevelOptions,
): RequestHandler {
  const lookups = options.tenantIdLookups ?? DEFAULT_TENANT_ID_LOOKUPS
  const minimumWeight = SECURITY_LEVEL_WEIGHT[options.minimumLevel]

  return async (req, res, next) => {
    try {
      const authed = req as AuthedRequest
      if (!authed.user?.id) {
        return res.status(401).json({ error: "UNAUTHENTICATED" })
      }

      const tenantId = getTenantId(req, lookups)
      if (!tenantId) {
        return res.status(400).json({ error: "TENANT_ID_REQUIRED" })
      }

      const membership = await prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            userId: authed.user.id,
            tenantId,
          },
        },
        select: {
          status: true,
          securityLevel: true,
        },
      })

      if (!membership || membership.status !== "ACTIVE") {
        return res.status(403).json({ error: "FORBIDDEN" })
      }

      const hasEnoughLevel =
        SECURITY_LEVEL_WEIGHT[membership.securityLevel] >= minimumWeight

      if (!hasEnoughLevel) {
        return res.status(403).json({ error: "INSUFFICIENT_SECURITY_LEVEL" })
      }

      return next()
    } catch (error) {
      return next(error)
    }
  }
}
