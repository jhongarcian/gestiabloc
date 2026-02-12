import { type NextFunction, type Request, type Response, Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireTenantAdmin } from "../middleware/requireTenantAdmin.js";

const router = Router();

const ACCOUNT_SETTINGS_SECTIONS = [
  "users",
  "account",
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

const UsersPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z
    .coerce
    .number()
    .int()
    .refine((value) => value === 10 || value === 25, {
      message: "pageSize must be 10 or 25",
    })
    .default(10),
});

const optionalStringField = (max: number) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z.string().max(max).nullable().optional(),
  );

const optionalEmailField = () =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
    z.string().email().max(255).nullable().optional(),
  );

const optionalUrlField = () =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      if (trimmed.length === 0) return null;

      // Accept domain-style input (e.g. "acme.com") and normalize to https URL.
      if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)) {
        return `https://${trimmed}`;
      }

      return trimmed;
    },
    z.string().url().max(255).nullable().optional(),
  );

const UpdateTenantInfoSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: optionalEmailField(),
  phone: optionalStringField(60),
  addressLine1: optionalStringField(255),
  addressLine2: optionalStringField(255),
  city: optionalStringField(120),
  state: optionalStringField(120),
  postalCode: optionalStringField(40),
  country: optionalStringField(120),
  timezone: optionalStringField(100),
  website: optionalUrlField(),
});

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

router.get("/:tenantId/users", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);
    const { page, pageSize } = UsersPaginationQuerySchema.parse(req.query);
    const now = new Date();

    const skip = (page - 1) * pageSize;

    const [total, members, tenant] = await prisma.$transaction([
      prisma.membership.count({
        where: { tenantId },
      }),
      prisma.membership.findMany({
        where: { tenantId },
        select: {
          userId: true,
          role: true,
          status: true,
          user: {
            select: {
              name: true,
              email: true,
              image: true,
              emailVerified: true,
              lastLoginAt: true,
              sessions: {
                select: { createdAt: true },
                where: { expiresAt: { gt: now } },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
        orderBy: { user: { name: "asc" } },
        skip,
        take: pageSize,
      }),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { timezone: true },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return res.json({
      ok: true,
      items: members.map((member) => ({
        id: member.userId,
        name: member.user.name,
        email: member.user.email,
        avatar: member.user.image ?? null,
        emailVerified: member.user.emailVerified,
        isOnline: member.user.sessions.length > 0,
        sessionCreatedAt: member.user.sessions[0]?.createdAt ?? null,
        role: member.role,
        accountStatus: member.status,
        lastLoginAt: member.user.lastLoginAt ?? null,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
      timezone: tenant?.timezone ?? null,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId/account", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        timezone: true,
        website: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!tenant) {
      return res.status(404).json({ error: "TENANT_NOT_FOUND" });
    }

    return res.json({
      ok: true,
      tenant,
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:tenantId/account", ...writeMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = UpdateTenantInfoSchema.parse(req.body);

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: payload.name,
        email: payload.email ?? null,
        phone: payload.phone ?? null,
        addressLine1: payload.addressLine1 ?? null,
        addressLine2: payload.addressLine2 ?? null,
        city: payload.city ?? null,
        state: payload.state ?? null,
        postalCode: payload.postalCode ?? null,
        country: payload.country ?? null,
        timezone: payload.timezone ?? null,
        website: payload.website ?? null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        timezone: true,
        website: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      ok: true,
      tenant,
    });
  } catch (error) {
    return next(error);
  }
});

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
  if (section !== "users" && section !== "account") {
    router.get(
      "/:tenantId/" + section,
      ...readMiddlewares,
      handleSectionListNotImplemented(section),
    );
  }
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
