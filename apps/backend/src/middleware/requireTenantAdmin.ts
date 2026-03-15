import type { RequestHandler } from "express";

import { prisma } from "../lib/prisma.js";
import type { AuthedRequest } from "./requireAuth.js";

type TenantIdSource = "body" | "params" | "query";

type TenantIdLookup = {
  source: TenantIdSource;
  key: string;
};

type RequireTenantAdminOptions = {
  tenantIdLookups?: TenantIdLookup[];
  requireActiveMembership?: boolean;
};

const DEFAULT_TENANT_ID_LOOKUPS: TenantIdLookup[] = [
  { source: "body", key: "tenantId" },
  { source: "params", key: "tenantId" },
  { source: "query", key: "tenantId" },
];

function getTenantId(
  req: Parameters<RequestHandler>[0],
  lookups: TenantIdLookup[],
) {
  for (const lookup of lookups) {
    const bucket = req[lookup.source] as Record<string, unknown> | undefined;
    const raw = bucket?.[lookup.key];
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw;
    }
  }
  return null;
}

export function requireTenantAdmin(
  options: RequireTenantAdminOptions = {},
): RequestHandler {
  const lookups = options.tenantIdLookups ?? DEFAULT_TENANT_ID_LOOKUPS;
  const requireActive = options.requireActiveMembership ?? true;

  return async (req, res, next) => {
    try {
      const authed = req as AuthedRequest;
      if (!authed.user?.id) {
        return res.status(401).json({ error: "UNAUTHENTICATED" });
      }

      const tenantId = getTenantId(req, lookups);
      if (!tenantId) {
        return res.status(400).json({ error: "TENANT_ID_REQUIRED" });
      }

      const membership = await prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            userId: authed.user.id,
            tenantId,
          },
        },
      });

      const isAdmin = membership?.role === "TENANT_ADMIN";
      const hasRequiredStatus = requireActive
        ? membership?.status === "ACTIVE"
        : Boolean(membership);

      if (!isAdmin || !hasRequiredStatus) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}
