import { type NextFunction, type Request, type Response, Router } from "express";
import argon2 from "argon2";
import multer from "multer";
import { randomUUID } from "crypto";
import { z } from "zod";

import { randomToken, sha256 } from "../lib/crypto.js";
import { deleteBlobByUrl, uploadPublicBlob } from "../lib/blob.js";
import { sendVerifyEmail } from "../lib/email.js";
import { prisma } from "../lib/prisma.js";
import { enforceSameOrigin } from "../lib/security.js";
import { deleteObject } from "../lib/s3.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
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
const TenantUserPathSchema = TenantPathSchema.extend({
  userId: z.string().min(1),
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

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .regex(/[A-Za-z]/, "Password must include at least one letter.")
  .regex(/[0-9]/, "Password must include at least one number.")
  .regex(/[^A-Za-z0-9]/, "Password must include at least one symbol.");

const CreateTenantMemberSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  password: passwordSchema.max(200),
  role: z.enum(["TENANT_ADMIN", "TENANT_USER"]).default("TENANT_USER"),
  securityLevel: z.enum(["LOW", "MEDIUM", "MAX"]).optional(),
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

const UpdateMemberSecurityLevelSchema = z.object({
  securityLevel: z.enum(["LOW", "MEDIUM", "MAX"]),
});

const UpdateTenantMemberSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
});

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES },
});

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function deleteLegacyAvatar(oldKey: string) {
  if (oldKey.startsWith("http://") || oldKey.startsWith("https://")) {
    await deleteBlobByUrl(oldKey).catch(() => {});
    return;
  }

  await deleteObject({ key: oldKey }).catch(() => {});
}

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

    const [total, activeMembersCount, members, tenant, subscription] = await prisma.$transaction([
      prisma.membership.count({
        where: { tenantId },
      }),
      prisma.membership.count({
        where: {
          tenantId,
          status: "ACTIVE",
        },
      }),
      prisma.membership.findMany({
        where: { tenantId },
        select: {
          userId: true,
          role: true,
          status: true,
          securityLevel: true,
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
      prisma.tenantSubscription.findUnique({
        where: { tenantId },
        select: {
          planKey: true,
          seatLimit: true,
        },
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
        securityLevel: member.securityLevel,
        lastLoginAt: member.user.lastLoginAt ?? null,
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
      seatUsage: subscription
        ? {
            used: activeMembersCount,
            limit: subscription.seatLimit,
            available: Math.max(0, subscription.seatLimit - activeMembersCount),
            planKey: subscription.planKey,
          }
        : null,
      timezone: tenant?.timezone ?? null,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:tenantId/users", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = CreateTenantMemberSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({
      where: { email: payload.email },
      select: { id: true },
    });

    if (existingUser) {
      return res.status(409).json({ error: "EMAIL_IN_USE" });
    }

    const [subscription, activeMembersCount] = await prisma.$transaction([
      prisma.tenantSubscription.findUnique({
        where: { tenantId },
        select: { seatLimit: true, planKey: true },
      }),
      prisma.membership.count({
        where: {
          tenantId,
          status: "ACTIVE",
        },
      }),
    ]);

    if (!subscription) {
      return res.status(409).json({ error: "SUBSCRIPTION_NOT_FOUND" });
    }

    if (activeMembersCount >= subscription.seatLimit) {
      return res.status(409).json({
        error: "SEAT_LIMIT_REACHED",
        details: {
          planKey: subscription.planKey,
          seatLimit: subscription.seatLimit,
          activeMembersCount,
        },
      });
    }

    const securityLevel =
      payload.securityLevel ??
      (payload.role === "TENANT_ADMIN" ? "MAX" : "LOW");

    const passwordHash = await argon2.hash(payload.password, {
      type: argon2.argon2id,
    });

    const verificationToken = randomToken(32);
    const verificationTokenHash = sha256(verificationToken);
    const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: payload.name,
          email: payload.email,
          passwordHash,
        },
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          image: true,
        },
      });

      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          tenantId,
          role: payload.role,
          status: "ACTIVE",
          securityLevel,
        },
        select: {
          role: true,
          status: true,
          securityLevel: true,
        },
      });

      await tx.emailVerification.create({
        data: {
          userId: user.id,
          tokenHash: verificationTokenHash,
          expiresAt: verificationExpiresAt,
        },
      });

      return {
        user,
        membership,
      };
    });

    const base = (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(
      /\/$/,
      "",
    );
    const verifyUrl = `${base}/verify?token=${encodeURIComponent(verificationToken)}`;
    await sendVerifyEmail(payload.email, verifyUrl);

    return res.status(201).json({
      ok: true,
      user: {
        id: created.user.id,
        name: created.user.name,
        email: created.user.email,
        avatar: created.user.image,
        emailVerified: created.user.emailVerified,
        role: created.membership.role,
        accountStatus: created.membership.status,
        securityLevel: created.membership.securityLevel,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId/users/:userId", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId, userId } = TenantUserPathSchema.parse(req.params);
    const now = new Date();

    const [member, tenant, recentSessions, recentVerifications] = await prisma.$transaction([
      prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            tenantId,
            userId,
          },
        },
        select: {
          userId: true,
          role: true,
          status: true,
          securityLevel: true,
          user: {
            select: {
              name: true,
              email: true,
              image: true,
              emailVerified: true,
              createdAt: true,
              updatedAt: true,
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
      }),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { timezone: true },
      }),
      prisma.session.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          ipAddress: true,
          userAgent: true,
        },
      }),
      prisma.emailVerification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          createdAt: true,
          usedAt: true,
          expiresAt: true,
        },
      }),
    ]);

    if (!member) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    const auditHistory = [
      {
        id: `created-${member.userId}`,
        type: "PROFILE_CREATED",
        title: "Profile created",
        detail: "User account was created.",
        at: member.user.createdAt,
      },
      ...recentVerifications.map((verification) => ({
        id: verification.id,
        type: verification.usedAt ? "EMAIL_VERIFIED" : "EMAIL_VERIFICATION_REQUESTED",
        title: verification.usedAt ? "Email verified" : "Verification requested",
        detail: verification.usedAt
          ? "User email verification was completed."
          : "Verification email was requested.",
        at: verification.usedAt ?? verification.createdAt,
      })),
      {
        id: `updated-${member.userId}`,
        type: "PROFILE_UPDATED",
        title: "Profile updated",
        detail: "User profile fields were updated.",
        at: member.user.updatedAt,
      },
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 10);

    return res.json({
      ok: true,
      user: {
        id: member.userId,
        name: member.user.name,
        email: member.user.email,
        avatar: member.user.image ?? null,
        emailVerified: member.user.emailVerified,
        isOnline: member.user.sessions.length > 0,
        sessionCreatedAt: member.user.sessions[0]?.createdAt ?? null,
        role: member.role,
        accountStatus: member.status,
        securityLevel: member.securityLevel,
        lastLoginAt: member.user.lastLoginAt ?? null,
        createdAt: member.user.createdAt,
        updatedAt: member.user.updatedAt,
        timezone: tenant?.timezone ?? null,
        activity: {
          recentSessions: recentSessions.map((session) => ({
            id: session.id,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            ipAddress: session.ipAddress ?? null,
            userAgent: session.userAgent ?? null,
            isActive: session.expiresAt.getTime() > now.getTime(),
          })),
        },
        auditHistory: auditHistory.map((event) => ({
          id: event.id,
          type: event.type,
          title: event.title,
          detail: event.detail,
          at: event.at,
        })),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:tenantId/users/:userId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, userId } = TenantUserPathSchema.parse(req.params);
    const payload = UpdateTenantMemberSchema.parse(req.body);

    const membership = await prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          tenantId,
          userId,
        },
      },
      select: {
        userId: true,
        role: true,
      },
    });

    if (!membership) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!current) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    const normalizedEmail = payload.email.trim().toLowerCase();
    const isEmailChanging = normalizedEmail !== current.email;

    if (isEmailChanging) {
      const existing = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });
      if (existing && existing.id !== userId) {
        return res.status(409).json({ error: "EMAIL_IN_USE" });
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        name: payload.name,
        email: normalizedEmail,
        emailVerified: isEmailChanging ? false : undefined,
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      ok: true,
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        avatar: updated.image ?? null,
        emailVerified: updated.emailVerified,
        role: membership.role,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:tenantId/users/:userId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const authed = (req as AuthedRequest).user;
    const { tenantId, userId } = TenantUserPathSchema.parse(req.params);

    if (authed.id === userId) {
      return res.status(400).json({ error: "CANNOT_DELETE_SELF" });
    }

    const membership = await prisma.membership.findUnique({
      where: {
        userId_tenantId: {
          tenantId,
          userId,
        },
      },
      select: {
        role: true,
      },
    });

    if (!membership) {
      return res.status(404).json({ error: "USER_NOT_FOUND" });
    }

    if (membership.role === "TENANT_ADMIN") {
      const otherAdmins = await prisma.membership.count({
        where: {
          tenantId,
          role: "TENANT_ADMIN",
          status: "ACTIVE",
          NOT: { userId },
        },
      });

      if (otherAdmins < 1) {
        return res.status(409).json({ error: "LAST_TENANT_ADMIN" });
      }
    }

    const membershipCount = await prisma.membership.count({
      where: { userId },
    });

    if (membershipCount > 1) {
      await prisma.membership.delete({
        where: {
          userId_tenantId: {
            tenantId,
            userId,
          },
        },
      });
      return res.json({
        ok: true,
        deletedScope: "TENANT_MEMBERSHIP",
      });
    }

    await prisma.user.delete({
      where: { id: userId },
    });

    return res.json({
      ok: true,
      deletedScope: "USER_ACCOUNT",
    });
  } catch (error) {
    return next(error);
  }
});

