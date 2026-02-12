import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";

import { requireAuth } from "../middleware/requireAuth.js";
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js";

const router = Router();

const ACCOUNT_SETTINGS_SECTIONS = [
  "users",
  "services",
  "professionals",
  "follow-ups",
  "status-config",
  "features",
  "subscription",
  "custom-fields",
] as const;

type AccountSettingsSection = (typeof ACCOUNT_SETTINGS_SECTIONS)[number];

const TenantPathSchema = z.object({
  tenantId: z.string().min(1),
});

const TenantRecordPathSchema = TenantPathSchema.extend({
  recordId: z.string().min(1),
});

const TenantScopedMutationSchema = z
  .object({
    tenantId: z.string().min(1).optional(),
  })
  .passthrough();

const readMiddlewares = [
  requireAuth,
  requireTenantAdmin({
    tenantIdLookups: [{ source: "params", key: "tenantId" }],
  }),
] as const;

const writeMiddlewares = [
  requireAuth,
  requireTenantAdmin({
    tenantIdLookups: [
      { source: "params", key: "tenantId" },
      { source: "body", key: "tenantId" },
      { source: "query", key: "tenantId" },
    ],
  }),
] as const;

const handleSectionListNotImplemented = (section: AccountSettingsSection) => (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);
    if (req.method !== "GET") {
      TenantScopedMutationSchema.parse(req.body);
    }

    return res.status(501).json({
      error: "NOT_IMPLEMENTED",
      tenantId,
      section,
      method: req.method,
      scope: "collection",
    });
  } catch (error) {
    return next(error);
  }
};

const handleSectionRecordNotImplemented = (section: AccountSettingsSection) => (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
    if (req.method !== "DELETE") {
      TenantScopedMutationSchema.parse(req.body);
    }

    return res.status(501).json({
      error: "NOT_IMPLEMENTED",
      tenantId,
      section,
      recordId,
      method: req.method,
      scope: "record",
    });
  } catch (error) {
    return next(error);
  }
};

for (const section of ACCOUNT_SETTINGS_SECTIONS) {
  router.get(
    "/:tenantId/" + section,
    ...readMiddlewares,
    handleSectionListNotImplemented(section),
  );
  router.post(
    "/:tenantId/" + section,
    ...writeMiddlewares,
    handleSectionListNotImplemented(section),
  );
  router.put(
    "/:tenantId/" + section + "/:recordId",
    ...writeMiddlewares,
    handleSectionRecordNotImplemented(section),
  );
  router.patch(
    "/:tenantId/" + section + "/:recordId",
    ...writeMiddlewares,
    handleSectionRecordNotImplemented(section),
  );
  router.delete(
    "/:tenantId/" + section + "/:recordId",
    ...writeMiddlewares,
    handleSectionRecordNotImplemented(section),
  );
}

export default router;
