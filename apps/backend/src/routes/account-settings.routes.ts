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
const prismaWithContacts = prisma as any;

const ACCOUNT_SETTINGS_SECTIONS = [
  "users",
  "account",
  "services",
  "professionals",
  "follow-ups",
  "status-config",
  "tags",
  "features",
  "subscription",
  "custom-fields",
] as const;

type AccountSettingsSection = (typeof ACCOUNT_SETTINGS_SECTIONS)[number];

const TenantPathSchema = z.object({
  tenantId: z.string().min(1),
});

const StatusConfigKeySchema = z.enum(["contacts", "tasks"]);

const TenantStatusConfigPathSchema = TenantPathSchema.extend({
  configKey: StatusConfigKeySchema,
});

const TenantRecordPathSchema = TenantPathSchema.extend({
  recordId: z.string().min(1),
});
const TenantStatusConfigRecordPathSchema = TenantStatusConfigPathSchema.extend({
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

const STATUS_HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const CreateContactStatusConfigSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bgColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX),
  textColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().default(true),
});

const UpdateContactStatusConfigSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  bgColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX).optional(),
  textColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

const CreateTenantTagSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bgColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX),
  textColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

const UpdateTenantTagSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  bgColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX).optional(),
  textColor: z.string().trim().regex(STATUS_HEX_COLOR_REGEX).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

const ContactCustomFieldTypeSchema = z.enum([
  "TEXT",
  "NUMBER",
  "PHONE",
  "CURRENCY",
  "DATE",
  "SELECT",
  "MULTI_SELECT",
  "RADIO",
  "TEXTAREA",
  "CHECKBOX",
]);

const CustomFieldOptionsSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(50)
  .optional();

const CreateContactCustomFieldSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: optionalStringField(500),
  fieldType: ContactCustomFieldTypeSchema,
  isRequired: z.boolean().default(false),
  isEncrypted: z.boolean().default(false),
  isActive: z.boolean().default(true),
  options: CustomFieldOptionsSchema,
});

const UpdateContactCustomFieldSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  description: optionalStringField(500),
  fieldType: ContactCustomFieldTypeSchema.optional(),
  isRequired: z.boolean().optional(),
  isEncrypted: z.boolean().optional(),
  isActive: z.boolean().optional(),
  options: CustomFieldOptionsSchema,
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
});

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES },
});

const CONTACT_DEFAULT_STATUSES = [
  {
    name: "Active",
    bgColor: "#DCFCE7",
    textColor: "#166534",
    sortOrder: 10,
  },
  {
    name: "Inactive",
    bgColor: "#E2E8F0",
    textColor: "#334155",
    sortOrder: 20,
  },
  {
    name: "Pending",
    bgColor: "#FEF3C7",
    textColor: "#92400E",
    sortOrder: 30,
  },
] as const;

const TASK_DEFAULT_STATUSES = [
  {
    name: "To Do",
    bgColor: "#E2E8F0",
    textColor: "#334155",
    sortOrder: 10,
  },
  {
    name: "In Progress",
    bgColor: "#DBEAFE",
    textColor: "#1E3A8A",
    sortOrder: 20,
  },
  {
    name: "Completed",
    bgColor: "#DCFCE7",
    textColor: "#166534",
    sortOrder: 30,
  },
] as const;

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function slugifyCustomFieldKey(value: string) {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "custom_field";
}

function normalizeTenantTagName(value: string) {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized;
}

function normalizeCustomFieldOptions(options?: string[]) {
  if (!options) return null;

  const uniqueValues = [
    ...new Map(
      options
        .map((option) => option.trim())
        .filter(Boolean)
        .map((option) => [option.toLowerCase(), option]),
    ).values(),
  ];

  return uniqueValues.length > 0 ? uniqueValues : null;
}

function fieldTypeSupportsOptions(fieldType: z.infer<typeof ContactCustomFieldTypeSchema>) {
  return (
    fieldType === "SELECT" || fieldType === "MULTI_SELECT" || fieldType === "RADIO"
  );
}