router.post(
  "/:tenantId/users/:userId/request-email-verification",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId, userId } = TenantUserPathSchema.parse(req.params);

      const membership = await prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            tenantId,
            userId,
          },
        },
        select: {
          user: {
            select: {
              id: true,
              email: true,
              emailVerified: true,
            },
          },
        },
      });

      if (!membership?.user) {
        return res.status(404).json({ error: "USER_NOT_FOUND" });
      }

      if (membership.user.emailVerified) {
        return res.status(409).json({ error: "EMAIL_ALREADY_VERIFIED" });
      }

      const verificationToken = randomToken(32);
      const verificationTokenHash = sha256(verificationToken);
      const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await prisma.$transaction(async (tx) => {
        await tx.emailVerification.deleteMany({
          where: { userId: membership.user.id },
        });
        await tx.emailVerification.create({
          data: {
            userId: membership.user.id,
            tokenHash: verificationTokenHash,
            expiresAt: verificationExpiresAt,
          },
        });
      });

      const base = (process.env.WEB_ORIGIN ?? "http://localhost:3000").replace(
        /\/$/,
        "",
      );
      const verifyUrl = `${base}/verify?token=${encodeURIComponent(verificationToken)}`;
      await sendVerifyEmail(membership.user.email, verifyUrl);

      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/:tenantId/users/:userId/avatar-upload",
  ...writeMiddlewares,
  avatarUpload.single("file"),
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const authed = (req as AuthedRequest).user;
      const { tenantId, userId } = TenantUserPathSchema.parse(req.params);
      const file = (req as any).file as
        | {
            mimetype: string;
            size: number;
            originalname: string;
            buffer: Buffer;
          }
        | undefined;

      if (!file) {
        return res.status(400).json({ error: "FILE_REQUIRED" });
      }

      const contentType = file.mimetype;
      if (!["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(contentType)) {
        return res.status(400).json({ error: "UNSUPPORTED_CONTENT_TYPE" });
      }
      if (file.size > IMAGE_MAX_BYTES) {
        return res.status(400).json({ error: "FILE_TOO_LARGE" });
      }

      const membership = await prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            tenantId,
            userId,
          },
        },
        select: {
          userId: true,
        },
      });

      if (!membership) {
        return res.status(404).json({ error: "USER_NOT_FOUND" });
      }

      const fileId = randomUUID();
      const safeFilename = sanitizeFilename(file.originalname || "avatar");
      const pathname = `tenants/${tenantId}/avatars/${userId}/${fileId}/${safeFilename}`;
      const blob = await uploadPublicBlob({
        pathname,
        body: file.buffer,
        contentType,
      });

      await prisma.file.create({
        data: {
          id: fileId,
          tenantId,
          key: blob.url,
          contentType,
          size: file.size,
          createdById: authed.id,
          purpose: "AVATAR",
        },
      });

      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { image: true },
      });
      const oldKey = existingUser?.image ?? null;

      await prisma.user.update({
        where: { id: userId },
        data: { image: blob.url },
      });

      if (oldKey && oldKey !== blob.url) {
        const oldFile = await prisma.file.findUnique({ where: { key: oldKey } });
        if (oldFile?.tenantId === tenantId) {
          await prisma.file.delete({ where: { key: oldKey } }).catch(() => {});
        }
        await deleteLegacyAvatar(oldKey);
      }

      return res.json({ ok: true, imageUrl: blob.url, fileId });
    } catch (error) {
      return next(error);
    }
  },
);

router.patch(
  "/:tenantId/users/:userId/security-level",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      const { tenantId, userId } = TenantUserPathSchema.parse(req.params);
      const { securityLevel } = UpdateMemberSecurityLevelSchema.parse(req.body);

      const existingMembership = await prisma.membership.findUnique({
        where: {
          userId_tenantId: {
            tenantId,
            userId,
          },
        },
        select: {
          userId: true,
          tenantId: true,
          role: true,
          status: true,
          securityLevel: true,
        },
      });

      if (!existingMembership) {
        return res.status(404).json({ error: "USER_NOT_FOUND" });
      }

      if (
        existingMembership.role === "TENANT_ADMIN" &&
        securityLevel !== "MAX"
      ) {
        return res.status(400).json({
          error: "TENANT_ADMIN_SECURITY_LEVEL_FIXED",
        });
      }

      const membership = await prisma.membership.update({
        where: {
          userId_tenantId: {
            tenantId,
            userId,
          },
        },
        data: {
          securityLevel,
        },
        select: {
          userId: true,
          tenantId: true,
          role: true,
          status: true,
          securityLevel: true,
        },
      });

      return res.json({
        ok: true,
        membership,
      });
    } catch (error) {
      return next(error);
    }
  },
);

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