function validateCustomFieldOptions(
  fieldType: z.infer<typeof ContactCustomFieldTypeSchema>,
  options?: string[] | null,
) {
  const normalizedOptions = normalizeCustomFieldOptions(options ?? undefined);

  if (fieldTypeSupportsOptions(fieldType)) {
    if (!normalizedOptions?.length) {
      return {
        ok: false as const,
        error: "FIELD_OPTIONS_REQUIRED",
        details: [{ path: "options", message: "At least one option is required." }],
      };
    }
  } else if (normalizedOptions?.length) {
    return {
      ok: false as const,
      error: "FIELD_OPTIONS_NOT_SUPPORTED",
      details: [{ path: "options", message: "Options are only supported for choice fields." }],
    };
  }

  return {
    ok: true as const,
    options: normalizedOptions,
  };
}

async function buildUniqueCustomFieldKey(tenantId: string, label: string, excludeId?: string) {
  const baseKey = slugifyCustomFieldKey(label);

  const existing = await prismaWithContacts.contactCustomField.findMany({
    where: {
      tenantId,
      key: {
        startsWith: baseKey,
      },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: {
      key: true,
    },
  });

  const existingKeys = new Set(existing.map((item: { key: string }) => item.key));
  if (!existingKeys.has(baseKey)) {
    return baseKey;
  }

  let counter = 2;
  while (existingKeys.has(`${baseKey}_${counter}`)) {
    counter += 1;
  }

  return `${baseKey}_${counter}`;
}

async function deleteLegacyAvatar(oldKey: string) {
  if (oldKey.startsWith("http://") || oldKey.startsWith("https://")) {
    await deleteBlobByUrl(oldKey).catch(() => {});
    return;
  }

  await deleteObject({ key: oldKey }).catch(() => {});
}

async function ensureDefaultContactStatuses(tenantId: string) {
  await prismaWithContacts.contactStatusConfig.updateMany({
    where: {
      tenantId,
      name: { in: CONTACT_DEFAULT_STATUSES.map((item) => item.name) },
      isSystemDefault: false,
    },
    data: {
      isSystemDefault: true,
    },
  });

  await prismaWithContacts.contactStatusConfig.createMany({
    data: CONTACT_DEFAULT_STATUSES.map((item) => ({
      tenantId,
      name: item.name,
      bgColor: item.bgColor,
      textColor: item.textColor,
      sortOrder: item.sortOrder,
      isActive: true,
      isSystemDefault: true,
    })),
    skipDuplicates: true,
  });
}

async function ensureDefaultTaskStatuses(tenantId: string) {
  await prismaWithContacts.taskStatusConfig.updateMany({
    where: {
      tenantId,
      name: { in: TASK_DEFAULT_STATUSES.map((item) => item.name) },
      isSystemDefault: false,
    },
    data: {
      isSystemDefault: true,
    },
  });

  await prismaWithContacts.taskStatusConfig.createMany({
    data: TASK_DEFAULT_STATUSES.map((item) => ({
      tenantId,
      name: item.name,
      bgColor: item.bgColor,
      textColor: item.textColor,
      sortOrder: item.sortOrder,
      isActive: true,
      isSystemDefault: true,
    })),
    skipDuplicates: true,
  });
}

async function ensureDefaultStatusesForConfigKey(
  tenantId: string,
  configKey: z.infer<typeof StatusConfigKeySchema>,
) {
  if (configKey === "contacts") {
    await ensureDefaultContactStatuses(tenantId);
    return;
  }

  await ensureDefaultTaskStatuses(tenantId);
}

async function findTenantTagByName(tenantId: string, name: string, excludeId?: string) {
  const normalizedName = normalizeTenantTagName(name);

  return prismaWithContacts.tenantTag.findFirst({
    where: {
      tenantId,
      name: normalizedName,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: {
      id: true,
    },
  });
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

router.get("/:tenantId/status-config", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);

    await ensureDefaultContactStatuses(tenantId);
    await ensureDefaultTaskStatuses(tenantId);

    const contactStatuses = await prismaWithContacts.contactStatusConfig.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        isActive: true,
        isSystemDefault: true,
      },
    });
    const taskStatuses = await prismaWithContacts.taskStatusConfig.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        isActive: true,
        isSystemDefault: true,
      },
    });

    return res.json({
      ok: true,
      configurations: [
        {
          key: "contacts",
          label: "Contacts",
          statusCount: contactStatuses.length,
          activeStatusCount: contactStatuses.filter((item: { isActive: boolean }) => item.isActive).length,
        },
        {
          key: "tasks",
          label: "Tasks",
          statusCount: taskStatuses.length,
          activeStatusCount: taskStatuses.filter((item: { isActive: boolean }) => item.isActive).length,
        },
      ],
      contactStatuses,
      taskStatuses,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId/status-config/:configKey", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId, configKey } = TenantStatusConfigPathSchema.parse(req.params);
    await ensureDefaultStatusesForConfigKey(tenantId, configKey);

    const statusModel =
      configKey === "contacts"
        ? prismaWithContacts.contactStatusConfig
        : prismaWithContacts.taskStatusConfig;
    const statuses = await statusModel.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        isActive: true,
        isSystemDefault: true,
      },
    });

    return res.json({
      ok: true,
      configKey,
      statuses,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:tenantId/status-config/:configKey", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, configKey } = TenantStatusConfigPathSchema.parse(req.params);
    await ensureDefaultStatusesForConfigKey(tenantId, configKey);

    const payload = CreateContactStatusConfigSchema.parse(req.body);
    const normalizedName = payload.name.trim();
    const statusModel =
      configKey === "contacts"
        ? prismaWithContacts.contactStatusConfig
        : prismaWithContacts.taskStatusConfig;
    const maxSortOrderRecord = await statusModel.findFirst({
      where: { tenantId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSortOrder = (maxSortOrderRecord?.sortOrder ?? 0) + 10;

    const created = await statusModel.create({
      data: {
        tenantId,
        name: normalizedName,
        bgColor: payload.bgColor,
        textColor: payload.textColor,
        sortOrder: payload.sortOrder ?? nextSortOrder,
        isActive: payload.isActive,
        isSystemDefault: false,
      },
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        isActive: true,
        isSystemDefault: true,
      },
    });

    return res.status(201).json({ ok: true, status: created });
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/:tenantId/status-config/:configKey/:recordId",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId, configKey, recordId } =
        TenantStatusConfigRecordPathSchema.parse(req.params);
      await ensureDefaultStatusesForConfigKey(tenantId, configKey);
      const payload = UpdateContactStatusConfigSchema.parse(req.body);

      if (Object.keys(payload).length === 0) {
        return res.status(400).json({ error: "NO_CHANGES_PROVIDED" });
      }

      const statusModel =
        configKey === "contacts"
          ? prismaWithContacts.contactStatusConfig
          : prismaWithContacts.taskStatusConfig;
      const existing = await statusModel.findUnique({
        where: { id: recordId },
        select: {
          id: true,
          tenantId: true,
          isSystemDefault: true,
        },
      });

      if (!existing || existing.tenantId !== tenantId) {
        return res.status(404).json({ error: "STATUS_NOT_FOUND" });
      }

      if (existing.isSystemDefault && payload.name) {
        return res
          .status(400)
          .json({ error: "DEFAULT_STATUS_NAME_CANNOT_BE_CHANGED" });
      }

      const updated = await statusModel.update({
        where: { id: recordId },
        data: {
          name: payload.name?.trim(),
          bgColor: payload.bgColor,
          textColor: payload.textColor,
          sortOrder: payload.sortOrder,
          isActive: payload.isActive,
        },
        select: {
          id: true,
          name: true,
          bgColor: true,
          textColor: true,
          sortOrder: true,
          isActive: true,
          isSystemDefault: true,
        },
      });

      return res.json({ ok: true, status: updated });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  "/:tenantId/status-config/:configKey/:recordId",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId, configKey, recordId } =
        TenantStatusConfigRecordPathSchema.parse(req.params);
      await ensureDefaultStatusesForConfigKey(tenantId, configKey);

      const statusModel =
        configKey === "contacts"
          ? prismaWithContacts.contactStatusConfig
          : prismaWithContacts.taskStatusConfig;
      const existing = await statusModel.findUnique({
        where: { id: recordId },
        select: {
          id: true,
          tenantId: true,
          isSystemDefault: true,
        },
      });

      if (!existing || existing.tenantId !== tenantId) {
        return res.status(404).json({ error: "STATUS_NOT_FOUND" });
      }

      if (existing.isSystemDefault) {
        return res.status(409).json({ error: "CANNOT_DELETE_DEFAULT_STATUS" });
      }

      if (configKey === "contacts") {
        const inUseCount = await prismaWithContacts.contact.count({
          where: {
            tenantId,
            statusConfigId: recordId,
          },
        });

        if (inUseCount > 0) {
          return res.status(409).json({
            error: "STATUS_IN_USE",
            details: { contactCount: inUseCount },
          });
        }
      }

      await statusModel.delete({
        where: { id: recordId },
      });

      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  },
);

router.get("/:tenantId/tags", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);

    const tags = await prismaWithContacts.tenantTag.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      ok: true,
      tags,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:tenantId/tags", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = CreateTenantTagSchema.parse(req.body);
    const normalizedName = normalizeTenantTagName(payload.name);

    if (!normalizedName) {
      return res.status(400).json({ error: "INVALID_TAG_NAME" });
    }

    const duplicate = await findTenantTagByName(tenantId, normalizedName);
    if (duplicate) {
      return res.status(409).json({ error: "TAG_NAME_ALREADY_EXISTS" });
    }

    const maxSortOrderRecord = await prismaWithContacts.tenantTag.findFirst({
      where: { tenantId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSortOrder = (maxSortOrderRecord?.sortOrder ?? 0) + 10;

    const created = await prismaWithContacts.tenantTag.create({
      data: {
        tenantId,
        name: normalizedName,
        bgColor: payload.bgColor,
        textColor: payload.textColor,
        sortOrder: payload.sortOrder ?? nextSortOrder,
      },
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(201).json({ ok: true, tag: created });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:tenantId/tags/:recordId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
    const payload = UpdateTenantTagSchema.parse(req.body);

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: "NO_CHANGES_PROVIDED" });
    }

    const existing = await prismaWithContacts.tenantTag.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!existing || existing.tenantId !== tenantId) {
      return res.status(404).json({ error: "TAG_NOT_FOUND" });
    }

    if (payload.name) {
      const normalizedName = normalizeTenantTagName(payload.name);
      if (!normalizedName) {
        return res.status(400).json({ error: "INVALID_TAG_NAME" });
      }

      const duplicate = await findTenantTagByName(tenantId, payload.name, recordId);
      if (duplicate) {
        return res.status(409).json({ error: "TAG_NAME_ALREADY_EXISTS" });
      }
    }

    const updated = await prismaWithContacts.tenantTag.update({
      where: { id: recordId },
      data: {
        name: payload.name ? normalizeTenantTagName(payload.name) : undefined,
        bgColor: payload.bgColor,
        textColor: payload.textColor,
        sortOrder: payload.sortOrder,
      },
      select: {
        id: true,
        name: true,
        bgColor: true,
        textColor: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({ ok: true, tag: updated });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:tenantId/tags/:recordId", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);

    const existing = await prismaWithContacts.tenantTag.findUnique({
      where: { id: recordId },
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!existing || existing.tenantId !== tenantId) {
      return res.status(404).json({ error: "TAG_NOT_FOUND" });
    }

    await prismaWithContacts.tenantTag.delete({
      where: { id: recordId },
    });

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/:tenantId/custom-fields", ...readMiddlewares, async (req, res, next) => {
  try {
    const { tenantId } = TenantPathSchema.parse(req.params);

    const customFields = await prismaWithContacts.contactCustomField.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: {
        id: true,
        key: true,
        label: true,
        description: true,
        fieldType: true,
        isRequired: true,
        isEncrypted: true,
        isActive: true,
        options: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      ok: true,
      customFields: customFields.map((field: any) => ({
        ...field,
        options: Array.isArray(field.options) ? field.options : [],
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:tenantId/custom-fields", ...writeMiddlewares, async (req, res, next) => {
  try {
    enforceSameOrigin(req);

    const { tenantId } = TenantPathSchema.parse(req.params);
    const payload = CreateContactCustomFieldSchema.parse(req.body);
    const optionValidation = validateCustomFieldOptions(payload.fieldType, payload.options);

    if (!optionValidation.ok) {
      return res.status(400).json({
        error: optionValidation.error,
        details: optionValidation.details,
      });
    }

    const maxSortOrderRecord = await prismaWithContacts.contactCustomField.findFirst({
      where: { tenantId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSortOrder = (maxSortOrderRecord?.sortOrder ?? 0) + 10;
    const uniqueKey = await buildUniqueCustomFieldKey(tenantId, payload.label);

    const created = await prismaWithContacts.contactCustomField.create({
      data: {
        tenantId,
        key: uniqueKey,
        label: payload.label.trim(),
        description: payload.description ?? null,
        fieldType: payload.fieldType,
        isRequired: payload.isRequired,
        isEncrypted: payload.isEncrypted,
        isActive: payload.isActive,
        options: optionValidation.options,
        sortOrder: nextSortOrder,
      },
      select: {
        id: true,
        key: true,
        label: true,
        description: true,
        fieldType: true,
        isRequired: true,
        isEncrypted: true,
        isActive: true,
        options: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(201).json({
      ok: true,
      customField: {
        ...created,
        options: Array.isArray(created.options) ? created.options : [],
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.patch(
  "/:tenantId/custom-fields/:recordId",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);
      const payload = UpdateContactCustomFieldSchema.parse(req.body);

      if (Object.keys(payload).length === 0) {
        return res.status(400).json({ error: "NO_CHANGES_PROVIDED" });
      }

      const existing = await prismaWithContacts.contactCustomField.findUnique({
        where: { id: recordId },
        select: {
          id: true,
          tenantId: true,
          label: true,
          fieldType: true,
          options: true,
        },
      });

      if (!existing || existing.tenantId !== tenantId) {
        return res.status(404).json({ error: "CUSTOM_FIELD_NOT_FOUND" });
      }

      const nextFieldType = payload.fieldType ?? existing.fieldType;
      const nextOptions = payload.options ?? (Array.isArray(existing.options) ? existing.options : []);
      const optionValidation = validateCustomFieldOptions(nextFieldType, nextOptions);

      if (!optionValidation.ok) {
        return res.status(400).json({
          error: optionValidation.error,
          details: optionValidation.details,
        });
      }

      const nextLabel = payload.label?.trim() ?? existing.label;
      const nextKey =
        nextLabel !== existing.label
          ? await buildUniqueCustomFieldKey(tenantId, nextLabel, recordId)
          : undefined;

      const updated = await prismaWithContacts.contactCustomField.update({
        where: { id: recordId },
        data: {
          key: nextKey,
          label: payload.label?.trim(),
          description: payload.description,
          fieldType: payload.fieldType,
          isRequired: payload.isRequired,
          isEncrypted: payload.isEncrypted,
          isActive: payload.isActive,
          options: optionValidation.options,
          sortOrder: payload.sortOrder,
        },
        select: {
          id: true,
          key: true,
          label: true,
          description: true,
          fieldType: true,
          isRequired: true,
          isEncrypted: true,
          isActive: true,
          options: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return res.json({
        ok: true,
        customField: {
          ...updated,
          options: Array.isArray(updated.options) ? updated.options : [],
        },
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.delete(
  "/:tenantId/custom-fields/:recordId",
  ...writeMiddlewares,
  async (req, res, next) => {
    try {
      enforceSameOrigin(req);

      const { tenantId, recordId } = TenantRecordPathSchema.parse(req.params);

      const existing = await prismaWithContacts.contactCustomField.findUnique({
        where: { id: recordId },
        select: {
          id: true,
          tenantId: true,
        },
      });

      if (!existing || existing.tenantId !== tenantId) {
        return res.status(404).json({ error: "CUSTOM_FIELD_NOT_FOUND" });
      }

      await prismaWithContacts.contactCustomField.delete({
        where: { id: recordId },
      });

      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  },
);

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
  if (
    section !== "users" &&
    section !== "account" &&
    section !== "status-config" &&
    section !== "tags" &&
    section !== "custom-fields"
  ) {
    router.get(
      "/:tenantId/" + section,
      ...readMiddlewares,
      handleSectionListNotImplemented(section),
    );
  }
  if (
    section === "users" ||
    section === "account" ||
    section === "status-config" ||
    section === "tags" ||
    section === "custom-fields"
  ) {
    continue;
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
